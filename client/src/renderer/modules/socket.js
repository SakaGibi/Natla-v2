/**
 * socket.js
 * Responsible for all Socket.io communication with the SFU server.
 */

import { io } from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";

class SocketManager {
    constructor() {
        this.socket = null;
    }

    /**
     * Connect to the SFU Server
     * @param {string} url - The server URL (e.g., http://localhost:3030)
     */
    connect(url) {
        return new Promise((resolve, reject) => {
            this.socket = io(url, {
                transports: ['websocket'] 
            });

            this.socket.on("connect", () => {
                console.log(`[Socket] Connected to server with ID: ${this.socket.id}`);
                resolve(this.socket);
            });

            this.socket.on("connect_error", (error) => {
                console.error("[Socket] Connection error:", error);
                reject(error);
            });
        });
    }

    /**
     * Request to join a specific room
     * @param {string} roomId - The room name (room1, room2, etc.)
     * @returns {Promise} - Returns server's RTP Capabilities
     */
    joinRoom(roomId) {
        return new Promise((resolve, reject) => {
            this.socket.emit('joinRoom', { roomId }, (response) => {
                if (response.error) {
                    reject(response.error);
                } else {
                    console.log(`[Socket] Joined room ${roomId}. RTP Capabilities received.`);
                    resolve(response.rtpCapabilities);
                }
            });
        });
    }

    /**
     * Request the server to create a WebRTC Transport
     * @param {boolean} sender - True if for producing, false for consuming
     */
    createWebRtcTransport(sender = true) {
        return new Promise((resolve, reject) => {
            this.socket.emit('createWebRtcTransport', { sender }, (params) => {
                if (params.error) {
                    reject(params.error);
                } else {
                    console.log(`[Socket] ${sender ? 'Send' : 'Receive'} Transport params received.`);
                    resolve(params);
                }
            });
        });
    }

    
    // Send local DTLS parameters to server to link transports
    async connectTransport(transportId, dtlsParameters) {
        this.socket.emit('connectWebRtcTransport', { transportId, dtlsParameters });
    }

    // Inform server that we are producing media
    produce(transportId, kind, rtpParameters) {
        return new Promise((resolve, reject) => {
            this.socket.emit('produce', { transportId, kind, rtpParameters }, (response) => {
                if (response.error) {
                    reject(response.error);
                } else {
                    resolve(response.id);
                }
            });
        });
    }
}

export const socketManager = new SocketManager();