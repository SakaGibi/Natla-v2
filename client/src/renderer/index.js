/**
 * index.js 
 * Coordination point for UI and SFU logic.
 */
import { socketManager } from './modules/socket.js';
import { sfuManager } from './modules/sfu.js';
import { uiManager } from './modules/ui.js';
import { audioAnalyzer } from './modules/audioAnalyzer.js';
import { soundEffects } from './modules/soundEffects.js';
import { chatService } from './modules/chatService.js';
import { authService } from './modules/authService.js';

soundEffects.init();

const btnConnect = document.getElementById('btnConnect');
const statusDisplay = document.getElementById('roomPreview');

const activeControls = document.getElementById('activeControls');
const btnToggleMic = document.getElementById('btnToggleMic');
const btnToggleSound = document.getElementById('btnToggleSound');
const btnDisconnect = document.getElementById('btnDisconnect');

// State for notifications
let defaultStatusText = "";
let notificationTimeout = null;
const peerNames = new Map();
let myName = "";
let myProfilePic = null;
let currentRoom = "";
const serverUrl = import.meta.env.VITE_SERVER_URL || "http://localhost:3030";

function updateRoomStatusOnly(roomName, userList) {
    console.log('[UI] updateRoomStatusOnly called:', roomName, userList);
    const count = userList.length;
    const namesStr = userList.join(', ');

    // Room Status Text
    if (count === 0) {
        defaultStatusText = `${roomName}: Boş`;
    } else {
        defaultStatusText = `${roomName}: ${count} Kişi (${namesStr})`;
    }
    console.log('[UI] New defaultStatusText:', defaultStatusText);

    if (!notificationTimeout) {
        console.log('[UI] Updating display immediately (no timeout)');
        statusDisplay.innerText = defaultStatusText;
        statusDisplay.style.color = '#aaa';
    } else {
        console.log('[UI] Timeout active, skipping immediate update');
    }
}

function updateRoomStatus() {
    const count = peerNames.size + 1; // +1 for me
    const names = [myName, ...peerNames.values()];
    const namesStr = names.join(', ');

    // Room Status Text
    defaultStatusText = `${currentRoom}: ${count} Kişi (${namesStr})`;

    if (!notificationTimeout) {
        statusDisplay.innerText = defaultStatusText;
        statusDisplay.style.color = '#aaa';
    }
}

function showNotification(text, color = '#2ecc71', duration = 2000) {
    console.log(`[UI] showNotification: "${text}" (${color}) for ${duration}ms`);
    if (notificationTimeout) {
        console.log('[UI] Clearing existing timeout');
        clearTimeout(notificationTimeout);
    }

    statusDisplay.innerText = text;
    statusDisplay.style.color = color;

    notificationTimeout = setTimeout(() => {
        console.log('[UI] Notification timeout expired. Reverting to default:', defaultStatusText);
        notificationTimeout = null;
        statusDisplay.innerText = defaultStatusText;
        statusDisplay.style.color = '#aaa';
    }, duration);
}

// Load persisted data
function loadSavedData() {
    const savedName = localStorage.getItem('natla_username');
    const savedPic = localStorage.getItem('natla_profilePic');

    if (savedName) {
        document.getElementById('username').value = savedName;
    }

    if (savedPic) {
        myProfilePic = savedPic;
        document.getElementById('myAvatarDisplay').src = savedPic;
    }
}

async function startApp() {
    console.log("Natla Client Initializing...");

    // Load persisted data
    loadSavedData();

    // Setup Avatar Selection
    const avatarInput = document.getElementById('avatarInput');
    const myAvatarDisplay = document.getElementById('myAvatarDisplay');

    myAvatarDisplay.addEventListener('click', () => {
        avatarInput.click();
    });

    avatarInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) { // 2MB limit
            showNotification("Resim boyutu 2MB'dan küçük olmalı!", "#e74c3c", 3000);
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const base64String = event.target.result;
            myProfilePic = base64String;
            myAvatarDisplay.src = base64String;
            localStorage.setItem('natla_profilePic', base64String);
            showNotification("Profil fotoğrafı güncellendi!", "#2ecc71", 2000);
        };
        reader.readAsDataURL(file);
    });

    // Initial Connection & Preview Logic
    try {
        console.log('[App] Showing welcome notification...');
        // Show welcome message immediately with independent timeout
        showNotification("Hoşgeldiniz!", "#aaa", 2000);

        console.log('[App] Connecting to socket:', serverUrl);
        await socketManager.connect(serverUrl);
        console.log('[App] Socket connected!');

        // Initial fetch for default room 'Genel'
        const initialRoom = document.getElementById('roomSelect').value;
        console.log('[App] Fetching stats for initial room:', initialRoom);
        socketManager.socket.emit('getRoomStats', { roomId: initialRoom }, ({ users }) => {
            console.log('[App] Received stats for initial room:', users);
            updateRoomStatusOnly(initialRoom, users || []);
        });

        // Listen for room changes to update preview
        document.getElementById('roomSelect').addEventListener('change', (e) => {
            const newRoom = e.target.value;
            console.log('[App] Room selection changed to:', newRoom);
            socketManager.socket.emit('getRoomStats', { roomId: newRoom }, ({ users }) => {
                console.log('[App] Received stats for new room:', users);
                updateRoomStatusOnly(newRoom, users || []);
            });
        });

        // Listen for global room updates (Dynamic Preview)
        socketManager.socket.on('room-update', ({ roomId }) => {
            const currentSelectedRoom = document.getElementById('roomSelect').value;
            if (roomId === currentSelectedRoom) {
                console.log('[App] Received room-update for current preview:', roomId);
                socketManager.socket.emit('getRoomStats', { roomId }, ({ users }) => {
                    console.log('[App] Received updated stats:', users);
                    updateRoomStatusOnly(roomId, users || []);
                });
            }
        });

        // Handle Server Disconnect
        socketManager.socket.on('disconnect', () => {
            console.log('[App] Socket disconnected');
            if (activeControls.style.display !== 'none') {
                statusDisplay.innerText = "Bağlantı koptu...";
                statusDisplay.style.color = 'red';
                // Reload to reset state if we were in a call
                setTimeout(() => window.location.reload(), 1500);
            }
        });

        // Handle Dirty Reconnect (Server restarted while client was open)
        socketManager.socket.on('connect', () => {
            console.log('[App] Socket connected/reconnected');
            if (activeControls.style.display !== 'none') {
                console.log('[App] Detected dirty reconnect. Reloading...');
                window.location.reload();
            }
        });

        // Handle Peer State Updates (Mute/Deafen)
        socketManager.socket.on('peer-update', ({ peerId, isMuted, isDeafened }) => {
            console.log(`[App] Peer update received for ${peerId}: Muted=${isMuted}, Deafened=${isDeafened}`);
            uiManager.updatePeerState(peerId, { isMuted, isDeafened });
        });

        // Handle Remote Soundpad Events
        socketManager.socket.on('play-sound', ({ soundPath, isCustom }) => {
            // Respect deafen state
            if (!sfuManager.isDeafenedGlobal) {
                console.log(`[App] Playing remote sound: ${soundPath}`);
                soundEffects.playLocalSound(soundPath, isCustom);
            }
        });


    } catch (err) {
        console.error("[App] Connection Error:", err);
    }

    // --- BUTTON EVENT LISTENERS ---

    // Toggle Mic
    btnToggleMic.addEventListener('click', () => {
        const isMuted = sfuManager.toggleMic();

        // Update local UI state
        const isDeafened = btnToggleSound.classList.contains('btn-closed');

        // Send to server about our new state
        socketManager.socket.emit('peer-update', { isMuted, isDeafened });

        // Update button style
        if (isMuted) {
            btnToggleMic.classList.add('btn-closed');
            btnToggleMic.innerHTML = '🎤✖';
        } else {
            btnToggleMic.classList.remove('btn-closed');
            btnToggleMic.innerHTML = '🎤';
        }

        // Update local card immediately
        uiManager.updatePeerState('me', { isMuted, isDeafened });
    });

    // Toggle Sound (Deafen)
    btnToggleSound.addEventListener('click', () => {
        const isDeafened = sfuManager.toggleDeafen();

        let isMuted = btnToggleMic.classList.contains('btn-closed');

        if (isDeafened) {
            // Force Mute Mic when Deafening
            sfuManager.setMicMute(true);
            isMuted = true;

            // Update Mic Button UI to reflect mute
            btnToggleMic.classList.add('btn-closed');
            btnToggleMic.innerHTML = '🎤✖';
        }

        socketManager.socket.emit('peer-update', { isMuted, isDeafened });

        if (isDeafened) {
            btnToggleSound.classList.add('btn-closed');
            btnToggleSound.innerHTML = '🔇';
        } else {
            btnToggleSound.classList.remove('btn-closed');
            btnToggleSound.innerHTML = '🔊';
        }

        uiManager.updatePeerState('me', { isMuted, isDeafened });
    });


    btnConnect.addEventListener('click', async () => {
        const roomId = document.getElementById('roomSelect').value;
        const displayName = document.getElementById('username').value || `User-${Math.floor(Math.random() * 1000)}`;

        try {
            // Disable button to prevent double-clicks
            btnConnect.disabled = true;
            btnConnect.innerText = "Bağlanıyor...";

            uiManager.clearAll();
            peerNames.clear();

            // 1. Join room and get data
            const { rtpCapabilities, existingProducers, messages } = await socketManager.joinRoom(roomId, displayName, myProfilePic);

            // Enable Chat Inputs
            document.getElementById('msgInput').disabled = false;
            document.getElementById('btnSend').disabled = false;

            // Render History
            if (messages && Array.isArray(messages)) {
                messages.forEach(msg => {
                    renderMessage(msg);
                });
            }

            // Save username for next time
            localStorage.setItem('natla_username', displayName);

            // Render Self
            uiManager.addPeer('me', displayName, true, myProfilePic);

            // 2. Load Mediasoup Device
            await sfuManager.createDevice(rtpCapabilities);

            // 3. Create the inbound highway (Recv Transport)
            await sfuManager.createRecvTransport();

            // 4. Start producing your own audio
            await sfuManager.startProducing();

            // Setup initial state
            myName = displayName;
            currentRoom = roomId;

            // Process existing peers
            currentRoom = roomId;

            updateRoomStatus();

            // 5. Consume EXISTING people who are already in the room
            (existingProducers || []).forEach(p => {
                const { producerId, socketId, displayName, isMuted, isDeafened, profilePic } = p;
                const peerName = displayName || `User-${socketId.substr(0, 4)}`;

                // If we already have this name under a DIFFERENT socket ID, it's likely a stale ghost.
                for (const [existingSocketId, existingName] of peerNames.entries()) {
                    if (existingName === peerName && existingSocketId !== socketId) {
                        console.warn(`[App] Detected Ghost User by name collision (${peerName}). Removing OLD socket: ${existingSocketId}`);
                        peerNames.delete(existingSocketId);
                        uiManager.removePeer(existingSocketId);
                        audioAnalyzer.stop(existingSocketId);
                    }
                }

                peerNames.set(socketId, peerName);

                console.log('[App] Consuming existing producer:', producerId, 'from socket:', socketId);

                sfuManager.consume(producerId, socketId);

                // Create UI card indexed by socketId to match peer-update events
                uiManager.addPeer(socketId, peerName, false, profilePic);

                // Apply the initial mute/deafen state received from the server
                uiManager.updatePeerState(socketId, { isMuted, isDeafened });
            });

            updateRoomStatus();

            // 6. Listen for FUTURE people who join the room later
            socketManager.socket.on('new-producer', async ({ producerId, socketId, displayName, profilePic }) => {
                console.log('[App] New producer joined:', producerId, 'socket:', socketId);
                const name = displayName || `User-${socketId.substr(0, 4)}`;

                // GHOST USER FIX: Name Collision Check
                for (const [existingSocketId, existingName] of peerNames.entries()) {
                    if (existingName === name && existingSocketId !== socketId) {
                        console.warn(`[App] Detected Ghost User by name collision (${name}). Removing OLD socket: ${existingSocketId}`);
                        peerNames.delete(existingSocketId);
                        uiManager.removePeer(existingSocketId);
                        audioAnalyzer.stop(existingSocketId);
                    }
                }

                // Update local state and notifications
                peerNames.set(socketId, name);
                updateRoomStatus();
                showNotification(`${name} Odaya Katıldı`, "#2ecc71", 2000);

                // Add the user card IMMEDIATELY (using socketId as key)
                uiManager.addPeer(socketId, name, false, profilePic);

                // Establish media connection
                try {
                    await sfuManager.consume(producerId, socketId);
                } catch (err) {
                    console.error("[App] Consume failed:", err);
                    showNotification("Ses bağlantısı başarısız", "#e74c3c");
                }
            });

            socketManager.socket.on('producer-closed', ({ producerId, socketId, displayName }) => {
                console.log('[App] Producer closed:', producerId);

                const idToRemove = socketId || producerId;

                const name = displayName || peerNames.get(idToRemove) || "Birisi";

                // Clean up map
                peerNames.delete(idToRemove);

                updateRoomStatus();
                showNotification(`${name} Odadan Ayrıldı`, "#e74c3c", 2000);

                uiManager.removePeer(idToRemove);
                audioAnalyzer.stop(idToRemove);

                // Cleanup Audio Element
                const audioEl = document.getElementById(`remote-audio-${producerId}`);
                if (audioEl) audioEl.remove();
            });

            // UI: Switch to active controls
            btnConnect.style.display = 'none';
            activeControls.style.display = 'flex';
        } catch (err) {
            console.error("Critical Failure:", err);
            statusDisplay.innerText = `Hata: ${err.message || err}`;
            btnConnect.disabled = false;
            btnConnect.innerText = "Katıl";

            // Auto-recovery for Auth issues
            if (err.message && (err.message.includes('Unauthorized') || err.message.includes('Auth failed'))) {
                console.warn('[App] Authentication failed. Clearing session and reloading...');
                localStorage.removeItem('natla_session');
                setTimeout(() => window.location.reload(), 2000);
            }
        }
    });



    // Disconnect
    btnDisconnect.addEventListener('click', () => {
        window.location.reload();
    });

    // --- CHAT LOGIC ---
    const msgInput = document.getElementById('msgInput');
    const btnSend = document.getElementById('btnSend');
    const btnAttach = document.getElementById('btnAttach');
    const fileInput = document.getElementById('fileInput');
    const chatHistory = document.getElementById('chatHistory');

    // UI Helper: Scroll to bottom
    const scrollToBottom = () => {
        chatHistory.scrollTop = chatHistory.scrollHeight;
    };

    // --- MESSAGE SELECTION & DELETION ---
    const selectedMessageIds = new Set();
    const btnDeleteSelected = document.getElementById('btnDeleteSelected');
    const selectedCountSpan = document.getElementById('selectedCount');

    const updateDeleteButton = () => {
        const count = selectedMessageIds.size;
        selectedCountSpan.innerText = count;
        if (count > 0) {
            btnDeleteSelected.classList.add('visible');
        } else {
            btnDeleteSelected.classList.remove('visible');
        }
    };

    const toggleMessageSelection = (msgDiv, messageId) => {
        if (selectedMessageIds.has(messageId)) {
            selectedMessageIds.delete(messageId);
            msgDiv.classList.remove('selected');
        } else {
            selectedMessageIds.add(messageId);
            msgDiv.classList.add('selected');
        }
        updateDeleteButton();
    };

    // Handle Delete Action
    btnDeleteSelected.addEventListener('click', async () => {
        if (selectedMessageIds.size === 0) return;

        if (!confirm(`${selectedMessageIds.size} mesajı silmek istediğinize emin misiniz? (Sadece sizden silinir)`)) {
            return;
        }

        const idsToDelete = Array.from(selectedMessageIds);

        // Optimistic UI Update: Remove immediately
        idsToDelete.forEach(id => {
            const msgDiv = document.querySelector(`.message[data-id="${id}"]`);
            if (msgDiv) msgDiv.remove();
        });

        // Send to server
        // We do this individually for now as the API is single-item, 
        // but we could batch it if we updated the server. 
        // For 30 days TTL per user hidden messages, batched is better but loop is fine for now.
        for (const messageId of idsToDelete) {
            socketManager.socket.emit('deleteMessageForMe', { messageId }, (response) => {
                if (response.error) console.error('Delete error for', messageId, response.error);
            });
        }

        selectedMessageIds.clear();
        updateDeleteButton();
    });

    // UI Helper: Render Message
    const renderMessage = (data) => {
        const { _id, senderId, senderName, type, content, createdAt } = data; // Ensure _id is destructive from data
        const isMe = senderId === authService.getUserId();

        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isMe ? 'sent' : 'received'}`;
        msgDiv.dataset.id = _id; // Store ID for selection

        // Right-Click Selection
        msgDiv.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            toggleMessageSelection(msgDiv, _id);
        });

        // Allow Left-Click to toggle ONLY if selection mode is active (at least one selected)
        msgDiv.addEventListener('click', (e) => {
            if (selectedMessageIds.size > 0) {
                // Prevent default actions like opening images if selecting
                // e.preventDefault(); // Maybe not, depends on UX. Let's strictly use contextmenu for now or allow mixed.
                // Let's go with: if selection mode is active, click toggles.
                if (!e.target.closest('a') && !e.target.closest('img')) { // distinct check to allow opening links
                    toggleMessageSelection(msgDiv, _id);
                }
            }
        });

        const time = new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const nameDisplay = isMe ? 'Ben' : senderName || 'Anonim';

        let bodyHtml = '';
        if (type === 'text') {
            bodyHtml = `<div class="text">${content.text}</div>`;
        } else if (type === 'file') {
            const { fileName, size, fileId, mimeType } = content.file;
            const sizeStr = chatService.formatFileSize(size);
            const url = chatService.getFileUrl(fileId);

            // Image Preview
            if (mimeType.startsWith('image/')) {
                bodyHtml = `
                    <div class="file-attachment">
                        <img src="${url}" alt="${fileName}" style="max-width: 200px; border-radius: 8px; cursor: pointer;" onclick="window.open('${url}', '_blank')">
                        <div class="file-info">
                            <span>📷 ${fileName} (${sizeStr})</span>
                        </div>
                    </div>`;
            } else {
                // Generic File
                bodyHtml = `
                    <div class="file-attachment">
                        <a href="${url}" target="_blank" class="file-link">
                            📁 ${fileName} <small>(${sizeStr})</small>
                        </a>
                    </div>`;
            }
        }

        msgDiv.innerHTML = `
            <div class="msg-header">
                <span class="sender">${nameDisplay}</span>
                <span class="time">${time}</span>
            </div>
            ${bodyHtml}
        `;

        chatHistory.appendChild(msgDiv);
        scrollToBottom();
    };

    // Chat: Listen for incoming
    socketManager.onChatMessage((data) => {
        renderMessage(data);
    });

    // --- SLASH COMMANDS ---
    const handleCommand = (text) => {
        const cmd = text.trim().toLowerCase();

        if (cmd === '/help') {
            const helpMsg = `
                <div style="background: rgba(0,0,0,0.5); padding: 10px; border-radius: 8px; border: 1px solid #444;">
                    <strong>🛠️ Natla Komutları</strong>
                    <ul style="margin: 5px 0; padding-left: 20px;">
                        <li><strong>/help</strong>: Bu yardım ekranını gösterir.</li>
                        <li><strong>/clear</strong>: O anki oda sohbet geçmişini sizin için temizler.</li>
                    </ul>
                    <hr style="border:0; border-top:1px solid #555; margin: 8px 0;">
                    <strong>🗑️ Mesaj Silme:</strong>
                    <br>
                    Mesajlara <strong>Sağ Tıklayarak</strong> seçebilir ve sağ altta çıkan butona basarak silebilirsiniz.
                </div>
            `;
            // Render local system message
            const msgDiv = document.createElement('div');
            msgDiv.className = 'message received system-msg';
            msgDiv.style.background = 'transparent';
            msgDiv.innerHTML = helpMsg;
            chatHistory.appendChild(msgDiv);
            scrollToBottom();
            return true;
        }

        if (cmd === '/clear') {
            if (confirm('Bu odadaki tüm mesaj geçmişini kendin için silmek istediğine emin misin?')) {
                // Backend Call
                socketManager.socket.emit('deleteRoomHistoryForMe', { roomId: currentRoom }, (response) => {
                    if (response.success) {
                        chatHistory.innerHTML = ''; // Clear DOM
                        const infoDiv = document.createElement('div');
                        infoDiv.className = 'message received system-msg';
                        infoDiv.innerText = '🗑️ Sohbet geçmişi temizlendi.';
                        chatHistory.appendChild(infoDiv);
                    } else {
                        alert('Silme işlemi başarısız oldu.');
                    }
                });
            }
            return true;
        }

        return false; // Not a command
    };

    // Event: Click Send
    btnSend.addEventListener('click', () => {
        const text = msgInput.value;
        if (text.trim()) {
            if (!handleCommand(text)) {
                chatService.sendText(currentRoom, text);
            }
            msgInput.value = '';
        }
    });

    // Event: Enter Key
    msgInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btnSend.click();
    });

    // Event: Attach File
    btnAttach.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Visual feedback
        btnAttach.innerText = "⏳";
        btnAttach.disabled = true;

        await chatService.uploadAndSend(currentRoom, file);

        btnAttach.innerText = "📁";
        btnAttach.disabled = false;
        fileInput.value = null;
    });

}

startApp();