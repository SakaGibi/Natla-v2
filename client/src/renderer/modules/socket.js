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
    joinRoom(roomId, displayName, profilePic) {
        return new Promise((resolve, reject) => {
            this.socket.emit('joinRoom', { roomId, displayName, profilePic }, (response) => {
                if (response.error) {
                    reject(response.error);
                } else {
                    console.log(`[Socket] Joined room ${roomId}. Data received.`);
                    resolve(response);
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
        this.socket.emit('connectTransport', { transportId, dtlsParameters });
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

    /**
     * Request the server to create a Consumer for a specific producer.
     * @param {string} transportId - The local receive transport ID.
     * @param {string} producerId - The ID of the producer to consume.
     * @param {Object} rtpCapabilities - Local device capabilities.
     */
    consume(transportId, producerId, rtpCapabilities) {
        return new Promise((resolve, reject) => {
            this.socket.emit('consume', { transportId, producerId, rtpCapabilities }, (response) => {
                if (response.error) {
                    reject(response.error);
                } else {
                    console.log(`[Socket] Consumer params received for producer: ${producerId}.`);
                    resolve(response);
                }
            });
        });
    }

    /**
     * Request the server to resume a paused consumer.
     * @param {string} consumerId - The ID of the consumer to resume.
     */
    async consumerResume(consumerId) {
        return new Promise((resolve, reject) => {
            this.socket.emit('consumerResume', { consumerId }, (response) => {
                if (response && response.error) {
                    reject(response.error);
                }
            });
        });
    }

    /**
     * Emit a sound event to the server to play for others in the room.
     * @param {string} soundPath - Filename or path of the sound
     * @param {boolean} isCustom - Whether it's a custom uploaded sound
     */
    emitPlaySound(soundPath, isCustom) {
        if (this.socket) {
            this.socket.emit('play-sound', { soundPath, isCustom });
        }
    }


}

export const socketManager = new SocketManager();