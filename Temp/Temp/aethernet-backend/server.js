require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const os = require('os');

const db = require('./db');
const socketHandler = require('./sockets');
const { setupWebRTCSignaling } = require('./services/webrtc');
const { startDiscovery, getLocalIP } = require('./services/discovery');

const authRoutes = require('./routes/auth');
const peersRoutes = require('./routes/peers');
const messagesRoutes = require('./routes/messages');
const transactionsRoutes = require('./routes/transactions');
const eventsRoutes = require('./routes/events');
const paymentsRoutes = require('./routes/payments');
const aetherPayRoutes = require('./routes/aetherpay');
const bankRoutes = require('./routes/bank');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE'] }
});

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Serve the AetherLink-UI frontend statically ───────────────────────────────
const FRONTEND_DIR = path.join(__dirname, '..', 'AetherLink-UI');
app.use(express.static(FRONTEND_DIR));

// Attach io to every request so routes can emit events
app.use((req, _res, next) => { req.io = io; next(); });

// ─── REST Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/peers', peersRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/aetherpay', aetherPayRoutes);
app.use('/api/bank', bankRoutes);

// Health + network info
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        node: 'AetherNet Gateway',
        uptime: process.uptime(),
        local_ip: getLocalIP(),
    });
});

// SPA fallback (serve index.html for non-API routes)
app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health') return next();
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// Global error handler
app.use((err, _req, res, _next) => {
    console.error('[ERROR]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
socketHandler(io);
setupWebRTCSignaling(io);

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const LOCAL_IP = getLocalIP();

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🛰️  AetherNet Gateway Online`);
    console.log(`   🌐 Frontend  → http://localhost:${PORT}`);
    console.log(`   📡 LAN URL  → http://${LOCAL_IP}:${PORT}   ← share this on venue WiFi`);
    console.log(`   REST API   → http://localhost:${PORT}/api`);
    console.log(`   Socket.io  → ws://localhost:${PORT}`);
    console.log(`   Health     → http://localhost:${PORT}/health\n`);

    // Start mDNS peer discovery (no internet needed)
    // Will auto-discover other AetherNet nodes on the same WiFi
    startDiscovery('gateway-node', PORT, io);
});

module.exports = { app, io };
