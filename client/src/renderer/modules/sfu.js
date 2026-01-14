/**
 * sfu.js
 * Manages the Mediasoup Device and local WebRTC Transports.
 */

import { Device } from 'mediasoup-client';

class SFUManager {
    constructor() {
        this.device = null;
        this.sendTransport = null;
        this.recvTransport = null;
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
}

export const sfuManager = new SFUManager();