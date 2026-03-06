'use strict';
/**
 * routes/aetherpay.js — AetherPay: Custom Offline UPI System
 * ===========================================================
 * A completely self-contained digital payment protocol that works with
 * NO internet, NO external APIs, NO bank accounts required.
 *
 * How it works:
 *   - Every node gets a UPI-style address: "nodeaddress@aethernet"
 *   - Balances are stored locally in the JSON database
 *   - When ONLINE (LAN): transfers are instant via Socket.io
 *   - When OFFLINE: transfers are queued and auto-settle on reconnect
 *   - Think of it as a private, encrypted, offline-first payment network
 *
 * AetherPay Address format: {nodeId}@aethernet
 * Example: aether-9f8a-2b1c@aethernet
 *
 * Endpoints:
 *   GET   /api/aetherpay/wallet           - Get your wallet (balance + address)
 *   POST  /api/aetherpay/send             - Send AetherCoins to any node on the mesh
 *   GET   /api/aetherpay/history          - Full transaction ledger
 *   POST  /api/aetherpay/request          - Request payment from another node
 *   GET   /api/aetherpay/pending          - See pending incoming requests
 *   POST  /api/aetherpay/approve/:id      - Approve a payment request
 *   POST  /api/aetherpay/sync             - Auto-settle queued transfers over mesh
 *   GET   /api/aetherpay/address/:nodeId  - Look up any node's AetherPay address
 */

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const authenticate = require('../middleware/auth');

// ── Schema: wallets + payment_requests tables ─────────────────────────────────
db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL UNIQUE,
        node_address TEXT NOT NULL UNIQUE,
        aether_id    TEXT NOT NULL UNIQUE,
        balance      REAL NOT NULL DEFAULT 1000.00,
        created_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS payment_requests (
        id             TEXT PRIMARY KEY,
        from_aether_id TEXT NOT NULL,
        to_aether_id   TEXT NOT NULL,
        amount         REAL NOT NULL,
        note           TEXT,
        status         TEXT NOT NULL DEFAULT 'pending',
        created_at     TEXT,
        settled_at     TEXT
    );
`);

// ── Helper: get or create wallet for a user ────────────────────────────────────
function getOrCreateWallet(userId, nodeAddress) {
    let wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
    if (!wallet) {
        const id = uuidv4();
        const aetherId = `${nodeAddress}@aethernet`;
        db.prepare(
            `INSERT INTO wallets (id, user_id, node_address, aether_id, balance, created_at)
             VALUES (?, ?, ?, ?, 1000.00, datetime('now'))`
        ).run(id, userId, nodeAddress, aetherId);
        wallet = db.prepare('SELECT * FROM wallets WHERE id = ?').get(id);
    }
    return wallet;
}

// ── GET /api/aetherpay/wallet ─────────────────────────────────────────────────
// Returns your AetherPay wallet: balance, address, QR data
router.get('/wallet', authenticate, (req, res) => {
    const wallet = getOrCreateWallet(req.user.id, req.user.node_address);

    // Count pending incoming requests
    const pendingCount = db.prepare(
        `SELECT COUNT(*) as c FROM payment_requests WHERE to_aether_id = ? AND status = 'pending'`
    ).get(wallet.aether_id)?.c || 0;

    return res.json({
        wallet: {
            aether_id: wallet.aether_id,
            balance: wallet.balance,
            node_address: wallet.node_address,
            currency: 'AC',   // AetherCoins
        },
        pending_requests: pendingCount,
        qr_data: `aetherpay:${wallet.aether_id}?currency=AC`,
    });
});

// ── POST /api/aetherpay/send ──────────────────────────────────────────────────
// Send AetherCoins to another node — instant if online, queued if offline
router.post('/send', authenticate, (req, res) => {
    const { to_aether_id, amount, note = '' } = req.body;

    if (!to_aether_id) return res.status(400).json({ error: 'to_aether_id required (format: nodeid@aethernet)' });
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Amount must be > 0' });

    const senderWallet = getOrCreateWallet(req.user.id, req.user.node_address);

    if (senderWallet.balance < amount) {
        return res.status(400).json({
            error: `Insufficient balance. You have AC ${senderWallet.balance.toFixed(2)}`,
        });
    }

    // Check if recipient wallet exists (is on the same mesh)
    const recipientWallet = db.prepare(
        'SELECT * FROM wallets WHERE aether_id = ?'
    ).get(to_aether_id);

    const txId = uuidv4();
    const isLive = !!recipientWallet; // instant if recipient is on this node's DB

    if (isLive) {
        // ── Instant transfer (both on same LAN / same server) ────────────────
        db.prepare('UPDATE wallets SET balance = balance - ? WHERE user_id = ?')
            .run(amount, req.user.id);
        db.prepare('UPDATE wallets SET balance = balance + ? WHERE aether_id = ?')
            .run(amount, to_aether_id);

        db.prepare(
            `INSERT INTO transactions (id, from_node, to_node, amount, status, settled_at, created_at)
             VALUES (?, ?, ?, ?, 'settled', datetime('now'), datetime('now'))`
        ).run(txId, senderWallet.aether_id, to_aether_id, amount);

        db.prepare('INSERT INTO events (id, type, title, node_id) VALUES (?, ?, ?, ?)')
            .run(uuidv4(), 'upi', `AetherPay Sent: AC ${amount} → ${to_aether_id} [SETTLED]`, to_aether_id);

        // Real-time notification to recipient via Socket.io
        req.io.to(recipientWallet.node_address).emit('aetherpay:received', {
            from: senderWallet.aether_id,
            amount,
            note,
            txId,
            newBalance: recipientWallet.balance + amount,
        });

        return res.json({
            message: `AC ${amount} sent instantly to ${to_aether_id}`,
            tx_id: txId,
            status: 'settled',
            new_balance: senderWallet.balance - amount,
            currency: 'AC',
        });

    } else {
        // ── Offline transfer — deduct now, deliver when peer connects ─────────
        db.prepare('UPDATE wallets SET balance = balance - ? WHERE user_id = ?')
            .run(amount, req.user.id);

        db.prepare(
            `INSERT INTO transactions (id, from_node, to_node, amount, status, created_at)
             VALUES (?, ?, ?, ?, 'pending', datetime('now'))`
        ).run(txId, senderWallet.aether_id, to_aether_id, amount);

        db.prepare('INSERT INTO events (id, type, title, node_id) VALUES (?, ?, ?, ?)')
            .run(uuidv4(), 'upi', `AetherPay Queued: AC ${amount} → ${to_aether_id} [OFFLINE]`, to_aether_id);

        return res.status(202).json({
            message: `Recipient offline. AC ${amount} queued — will deliver when they connect to the mesh.`,
            tx_id: txId,
            status: 'pending',
            new_balance: senderWallet.balance - amount,
            currency: 'AC',
        });
    }
});

// ── POST /api/aetherpay/request ───────────────────────────────────────────────
// Request money from another node (like "Request" in GPay)
router.post('/request', authenticate, (req, res) => {
    const { from_aether_id, amount, note = '' } = req.body;
    if (!from_aether_id || !amount) return res.status(400).json({ error: 'from_aether_id and amount required' });

    const myWallet = getOrCreateWallet(req.user.id, req.user.node_address);
    const reqId = uuidv4();

    db.prepare(
        `INSERT INTO payment_requests (id, from_aether_id, to_aether_id, amount, note, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`
    ).run(reqId, from_aether_id, myWallet.aether_id, amount, note);

    db.prepare('INSERT INTO events (id, type, title, node_id) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), 'upi', `Payment Request: AC ${amount} from ${from_aether_id}`, from_aether_id);

    // Notify the target node in real-time if online
    req.io.emit('aetherpay:request', {
        reqId, from: myWallet.aether_id, to: from_aether_id, amount, note,
    });

    return res.status(201).json({
        message: `Request sent to ${from_aether_id} for AC ${amount}`,
        request_id: reqId,
        status: 'pending',
    });
});

// ── GET /api/aetherpay/pending ────────────────────────────────────────────────
// Get incoming payment requests you need to approve
router.get('/pending', authenticate, (req, res) => {
    const wallet = getOrCreateWallet(req.user.id, req.user.node_address);
    const requests = db.prepare(
        `SELECT * FROM payment_requests WHERE from_aether_id = ? AND status = 'pending' ORDER BY created_at DESC`
    ).all(wallet.aether_id);
    return res.json({ requests });
});

// ── POST /api/aetherpay/approve/:id ──────────────────────────────────────────
// Approve a payment request — sends the money
router.post('/approve/:id', authenticate, (req, res) => {
    const request = db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

    const myWallet = getOrCreateWallet(req.user.id, req.user.node_address);
    if (myWallet.aether_id !== request.from_aether_id) {
        return res.status(403).json({ error: 'This request is not for your wallet' });
    }
    if (myWallet.balance < request.amount) {
        return res.status(400).json({ error: `Insufficient balance: AC ${myWallet.balance.toFixed(2)}` });
    }

    // Deduct from approver
    db.prepare('UPDATE wallets SET balance = balance - ? WHERE user_id = ?')
        .run(request.amount, req.user.id);

    // Credit recipient if online
    db.prepare('UPDATE wallets SET balance = balance + ? WHERE aether_id = ?')
        .run(request.amount, request.to_aether_id);

    // Mark request as settled
    db.prepare(`UPDATE payment_requests SET status = 'settled', settled_at = datetime('now') WHERE id = ?`)
        .run(request.id);

    // Record transaction
    const txId = uuidv4();
    db.prepare(
        `INSERT INTO transactions (id, from_node, to_node, amount, status, settled_at, created_at)
         VALUES (?, ?, ?, ?, 'settled', datetime('now'), datetime('now'))`
    ).run(txId, myWallet.aether_id, request.to_aether_id, request.amount);

    db.prepare('INSERT INTO events (id, type, title, node_id) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), 'upi', `Request Approved: AC ${request.amount} → ${request.to_aether_id}`, request.to_aether_id);

    req.io.emit('aetherpay:approved', { reqId: request.id, amount: request.amount, to: request.to_aether_id });

    return res.json({
        message: `Approved! AC ${request.amount} sent to ${request.to_aether_id}`,
        tx_id: txId,
        new_balance: myWallet.balance - request.amount,
    });
});

// ── POST /api/aetherpay/sync ──────────────────────────────────────────────────
// Auto-settle pending offline transfers (called on mesh reconnect)
router.post('/sync', authenticate, (req, res) => {
    const pending = db.prepare(
        `SELECT * FROM transactions WHERE from_node LIKE '%@aethernet' AND status = 'pending'`
    ).all();

    let synced = 0;
    for (const tx of pending) {
        const recipientWallet = db.prepare('SELECT * FROM wallets WHERE aether_id = ?').get(tx.to_node);
        if (!recipientWallet) continue; // still offline

        // Credit recipient
        db.prepare('UPDATE wallets SET balance = balance + ? WHERE aether_id = ?')
            .run(tx.amount, tx.to_node);

        // Mark settled
        db.prepare(`UPDATE transactions SET status = 'settled', settled_at = datetime('now') WHERE id = ?`)
            .run(tx.id);

        db.prepare('INSERT INTO events (id, type, title, node_id) VALUES (?, ?, ?, ?)')
            .run(uuidv4(), 'upi', `Auto-Synced: AC ${tx.amount} → ${tx.to_node}`, tx.to_node);

        req.io.emit('aetherpay:received', { from: tx.from_node, amount: tx.amount, txId: tx.id });
        synced++;
    }

    return res.json({ message: `Sync complete: ${synced} transfer(s) settled`, synced });
});

// ── GET /api/aetherpay/history ────────────────────────────────────────────────
router.get('/history', authenticate, (req, res) => {
    const wallet = getOrCreateWallet(req.user.id, req.user.node_address);
    const txns = db.prepare(
        `SELECT * FROM transactions WHERE from_node = ? OR to_node = ? ORDER BY created_at DESC LIMIT 50`
    ).all(wallet.aether_id, wallet.aether_id);
    return res.json({ transactions: txns, balance: wallet.balance, aether_id: wallet.aether_id });
});

// ── GET /api/aetherpay/address/:nodeId ────────────────────────────────────────
// Look up any node's AetherPay address
router.get('/address/:nodeId', (req, res) => {
    const wallet = db.prepare('SELECT aether_id, balance FROM wallets WHERE node_address = ?')
        .get(req.params.nodeId);
    if (!wallet) return res.status(404).json({ error: 'Node not found on this mesh' });
    return res.json({ aether_id: wallet.aether_id }); // don't expose balance
});

module.exports = router;
