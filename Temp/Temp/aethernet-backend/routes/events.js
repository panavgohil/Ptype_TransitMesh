const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const authenticate = require('../middleware/auth');

// ─── GET /api/events ──────────────────────────────────────────────────────────
// Get recent activity log (last 20 events, most recent first)
router.get('/', authenticate, (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const events = db.prepare(
        `SELECT * FROM events ORDER BY created_at DESC LIMIT ?`
    ).all(limit);
    return res.json({ events });
});

// ─── POST /api/events ─────────────────────────────────────────────────────────
// Manually append an event to the cryptographic ledger
router.post('/', authenticate, (req, res) => {
    const { type, title, node_id } = req.body;
    const validTypes = ['ble', 'msg', 'upi', 'wifi'];

    if (!type || !title) {
        return res.status(400).json({ error: 'type and title are required' });
    }
    if (!validTypes.includes(type)) {
        return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
    }

    const id = uuidv4();
    db.prepare('INSERT INTO events (id, type, title, node_id) VALUES (?, ?, ?, ?)')
        .run(id, type, title, node_id || null);

    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
    return res.status(201).json({ message: 'Event logged', event });
});

module.exports = router;
