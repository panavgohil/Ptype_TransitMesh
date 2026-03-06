const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'aethernet_secret';

/**
 * Middleware: verifies JWT in Authorization header.
 * Sets req.user = { id, display_name, node_address } on success.
 */
function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7);
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token expired or invalid' });
    }
}

module.exports = authenticate;
