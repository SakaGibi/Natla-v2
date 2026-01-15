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
        const serverUrl = "http://localhost:3030";

        try {
            statusDisplay.innerText = "Bağlanılıyor...";
            
            // 1. server Connection
            await socketManager.connect(serverUrl);
            
            // 2. Join room and get RTP Capabilities
            const rtpCapabilities = await socketManager.joinRoom(roomId);
            
            // 3. load Mediasoup Device
            await sfuManager.createDevice(rtpCapabilities);
            
            // 4. Start producing
            await sfuManager.startProducing();

            statusDisplay.innerText = `${roomId} odasında yayındasın!`;
            console.log("[App] Handshake and Producing initiated successfully.");

        } catch (err) {
            console.error("Critical Failure:", err);
            statusDisplay.innerText = `Hata: ${err.message || err}`;
        }
    });
}

startApp();