/**
 * index.js 
 * Coordination point for UI and SFU logic.
 */
import { socketManager } from './modules/socket.js';
import { sfuManager } from './modules/sfu.js';

const btnConnect = document.getElementById('btnConnect');
const statusDisplay = document.getElementById('roomPreview');

async function startApp() {
    console.log("Natla Client Initializing...");

    btnConnect.addEventListener('click', async () => {
        const roomId = document.getElementById('roomSelect').value;
        const serverUrl = import.meta.env.VITE_SERVER_URL || "http://localhost:3030";

        try {
            statusDisplay.innerText = "Connecting...";
            await socketManager.connect(serverUrl);

            // 1. Join room and get data
            const { rtpCapabilities, existingProducers } = await socketManager.joinRoom(roomId);

            // 2. Load Mediasoup Device
            await sfuManager.createDevice(rtpCapabilities);

            // 3. Create the inbound highway (Recv Transport)
            await sfuManager.createRecvTransport();

            // 4. Start producing your own audio
            await sfuManager.startProducing();

            // 5. Consume EXISTING people
            (existingProducers || []).forEach(producerId => {
                console.log('[App] Consuming existing producer:', producerId);
                sfuManager.consume(producerId);
            });

            // 6. Listen for FUTURE people
            socketManager.socket.on('new-producer', async ({ producerId }) => {
                console.log('[App] New producer joined:', producerId);
                await sfuManager.consume(producerId);
            });

            statusDisplay.innerText = `${roomId} odasında yayındasın!`;
        } catch (err) {
            console.error("Critical Failure:", err);
            statusDisplay.innerText = `Hata: ${err.message || err}`;
        }
    });
}

startApp();