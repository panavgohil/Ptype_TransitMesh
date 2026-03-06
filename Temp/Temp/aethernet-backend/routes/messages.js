const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const authenticate = require('../middleware/auth');

// ─── GET /api/messages ────────────────────────────────────────────────────────
// Get all buffered messages for the authenticated node (as sender or recipient)
router.get('/', authenticate, (req, res) => {
    const messages = db.prepare(
        `SELECT * FROM messages
         WHERE sender_node = ? OR recipient_node = ?
         ORDER BY created_at DESC
         LIMIT 50`
    ).all(req.user.node_address, req.user.node_address);
    return res.json({ messages });
});

// ─── POST /api/messages ───────────────────────────────────────────────────────
// Buffer a new encrypted message (store-and-forward)
router.post('/', authenticate, (req, res) => {
    const { recipient_node, payload_encrypted, ttl = 5 } = req.body;

    if (!recipient_node || !payload_encrypted) {
        return res.status(400).json({ error: 'recipient_node and payload_encrypted are required' });
    }

    const id = uuidv4();
    db.prepare(
        `INSERT INTO messages (id, sender_node, recipient_node, payload_encrypted, ttl)
         VALUES (?, ?, ?, ?, ?)`
    ).run(id, req.user.node_address, recipient_node, payload_encrypted, ttl);

    // Log event
    db.prepare('INSERT INTO events (id, type, title, node_id) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), 'msg', 'Encrypted Payload Buffered', recipient_node);

    // Emit real-time socket event
    req.io.emit('message:buffered', {
        id,
        senderNode: req.user.node_address,
        recipientNode: recipient_node,
        preview: '[Encrypted]',
        ttl
    });

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
    return res.status(201).json({ message: 'Message buffered', data: message });
});

// ─── PATCH /api/messages/:id/status ──────────────────────────────────────────
// Update delivery status (buffered → delivered/expired)
router.patch('/:id/status', authenticate, (req, res) => {
    const { status } = req.body;
    const validStatuses = ['buffered', 'delivered', 'expired'];

    if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
    }

    const syncedAt = status === 'delivered' ? "datetime('now')" : 'NULL';
    db.prepare(
        `UPDATE messages SET status = ?, synced_at = ${syncedAt} WHERE id = ?`
    ).run(status, req.params.id);

    return res.json({ message: 'Message status updated', id: req.params.id, status });
});

// ─── DELETE /api/messages/:id ─────────────────────────────────────────────────
router.delete('/:id', authenticate, (req, res) => {
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    if (msg.sender_node !== req.user.node_address) {
        return res.status(403).json({ error: 'Not authorized to delete this message' });
    }

    db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id);
    return res.json({ message: 'Message deleted' });
});

module.exports = router;
