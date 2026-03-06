const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const authenticate = require('../middleware/auth');

// ─── GET /api/transactions ────────────────────────────────────────────────────
// Get all offline transactions for the authenticated node
router.get('/', authenticate, (req, res) => {
    const transactions = db.prepare(
        `SELECT * FROM transactions
         WHERE from_node = ? OR to_node = ?
         ORDER BY created_at DESC
         LIMIT 50`
    ).all(req.user.node_address, req.user.node_address);
    return res.json({ transactions });
});

// ─── POST /api/transactions ───────────────────────────────────────────────────
// Queue a new offline UPI transfer (buffered until internet sync)
router.post('/', authenticate, (req, res) => {
    const { to_node, amount } = req.body;

    if (!to_node || amount === undefined || amount <= 0) {
        return res.status(400).json({ error: 'to_node and a positive amount are required' });
    }

    const id = uuidv4();
    db.prepare(
        `INSERT INTO transactions (id, from_node, to_node, amount)
         VALUES (?, ?, ?, ?)`
    ).run(id, req.user.node_address, to_node, amount);

    // Log event
    db.prepare('INSERT INTO events (id, type, title, node_id) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), 'upi', `UPI Payload Stored → ${to_node}: ₹${amount}`, to_node);

    // Emit real-time socket event
    req.io.emit('transaction:queued', {
        id,
        fromNode: req.user.node_address,
        toNode: to_node,
        amount,
        status: 'pending'
    });

    const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
    return res.status(201).json({ message: 'Transaction queued for offline mesh transfer', transaction: tx });
});

// ─── PATCH /api/transactions/:id/settle ──────────────────────────────────────
// Settle a pending transaction after internet sync
router.patch('/:id/settle', authenticate, (req, res) => {
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    if (tx.from_node !== req.user.node_address && tx.to_node !== req.user.node_address) {
        return res.status(403).json({ error: 'Not authorized to settle this transaction' });
    }

    if (tx.status !== 'pending') {
        return res.status(400).json({ error: `Transaction already ${tx.status}` });
    }

    db.prepare(
        `UPDATE transactions SET status = 'settled', settled_at = datetime('now') WHERE id = ?`
    ).run(req.params.id);

    // Log event
    db.prepare('INSERT INTO events (id, type, title, node_id) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), 'upi', `UPI Settled: ₹${tx.amount} to ${tx.to_node}`, tx.to_node);

    req.io.emit('transaction:settled', { id: req.params.id, amount: tx.amount, toNode: tx.to_node });

    return res.json({ message: 'Transaction settled', id: req.params.id });
});

module.exports = router;
