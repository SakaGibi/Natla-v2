/**
 * index.js 
 * Coordination point for UI and SFU logic.
 */
import { socketManager } from './modules/socket.js';
import { sfuManager } from './modules/sfu.js';
import { uiManager } from './modules/ui.js';
import { audioAnalyzer } from './modules/audioAnalyzer.js';

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

            uiManager.clearAll(); // Clean up previous session UI

            // Already connected, just join room now

            // 1. Join room and get data
            const { rtpCapabilities, existingProducers } = await socketManager.joinRoom(roomId, displayName, myProfilePic);

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
            (existingProducers || []).forEach(p => {
                const producerId = p.producerId || p;
                const peerName = p.displayName || `User-${producerId.substr(0, 4)}`;
                peerNames.set(producerId, peerName);
            });

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

                // Establish media connection
                await sfuManager.consume(producerId, socketId);

                // Add the user card using socketId for state synchronization
                uiManager.addPeer(socketId, name, false, profilePic);
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
        }
    });



    // Disconnect
    btnDisconnect.addEventListener('click', () => {
        window.location.reload();
    });
}

startApp();