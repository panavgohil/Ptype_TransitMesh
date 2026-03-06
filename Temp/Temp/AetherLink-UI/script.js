const initialActivities = [
    { type: 'ble', icon: 'fa-brands fa-bluetooth-b', title: 'BLE Discovery: Node M7', time: 'Just now' },
    { type: 'msg', icon: 'fa-solid fa-envelope', title: 'Message Buffered', time: '2 mins ago' },
    { type: 'upi', icon: 'fa-solid fa-indian-rupee-sign', title: 'UPI Payload Stored', time: '5 mins ago' },
    { type: 'wifi', icon: 'fa-solid fa-wifi', title: 'Wi-Fi Direct Handshake (Node X2)', time: '12 mins ago' }
];

let activitiesList = [...initialActivities];
let syncTimeout;

function renderActivities() {
    const lists = document.querySelectorAll('.activity-list[id="activity-list"]');

    lists.forEach(list => {
        list.innerHTML = '';
        const toRender = activitiesList.slice(0, 4);

        toRender.forEach((act, index) => {
            const li = document.createElement('li');
            li.className = 'activity-item';
            li.style.animationDelay = `${index * 0.05}s`;

            li.innerHTML = `
                <div class="activity-icon icon-${act.type}">
                    <i class="${act.icon}"></i>
                </div>
                <div class="activity-details">
                    <div class="activity-title">${act.title}</div>
                    <div class="activity-time">${act.time}</div>
                </div>
            `;
            list.appendChild(li);
        });
    });
}

function simulateSync() {
    if (syncTimeout) return;

    document.getElementById('network-status').textContent = 'Negotiating Wi-Fi Direct Group...';
    document.querySelector('.status-indicator').className = 'status-indicator syncing';
    document.querySelector('.status-desc').textContent = 'BLE signal > -70dBm detected. Establishing high-speed socket connection for payload transfer.';

    if (navigator.vibrate) navigator.vibrate(50);

    activitiesList.unshift({
        type: 'wifi',
        icon: 'fa-solid fa-wifi',
        title: 'TCP Socket Transmission',
        time: 'Just now'
    });
    renderActivities();

    syncTimeout = setTimeout(() => {
        document.getElementById('network-status').textContent = 'Idle / BLE Scanning';
        document.querySelector('.status-indicator').className = 'status-indicator';
        document.querySelector('.status-desc').textContent = 'Foreground Service active. Silently discovering nearby peers over low-power Bluetooth connection.';

        const bufferedNode = document.getElementById('buffered-msgs');
        let current = parseInt(bufferedNode.textContent);
        if (current > 0) {
            let decrements = Math.min(current, 3);
            let target = current - decrements;

            let interval = setInterval(() => {
                current--;
                bufferedNode.textContent = current;
                if (current <= target) clearInterval(interval);
            }, 60);
        }

        syncTimeout = null;
    }, 4000);
}

// Splash Screen Logic
function setupSplash() {
    const splash = document.getElementById('splash-screen');
    const biometricBtn = document.getElementById('biometric-unlock-btn');
    const dots = document.querySelectorAll('.pin-dot');

    if (biometricBtn && splash) {
        biometricBtn.addEventListener('click', () => {
            biometricBtn.classList.add('scanning');

            // Simulate fingerprint scan & dot fill
            let delay = 0;
            dots.forEach((dot, index) => {
                setTimeout(() => {
                    dot.classList.add('filled');
                }, delay);
                delay += 150;
            });

            // Unlock after dots filled
            setTimeout(() => {
                splash.classList.add('fade-out');
                setTimeout(() => {
                    splash.remove();
                }, 600);
            }, delay + 300);
        });
    }
}

// Tab Switching Logic
function setupTabs() {
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // Remove active class from all nav items and tabs
            navItems.forEach(nav => nav.classList.remove('active'));
            tabContents.forEach(tab => tab.classList.remove('active'));

            // Add active class to clicked nav item
            item.classList.add('active');

            // Show corresponding tab content
            const targetId = item.getAttribute('data-target');
            const targetTab = document.getElementById(targetId);
            if (targetTab) {
                targetTab.classList.add('active');
            }
        });
    });
}

// Accordion Logic for Help Tab
function setupAccordion() {
    const helpHeaders = document.querySelectorAll('.help-header');

    helpHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const parentItem = header.parentElement;
            const wasActive = parentItem.classList.contains('active');

            // Close all
            document.querySelectorAll('.help-item').forEach(item => {
                item.classList.remove('active');
            });

            // Toggle clicked one
            if (!wasActive) {
                parentItem.classList.add('active');
            }
        });
    });
}

function setupChatView() {
    const chatItems = document.querySelectorAll('.chat-item');
    const chatView = document.getElementById('chat-view');
    const closeBtn = document.getElementById('close-chat-btn');
    const activeChatName = document.getElementById('active-chat-name');
    const activeChatAvatar = document.getElementById('active-chat-avatar');

    // Open chat
    chatItems.forEach(item => {
        item.addEventListener('click', () => {
            const name = item.querySelector('h4').textContent;
            const avatarHtml = item.querySelector('.chat-avatar').innerHTML;
            const avatarClass = Array.from(item.querySelector('.chat-avatar').classList).find(c => c.startsWith('bg-gradient-'));

            activeChatName.textContent = name;
            activeChatAvatar.innerHTML = avatarHtml;
            activeChatAvatar.className = 'chat-avatar ' + (avatarClass || 'bg-gradient-1');

            chatView.classList.add('open');

            // Scroll to bottom of messages
            const msgs = document.getElementById('chat-messages');
            msgs.scrollTop = msgs.scrollHeight;
        });
    });

    // Close chat
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            chatView.classList.remove('open');
        });
    }

    // Send logic
    const sendBtn = document.getElementById('send-msg-btn');
    const inputField = document.getElementById('chat-input-field');
    const chatMessages = document.getElementById('chat-messages');

    function sendMessage() {
        const text = inputField.value.trim();
        if (text) {
            const now = new Date();
            const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const msgHtml = `
                <div class="message sent" style="animation: slideIn 0.3s forwards">
                    <div class="msg-bubble">
                        ${text}
                        <div class="msg-status"><i class="fa-solid fa-clock text-muted"></i></div>
                    </div>
                    <span class="msg-time">${timeStr}</span>
                </div>
            `;

            chatMessages.insertAdjacentHTML('beforeend', msgHtml);
            inputField.value = '';
            chatMessages.scrollTop = chatMessages.scrollHeight;

            // Simulate delayed send status update
            setTimeout(() => {
                const statusIcons = chatMessages.querySelectorAll('.sent:last-child .msg-status i');
                if (statusIcons.length) {
                    statusIcons[0].className = 'fa-solid fa-check text-muted';
                }
            }, 800);

            // Simulate typing indicator and auto-reply
            setTimeout(() => {
                const typingHtml = `
                    <div class="message received typing-indicator-msg" style="animation: slideIn 0.3s forwards">
                        <div class="msg-bubble typing-bubble">
                            <span class="typing-dot"></span>
                            <span class="typing-dot"></span>
                            <span class="typing-dot"></span>
                        </div>
                    </div>
                `;
                chatMessages.insertAdjacentHTML('beforeend', typingHtml);
                chatMessages.scrollTop = chatMessages.scrollHeight;

                setTimeout(() => {
                    const typingNode = chatMessages.querySelector('.typing-indicator-msg');
                    if (typingNode) typingNode.remove();

                    const replyTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    const replyHtml = `
                        <div class="message received" style="animation: slideIn 0.3s forwards">
                            <div class="msg-bubble">
                                Acknowledged. We will sync when relay node is in range.
                            </div>
                            <span class="msg-time">${replyTime}</span>
                        </div>
                    `;
                    chatMessages.insertAdjacentHTML('beforeend', replyHtml);
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }, 2000);

            }, 1200);
        }
    }

    if (sendBtn) {
        sendBtn.addEventListener('click', sendMessage);
    }

    if (inputField) {
        inputField.addEventListener('input', () => {
            inputField.style.height = 'auto';
            inputField.style.height = inputField.scrollHeight + 'px';
        });

        inputField.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
                inputField.style.height = 'auto'; // Reset size
            }
        });
    }
}

function setupSwipeToDelete() {
    const swipeContainers = document.querySelectorAll('.swipe-container');

    swipeContainers.forEach(container => {
        const content = container.querySelector('.swipe-content');
        const action = container.querySelector('.swipe-action');
        let startX = 0;
        let currentX = 0;
        let isDragging = false;

        if (!content || !action) return;

        const handleStart = (clientX) => {
            startX = clientX;
            isDragging = true;
            content.style.transition = 'none';
        };

        const handleMove = (clientX) => {
            if (!isDragging) return;
            const diff = clientX - startX;

            // Only allow swiping left
            if (diff < 0) {
                currentX = Math.max(diff, -80); // Max swipe distance 80px
                content.style.transform = `translateX(${currentX}px)`;
            }
        };

        const handleEnd = () => {
            if (!isDragging) return;
            isDragging = false;
            content.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1)';

            if (currentX < -40) {
                // Keep open
                content.style.transform = `translateX(-80px)`;
            } else {
                // Snap back
                content.style.transform = `translateX(0)`;
            }
        };

        // Touch events
        content.addEventListener('touchstart', e => handleStart(e.touches[0].clientX), { passive: true });
        content.addEventListener('touchmove', e => handleMove(e.touches[0].clientX), { passive: true });
        content.addEventListener('touchend', handleEnd);

        // Mouse events for desktop testing
        content.addEventListener('mousedown', e => handleStart(e.clientX));
        document.addEventListener('mousemove', e => { if (isDragging) handleMove(e.clientX); });
        document.addEventListener('mouseup', handleEnd);

        // Handle delete click
        action.addEventListener('click', (e) => {
            e.stopPropagation();
            container.style.transition = 'all 0.3s ease';
            container.style.opacity = '0';
            container.style.padding = '0';
            container.style.height = '0';
            container.style.marginBottom = '0';
            setTimeout(() => {
                container.remove();
            }, 300);
        });
    });
}

function setupModals() {
    // Compose Modal
    const openComposeBtn = document.getElementById('open-compose-btn');
    const closeComposeBtn = document.getElementById('close-compose-btn');
    const composeModal = document.getElementById('compose-modal');

    // QR Modal
    const openQrBtn = document.getElementById('open-qr-btn');
    const closeQrBtn = document.getElementById('close-qr-btn');
    const qrModal = document.getElementById('qr-modal');

    // Send Modal
    const openSendBtn = document.getElementById('open-send-btn');
    const closeSendBtn = document.getElementById('close-send-btn');
    const sendModal = document.getElementById('send-modal');

    // History Modal
    const openHistoryBtn = document.getElementById('open-history-btn');
    const closeHistoryBtn = document.getElementById('close-history-btn');
    const historyModal = document.getElementById('history-modal');

    // Node Details Modal (Radar)
    const nodeModal = document.getElementById('node-modal');
    const closeNodeBtn = document.getElementById('close-node-btn');

    function openModal(modal) {
        if (modal) modal.classList.add('active');
    }

    function closeModal(modal) {
        if (modal) modal.classList.remove('active');
    }

    if (openComposeBtn) openComposeBtn.addEventListener('click', () => openModal(composeModal));
    if (closeComposeBtn) closeComposeBtn.addEventListener('click', () => closeModal(composeModal));

    if (openQrBtn) openQrBtn.addEventListener('click', () => openModal(qrModal));
    if (closeQrBtn) closeQrBtn.addEventListener('click', () => closeModal(qrModal));

    if (openSendBtn) openSendBtn.addEventListener('click', () => openModal(sendModal));
    if (closeSendBtn) closeSendBtn.addEventListener('click', () => closeModal(sendModal));

    if (openHistoryBtn) openHistoryBtn.addEventListener('click', () => openModal(historyModal));
    if (closeHistoryBtn) closeHistoryBtn.addEventListener('click', () => closeModal(historyModal));



    // Close on click outside
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeModal(overlay);
            }
        });
    });

    // Dummy Connect actions in Compose Modal
    document.querySelectorAll('.connect-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
            setTimeout(() => {
                closeModal(composeModal);
                btn.textContent = 'Connect';
                showToast('Secure Channel Opened', 'AES-256 encrypted handshake successful.', 'fa-lock', 'text-emerald');
            }, 1200);
        });
    });
}

function setupDrawer() {
    const openMenuBtn = document.getElementById('open-menu-btn');
    const closeMenuBtn = document.getElementById('close-menu-btn');
    const settingsDrawer = document.getElementById('settings-drawer');

    if (openMenuBtn && settingsDrawer) {
        openMenuBtn.addEventListener('click', () => {
            settingsDrawer.classList.add('active');
        });
    }

    if (closeMenuBtn && settingsDrawer) {
        closeMenuBtn.addEventListener('click', () => {
            settingsDrawer.classList.remove('active');
        });
    }

    if (settingsDrawer) {
        settingsDrawer.addEventListener('click', (e) => {
            if (e.target === settingsDrawer) {
                settingsDrawer.classList.remove('active');
            }
        });
    }

    // Theme Toggle Logic
    const themeSwitch = document.getElementById('theme-switch');
    const themeText = document.getElementById('theme-text');
    const themeIcon = document.getElementById('theme-icon');

    if (themeSwitch) {
        themeSwitch.addEventListener('change', (e) => {
            if (e.target.checked) {
                // Dark mode
                document.body.classList.remove('light-mode');
                themeText.textContent = 'Dark Mode';
                themeIcon.innerHTML = '<i class="fa-solid fa-moon"></i>';
                showToast('Theme Updated', 'Dark mode activated.', 'fa-moon', 'text-primary');
            } else {
                // Light mode
                document.body.classList.add('light-mode');
                themeText.textContent = 'Light Mode';
                themeIcon.innerHTML = '<i class="fa-solid fa-sun" style="color: #f39c12;"></i>';
                showToast('Theme Updated', 'Light mode activated.', 'fa-sun', 'text-primary');
            }
        });
    }

    // Add click events to drawer actions
    document.querySelectorAll('.drawer-action').forEach(action => {
        action.addEventListener('click', (e) => {
            // Prevent drawer from closing if clicking the theme toggle
            if (action.id === 'theme-toggle-btn') {
                // If they clicked the container but not the switch itself, toggle it
                if (e.target !== themeSwitch && !e.target.closest('.toggle-switch')) {
                    themeSwitch.checked = !themeSwitch.checked;
                    themeSwitch.dispatchEvent(new Event('change'));
                }
                return;
            }

            if (settingsDrawer) settingsDrawer.classList.remove('active');

            const title = action.querySelector('h3').textContent;
            if (title === "Kill Service") {
                showToast('Service Terminated', 'Background DTN routing has been stopped.', 'fa-power-off', 'text-accent');
            } else {
                showToast('Opening Config', `Navigating to ${title}...`, 'fa-gear', 'text-primary');
            }
        });
    });
}

function showToast(title, desc, iconLabel, iconColorClass) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
        <div class="toast-icon bg-gradient-2">
            <i class="fa-solid ${iconLabel} ${iconColorClass || ''}"></i>
        </div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-desc">${desc}</div>
        </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

document.addEventListener('DOMContentLoaded', () => {
    setupSplash();
    renderActivities();
    setupTabs();
    setupAccordion();
    setupChatView();
    setupSwipeToDelete();
    setupModals();
    setupDrawer();

    setInterval(() => {
        if (!syncTimeout && Math.random() > 0.6) {
            const bufferedNode = document.getElementById('buffered-msgs');
            if (bufferedNode) {
                bufferedNode.textContent = parseInt(bufferedNode.textContent) + 1;
            }

            if (activitiesList.length > 20) activitiesList.pop();

            const isMsg = Math.random() > 0.5;
            const randomType = isMsg ?
                { type: 'msg', icon: 'fa-solid fa-envelope', title: 'New Encrypted Payload Appended' } :
                { type: 'ble', icon: 'fa-brands fa-bluetooth-b', title: `BLE Discovery: Node ${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${Math.floor(Math.random() * 9)}` };

            activitiesList.unshift({
                ...randomType,
                time: 'Just now'
            });

            renderActivities();

            // Randomly toggle radar nodes for visual effect
            document.querySelectorAll('.radar-node').forEach(node => {
                if (Math.random() > 0.6) {
                    node.style.display = node.style.display === 'none' ? 'block' : 'none';
                }
            });

            // Occasionally show a toast for background events to make the app feel alive
            if (Math.random() > 0.7) {
                if (isMsg) {
                    showToast('Payload Buffered', 'Message stored locally awaiting internet sync.', 'fa-envelope', '');
                } else {
                    showToast('Peer Discovered', 'New node registered via BLE.', 'fa-bluetooth', '');
                }
            }
        }
    }, 5500);
});
