const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const authenticate = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'aethernet_secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', (req, res) => {
    const { display_name, node_address, password } = req.body;

    if (!display_name || !node_address || !password) {
        return res.status(400).json({ error: 'display_name, node_address, and password are required' });
    }

    const exists = db.prepare('SELECT id FROM users WHERE node_address = ?').get(node_address);
    if (exists) {
        return res.status(409).json({ error: 'Node address already registered' });
    }

    const password_hash = bcrypt.hashSync(password, 10);
    const id = uuidv4();

    db.prepare(
        'INSERT INTO users (id, display_name, node_address, password_hash) VALUES (?, ?, ?, ?)'
    ).run(id, display_name, node_address, password_hash);

    // Seed an event
    db.prepare('INSERT INTO events (id, type, title, node_id) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), 'wifi', `Node Registered: ${node_address}`, node_address);

    const token = jwt.sign({ id, display_name, node_address }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.status(201).json({
        message: 'Node registered successfully',
        token,
        user: { id, display_name, node_address }
    });
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', (req, res) => {
    const { node_address, password } = req.body;

    if (!node_address || !password) {
        return res.status(400).json({ error: 'node_address and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE node_address = ?').get(node_address);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ error: 'Invalid node address or password' });
    }

    const token = jwt.sign(
        { id: user.id, display_name: user.display_name, node_address: user.node_address },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );

    return res.json({
        message: 'Authenticated',
        token,
        user: { id: user.id, display_name: user.display_name, node_address: user.node_address }
    });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
    const user = db.prepare('SELECT id, display_name, node_address, created_at FROM users WHERE id = ?')
        .get(req.user.id);

    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ user });
});

module.exports = router;
