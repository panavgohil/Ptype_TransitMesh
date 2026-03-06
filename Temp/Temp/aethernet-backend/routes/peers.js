const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const authenticate = require('../middleware/auth');

// ─── GET /api/peers ──────────────────────────────────────────────────────────
// Returns all peers last seen by the authenticated node
router.get('/', authenticate, (req, res) => {
    const peers = db.prepare(
        `SELECT * FROM peers WHERE user_id = ? ORDER BY last_seen DESC`
    ).all(req.user.id);
    return res.json({ peers });
});

// ─── POST /api/peers/seen ─────────────────────────────────────────────────────
// Report a peer sighting (BLE or Wi-Fi Direct)
router.post('/seen', authenticate, (req, res) => {
    const { peer_node_id, rssi = 0, distance_meters = 0, transport = 'ble' } = req.body;

    if (!peer_node_id) {
        return res.status(400).json({ error: 'peer_node_id is required' });
    }

    // Upsert: update if already seen, else insert
    const existing = db.prepare(
        'SELECT id FROM peers WHERE user_id = ? AND peer_node_id = ?'
    ).get(req.user.id, peer_node_id);

    if (existing) {
        db.prepare(
            `UPDATE peers SET rssi = ?, distance_meters = ?, transport = ?, last_seen = datetime('now')
             WHERE user_id = ? AND peer_node_id = ?`
        ).run(rssi, distance_meters, transport, req.user.id, peer_node_id);
    } else {
        db.prepare(
            `INSERT INTO peers (id, user_id, peer_node_id, rssi, distance_meters, transport)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(uuidv4(), req.user.id, peer_node_id, rssi, distance_meters, transport);
    }

    // Log event
    const eventId = uuidv4();
    db.prepare('INSERT INTO events (id, type, title, node_id) VALUES (?, ?, ?, ?)')
        .run(eventId, 'ble', `BLE Discovery: ${peer_node_id}`, peer_node_id);

    // Emit real-time socket event
    req.io.emit('peer:discovered', {
        nodeId: peer_node_id,
        rssi,
        transport,
        distance_meters,
        reporter: req.user.node_address
    });

    const peer = db.prepare(
        'SELECT * FROM peers WHERE user_id = ? AND peer_node_id = ?'
    ).get(req.user.id, peer_node_id);

    return res.status(201).json({ message: 'Peer sighting recorded', peer });
});

// ─── DELETE /api/peers/:id ────────────────────────────────────────────────────
router.delete('/:id', authenticate, (req, res) => {
    const result = db.prepare(
        'DELETE FROM peers WHERE id = ? AND user_id = ?'
    ).run(req.params.id, req.user.id);

    if (result.changes === 0) {
        return res.status(404).json({ error: 'Peer not found or not owned by you' });
    }
    return res.json({ message: 'Peer removed' });
});

module.exports = router;
