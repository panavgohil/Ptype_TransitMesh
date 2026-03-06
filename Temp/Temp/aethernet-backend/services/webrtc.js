'use strict';
/**
 * services/webrtc.js — WebRTC Signaling Relay
 * =============================================
 * Relays SDP offers/answers and ICE candidates between browser peers
 * via Socket.io so they can establish a direct P2P DataChannel connection.
 *
 * Once the DataChannel is open, messages flow directly between browsers
 * with NO server involvement and NO internet required (LAN only).
 *
 * Signal flow:
 *   Peer A                    Server                    Peer B
 *   ──────                    ──────                    ──────
 *   emit(webrtc:offer) ──────► relay ──────────────────► on(webrtc:offer)
 *   on(webrtc:answer) ◄────── relay ◄────────────────── emit(webrtc:answer)
 *   emit(webrtc:ice) ────────► relay ──────────────────► on(webrtc:ice)
 *   [DataChannel OPEN — P2P from here, server not involved]
 */

/**
 * Register WebRTC signaling events on a Socket.io server.
 * @param {import('socket.io').Server} io
 */
function setupWebRTCSignaling(io) {
    io.on('connection', (socket) => {

        // ── Peer A sends offer to Peer B ──────────────────────────────────────
        socket.on('webrtc:offer', ({ targetNode, sdp }) => {
            console.log(`[WebRTC] Offer from ${socket.id} → room:${targetNode}`);
            // Relay to all sockets in the target node's room
            socket.to(targetNode).emit('webrtc:offer', {
                fromSocketId: socket.id,
                sdp,
            });
        });

        // ── Peer B sends answer back to Peer A ───────────────────────────────
        socket.on('webrtc:answer', ({ targetSocketId, sdp }) => {
            console.log(`[WebRTC] Answer from ${socket.id} → socket:${targetSocketId}`);
            io.to(targetSocketId).emit('webrtc:answer', {
                fromSocketId: socket.id,
                sdp,
            });
        });

        // ── ICE candidates relay (both directions) ────────────────────────────
        socket.on('webrtc:ice', ({ targetSocketId, candidate }) => {
            io.to(targetSocketId).emit('webrtc:ice', {
                fromSocketId: socket.id,
                candidate,
            });
        });

        // ── P2P message sent through DataChannel (fallback if DataChannel fails)
        socket.on('p2p:message', ({ targetNode, payload, senderNode }) => {
            console.log(`[P2P] Relaying message: ${senderNode} → ${targetNode}`);
            socket.to(targetNode).emit('p2p:message', {
                senderNode,
                payload,
                via: 'relay-fallback',
                timestamp: new Date().toISOString(),
            });
        });
    });
}

module.exports = { setupWebRTCSignaling };
