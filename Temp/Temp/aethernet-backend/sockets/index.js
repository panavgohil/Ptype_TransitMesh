const { v4: uuidv4 } = require('uuid');
const db = require('../db');

/**
 * Registers all Socket.io event handlers.
 * @param {import('socket.io').Server} io
 */
function socketHandler(io) {
    io.on('connection', (socket) => {
        console.log(`[WS] Client connected: ${socket.id}`);

        // ── join:node ─────────────────────────────────────────────────────────
        // Client joins a room identified by its node_address
        // so targeted events can be sent to specific nodes
        socket.on('join:node', (nodeAddress) => {
            socket.join(nodeAddress);
            console.log(`[WS] ${socket.id} joined room: ${nodeAddress}`);
            socket.emit('joined', { room: nodeAddress, message: 'You are connected to the AetherNet gateway.' });
        });

        // ── handshake:force ───────────────────────────────────────────────────
        // Client triggers a forced sync cycle (Force Handshake button)
        socket.on('handshake:force', (data) => {
            const nodeAddress = data?.node_address || 'unknown';
            console.log(`[WS] Force handshake requested by ${nodeAddress}`);

            // Simulate: mark buffered messages for that node as delivered
            let deliveredCount = 0;
            try {
                const result = db.prepare(
                    `UPDATE messages SET status = 'delivered', synced_at = datetime('now')
                     WHERE sender_node = ? AND status = 'buffered'`
                ).run(nodeAddress);
                deliveredCount = result.changes;

                // Also settle pending transactions
                db.prepare(
                    `UPDATE transactions SET status = 'settled', settled_at = datetime('now')
                     WHERE from_node = ? AND status = 'pending'`
                ).run(nodeAddress);

                // Log the sync event
                db.prepare('INSERT INTO events (id, type, title, node_id) VALUES (?, ?, ?, ?)')
                    .run(uuidv4(), 'wifi', 'TCP Socket Transmission — Sync Cycle Complete', nodeAddress);
            } catch (err) {
                console.error('[WS] handshake:force DB error:', err.message);
            }

            // Respond to the requesting client
            socket.emit('sync:complete', {
                deliveredCount,
                message: deliveredCount > 0
                    ? `${deliveredCount} buffered payload(s) synced to internet gateway.`
                    : 'No pending payloads. Mesh is clean.'
            });

            // Broadcast to everyone that a sync happened
            io.emit('peer:synced', { nodeAddress, deliveredCount });
        });

        // ── disconnect ────────────────────────────────────────────────────────
        socket.on('disconnect', () => {
            console.log(`[WS] Client disconnected: ${socket.id}`);
        });
    });
}

module.exports = socketHandler;
