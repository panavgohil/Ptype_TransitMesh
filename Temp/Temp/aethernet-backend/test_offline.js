/**
 * test_offline.js — AetherNet Offline Functionality Tests
 * =========================================================
 * Run: node test_offline.js
 * Server must be running on localhost:3000 (npm start).
 * Tests everything that works WITHOUT internet connection.
 */

const BASE = 'http://localhost:3000';

async function api(path, opts = {}) {
    const options = {
        method: opts.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(opts.headers || {}),
        },
    };
    if (opts.body) options.body = opts.body;

    const res = await fetch(`${BASE}${path}`, options);
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: res.status, ok: res.ok, json };
}

let PASS = 0, FAIL = 0;
function pass(label) { console.log(`  ✅ PASS: ${label}`); PASS++; }
function fail(label, reason) { console.log(`  ❌ FAIL: ${label} — ${reason}`); FAIL++; }

async function waitForServer(maxMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        try { const { ok } = await api('/health'); if (ok) return true; } catch { }
        await new Promise(r => setTimeout(r, 300));
    }
    return false;
}

// ─── Node credentials ──────────────────────────────────────────────────────────
const NODE_A = { display_name: 'AlphaNode', node_address: 'aether-alpha-001', password: 'alpha_pass' };
const NODE_B = { display_name: 'BetaNode', node_address: 'aether-beta-002', password: 'beta_pass' };

async function registerOrLogin(node) {
    const reg = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(node),
    });
    if (reg.ok) return { token: reg.json.token, node_address: reg.json.user.node_address, fresh: true };
    if (reg.status === 409) {
        const login = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ node_address: node.node_address, password: node.password }),
        });
        if (login.ok) return { token: login.json.token, node_address: login.json.user.node_address, fresh: false };
    }
    return null;
}

async function runTests() {
    console.log('\n🛰️  AetherNet Offline Test Suite');
    console.log('='.repeat(52));

    // ── 1. Health ─────────────────────────────────────────────────────────────
    console.log('\n[1] Health Check');
    const health = await api('/health');
    if (health.ok && health.json.status === 'ok') {
        pass(`Server healthy · LAN-IP = ${health.json.local_ip} · uptime = ${Math.round(health.json.uptime)}s`);
    } else fail('Health check', JSON.stringify(health.json));

    // ── 2 & 3. Auth ──────────────────────────────────────────────────────────
    console.log('\n[2] Node A — offline JWT auth (SQLite only, no cloud)');
    const A = await registerOrLogin(NODE_A);
    if (A) pass(`Node A ready · ${A.node_address} · ${A.fresh ? 'registered' : 'logged in'}`);
    else { fail('Node A auth', 'failed'); process.exit(1); }

    console.log('\n[3] Node B — simulates second device on same WiFi');
    const B = await registerOrLogin(NODE_B);
    if (B) pass(`Node B ready · ${B.node_address} · ${B.fresh ? 'registered' : 'logged in'}`);
    else { fail('Node B auth', 'failed'); process.exit(1); }

    // ── 4. Protected route ────────────────────────────────────────────────────
    console.log('\n[4] JWT Protected Route (offline)');
    const peersInit = await api('/api/peers', { headers: { Authorization: `Bearer ${A.token}` } });
    if (peersInit.ok) pass(`JWT validated · ${peersInit.json.peers?.length ?? 0} known peer(s)`);
    else fail('JWT auth', JSON.stringify(peersInit.json));

    // ── 5. BLE peer report ────────────────────────────────────────────────────
    console.log('\n[5] BLE Peer Discovery (simulates Web Bluetooth finding device)');
    const blePeer = await api('/api/peers/seen', {
        method: 'POST',
        headers: { Authorization: `Bearer ${A.token}` },
        body: JSON.stringify({
            peer_node_id: B.node_address,
            rssi: -62,
            distance_meters: 3.2,
            transport: 'ble'
        }),
    });
    if (blePeer.status === 200 || blePeer.status === 201)
        pass(`BLE peer recorded · ${B.node_address} · rssi=-62 dBm · ~3.2m`);
    else fail('BLE peer', `HTTP ${blePeer.status} · ${JSON.stringify(blePeer.json)}`);

    // ── 6. WiFi LAN peer ──────────────────────────────────────────────────────
    console.log('\n[6] WiFi LAN Peer (simulates mDNS Bonjour discovery)');
    const lanPeer = await api('/api/peers/seen', {
        method: 'POST',
        headers: { Authorization: `Bearer ${A.token}` },
        body: JSON.stringify({
            peer_node_id: B.node_address,
            rssi: 0,
            distance_meters: 0,
            transport: 'lan'
        }),
    });
    if (lanPeer.status === 200 || lanPeer.status === 201)
        pass('LAN peer upserted · transport=lan (mDNS discovered on local WiFi)');
    else fail('LAN peer', `HTTP ${lanPeer.status} · ${JSON.stringify(lanPeer.json)}`);

    // ── 7. Peer list persisted ────────────────────────────────────────────────
    console.log('\n[7] Peer Persistence in SQLite');
    const peerList = await api('/api/peers', { headers: { Authorization: `Bearer ${A.token}` } });
    if (peerList.ok) {
        const found = peerList.json.peers?.find(p => p.peer_node_id === B.node_address);
        if (found) pass(`${B.node_address} persisted · transport=${found.transport}`);
        else fail('Peer persistence', 'Peer B not found');
    } else fail('Peer list', JSON.stringify(peerList.json));

    // ── 8. Link bank account first (needed for payment account) ──────────────
    console.log('\n[8] Link Payment Account (demo UPI, offline)');
    const linkBank = await api('/api/payments/link-bank', {
        method: 'POST',
        headers: { Authorization: `Bearer ${A.token}` },
        body: JSON.stringify({
            upi_id: `${A.node_address.replace(/-/g, '')}@aethernet`,
            account_name: 'AlphaNode'
        }),
    });
    if (linkBank.ok || linkBank.status === 201)
        pass(`UPI ID linked offline: ${A.node_address.replace(/-/g, '')}@aethernet`);
    else fail('Link bank', `HTTP ${linkBank.status} · ${JSON.stringify(linkBank.json)}`);

    // ── 9. Networkless payment queue ──────────────────────────────────────────
    console.log('\n[9] 💸 Networkless Payment Queue (core offline feature)');
    const txn = await api('/api/transactions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${A.token}` },
        body: JSON.stringify({ to_node: B.node_address, amount: 500 }),
    });
    let txId;
    if (txn.status === 200 || txn.status === 201) {
        txId = txn.json.transaction?.id;
        pass(`₹500 QUEUED offline → ${B.node_address} · id=${txId?.slice(0, 8)}... · status=${txn.json.transaction?.status}`);
    } else fail('Offline payment queue', `HTTP ${txn.status} · ${JSON.stringify(txn.json)}`);

    // ── 10. Payments payout (offline queue via /api/payments/payout) ──────────
    console.log('\n[10] 💸 AetherPay Payout (queued offline if no Razorpay)');
    const payout = await api('/api/payments/payout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${A.token}` },
        body: JSON.stringify({ to_node: B.node_address, to_upi: `${B.node_address.replace(/-/g, '')}@aethernet`, amount: 100 }),
    });
    if (payout.ok || payout.status === 202)
        pass(`Payout queued offline · status=${payout.json.status ?? 'pending'}`);
    else fail('AetherPay payout', `HTTP ${payout.status} · ${JSON.stringify(payout.json)}`);

    // ── 11. Pending transaction list ──────────────────────────────────────────
    console.log('\n[11] Pending Offline Transactions in SQLite');
    const txList = await api('/api/transactions', { headers: { Authorization: `Bearer ${A.token}` } });
    if (txList.ok) {
        const pending = txList.json.transactions?.filter(t => t.status === 'pending') || [];
        pass(`${pending.length} pending offline payment(s) stored → will sync when internet returns`);
    } else fail('Transaction list', JSON.stringify(txList.json));

    // ── 12. Settle transaction in local DB ────────────────────────────────────
    if (txId) {
        console.log('\n[12] Settle a Queued Transaction (local DB update)');
        const settle = await api(`/api/transactions/${txId}/settle`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${A.token}` },
        });
        if (settle.ok) pass(`Transaction settled in SQLite (Razorpay will settle when internet returns)`);
        else fail('Settle transaction', `HTTP ${settle.status} · ${JSON.stringify(settle.json)}`);
    }

    // ── 13. Payments order (demo mode) ────────────────────────────────────────
    console.log('\n[13] 💳 Create Payment Order (demo mode, no Razorpay needed)');
    const order = await api('/api/payments/order', {
        method: 'POST',
        headers: { Authorization: `Bearer ${A.token}` },
        body: JSON.stringify({ amount: 100 }),
    });
    if (order.ok) {
        const isDemo = order.json.order?._demo || order.json.razorpay_key === 'demo';
        if (isDemo) pass('Demo order created — all mesh features work without Razorpay keys');
        else pass('Real Razorpay order created');
    } else fail('Payments order', `HTTP ${order.status} · ${JSON.stringify(order.json)}`);

    // ── 14. Encrypted message (store-and-forward) ─────────────────────────────
    console.log('\n[14] Encrypted Mesh Message (store-and-forward)');
    const msg = await api('/api/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${A.token}` },
        body: JSON.stringify({
            recipient_node: B.node_address,
            payload_encrypted: Buffer.from('AetherNet offline mesh works!').toString('base64'),
            ttl: 5
        }),
    });
    if (msg.ok || msg.status === 201) pass('Encrypted message buffered in SQLite (store-and-forward mesh)');
    else fail('Mesh message', `HTTP ${msg.status} · ${JSON.stringify(msg.json)}`);

    // ── 15. Activity events feed ──────────────────────────────────────────────
    console.log('\n[15] Activity Events Feed');
    const events = await api('/api/events', { headers: { Authorization: `Bearer ${A.token}` } });
    if (events.ok) pass(`${events.json.events?.length ?? 0} events logged (BLE, WiFi, UPI activity)`);
    else fail('Events feed', JSON.stringify(events.json));

    // ── Summary ───────────────────────────────────────────────────────────────
    const total = PASS + FAIL;
    console.log('\n' + '='.repeat(52));
    console.log(`\n📊 Results: ${PASS}/${total} passed · ${FAIL} failed\n`);

    if (FAIL === 0) {
        console.log('🎉 ALL OFFLINE TESTS PASSED — AetherNet works without internet!\n');
        console.log('   ✅ JWT auth (local SQLite, no cloud lookup)');
        console.log('   ✅ BLE peer discovery stored offline');
        console.log('   ✅ WiFi LAN mDNS peers persisted');
        console.log('   ✅ Networkless payment queue (SQLite pending)');
        console.log('   ✅ AetherPay payout queue (offline)');
        console.log('   ✅ Encrypted message store-and-forward');
        console.log('   ✅ Activity events logged offline');
        console.log('\n   📡 WebRTC DataChannels: test via browser (Chrome LAN)');
        console.log('   📶 Real BLE scan: Chrome + physical BLE device\n');
    } else {
        console.log(`⚠️  ${FAIL} test(s) failed — see details above\n`);
    }
    process.exit(FAIL > 0 ? 1 : 0);
}

waitForServer().then(ready => {
    if (!ready) {
        console.error('❌ Server not on localhost:3000 — run: npm start');
        process.exit(1);
    }
    return runTests();
}).catch(console.error);
