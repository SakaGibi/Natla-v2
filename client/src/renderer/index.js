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
            
            // 1. Establish Socket Connection
            await socketManager.connect(serverUrl);
            
            // 2. Join Room & Get server capabilities
            const rtpCapabilities = await socketManager.joinRoom(roomId);
            
            // 3. Initialize Mediasoup Device
            // This is where sfu.js comes into play
            await sfuManager.createDevice(rtpCapabilities);
            
            statusDisplay.innerText = `${roomId} odasına bağlanıldı ve cihaz hazır!`;
            console.log("[App] Handshake complete. Device is ready.");

        } catch (err) {
            console.error("Connection failed:", err);
            statusDisplay.innerText = `Hata: ${err.message || err}`;
        }
    });
}

startApp();