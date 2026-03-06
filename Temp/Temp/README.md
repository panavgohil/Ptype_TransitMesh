# 🛰️ AetherNet — Offline Mesh Network + Networkless Payments

> **Hack Samarth IITK 2026** · Resilient communication and payments when the internet is gone.

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-LAN%20%7C%20BLE%20%7C%20WebRTC-purple)]()

---

## 🌐 What is AetherNet?

AetherNet is a **fully offline peer-to-peer mesh network** that lets people:

| Feature | How it works |
|---|---|
| 💬 Mesh Messaging | WebRTC DataChannels over WiFi (no internet needed) |
| 📡 BLE Discovery | Web Bluetooth API scans for nearby devices |
| 🔍 LAN Discovery | mDNS/Bonjour auto-discovers AetherNet nodes on same WiFi |
| 💸 Offline Payments | Transaction queue stored in SQLite, synced when internet returns |
| 🏦 AetherPay Vault | Local wallet with Razorpay UPI integration |

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────┐
│  AetherLink-UI (Browser)                       │
│  ├── BLE Scan (Web Bluetooth API)              │
│  ├── WebRTC P2P DataChannels (offline mesh)    │
│  ├── Socket.io signaling                       │
│  └── AetherPay / Razorpay checkout            │
└──────────────┬─────────────────────────────────┘
               │ HTTP + WebSocket (localhost or LAN IP)
┌──────────────▼─────────────────────────────────┐
│  aethernet-backend (Node.js + Express)         │
│  ├── REST API  /api/*                          │
│  ├── Socket.io (real-time relay + signaling)   │
│  ├── mDNS/Bonjour — peer discovery on LAN      │
│  ├── SQLite DB (better-sqlite3)                │
│  └── Razorpay UPI integration                 │
└────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start (Local)

### 1. Clone the repo
```bash
git clone https://github.com/YOUR_USERNAME/aethernet.git
cd aethernet
```

### 2. Backend setup
```bash
cd aethernet-backend
cp .env.example .env          # fill in your Razorpay keys (optional for demo)
npm install
npm start
```

The server starts on **http://localhost:3000**

### 3. Open the frontend
Just visit **http://localhost:3000** in Chrome — the backend serves the UI automatically.

> **For BLE scanning** — use Chrome on Android or Chrome desktop  
> **For LAN mesh** — run the backend on multiple machines on the same WiFi

---

## 🔌 Offline Capabilities

### Without ANY internet:
| Capability | Works offline? |
|---|---|
| Register / Login | ✅ Yes (JWT, local SQLite) |
| BLE peer discovery | ✅ Yes (Web Bluetooth, no cloud) |
| LAN peer discovery | ✅ Yes (mDNS/Bonjour, same WiFi) |
| Mesh messaging (chat) | ✅ Yes (WebRTC DataChannel) |
| Queue a payment | ✅ Yes (stored in SQLite with `pending` status) |
| Settle/confirm payment | ❌ Needs internet (Razorpay settlement) |
| BLE → Networkless Pay | ✅ Transaction stored locally, settled later |

### Networkless Payment Flow
```
Device A (sender)                  Device B (receiver)
───────────────────────────────────────────────────────
1. BLE scan discovers Device B
2. Connect via WiFi LAN / WebRTC
3. POST /api/transactions { to_node, amount }
   → Stored in SQLite with status=pending
4. ← Socket.io emits transaction:queued to both
5. (Internet returns) POST /api/payments/sync-pending
   → Razorpay settles all pending transactions
```

---

## 📁 Project Structure

```
aethernet/
├── aethernet-backend/
│   ├── server.js           # Express + Socket.io entrypoint
│   ├── db.js               # SQLite schema + setup
│   ├── routes/
│   │   ├── auth.js         # Register, Login (JWT)
│   │   ├── peers.js        # Known peers API
│   │   ├── messages.js     # Message relay
│   │   ├── transactions.js # Offline payment queue
│   │   ├── payments.js     # Razorpay UPI
│   │   ├── aetherpay.js    # AetherPay wallet
│   │   ├── bank.js         # Bank account linking
│   │   └── events.js       # Activity feed events
│   ├── services/
│   │   ├── discovery.js    # mDNS/Bonjour LAN discovery
│   │   └── webrtc.js       # WebRTC signaling server
│   ├── sockets/            # Socket.io handlers
│   ├── middleware/auth.js  # JWT middleware
│   └── .env.example        # Environment template
│
└── AetherLink-UI/
    ├── index.html          # Single-page app shell
    ├── script.js           # Main UI logic
    ├── api-client.js       # REST + Socket.io client
    ├── ble-client.js       # Web Bluetooth BLE scanner
    ├── p2p-client.js       # WebRTC P2P + Razorpay UPI
    ├── aetherpay-ui.js     # AetherPay wallet UI
    ├── bank-wallet-ui.js   # Bank/wallet UI
    └── style.css           # Full design system
```

---

## ⚙️ Environment Variables

Copy `aethernet-backend/.env.example` to `.env` and fill in:

| Variable | Description |
|---|---|
| `PORT` | HTTP port (default: 3000) |
| `JWT_SECRET` | Secret for signing JWT tokens |
| `DB_PATH` | SQLite database file path |
| `RAZORPAY_KEY_ID` | Razorpay test/live key (optional) |
| `RAZORPAY_KEY_SECRET` | Razorpay test/live secret |

> Without Razorpay keys, the app runs in **demo mode** — all mesh features work, only real UPI settlements are skipped.

---

## 🧪 API Reference

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Create a mesh node account |
| POST | `/api/auth/login` | Login, get JWT |
| GET | `/api/peers` | List known peers |
| POST | `/api/peers/seen` | Report a discovered peer |
| POST | `/api/transactions` | Queue an offline payment |
| PATCH | `/api/transactions/:id/settle` | Settle a pending payment |
| POST | `/api/payments/order` | Create Razorpay order |
| POST | `/api/payments/payout` | Send UPI payment |
| POST | `/api/payments/sync-pending` | Sync offline queue |
| GET | `/health` | Node health + local IP |

---

## 🛠️ Tech Stack

- **Backend**: Node.js, Express, Socket.io, better-sqlite3, JWT, Bonjour/mDNS, Razorpay
- **Frontend**: Vanilla JS, Web Bluetooth API, WebRTC, CSS animations
- **Payments**: Razorpay UPI (with offline queue fallback)
- **Discovery**: mDNS (LAN), BLE advertisements (physical proximity)

---

## 📜 License

MIT © Hack Samarth IITK 2026
