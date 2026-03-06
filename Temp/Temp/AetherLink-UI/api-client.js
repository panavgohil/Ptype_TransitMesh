/**
 * api-client.js — AetherNet Backend Integration
 * ================================================
 * Connects every UI section to real backend APIs.
 * Loaded BEFORE script.js in index.html.
 */

const BACKEND_URL = 'http://localhost:3000';

// ── Auth token helpers ────────────────────────────────────────────────────────
const Auth = {
    getToken: () => localStorage.getItem('aethernet_token'),
    setToken: (t) => localStorage.setItem('aethernet_token', t),
    getNode: () => localStorage.getItem('aethernet_node'),
    setNode: (n) => localStorage.setItem('aethernet_node', n),
    getName: () => localStorage.getItem('aethernet_name'),
    setName: (n) => localStorage.setItem('aethernet_name', n),
    getBalance: () => parseFloat(localStorage.getItem('aethernet_balance') || '14500'),
    setBalance: (b) => localStorage.setItem('aethernet_balance', String(b)),
};

// ── Authenticated fetch ───────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
    const token = Auth.getToken();
    const res = await fetch(`${BACKEND_URL}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            ...(options.headers || {}),
        },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. AUTH — register/login node, populate profile UI
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function initNodeAuth() {
    let nodeAddress = Auth.getNode();
    if (!nodeAddress) {
        const rand = () => Math.random().toString(36).substr(2, 4);
        nodeAddress = `aether-${rand()}-${rand()}`;
        Auth.setNode(nodeAddress);
    }
    const displayName = `Node ${nodeAddress.split('-')[1].toUpperCase()}`;
    const password = `pwd-${nodeAddress}`;

    let user = null;
    try {
        const res = await apiFetch('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ node_address: nodeAddress, password }),
        });
        Auth.setToken(res.token);
        user = res.user;
    } catch {
        try {
            const res = await apiFetch('/api/auth/register', {
                method: 'POST',
                body: JSON.stringify({ display_name: displayName, node_address: nodeAddress, password }),
            });
            Auth.setToken(res.token);
            user = res.user;
        } catch (err) {
            console.warn('[AetherNet] Auth failed (offline mode):', err.message);
            return;
        }
    }

    if (user) {
        Auth.setName(user.display_name);
        updateProfileUI(user);
        console.log('[AetherNet] Authenticated as:', user.node_address);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. UI POPULATORS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Update the side drawer with real user info */
function updateProfileUI(user) {
    // Drawer name
    const nameEl = document.querySelector('.drawer-header h2');
    if (nameEl) nameEl.textContent = user.display_name;

    // Drawer avatar letter
    const avatarEl = document.querySelector('.user-profile-large .chat-avatar');
    if (avatarEl) avatarEl.textContent = user.display_name[0].toUpperCase();

    // Drawer subtitle
    const subEl = document.querySelector('.drawer-header span');
    if (subEl) subEl.innerHTML = `<i class="fa-solid fa-fingerprint text-emerald"></i> ${user.node_address}`;

    // QR address
    const qrAddr = document.querySelector('.qr-address');
    if (qrAddr) qrAddr.textContent = `addr: ${user.node_address}`;

    console.log('[UI] Profile updated:', user.display_name);
}

/** Update wallet card balance display */
function updateBalanceUI() {
    const bal = Auth.getBalance();
    const balEl = document.querySelector('.card-balance h3');
    if (balEl) balEl.textContent = `₹ ${bal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}

/** Populate transaction history modal with backend data */
async function loadTransactionHistory() {
    try {
        const { transactions } = await apiFetch('/api/transactions');
        const historyList = document.querySelector('#history-modal .activity-list');
        const bufferedList = document.querySelector('#tab-wallet .activity-list');
        if (!transactions || !transactions.length) return;

        const myNode = Auth.getNode();

        // Calculate real balance from settled transactions
        let balance = 14500; // starting credits
        transactions.forEach(tx => {
            if (tx.status === 'settled') {
                if (tx.from_node === myNode) balance -= tx.amount;
                else if (tx.to_node === myNode) balance += tx.amount;
            }
        });
        Auth.setBalance(balance);
        updateBalanceUI();

        // Build history list HTML
        if (historyList) {
            historyList.innerHTML = transactions.map(tx => {
                const isSent = tx.from_node === myNode;
                const amtClass = isSent ? 'negative' : 'text-emerald';
                const amtSign = isSent ? '-' : '+';
                const iconCls = isSent ? 'fa-arrow-up' : 'fa-arrow-down';
                const iconType = isSent ? 'icon-upi' : 'icon-ble';
                const peer = isSent ? tx.to_node : tx.from_node;
                const statusBadge = tx.status === 'pending'
                    ? '<span style="font-size:10px;color:var(--accent)"> · Pending</span>'
                    : '<span style="font-size:10px;color:var(--emerald)"> · Settled</span>';
                const date = new Date(tx.created_at + 'Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                return `
                <li class="activity-item">
                    <div class="activity-icon ${iconType}"><i class="fa-solid ${iconCls}"></i></div>
                    <div class="activity-details">
                        <div class="activity-title">${isSent ? 'Sent to' : 'Received from'} ${peer}</div>
                        <div class="activity-time">${date}${statusBadge}</div>
                    </div>
                    <div class="tx-amount ${amtClass}">${amtSign} ₹${tx.amount.toLocaleString('en-IN')}</div>
                </li>`;
            }).join('');
        }

        // Buffered (pending) transactions in wallet tab
        const pending = transactions.filter(t => t.status === 'pending' && t.from_node === myNode);
        if (bufferedList && pending.length > 0) {
            bufferedList.innerHTML = pending.map(tx => `
            <li class="activity-item">
                <div class="activity-icon icon-upi"><i class="fa-solid fa-arrow-up"></i></div>
                <div class="activity-details">
                    <div class="activity-title">Sent to ${tx.to_node}</div>
                    <div class="activity-time">Awaiting internet node...</div>
                </div>
                <div class="tx-amount negative">- ₹${tx.amount.toLocaleString('en-IN')}</div>
            </li>`).join('');
        }

        console.log(`[API] Loaded ${transactions.length} transactions`);
    } catch (err) {
        console.warn('[API] Could not load transactions (offline):', err.message);
    }
}

/** Populate the Comms tab chat list with buffered messages */
async function loadChatMessages() {
    try {
        const { messages } = await apiFetch('/api/messages');
        if (!messages || !messages.length) return;

        const myNode = Auth.getNode();
        const chatList = document.querySelector('#tab-chat .chat-list');
        if (!chatList) return;

        // Group messages by peer
        const threads = {};
        messages.forEach(msg => {
            const peer = msg.sender_node === myNode ? msg.recipient_node : msg.sender_node;
            if (!threads[peer]) threads[peer] = [];
            threads[peer].push(msg);
        });

        // Build chat item HTML for each thread
        const gradients = ['bg-gradient-1', 'bg-gradient-2', 'bg-gradient-3'];
        const newItems = Object.entries(threads)
            .slice(0, 5) // max 5 threads
            .map(([peer, msgs], i) => {
                const last = msgs[msgs.length - 1];
                const initials = peer.slice(-4).toUpperCase();
                const grade = gradients[i % gradients.length];
                const time = new Date(last.created_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const preview = last.sender_node === myNode ? 'You: [Encrypted]' : '[Encrypted Payload]';
                const unread = msgs.filter(m => m.status === 'buffered' && m.recipient_node === myNode).length;
                return `
                <div class="chat-item ${unread ? 'unread' : ''}">
                    <div class="chat-avatar ${grade}">${initials}</div>
                    <div class="chat-preview">
                        <div class="chat-header">
                            <h4>${peer}</h4><span>${time}</span>
                        </div>
                        <p>${preview}</p>
                    </div>
                    ${unread ? `<div class="unread-badge">${unread}</div>` : ''}
                </div>`;
            }).join('');

        if (newItems) {
            // Prepend real messages before the hardcoded ones
            chatList.insertAdjacentHTML('afterbegin', newItems);
        }

        console.log(`[API] Loaded ${Object.keys(threads).length} message threads`);
    } catch (err) {
        console.warn('[API] Could not load messages (offline):', err.message);
    }
}

/** Populate compose modal peer list from backend */
async function loadPeers() {
    try {
        const { peers } = await apiFetch('/api/peers');
        if (!peers || !peers.length) return;

        const peerList = document.querySelector('#compose-modal .peer-list');
        if (!peerList) return;

        const newPeers = peers.slice(0, 6).map(p => {
            const signalClass = p.rssi > -65 ? 'text-emerald' : p.rssi > -75 ? 'text-primary' : 'text-muted';
            const signalLabel = p.rssi > -65 ? 'Strong Signal' : p.rssi > -75 ? 'Medium Signal' : 'Weak Signal';
            return `
            <div class="peer-item">
                <div class="peer-icon"><i class="fa-brands fa-bluetooth ${signalClass}"></i></div>
                <div class="peer-info">
                    <h4>${p.peer_node_id} (${signalLabel})</h4>
                    <span>RSSI: ${p.rssi} dBm · ~${p.distance_meters}m · ${p.transport.toUpperCase()}</span>
                </div>
                <button class="connect-btn">Connect</button>
            </div>`;
        }).join('');

        peerList.insertAdjacentHTML('afterbegin', newPeers);
        console.log(`[API] Loaded ${peers.length} peers into compose modal`);
    } catch (err) {
        console.warn('[API] Could not load peers (offline):', err.message);
    }
}

/** Load events feed into the Radar activity list */
async function loadEventsFeed() {
    try {
        const { events } = await apiFetch('/api/events?limit=10');
        if (!events || !events.length) return;
        const typeMap = {
            ble: { icon: 'fa-brands fa-bluetooth-b' },
            msg: { icon: 'fa-solid fa-envelope' },
            upi: { icon: 'fa-solid fa-indian-rupee-sign' },
            wifi: { icon: 'fa-solid fa-wifi' },
        };
        const mapped = events.map(e => ({
            type: e.type,
            icon: (typeMap[e.type] || typeMap.wifi).icon,
            title: e.title,
            time: new Date(e.created_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }));
        if (window.activitiesList) {
            window.activitiesList = [...mapped, ...window.activitiesList];
            window.renderActivities && window.renderActivities();
        }
        console.log(`[API] Loaded ${events.length} events`);
    } catch (err) {
        console.warn('[API] Could not load events (offline):', err.message);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. SOCKET.IO — real-time events
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function initSocket() {
    const script = document.createElement('script');
    script.src = `${BACKEND_URL}/socket.io/socket.io.js`;
    script.onload = () => {
        const socket = io(BACKEND_URL, { transports: ['websocket', 'polling'] });
        window._aetherSocket = socket;

        socket.on('connect', () => {
            console.log('[WS] Connected to AetherNet gateway');
            const nodeAddress = Auth.getNode();
            if (nodeAddress) socket.emit('join:node', nodeAddress);
        });

        // Live peer → update activity feed + peer count
        socket.on('peer:discovered', ({ nodeId, transport }) => {
            if (window.activitiesList) {
                window.activitiesList.unshift({
                    type: transport === 'wifi' ? 'wifi' : 'ble',
                    icon: transport === 'wifi' ? 'fa-solid fa-wifi' : 'fa-brands fa-bluetooth-b',
                    title: `BLE Discovery: ${nodeId}`,
                    time: 'Just now'
                });
                window.renderActivities && window.renderActivities();
            }
        });

        // Incoming encrypted message → bump counter
        socket.on('message:buffered', ({ senderNode }) => {
            const ctr = document.getElementById('buffered-msgs');
            if (ctr) ctr.textContent = parseInt(ctr.textContent || '0') + 1;

            // Show toast
            if (typeof showToast === 'function') {
                showToast('Encrypted Payload Received', `From: ${senderNode}`, 'fa-envelope', '');
            }
        });

        // Transaction queued by the other party
        socket.on('transaction:queued', ({ fromNode, amount }) => {
            if (typeof showToast === 'function') {
                showToast('Offline Transfer Incoming', `₹${amount} from ${fromNode}`, 'fa-indian-rupee-sign', 'text-emerald');
            }
        });

        // Sync complete → decrement buffer counter
        socket.on('sync:complete', ({ deliveredCount }) => {
            const ctr = document.getElementById('buffered-msgs');
            if (ctr) {
                ctr.textContent = Math.max(0, parseInt(ctr.textContent || '0') - deliveredCount);
            }
            // Reload transactions & balance
            loadTransactionHistory();
        });

        socket.on('disconnect', () => console.log('[WS] Disconnected'));
    };
    document.head.appendChild(script);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. ACTION PATCHES — wire UI buttons to real API calls
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Force Handshake → emit real socket event */
function patchForceHandshake() {
    const btn = document.querySelector('button[onclick="simulateSync()"]');
    if (!btn) return;
    btn.removeAttribute('onclick');
    btn.addEventListener('click', () => {
        window.simulateSync && window.simulateSync(); // keep local animation
        if (window._aetherSocket?.connected) {
            window._aetherSocket.emit('handshake:force', { node_address: Auth.getNode() });
        }
    });
}

/** Chat Send → POST /api/messages */
function patchChatSend() {
    const observer = new MutationObserver(() => {
        const sendBtn = document.getElementById('send-msg-btn');
        if (sendBtn && !sendBtn._apiPatched) {
            sendBtn._apiPatched = true;
            sendBtn.addEventListener('click', async () => {
                const input = document.getElementById('chat-input-field');
                const chatName = document.getElementById('active-chat-name');
                if (!input?.value.trim()) return;
                const recipientNode = chatName
                    ? chatName.textContent.trim().replace(/\s+/g, '-').toLowerCase()
                    : 'unknown';
                try {
                    await apiFetch('/api/messages', {
                        method: 'POST',
                        body: JSON.stringify({
                            recipient_node: recipientNode,
                            payload_encrypted: btoa(unescape(encodeURIComponent(input.value.trim()))),
                            ttl: 5,
                        }),
                    });
                } catch (err) {
                    console.warn('[API] Message buffer failed (offline):', err.message);
                }
            }, { capture: true });
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

/** Vault Send → POST /api/transactions, deduct from local balance */
function patchVaultSend() {
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.primary-btn');
        if (!btn?.textContent.includes('Send via')) return;
        const modal = document.getElementById('send-modal');
        if (!modal?.classList.contains('active')) return;

        const toNode = modal.querySelector('input[type="text"]')?.value.trim() || 'unknown-node';
        const amount = parseFloat(modal.querySelector('input[type="number"]')?.value || '0');
        if (amount <= 0) return;

        try {
            await apiFetch('/api/transactions', {
                method: 'POST',
                body: JSON.stringify({ to_node: toNode, amount }),
            });
            // Optimistically deduct from balance
            Auth.setBalance(Math.max(0, Auth.getBalance() - amount));
            updateBalanceUI();
            if (typeof showToast === 'function') {
                showToast('Transfer Queued', `₹${amount} → ${toNode} buffered for sync`, 'fa-indian-rupee-sign', 'text-primary');
            }
        } catch (err) {
            console.warn('[API] Transaction failed (offline):', err.message);
        }
    });
}

/** Report a simulated peer sighting to backend */
async function reportSamplePeers() {
    const samplePeers = [
        { peer_node_id: 'Node-7A', rssi: -62, distance_meters: 4, transport: 'ble' },
        { peer_node_id: 'Node-X2', rssi: -74, distance_meters: 12, transport: 'ble' },
        { peer_node_id: 'Node-M9', rssi: -58, distance_meters: 2, transport: 'wifi' },
    ];
    for (const p of samplePeers) {
        try {
            await apiFetch('/api/peers/seen', { method: 'POST', body: JSON.stringify(p) });
        } catch { /* offline */ }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. BOOT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
document.addEventListener('DOMContentLoaded', () => {
    initSocket();
    patchChatSend();
    patchVaultSend();

    // After splash dismissed → auth + load all data
    const splashObserver = new MutationObserver(async (mutations) => {
        for (const m of mutations) {
            for (const node of m.removedNodes) {
                if (node.id === 'splash-screen') {
                    splashObserver.disconnect();

                    // 1. Authenticate
                    await initNodeAuth();

                    // 2. Load all backend data in parallel
                    await Promise.allSettled([
                        loadEventsFeed(),
                        loadTransactionHistory(),
                        loadChatMessages(),
                        reportSamplePeers().then(() => loadPeers()),
                    ]);

                    // 3. Patch buttons (after DOM is stable)
                    patchForceHandshake();

                    // 4. Update balance display
                    updateBalanceUI();

                    console.log('[AetherNet] ✅ All backend data loaded');
                }
            }
        }
    });

    const appContainer = document.querySelector('.app-container');
    if (appContainer) splashObserver.observe(appContainer, { childList: true, subtree: false });
});
