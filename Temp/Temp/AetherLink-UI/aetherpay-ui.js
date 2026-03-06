/**
 * aetherpay-ui.js — AetherPay Wallet UI Integration
 * ===================================================
 * Replaces the hardcoded wallet UI with real AetherPay data.
 * Works completely OFFLINE — no internet, no Razorpay needed.
 *
 * AetherPay is our own custom payment protocol:
 *   - Address format: nodeaddress@aethernet
 *   - Currency: AC (AetherCoins)
 *   - Instant on LAN, queued offline
 */

const BACKEND = 'http://localhost:3000';

async function apiFetch(path, opts = {}) {
    const token = localStorage.getItem('aethernet_token');
    const res = await fetch(`${BACKEND}${path}`, {
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

// ── Load wallet and update all wallet UI elements ────────────────────────────
async function loadAetherWallet() {
    try {
        const { wallet, pending_requests } = await apiFetch('/api/aetherpay/wallet');

        // Save for other scripts to use
        localStorage.setItem('aethernet_aether_id', wallet.aether_id);
        localStorage.setItem('aethernet_balance', String(wallet.balance));

        // ── Update the card balance display ──
        const balEl = document.querySelector('.card-balance h3');
        if (balEl) balEl.textContent = `AC ${wallet.balance.toFixed(2)}`;

        // ── Update currency label ──
        const currEl = document.querySelector('.card-balance p');
        if (currEl) currEl.textContent = 'AetherCoins · Offline Mesh Currency';

        // ── Update card number area with AetherPay address ──
        const cardNumEl = document.querySelector('.card-number');
        if (cardNumEl) {
            const short = wallet.aether_id.replace('@aethernet', '');
            cardNumEl.textContent = `${short.slice(0, 4)} ${short.slice(4, 8)} ${short.slice(8, 12)} @aethernet`;
        }

        // ── Update card name line ──
        const cardNameEl = document.querySelector('.card-name');
        if (cardNameEl) {
            cardNameEl.textContent = localStorage.getItem('aethernet_name') || wallet.node_address;
        }

        // ── Show pending requests badge ──
        if (pending_requests > 0) {
            if (typeof showToast === 'function') {
                showToast(`${pending_requests} Payment Request(s)`, 'Tap Vault to review', 'fa-bell', 'text-primary');
            }
        }

        console.log(`[AetherPay] Wallet loaded: ${wallet.aether_id} | Balance: AC ${wallet.balance}`);
    } catch (err) {
        console.warn('[AetherPay] Wallet load failed (offline):', err.message);
    }
}

// ── Load transaction history and populate history modal ──────────────────────
async function loadAetherHistory() {
    try {
        const { transactions, balance, aether_id } = await apiFetch('/api/aetherpay/history');
        const myId = aether_id;
        const histList = document.querySelector('#history-modal .activity-list');
        if (!histList || !transactions.length) return;

        histList.innerHTML = transactions.map(tx => {
            const isSent = tx.from_node === myId;
            const peer = isSent ? tx.to_node : tx.from_node;
            const sign = isSent ? '-' : '+';
            const cls = isSent ? 'negative' : 'text-emerald';
            const icon = isSent ? 'fa-arrow-up' : 'fa-arrow-down';
            const badge = tx.status === 'pending'
                ? '<span style="font-size:10px;color:var(--accent)"> · Pending</span>'
                : '<span style="font-size:10px;color:var(--emerald)"> · Settled</span>';
            const date = tx.created_at
                ? new Date(tx.created_at + 'Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                : 'Recently';
            return `
            <li class="activity-item">
                <div class="activity-icon icon-upi"><i class="fa-solid ${icon}"></i></div>
                <div class="activity-details">
                    <div class="activity-title">${isSent ? 'Sent to' : 'From'} ${peer}</div>
                    <div class="activity-time">${date}${badge}</div>
                </div>
                <div class="tx-amount ${cls}">${sign} AC ${tx.amount.toFixed(2)}</div>
            </li>`;
        }).join('');
    } catch (err) {
        console.warn('[AetherPay] History load failed:', err.message);
    }
}

// ── Patch "Send via Mesh" to use AetherPay ───────────────────────────────────
function patchSendButton() {
    document.addEventListener('click', async (e) => {
        // Look for Send via Mesh button inside the send modal
        const btn = e.target.closest('.primary-btn');
        if (!btn || !btn.textContent.includes('Send via')) return;
        const modal = document.getElementById('send-modal');
        if (!modal?.classList.contains('active')) return;

        e.stopImmediatePropagation(); // prevent other handlers

        const toInput = modal.querySelector('input[type="text"]');
        const amtInput = modal.querySelector('input[type="number"]');

        let toId = toInput?.value.trim() || '';
        const amt = parseFloat(amtInput?.value || '0');

        if (amt <= 0) { alert('Enter an amount greater than 0'); return; }

        // Auto-append @aethernet if user typed a node address without it
        if (toId && !toId.includes('@')) toId = `${toId}@aethernet`;
        if (!toId) { alert('Enter a recipient AetherPay address\nFormat: nodeaddress@aethernet'); return; }

        btn.textContent = 'Sending...';
        btn.disabled = true;

        try {
            const result = await apiFetch('/api/aetherpay/send', {
                method: 'POST',
                body: JSON.stringify({ to_aether_id: toId, amount: amt }),
            });

            const settled = result.status === 'settled';
            if (typeof showToast === 'function') {
                showToast(
                    settled ? '✅ Sent!' : '📦 Queued',
                    settled
                        ? `AC ${amt} → ${toId}`
                        : `Offline — will send when ${toId} connects`,
                    'fa-indian-rupee-sign',
                    settled ? 'text-emerald' : 'text-primary'
                );
            }

            // Update displayed balance
            localStorage.setItem('aethernet_balance', String(result.new_balance));
            const balEl = document.querySelector('.card-balance h3');
            if (balEl) balEl.textContent = `AC ${result.new_balance.toFixed(2)}`;

        } catch (err) {
            alert(`Transfer failed: ${err.message}`);
        } finally {
            btn.textContent = 'Send via Mesh';
            btn.disabled = false;
            modal.classList.remove('active');
        }

    }, true);
}

// ── Patch input placeholder in send modal to show AetherPay format ──────────
function patchSendModalUI() {
    const observer = new MutationObserver(() => {
        const sendModal = document.getElementById('send-modal');
        if (!sendModal) return;

        const textInput = sendModal.querySelector('input[type="text"]');
        if (textInput && !textInput._apPatched) {
            textInput._apPatched = true;
            textInput.placeholder = 'nodeaddress@aethernet';
            const label = textInput.previousElementSibling || textInput.parentElement?.querySelector('label');
            if (label) label.textContent = 'AetherPay Address';
        }

        const numInput = sendModal.querySelector('input[type="number"]');
        if (numInput && !numInput._apPatched) {
            numInput._apPatched = true;
            numInput.placeholder = 'Amount in AC (AetherCoins)';
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

// ── Listen for real-time incoming payments (Socket.io) ──────────────────────
function listenForIncomingPayments() {
    const socket = window._aetherSocket;
    if (!socket) { setTimeout(listenForIncomingPayments, 1000); return; }

    socket.on('aetherpay:received', ({ from, amount, newBalance }) => {
        if (typeof showToast === 'function') {
            showToast('💰 Payment Received!', `AC ${amount} from ${from}`, 'fa-indian-rupee-sign', 'text-emerald');
        }
        // Update balance display in real time
        loadAetherWallet();
    });

    socket.on('aetherpay:request', ({ from, amount, note }) => {
        if (typeof showToast === 'function') {
            showToast('🔔 Payment Requested', `${from} wants AC ${amount}`, 'fa-bell', 'text-primary');
        }
    });

    socket.on('aetherpay:approved', ({ amount, to }) => {
        if (typeof showToast === 'function') {
            showToast('✅ Request Approved', `AC ${amount} received`, 'fa-check', 'text-emerald');
        }
        loadAetherWallet();
    });
}

// ── Auto-sync queued payments on mesh reconnect ──────────────────────────────
async function syncAetherPay() {
    try {
        const result = await apiFetch('/api/aetherpay/sync', { method: 'POST' });
        if (result.synced > 0 && typeof showToast === 'function') {
            showToast('Mesh Sync', `${result.synced} queued transfer(s) delivered`, 'fa-rotate', 'text-emerald');
            loadAetherWallet();
        }
    } catch { }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    patchSendButton();
    patchSendModalUI();

    const observer = new MutationObserver(async (mutations) => {
        for (const m of mutations) {
            for (const node of m.removedNodes) {
                if (node.id === 'splash-screen') {
                    observer.disconnect();
                    setTimeout(async () => {
                        await loadAetherWallet();
                        await loadAetherHistory();
                        listenForIncomingPayments();
                        await syncAetherPay();
                        console.log('[AetherPay] ✅ Custom offline UPI ready');
                    }, 2000); // wait for auth
                }
            }
        }
    });

    const app = document.querySelector('.app-container');
    if (app) observer.observe(app, { childList: true, subtree: false });
});
