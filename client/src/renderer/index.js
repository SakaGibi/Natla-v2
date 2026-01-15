/**
 * index.js 
 * Coordination point for UI and SFU logic.
 */
import { socketManager } from './modules/socket.js';
import { sfuManager } from './modules/sfu.js';
import { uiManager } from './modules/ui.js';

const btnConnect = document.getElementById('btnConnect');
const statusDisplay = document.getElementById('roomPreview');

async function startApp() {
    console.log("Natla Client Initializing...");

    btnConnect.addEventListener('click', async () => {
        const roomId = document.getElementById('roomSelect').value;
        const displayName = document.getElementById('username').value || `User-${Math.floor(Math.random() * 1000)}`;
        const serverUrl = import.meta.env.VITE_SERVER_URL || "http://localhost:3030";

        try {
            // Disable button to prevent double-clicks
            btnConnect.disabled = true;
            btnConnect.innerText = "Bağlanıyor...";

            uiManager.clearAll(); // Clean up previous session UI
            statusDisplay.innerText = "Connecting...";
            await socketManager.connect(serverUrl);

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

            // 5. Consume EXISTING people
            (existingProducers || []).forEach(p => {
                // Determine if p is just an ID or an object {producerId, displayName}
                // Server update sends object now
                const producerId = p.producerId || p;
                const peerName = p.displayName || `User-${producerId.substr(0, 4)}`;

                console.log('[App] Consuming existing producer:', producerId);
                sfuManager.consume(producerId);
                uiManager.addPeer(producerId, peerName);
            });

            // 6. Listen for FUTURE people
            socketManager.socket.on('new-producer', async ({ producerId, displayName }) => {
                console.log('[App] New producer joined:', producerId);
                await sfuManager.consume(producerId);
                uiManager.addPeer(producerId, displayName || `User-${producerId.substr(0, 4)}`);
            });

            statusDisplay.innerText = `${roomId} odasında yayındasın!`;
        } catch (err) {
            console.error("Critical Failure:", err);
            statusDisplay.innerText = `Hata: ${err.message || err}`;
        }
    });
}

startApp();