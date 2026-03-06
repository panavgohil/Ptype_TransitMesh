/**
 * p2p-client.js — Offline P2P Mesh Networking + Razorpay UPI
 * =============================================================
 * Load this AFTER api-client.js in index.html.
 * Handles:
 *   - WebRTC DataChannel for true P2P offline messaging
 *   - Auto-connects to LAN-discovered peers
 *   - Razorpay UPI checkout for receiving payments
 *   - Offline payment queue with auto-sync
 */

const BACKEND_URL = 'http://localhost:3000';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PART 1 — WebRTC P2P Mesh
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const peerConnections = {};   // { nodeId: RTCPeerConnection }
const dataChannels = {};   // { nodeId: RTCDataChannel }

const ICE_SERVERS = [
    // STUN servers (only used if devices are on different networks)
    // On same WiFi, ICE resolves locally — no internet needed
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
];

function getSocket() { return window._aetherSocket; }
function getMyNode() { return localStorage.getItem('aethernet_node'); }

/** Create a new RTCPeerConnection for a given peer node */
function createPeerConnection(nodeId) {
    if (peerConnections[nodeId]) return peerConnections[nodeId];

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peerConnections[nodeId] = pc;

    // Relay ICE candidates via Socket.io signaling
    pc.onicecandidate = ({ candidate }) => {
        if (candidate && getSocket()) {
            getSocket().emit('webrtc:ice', {
                targetSocketId: window._peerSocketIds?.[nodeId],
                candidate,
            });
        }
    };

    pc.onconnectionstatechange = () => {
        console.log(`[WebRTC] ${nodeId}: ${pc.connectionState}`);
        if (pc.connectionState === 'connected') {
            showP2PToast(nodeId, 'connected');
        }
    };

    // Receiving a DataChannel from remote peer
    pc.ondatachannel = ({ channel }) => {
        setupDataChannel(channel, nodeId);
    };

    return pc;
}

/** Setup DataChannel event handlers */
function setupDataChannel(channel, nodeId) {
    dataChannels[nodeId] = channel;

    channel.onopen = () => {
        console.log(`[P2P] ✅ DataChannel OPEN with ${nodeId} — fully offline P2P`);
        showP2PToast(nodeId, 'channel-open');
    };

    channel.onmessage = ({ data }) => {
        try {
            const msg = JSON.parse(data);
            console.log(`[P2P] Message from ${nodeId}:`, msg);
            handleIncomingP2PMessage(nodeId, msg);
        } catch {
            console.log(`[P2P] Raw data from ${nodeId}:`, data);
        }
    };

    channel.onclose = () => console.log(`[P2P] Channel closed: ${nodeId}`);
    channel.onerror = (e) => console.warn(`[P2P] Channel error: ${nodeId}`, e);
}

/** Initiate a WebRTC connection to a discovered peer */
async function connectToPeer(nodeId) {
    if (dataChannels[nodeId]?.readyState === 'open') return; // already connected

    const pc = createPeerConnection(nodeId);
    const channel = pc.createDataChannel('aethernet-mesh', { ordered: true });
    setupDataChannel(channel, nodeId);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    getSocket()?.emit('webrtc:offer', { targetNode: nodeId, sdp: offer });
    console.log(`[WebRTC] Offer sent to ${nodeId}`);
}

/** Send a message through the P2P DataChannel (true offline) */
function sendP2PMessage(nodeId, payload) {
    const ch = dataChannels[nodeId];
    if (ch?.readyState === 'open') {
        ch.send(JSON.stringify({
            type: 'chat',
            sender: getMyNode(),
            payload,
            timestamp: Date.now(),
        }));
        console.log(`[P2P] ✉️  Sent directly to ${nodeId} (offline)`);
        return true;
    }
    return false; // DataChannel not open, fall back to server relay
}

/** Handle received P2P message — display in chat UI */
function handleIncomingP2PMessage(senderNode, msg) {
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;

    const time = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const text = typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload);

    chatMessages.insertAdjacentHTML('beforeend', `
        <div class="message received" style="animation: slideIn 0.3s forwards">
            <div class="msg-bubble">
                ${text}
                <div style="font-size:10px;opacity:0.5;margin-top:4px">
                    <i class="fa-solid fa-tower-broadcast"></i> via P2P mesh
                </div>
            </div>
            <span class="msg-time">${time}</span>
        </div>
    `);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    if (typeof showToast === 'function') {
        showToast('P2P Message', `From ${senderNode} (offline)`, 'fa-tower-broadcast', 'text-emerald');
    }
}

/** Show a toast for WebRTC connection events */
function showP2PToast(nodeId, event) {
    if (typeof showToast !== 'function') return;
    if (event === 'connected') {
        showToast('Peer Connected', `Encrypted tunnel to ${nodeId}`, 'fa-lock', 'text-emerald');
    } else if (event === 'channel-open') {
        showToast('P2P Channel Open', `${nodeId} — offline messaging ready`, 'fa-tower-broadcast', 'text-primary');
    }
}

/** Wire WebRTC signaling events from Socket.io */
function setupWebRTCSocketListeners() {
    const socket = getSocket();
    if (!socket) return;

    window._peerSocketIds = {};

    // Received offer → send answer
    socket.on('webrtc:offer', async ({ fromSocketId, sdp }) => {
        const nodeId = fromSocketId; // temp key by socket ID until we know the node
        const pc = createPeerConnection(nodeId);
        window._peerSocketIds[nodeId] = fromSocketId;

        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('webrtc:answer', { targetSocketId: fromSocketId, sdp: answer });
    });

    // Received answer → set remote description
    socket.on('webrtc:answer', async ({ fromSocketId, sdp }) => {
        const pc = Object.values(peerConnections).find((_, i) => i === 0); // simplification
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    });

    // ICE candidate
    socket.on('webrtc:ice', async ({ fromSocketId, candidate }) => {
        for (const pc of Object.values(peerConnections)) {
            try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { }
        }
    });

    // LAN peer discovered via mDNS → auto attempt connection
    socket.on('peer:lan-url', ({ nodeId, baseUrl }) => {
        console.log(`[mDNS] LAN peer reachable at ${baseUrl}`);
        window._lanPeers = window._lanPeers || {};
        window._lanPeers[nodeId] = baseUrl;

        // Update BACKEND_URL for api-client if on LAN
        updatePeerListUI(nodeId, baseUrl);
    });

    // Relay fallback (when DataChannel not yet open)
    socket.on('p2p:message', ({ senderNode, payload }) => {
        handleIncomingP2PMessage(senderNode, { payload, timestamp: Date.now() });
    });
}

/** Update compose modal to show LAN peers with Connect button that opens WebRTC */
function updatePeerListUI(nodeId, baseUrl) {
    const peerList = document.querySelector('#compose-modal .peer-list');
    if (!peerList) return;

    // Check if this peer already listed
    if (document.getElementById(`p2p-peer-${nodeId}`)) return;

    peerList.insertAdjacentHTML('afterbegin', `
        <div class="peer-item" id="p2p-peer-${nodeId}" style="border-left: 3px solid var(--emerald); padding-left: 10px;">
            <div class="peer-icon"><i class="fa-solid fa-wifi text-emerald"></i></div>
            <div class="peer-info">
                <h4>${nodeId} <span style="font-size:10px;color:var(--emerald)">● LAN</span></h4>
                <span>On same WiFi · No internet needed</span>
            </div>
            <button class="connect-btn" onclick="window.connectToPeer('${nodeId}')">P2P</button>
        </div>
    `);
}

// Expose to HTML onclick
window.connectToPeer = connectToPeer;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PART 2 — Razorpay UPI Checkout
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function apiFetch(path, opts = {}) {
    const token = localStorage.getItem('aethernet_token');
    const res = await fetch(`${BACKEND_URL}${path}`, {
        ...opts,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            ...(opts.headers || {}),
        },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

/** Load Razorpay checkout.js dynamically */
function loadRazorpayScript() {
    return new Promise((resolve) => {
        if (window.Razorpay) return resolve(true);
        const s = document.createElement('script');
        s.src = 'https://checkout.razorpay.com/v1/checkout.js';
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false); // offline — use demo mode
        document.head.appendChild(s);
    });
}

/**
 * Open Razorpay UPI checkout to collect payment.
 * Called when user taps "Receive" in the Vault tab.
 */
async function openReceivePayment(amount) {
    if (!amount || amount <= 0) {
        amount = parseFloat(prompt('Enter amount to receive (₹):') || '0');
        if (!amount || amount <= 0) return;
    }

    try {
        const { order, razorpay_key, display_name } = await apiFetch('/api/payments/order', {
            method: 'POST',
            body: JSON.stringify({ amount }),
        });

        if (order._demo || razorpay_key === 'demo') {
            alert(`Demo mode: Would receive ₹${amount}\nSet RAZORPAY_KEY_ID in .env for real UPI`);
            return;
        }

        await loadRazorpayScript();
        if (!window.Razorpay) { alert('Razorpay checkout not available (offline)'); return; }

        const rzp = new window.Razorpay({
            key: razorpay_key,
            amount: order.amount,
            currency: 'INR',
            name: 'AetherNet Mesh',
            description: `Payment to ${display_name}`,
            order_id: order.id,
            prefill: { name: display_name },
            theme: { color: '#7c5cfc' },
            handler: async (response) => {
                try {
                    await apiFetch('/api/payments/verify', {
                        method: 'POST',
                        body: JSON.stringify({
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                            amount,
                        }),
                    });
                    if (typeof showToast === 'function') {
                        showToast('Payment Received!', `₹${amount} credited`, 'fa-indian-rupee-sign', 'text-emerald');
                    }
                    // Refresh balance
                    loadPaymentAccount();
                } catch (e) {
                    console.warn('[Razorpay] Verify failed:', e.message);
                }
            },
        });
        rzp.open();

    } catch (err) {
        console.warn('[Payments] Order creation failed:', err.message);
    }
}

/**
 * Send UPI payment — tries Razorpay payout if online, queues offline otherwise.
 * This patches the "Send via Mesh" button.
 */
function patchVaultSendWithUPI() {
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.primary-btn');
        if (!btn?.textContent.includes('Send via')) return;
        const modal = document.getElementById('send-modal');
        if (!modal?.classList.contains('active')) return;

        e.stopImmediatePropagation();

        const toUPI = modal.querySelector('input[type="text"]')?.value.trim() || '';
        const amount = parseFloat(modal.querySelector('input[type="number"]')?.value || '0');
        if (amount <= 0) { alert('Enter a valid amount'); return; }

        const btn2 = modal.querySelector('.primary-btn');
        if (btn2) { btn2.textContent = 'Sending...'; btn2.disabled = true; }

        try {
            const result = await apiFetch('/api/payments/payout', {
                method: 'POST',
                body: JSON.stringify({ to_upi: toUPI, to_node: toUPI, amount }),
            });

            const isSettled = result.status !== 'pending';
            if (typeof showToast === 'function') {
                showToast(
                    isSettled ? 'Payment Sent!' : 'Queued Offline',
                    isSettled ? `₹${amount} → ${toUPI}` : `Will sync when online`,
                    'fa-indian-rupee-sign',
                    isSettled ? 'text-emerald' : 'text-primary'
                );
            }
            // Update local balance
            const curBal = parseFloat(localStorage.getItem('aethernet_balance') || '14500');
            localStorage.setItem('aethernet_balance', String(Math.max(0, curBal - amount)));
            refreshBalanceDisplay();

        } catch (err) {
            alert(`Payment failed: ${err.message}`);
        } finally {
            if (btn2) { btn2.textContent = 'Send via Mesh'; btn2.disabled = false; }
            modal.classList.remove('active');
        }
    }, true);
}

/** Refresh wallet balance from backend */
async function loadPaymentAccount() {
    try {
        const { balance } = await apiFetch('/api/payments/account');
        localStorage.setItem('aethernet_balance', String(balance));
        refreshBalanceDisplay();
    } catch {
        // offline — use cached balance
    }
}

function refreshBalanceDisplay() {
    const bal = parseFloat(localStorage.getItem('aethernet_balance') || '14500');
    const balEl = document.querySelector('.card-balance h3');
    if (balEl) balEl.textContent = `₹ ${bal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}

/** Wire the Receive button to open Razorpay checkout */
function patchReceiveButton() {
    document.querySelectorAll('.action-icon-btn').forEach(btn => {
        if (btn.querySelector('span')?.textContent?.trim() === 'Receive') {
            btn.addEventListener('click', () => openReceivePayment(null));
        }
    });
}

/** Link bank/UPI account — called once after auth */
async function linkBankAccount() {
    const nodeAddress = localStorage.getItem('aethernet_node');
    if (!nodeAddress) return;

    // Check if already linked
    try {
        await apiFetch('/api/payments/account');
        return; // already linked
    } catch { }

    // Auto-link a demo UPI ID (user can update later)
    const demoUPI = `${nodeAddress.replace(/-/g, '')}@razorpay`;
    try {
        await apiFetch('/api/payments/link-bank', {
            method: 'POST',
            body: JSON.stringify({
                upi_id: demoUPI,
                account_name: localStorage.getItem('aethernet_name') || nodeAddress,
            }),
        });
        console.log('[Payments] Auto-linked UPI ID:', demoUPI);
    } catch (err) {
        console.warn('[Payments] Bank link failed:', err.message);
    }
}

/** Auto-sync pending transactions when backend detects internet */
async function syncPendingPayments() {
    try {
        const result = await apiFetch('/api/payments/sync-pending', { method: 'POST' });
        if (result.synced > 0 && typeof showToast === 'function') {
            showToast('Payments Synced', `${result.synced} transfer(s) settled`, 'fa-indian-rupee-sign', 'text-emerald');
        }
    } catch { }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PART 3 — Patch chat send to try P2P before server relay
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function patchChatForP2P() {
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('#send-msg-btn');
        if (!btn) return;
        const input = document.getElementById('chat-input-field');
        const chatName = document.getElementById('active-chat-name');
        if (!input?.value.trim()) return;

        const text = input.value.trim();
        const peerNodeId = chatName?.textContent.trim().replace(/\s+/g, '-').toLowerCase();
        if (!peerNodeId) return;

        // Try to send via P2P DataChannel first (no internet)
        const sent = sendP2PMessage(peerNodeId, text);
        if (sent) console.log('[P2P] Sent via DataChannel (offline)');
        // api-client.js also fires and POSTs to server as backup
    }, { capture: false });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BOOT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
document.addEventListener('DOMContentLoaded', () => {
    patchVaultSendWithUPI();
    patchChatForP2P();

    // After splash dismissed
    const observer = new MutationObserver(async (mutations) => {
        for (const m of mutations) {
            for (const node of m.removedNodes) {
                if (node.id === 'splash-screen') {
                    observer.disconnect();

                    // Wait a tick for api-client.js auth to complete
                    setTimeout(async () => {
                        // Setup WebRTC socket listeners (socket exists now)
                        setupWebRTCSocketListeners();

                        // Link bank account (once)
                        await linkBankAccount();

                        // Load payment account + real balance
                        await loadPaymentAccount();

                        // Patch receive button
                        patchReceiveButton();

                        // Attempt to sync any pending offline payments
                        await syncPendingPayments();

                        console.log('[P2P + Payments] ✅ Offline networking & UPI ready');
                    }, 1500);
                }
            }
        }
    });

    const app = document.querySelector('.app-container');
    if (app) observer.observe(app, { childList: true, subtree: false });
});
