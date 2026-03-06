'use strict';
/**
 * services/discovery.js — mDNS LAN Peer Discovery
 * =================================================
 * Advertises this AetherNet node on the local network using mDNS/Bonjour.
 * Discovers other AetherNet nodes on the same WiFi — NO internet needed.
 *
 * Uses: bonjour-service (pure JS, no native compilation)
 */

let Bonjour;
try { Bonjour = require('bonjour-service').Bonjour; } catch {
    console.warn('[mDNS] bonjour-service not installed — run npm install');
}

const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const os = require('os');

// Get the machine's local IP address (first non-loopback IPv4)
function getLocalIP() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const iface of nets[name]) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return '127.0.0.1';
}

let bonjourInstance = null;

/**
 * Start mDNS advertising + browsing.
 * @param {string}  nodeAddress  - This node's unique address (e.g. "aether-9f8a-2b1c")
 * @param {number}  port         - HTTP port this node is running on
 * @param {import('socket.io').Server} io - Socket.io server to emit discoveries
 */
function startDiscovery(nodeAddress, port, io) {
    if (!Bonjour) return;

    bonjourInstance = new Bonjour();

    const localIP = getLocalIP();
    const serviceName = `AetherNet-${nodeAddress}`;

    // ── Advertise self ────────────────────────────────────────────────────────
    const service = bonjourInstance.publish({
        name: serviceName,
        type: 'aethernet',
        port,
        txt: {
            node: nodeAddress,
            version: '1.0',
            ip: localIP,
        }
    });

    service.on('up', () => {
        console.log(`[mDNS] 📡 Advertising as "${serviceName}" on ${localIP}:${port}`);
    });

    // ── Browse for other AetherNet nodes ─────────────────────────────────────
    const browser = bonjourInstance.find({ type: 'aethernet' }, (foundService) => {
        const peerNode = foundService.txt?.node;
        const peerIP = foundService.txt?.ip || (foundService.addresses?.[0]);
        const peerPort = foundService.port;

        // Skip self
        if (!peerNode || peerNode === nodeAddress) return;

        console.log(`[mDNS] 🟢 Peer discovered on LAN: ${peerNode} @ ${peerIP}:${peerPort}`);

        // Log peer into DB (rssi = 0 for LAN, transport = 'lan')
        try {
            const existing = db.prepare(
                'SELECT id FROM peers WHERE peer_node_id = ?'
            ).get(peerNode);

            if (!existing) {
                db.prepare(
                    `INSERT INTO peers (id, user_id, peer_node_id, rssi, distance_meters, transport)
                     VALUES (?, ?, ?, ?, ?, ?)`
                ).run(uuidv4(), 'system', peerNode, 0, 0, 'lan');
            } else {
                db.prepare(
                    `UPDATE peers SET transport = 'lan', last_seen = datetime('now') WHERE peer_node_id = ?`
                ).run(peerNode);
            }

            db.prepare('INSERT INTO events (id, type, title, node_id) VALUES (?, ?, ?, ?)')
                .run(uuidv4(), 'wifi', `LAN Node Discovered: ${peerNode} (${peerIP})`, peerNode);
        } catch (e) {
            console.warn('[mDNS] DB write error:', e.message);
        }

        // Emit real-time socket event to all connected browsers
        io.emit('peer:discovered', {
            nodeId: peerNode,
            ip: peerIP,
            port: peerPort,
            transport: 'lan',
            rssi: 0,
        });

        io.emit('peer:lan-url', {
            nodeId: peerNode,
            baseUrl: `http://${peerIP}:${peerPort}`,
        });
    });

    browser.on('up', () => console.log('[mDNS] Browsing for AetherNet peers on LAN...'));
    browser.start();
}

function stopDiscovery() {
    if (bonjourInstance) {
        bonjourInstance.unpublishAll(() => bonjourInstance.destroy());
        bonjourInstance = null;
        console.log('[mDNS] Discovery stopped');
    }
}

module.exports = { startDiscovery, stopDiscovery, getLocalIP };
