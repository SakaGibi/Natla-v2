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
const peerNames = new Map(); // producerId -> displayName
let myName = "";
let currentRoom = "";
const serverUrl = import.meta.env.VITE_SERVER_URL || "http://localhost:3030";

function updateRoomStatusOnly(roomName, userList) {
    console.log('[UI] updateRoomStatusOnly called:', roomName, userList);
    const count = userList.length;
    const namesStr = userList.join(', ');

    // "Genel: 3 Kişi (Ahmet, Mehmet...)"
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

    // "Genel: 3 Kişi (Ahmet, Mehmet...)"
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

async function startApp() {
    console.log("Natla Client Initializing...");

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

    } catch (err) {
        console.error("[App] Connection Error:", err);
    }

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
            const { rtpCapabilities, existingProducers } = await socketManager.joinRoom(roomId, displayName);

            // Render Self
            uiManager.addPeer('me', displayName, true);

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

            // "Welcome" - Green
            showNotification("Odaya Bağlanılıyor!", "#2ecc71", 1000);
            updateRoomStatus();

            // 5. Consume EXISTING people
            (existingProducers || []).forEach(p => {
                // Determine if p is just an ID or an object {producerId, displayName}
                // Server update sends object now
                const producerId = p.producerId || p;
                const peerName = p.displayName || `User-${producerId.substr(0, 4)}`;

                // NO double add to map here, already done above for status

                console.log('[App] Consuming existing producer:', producerId);
                sfuManager.consume(producerId);
                uiManager.addPeer(producerId, peerName);
            });

            // 6. Listen for FUTURE people
            socketManager.socket.on('new-producer', async ({ producerId, displayName }) => {
                console.log('[App] New producer joined:', producerId);
                const name = displayName || `User-${producerId.substr(0, 4)}`;

                peerNames.set(producerId, name);
                updateRoomStatus();
                showNotification(`${name} girdi`, "#2ecc71", 2000); // Green

                await sfuManager.consume(producerId);
                uiManager.addPeer(producerId, name);
            });

            socketManager.socket.on('producer-closed', ({ producerId, displayName }) => {
                console.log('[App] Producer closed:', producerId);

                const name = displayName || peerNames.get(producerId) || "Birisi";

                peerNames.delete(producerId);
                updateRoomStatus();
                showNotification(`${name} çıktı`, "#e74c3c", 2000); // Red

                uiManager.removePeer(producerId);
                audioAnalyzer.stop(producerId);
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

    // Toggle Mic
    btnToggleMic.addEventListener('click', () => {
        const isClosed = btnToggleMic.classList.toggle('btn-closed');
        btnToggleMic.innerText = isClosed ? '🎤✖' : '🎤';
        // TODO: Actually mute the producer track
    });

    // Toggle Sound (Deafen)
    btnToggleSound.addEventListener('click', () => {
        const isClosed = btnToggleSound.classList.toggle('btn-closed');
        btnToggleSound.innerText = isClosed ? '🔇' : '🔊';
        // TODO: Actually mute all remote audio tags
    });

    // Disconnect
    btnDisconnect.addEventListener('click', () => {
        window.location.reload();
    });
}

startApp();