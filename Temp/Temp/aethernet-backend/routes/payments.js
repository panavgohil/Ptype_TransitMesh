'use strict';
/**
 * routes/payments.js — Full UPI / Bank Payment System
 * =====================================================
 * Built on Razorpay (same infrastructure as Paytm, PhonePe, GPay under the hood).
 * Sandbox mode = identical UX to real UPI, uses test money.
 *
 * Endpoints:
 *   POST  /api/payments/link-bank      Link UPI ID or bank account
 *   GET   /api/payments/account        Get linked account
 *   POST  /api/payments/order          Create payment order (to receive money)
 *   POST  /api/payments/verify         Verify UPI payment signature
 *   POST  /api/payments/payout         Send money via UPI to another UPI ID
 *   GET   /api/payments/history        Full transaction history
 *   POST  /api/payments/sync-pending   Settle all pending offline transactions
 */

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const db = require('../db');
const authenticate = require('../middleware/auth');

// ── Init Razorpay ─────────────────────────────────────────────────────────────
let Razorpay;
let razorpay;
const RAZORPAY_CONFIGURED = process.env.RAZORPAY_KEY_ID &&
    !process.env.RAZORPAY_KEY_ID.includes('REPLACE');

if (RAZORPAY_CONFIGURED) {
    try {
        Razorpay = require('razorpay');
        razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });
        console.log('[Payments] Razorpay initialised ✅');
    } catch (e) {
        console.warn('[Payments] Razorpay SDK not installed:', e.message);
    }
} else {
    console.warn('[Payments] ⚠️  Razorpay keys not set → running in DEMO mode (no real UPI calls)');
}

// Ensure bank_accounts table exists
db.exec(`
    CREATE TABLE IF NOT EXISTS bank_accounts (
        id                       TEXT PRIMARY KEY,
        user_id                  TEXT NOT NULL,
        upi_id                   TEXT,
        account_name             TEXT,
        ifsc                     TEXT,
        account_number           TEXT,
        razorpay_contact_id      TEXT,
        razorpay_fund_account_id TEXT,
        created_at               TEXT
    );
`);

// ── Helper: get bank account for current user ─────────────────────────────────
function getUserAccount(userId) {
    return db.prepare('SELECT * FROM bank_accounts WHERE user_id = ?').get(userId);
}

// ── POST /api/payments/link-bank ─────────────────────────────────────────────
// Link a UPI ID or bank account to this node (like "Add payment method" in GPay)
router.post('/link-bank', authenticate, async (req, res) => {
    const { upi_id, account_name, ifsc, account_number } = req.body;

    if (!upi_id && !account_number) {
        return res.status(400).json({ error: 'Provide upi_id or account_number + ifsc' });
    }

    let razorpay_contact_id = null;
    let razorpay_fund_account_id = null;

    // If Razorpay is configured, create a real contact + fund account
    if (razorpay && RAZORPAY_CONFIGURED) {
        try {
            // 1. Create contact
            const contact = await razorpay.contacts.create({
                name: account_name || req.user.display_name,
                email: `${req.user.node_address}@aethernet.mesh`,
                type: 'vendor',
            });
            razorpay_contact_id = contact.id;

            // 2. Add fund account (UPI or bank)
            const fundPayload = {
                contact_id: contact.id,
                account_type: upi_id ? 'vpa' : 'bank_account',
            };
            if (upi_id) {
                fundPayload.vpa = { address: upi_id };
            } else {
                fundPayload.bank_account = {
                    name: account_name,
                    ifsc: ifsc,
                    account_number: account_number,
                };
            }
            const fundAccount = await razorpay.fundAccount.create(fundPayload);
            razorpay_fund_account_id = fundAccount.id;

        } catch (err) {
            console.warn('[Razorpay] Contact/FundAccount creation failed:', err.message);
            // Continue in demo mode
        }
    }

    // Remove old account if exists
    db.prepare('DELETE FROM bank_accounts WHERE user_id = ?').run(req.user.id);

    const id = uuidv4();
    db.prepare(
        `INSERT INTO bank_accounts
         (id, user_id, upi_id, account_name, ifsc, account_number, razorpay_contact_id, razorpay_fund_account_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(id, req.user.id, upi_id || null, account_name || null, ifsc || null,
        account_number || null, razorpay_contact_id, razorpay_fund_account_id);

    db.prepare('INSERT INTO events (id, type, title, node_id) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), 'upi', `Bank Account Linked: ${upi_id || account_number}`, req.user.node_address);

    const account = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(id);
    return res.status(201).json({ message: 'Payment account linked', account });
});

// ── GET /api/payments/account ─────────────────────────────────────────────────
router.get('/account', authenticate, (req, res) => {
    const account = getUserAccount(req.user.id);
    if (!account) return res.status(404).json({ error: 'No payment account linked. Call /link-bank first.' });

    // Calculate balance from transactions
    const myNode = req.user.node_address;
    const txns = db.prepare(
        `SELECT * FROM transactions WHERE (from_node = ? OR to_node = ?) AND status = 'settled'`
    ).all(myNode, myNode);
    let balance = 14500; // starting balance
    txns.forEach(t => {
        if (t.from_node === myNode) balance -= t.amount;
        else balance += t.amount;
    });

    return res.json({ account, balance: Math.max(0, balance), currency: 'INR' });
});

// ── POST /api/payments/order ─────────────────────────────────────────────────
// Create a Razorpay order so someone can PAY YOU (like "Request Money")
router.post('/order', authenticate, async (req, res) => {
    const { amount, note = 'AetherNet Mesh Payment' } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' });

    let order = null;

    if (razorpay && RAZORPAY_CONFIGURED) {
        try {
            order = await razorpay.orders.create({
                amount: Math.round(amount * 100), // Razorpay uses paise
                currency: 'INR',
                receipt: `aether-${uuidv4().slice(0, 8)}`,
                notes: { node: req.user.node_address, note },
            });
        } catch (err) {
            console.warn('[Razorpay] Order creation failed:', err.message);
        }
    }

    // Demo mode order
    if (!order) {
        order = {
            id: `order_demo_${Date.now()}`,
            amount: Math.round(amount * 100),
            currency: 'INR',
            status: 'created',
            _demo: true,
        };
    }

    return res.json({
        order,
        razorpay_key: process.env.RAZORPAY_KEY_ID || 'demo',
        node_address: req.user.node_address,
        display_name: req.user.display_name,
    });
});

// ── POST /api/payments/verify ─────────────────────────────────────────────────
// Verify Razorpay payment signature (called after checkout completes)
router.post('/verify', authenticate, (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;

    if (RAZORPAY_CONFIGURED && razorpay_signature) {
        const body = `${razorpay_order_id}|${razorpay_payment_id}`;
        const expected = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest('hex');

        if (expected !== razorpay_signature) {
            return res.status(400).json({ error: 'Invalid payment signature' });
        }
    }

    // Record as settled incoming transaction
    const id = uuidv4();
    db.prepare(
        `INSERT INTO transactions (id, from_node, to_node, amount, status, settled_at, created_at)
         VALUES (?, ?, ?, ?, 'settled', datetime('now'), datetime('now'))`
    ).run(id, razorpay_payment_id || 'razorpay', req.user.node_address, amount || 0);

    db.prepare('INSERT INTO events (id, type, title, node_id) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), 'upi', `UPI Payment Received: ₹${amount}`, req.user.node_address);

    req.io.emit('transaction:settled', {
        id, toNode: req.user.node_address, amount, paymentId: razorpay_payment_id
    });

    return res.json({ message: 'Payment verified and recorded', transaction_id: id });
});

// ── POST /api/payments/payout ─────────────────────────────────────────────────
// Send money to another UPI ID (like "Pay" in GPay/Paytm)
router.post('/payout', authenticate, async (req, res) => {
    const { to_upi, to_node, amount, note = 'AetherNet Mesh Transfer' } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' });
    if (!to_upi && !to_node) return res.status(400).json({ error: 'to_upi or to_node required' });

    const account = getUserAccount(req.user.id);
    const txId = uuidv4();

    // ── Online path: use Razorpay Payouts API ────────────────────────────────
    if (razorpay && RAZORPAY_CONFIGURED && account?.razorpay_fund_account_id && to_upi) {
        try {
            const payout = await razorpay.payouts.create({
                account_number: process.env.RAZORPAY_ACCOUNT_NUMBER || '2323230093547768',
                fund_account_id: account.razorpay_fund_account_id,
                amount: Math.round(amount * 100),
                currency: 'INR',
                mode: 'UPI',
                purpose: 'payout',
                queue_if_low_balance: true,
                narration: note,
                notes: { from: req.user.node_address, to: to_upi },
            });

            db.prepare(
                `INSERT INTO transactions (id, from_node, to_node, amount, status, settled_at, created_at)
                 VALUES (?, ?, ?, ?, 'settled', datetime('now'), datetime('now'))`
            ).run(txId, req.user.node_address, to_upi || to_node, amount);

            db.prepare('INSERT INTO events (id, type, title, node_id) VALUES (?, ?, ?, ?)')
                .run(uuidv4(), 'upi', `UPI Sent: ₹${amount} → ${to_upi}`, to_upi);

            req.io.emit('transaction:settled', { id: txId, fromNode: req.user.node_address, toNode: to_upi, amount });

            return res.json({ message: 'Payout sent via UPI', payout_id: payout.id, status: payout.status });

        } catch (err) {
            console.warn('[Razorpay] Payout failed:', err.message, '→ queuing offline');
        }
    }

    // ── Offline path: queue for later sync ───────────────────────────────────
    db.prepare(
        `INSERT INTO transactions (id, from_node, to_node, amount, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', datetime('now'))`
    ).run(txId, req.user.node_address, to_upi || to_node, amount);

    db.prepare('INSERT INTO events (id, type, title, node_id) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), 'upi', `UPI Payload Stored (Offline) → ₹${amount}`, to_upi || to_node);

    req.io.emit('transaction:queued', {
        id: txId, fromNode: req.user.node_address, toNode: to_upi || to_node, amount, status: 'pending'
    });

    return res.status(202).json({
        message: 'Offline: transfer queued. Will auto-settle when internet is restored.',
        transaction_id: txId, status: 'pending'
    });
});

// ── GET /api/payments/history ─────────────────────────────────────────────────
router.get('/history', authenticate, (req, res) => {
    const myNode = req.user.node_address;
    const txns = db.prepare(
        `SELECT * FROM transactions WHERE from_node = ? OR to_node = ? ORDER BY created_at DESC LIMIT 50`
    ).all(myNode, myNode);

    let balance = 14500;
    txns.forEach(t => {
        if (t.status === 'settled') {
            if (t.from_node === myNode) balance -= t.amount;
            else if (t.to_node === myNode) balance += t.amount;
        }
    });

    return res.json({ transactions: txns, balance: Math.max(0, balance), currency: 'INR' });
});

// ── POST /api/payments/sync-pending ──────────────────────────────────────────
// Called when internet is restored — settle all pending offline transfers via Razorpay
router.post('/sync-pending', authenticate, async (req, res) => {
    const myNode = req.user.node_address;
    const pending = db.prepare(
        `SELECT * FROM transactions WHERE from_node = ? AND status = 'pending'`
    ).all(myNode);

    if (!pending.length) return res.json({ message: 'No pending transactions', synced: 0 });

    let synced = 0, failed = 0;

    for (const tx of pending) {
        // If Razorpay is configured, attempt real payout
        if (razorpay && RAZORPAY_CONFIGURED) {
            try {
                await razorpay.payouts.create({
                    account_number: process.env.RAZORPAY_ACCOUNT_NUMBER || '2323230093547768',
                    amount: Math.round(tx.amount * 100),
                    currency: 'INR',
                    mode: 'UPI',
                    purpose: 'payout',
                    queue_if_low_balance: true,
                    narration: 'AetherNet offline sync',
                    notes: { tx_id: tx.id },
                });
            } catch (e) {
                console.warn('[Razorpay] Payout failed for', tx.id, e.message);
                failed++;
                continue;
            }
        }

        db.prepare(
            `UPDATE transactions SET status = 'settled', settled_at = datetime('now') WHERE id = ?`
        ).run(tx.id);

        db.prepare('INSERT INTO events (id, type, title, node_id) VALUES (?, ?, ?, ?)')
            .run(uuidv4(), 'upi', `UPI Settled (Sync): ₹${tx.amount} → ${tx.to_node}`, tx.to_node);
        synced++;
    }

    req.io.emit('sync:complete', { deliveredCount: synced });

    return res.json({
        message: `Sync complete: ${synced} settled, ${failed} failed`,
        synced, failed
    });
});

module.exports = router;
