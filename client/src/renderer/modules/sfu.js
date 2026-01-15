/**
 * sfu.js
 * Manages the Mediasoup Device and local WebRTC Transports.
 */

import { Device } from 'mediasoup-client';
import { socketManager } from './socket.js';

class SFUManager {
    constructor() {
        this.device = null;
        this.sendTransport = null;
        this.recvTransport = null;
        this.localStream = null;
    }

    /**
     * Initializes the Mediasoup Device with server capabilities.
     * @param {Object} rtpCapabilities - The capabilities sent by the server.
     */
    async createDevice(rtpCapabilities) {
        try {
            // 1. Create a new Mediasoup Device
            this.device = new Device();

            // 2. Load the device with server-side RTP capabilities
            await this.device.load({ routerRtpCapabilities: rtpCapabilities });

            console.log('[SFU] Mediasoup Device loaded successfully.');
        } catch (error) {
            console.error('[SFU] Failed to load device:', error);
            throw error;
        }
    }

    // step2.1 : Create a Send Transport and Start Producing
    /**
     * Starts producing audio from a selected microphone.
     * @param {string} deviceId - The ID of the selected microphone.
     */
    async startProducing(deviceId) {
        try {
            // Stop existing tracks to prevent "Device in use" DOMException
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
            }

            // 1. Get microphone access with specific deviceId
            // We set video to false for now to avoid camera conflicts
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: deviceId ? { deviceId: { exact: deviceId } } : true,
                video: false 
            });
            
            const track = this.localStream.getAudioTracks()[0];

            // 2. Request send transport parameters from server
            const params = await socketManager.createWebRtcTransport(true);

            // 3. Create local send transport
            this.sendTransport = this.device.createSendTransport(params);

            // 4. Handle 'connect' event (DTLS Handshake)
            this.sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                try {
                    await socketManager.connectTransport(this.sendTransport.id, dtlsParameters);
                    callback();
                } catch (error) {
                    errback(error);
                }
            });
                
            // 5. Handle 'produce' event (Sending the actual track)
            this.sendTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
                try {
                    const id = await socketManager.produce(this.sendTransport.id, kind, rtpParameters);
                    callback({ id });
                } catch (error) {
                    errback(error);
                }
            });

            // 6. Start producing the track
            this.producer = await this.sendTransport.produce({ track });
            
            console.log('[SFU] Started producing track:', this.producer.id);
            return this.producer;

        } catch (error) {
            console.error('[SFU] Failed to start producing:', error);
            throw error;
        }
    }
}
export const sfuManager = new SFUManager();