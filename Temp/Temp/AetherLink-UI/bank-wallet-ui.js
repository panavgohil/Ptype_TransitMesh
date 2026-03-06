/**
 * bank-wallet-ui.js — Real ₹ INR Bank Wallet Frontend
 * =====================================================
 * Replaces AetherCoin UI with real Indian Rupee bank account display.
 * Works offline & online. No Razorpay needed. Bank-linked or node-addressed.
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. LOAD WALLET & UPDATE VAULT TAB UI
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function loadBankWallet() {
    try {
        const { profile, balance, available_balance, pending_debits } = await apiFetch('/api/bank/account');

        localStorage.setItem('aethernet_balance', String(balance));
        localStorage.setItem('aethernet_upi_id', profile.upi_id);

        // ── Card balance ──────────────────────────────────────────────────────
        const balEl = document.querySelector('.card-balance h3');
        if (balEl) balEl.textContent = `₹ ${available_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

        const balLabel = document.querySelector('.card-balance p');
        if (balLabel) balLabel.textContent = pending_debits > 0
            ? `₹${pending_debits.toFixed(2)} pending · AetherNet Wallet`
            : 'AetherNet Wallet · INR';

        // ── Card UPI ID / number ──────────────────────────────────────────────
        const cardNum = document.querySelector('.card-number');
        if (cardNum) cardNum.textContent = profile.upi_id;

        // ── Card holder name ──────────────────────────────────────────────────
        const cardName = document.querySelector('.card-name');
        if (cardName) cardName.textContent = profile.display_name || profile.upi_id;

        // ── Bank badge on card ────────────────────────────────────────────────
        const cardType = document.querySelector('.card-type');
        if (cardType && profile.bank_name) cardType.textContent = profile.bank_name;

        console.log(`[Bank] Wallet: ${profile.upi_id} | ₹${available_balance}`);

    } catch (err) {
        console.warn('[Bank] Wallet load failed:', err.message);
        // Show "Link Account" prompt if no bank linked
        if (err.message.includes('404') || err.message.includes('No payment')) {
            showLinkBankPrompt();
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. LINK BANK ACCOUNT PROMPT (shown on first use)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function showLinkBankPrompt() {
    const vault = document.getElementById('tab-wallet');
    if (!vault || document.getElementById('link-bank-prompt')) return;

    const prompt = document.createElement('div');
    prompt.id = 'link-bank-prompt';
    prompt.style.cssText = `
        background: linear-gradient(135deg, rgba(124,92,252,0.15), rgba(0,212,255,0.1));
        border: 1px solid rgba(124,92,252,0.4);
        border-radius: 16px;
        padding: 20px;
        margin: 16px;
        text-align: center;
    `;
    prompt.innerHTML = `
        <div style="font-size:32px;margin-bottom:12px">🏦</div>
        <h3 style="color:var(--text-primary);margin-bottom:8px">Link Your Bank Account</h3>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">
            Add your UPI ID or bank account to send and receive ₹ INR over the mesh network.
            Works offline — no internet needed.
        </p>
        <button id="open-link-bank-btn" class="primary-btn" style="width:100%">
            <i class="fa-solid fa-plus"></i> Link Bank / UPI ID
        </button>
    `;

    // Insert at top of vault tab
    vault.insertBefore(prompt, vault.firstChild);
    document.getElementById('open-link-bank-btn').addEventListener('click', openLinkBankModal);
}

function openLinkBankModal() {
    // Create inline modal for bank linking
    let modal = document.getElementById('link-bank-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'link-bank-modal';
        modal.className = 'modal-overlay active';
        modal.innerHTML = `
            <div class="modal-container" style="max-width:380px">
                <div class="modal-header">
                    <h3>🏦 Link Bank Account</h3>
                    <button class="close-modal" onclick="document.getElementById('link-bank-modal').classList.remove('active')">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="modal-body" style="display:flex;flex-direction:column;gap:16px;padding:20px">
                    <div>
                        <label style="font-size:13px;color:var(--text-muted);display:block;margin-bottom:6px">
                            UPI ID <span style="color:var(--text-muted)">(e.g. yourname@okaxis, @ybl, @paytm)</span>
                        </label>
                        <input id="lb-upi" type="text" placeholder="yourname@okaxis"
                            style="width:100%;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:var(--text-primary);font-size:14px">
                    </div>
                    <div style="text-align:center;color:var(--text-muted);font-size:12px">— OR link bank account —</div>
                    <div>
                        <label style="font-size:13px;color:var(--text-muted);display:block;margin-bottom:6px">Account Number</label>
                        <input id="lb-acc" type="text" placeholder="Enter account number"
                            style="width:100%;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:var(--text-primary);font-size:14px">
                    </div>
                    <div>
                        <label style="font-size:13px;color:var(--text-muted);display:block;margin-bottom:6px">IFSC Code</label>
                        <input id="lb-ifsc" type="text" placeholder="e.g. HDFC0001234"
                            style="width:100%;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:var(--text-primary);font-size:14px">
                    </div>
                    <div>
                        <label style="font-size:13px;color:var(--text-muted);display:block;margin-bottom:6px">Bank Name (optional)</label>
                        <input id="lb-bank" type="text" placeholder="e.g. HDFC Bank"
                            style="width:100%;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:var(--text-primary);font-size:14px">
                    </div>
                    <div>
                        <label style="font-size:13px;color:var(--text-muted);display:block;margin-bottom:6px">
                            Opening Balance ₹ <span style="color:var(--text-muted)">(your current bank balance for ledger tracking)</span>
                        </label>
                        <input id="lb-bal" type="number" placeholder="e.g. 14500"
                            style="width:100%;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:var(--text-primary);font-size:14px">
                    </div>
                    <button id="submit-link-bank" class="primary-btn" style="width:100%;margin-top:8px">
                        Link Account
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('submit-link-bank').addEventListener('click', submitLinkBank);
    } else {
        modal.classList.add('active');
    }
}

async function submitLinkBank() {
    const upi = document.getElementById('lb-upi')?.value.trim();
    const acc = document.getElementById('lb-acc')?.value.trim();
    const ifsc = document.getElementById('lb-ifsc')?.value.trim();
    const bank = document.getElementById('lb-bank')?.value.trim();
    const openBal = parseFloat(document.getElementById('lb-bal')?.value || '0');

    if (!upi && !acc) { alert('Enter a UPI ID or account number'); return; }

    const btn = document.getElementById('submit-link-bank');
    btn.textContent = 'Linking...';
    btn.disabled = true;

    try {
        const result = await apiFetch('/api/bank/link', {
            method: 'POST',
            body: JSON.stringify({ upi_id: upi || null, account_number: acc || null, ifsc, bank_name: bank, opening_balance: openBal }),
        });

        if (typeof showToast === 'function') {
            showToast('Bank Account Linked!', result.upi_id, 'fa-bank', 'text-emerald');
        }

        // Remove the prompt and reload wallet
        document.getElementById('link-bank-prompt')?.remove();
        document.getElementById('link-bank-modal')?.classList.remove('active');
        await loadBankWallet();
        await loadBankHistory();

    } catch (err) {
        alert('Link failed: ' + err.message);
    } finally {
        btn.textContent = 'Link Account';
        btn.disabled = false;
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. TRANSACTION HISTORY — real ₹ INR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function loadBankHistory() {
    try {
        const { transactions, upi_id } = await apiFetch('/api/bank/history');
        if (!transactions?.length) return;

        const histList = document.querySelector('#history-modal .activity-list');
        if (!histList) return;

        histList.innerHTML = transactions.map(tx => {
            const isSent = tx.from_node === upi_id;
            const peer = isSent ? tx.to_node : tx.from_node;
            const badge = tx.status === 'pending'
                ? '<span style="font-size:10px;color:var(--accent)"> · Pending sync</span>'
                : '<span style="font-size:10px;color:var(--emerald)"> · Settled</span>';
            const date = tx.created_at
                ? new Date(tx.created_at + 'Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                : 'Recent';
            return `
            <li class="activity-item">
                <div class="activity-icon ${isSent ? 'icon-upi' : 'icon-ble'}">
                    <i class="fa-solid ${isSent ? 'fa-arrow-up' : 'fa-arrow-down'}"></i>
                </div>
                <div class="activity-details">
                    <div class="activity-title">${isSent ? 'Sent to' : 'Received from'} ${peer}</div>
                    <div class="activity-time">${date}${badge}</div>
                </div>
                <div class="tx-amount ${isSent ? 'negative' : 'text-emerald'}">
                    ${isSent ? '-' : '+'} ₹${tx.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
            </li>`;
        }).join('');
    } catch (err) {
        console.warn('[Bank] History load failed:', err.message);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. PATCH SEND BUTTON — real ₹ INR via /api/bank/transfer
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function patchSendWithRealINR() {
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.primary-btn');
        if (!btn?.textContent.includes('Send via')) return;
        const modal = document.getElementById('send-modal');
        if (!modal?.classList.contains('active')) return;

        e.stopImmediatePropagation();

        const toInput = modal.querySelector('input[type="text"]');
        const amtInput = modal.querySelector('input[type="number"]');

        let toUPI = toInput?.value.trim() || '';
        const amt = parseFloat(amtInput?.value || '0');

        if (!toUPI) { alert('Enter recipient UPI ID (e.g. friend@okaxis) or node address'); return; }
        if (amt <= 0) { alert('Enter a valid amount in ₹'); return; }

        // Auto-suffix @aethernet for node addresses
        if (!toUPI.includes('@') && toUPI.includes('aether')) toUPI += '@aethernet';

        btn.textContent = 'Sending...';
        btn.disabled = true;

        try {
            const result = await apiFetch('/api/bank/transfer', {
                method: 'POST',
                body: JSON.stringify({ to_upi: toUPI, amount: amt }),
            });

            const settled = result.status === 'settled';
            if (typeof showToast === 'function') {
                showToast(
                    settled ? '✅ ₹' + amt + ' Sent!' : '📦 Queued Offline',
                    settled
                        ? `Transferred to ${toUPI}`
                        : `Will auto-settle when ${toUPI} connects to mesh`,
                    'fa-indian-rupee-sign',
                    settled ? 'text-emerald' : 'text-primary'
                );
            }
            // Refresh wallet display
            await loadBankWallet();
            await loadBankHistory();
        } catch (err) {
            alert(`Transfer failed: ${err.message}`);
        } finally {
            btn.textContent = 'Send via Mesh';
            btn.disabled = false;
            modal.classList.remove('active');
        }
    }, true);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. SEND MODAL PLACEHOLDER UPDATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function patchSendModalPlaceholders() {
    const obs = new MutationObserver(() => {
        const modal = document.getElementById('send-modal');
        if (!modal) return;
        const textIn = modal.querySelector('input[type="text"]');
        if (textIn && !textIn._bankPatched) {
            textIn._bankPatched = true;
            textIn.placeholder = 'UPI ID (e.g. friend@okaxis) or node@aethernet';
            const lbl = textIn.previousElementSibling;
            if (lbl) lbl.textContent = 'Recipient UPI / AetherNet Address';
        }
        const numIn = modal.querySelector('input[type="number"]');
        if (numIn && !numIn._bankPatched) {
            numIn._bankPatched = true;
            numIn.placeholder = 'Amount in ₹ INR';
        }
    });
    obs.observe(document.body, { childList: true, subtree: true });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. REAL-TIME SOCKET EVENTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function listenForBankEvents() {
    const socket = window._aetherSocket;
    if (!socket) { setTimeout(listenForBankEvents, 1200); return; }

    socket.on('bank:received', ({ from, fromName, amount, message }) => {
        if (typeof showToast === 'function') {
            showToast(
                '💰 Payment Received!',
                `₹${amount.toLocaleString('en-IN')} from ${fromName || from}`,
                'fa-indian-rupee-sign',
                'text-emerald'
            );
        }
        loadBankWallet();
        loadBankHistory();
    });

    socket.on('bank:request', ({ requesterName, requester, amount }) => {
        if (typeof showToast === 'function') {
            showToast(
                '🔔 Payment Requested',
                `${requesterName || requester} wants ₹${amount}`,
                'fa-bell', 'text-primary'
            );
        }
    });

    socket.on('bank:pending', ({ from, to, amount }) => {
        const myUPI = localStorage.getItem('aethernet_upi_id');
        if (to === myUPI && typeof showToast === 'function') {
            showToast(
                '⏳ Payment Incoming',
                `₹${amount} from ${from} — will credit when synced`,
                'fa-clock', 'text-primary'
            );
        }
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. AUTO-SETTLE PENDING PAYMENTS ON MESH RECONNECT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function autoSettlePending() {
    try {
        const result = await apiFetch('/api/bank/settle', { method: 'POST' });
        if (result.settled > 0) {
            if (typeof showToast === 'function') {
                showToast(
                    '✅ Payments Settled',
                    `${result.settled} pending transfer(s) of ₹${result.total?.toFixed(2)} delivered`,
                    'fa-check-double', 'text-emerald'
                );
            }
            await loadBankWallet();
            await loadBankHistory();
        }
    } catch { }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BOOT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
document.addEventListener('DOMContentLoaded', () => {
    patchSendWithRealINR();
    patchSendModalPlaceholders();

    const obs = new MutationObserver(async (mutations) => {
        for (const m of mutations) {
            for (const node of m.removedNodes) {
                if (node.id === 'splash-screen') {
                    obs.disconnect();
                    setTimeout(async () => {
                        await loadBankWallet();
                        await loadBankHistory();
                        listenForBankEvents();
                        await autoSettlePending();
                        console.log('[Bank] ✅ Real INR wallet ready');
                    }, 2500);
                }
            }
        }
    });
    const app = document.querySelector('.app-container');
    if (app) obs.observe(app, { childList: true, subtree: false });
});
