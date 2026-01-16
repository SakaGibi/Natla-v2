/**
 * sfu.js
 * Manages the Mediasoup Device and local WebRTC Transports.
 */

import { Device } from 'mediasoup-client';
import { socketManager } from './socket.js';
import { uiManager } from './ui.js';
import { audioAnalyzer } from './audioAnalyzer.js';

class SFUManager {
    constructor() {
        this.device = null;
        this.sendTransport = null;
        this.recvTransport = null;
        this.localStream = null;
        this.isDeafenedGlobal = false;
    }

    get isConnected() {
        return !!(this.device && this.device.loaded);
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

            // Start local audio analysis for the meter
            audioAnalyzer.analyze('me', this.localStream, (level) => {
                uiManager.updateAudioLevel('me', level);
            });

            console.log('[SFU] Started producing track:', this.producer.id);
            return this.producer;

        } catch (error) {
            console.error('[SFU] Failed to start producing:', error);
            throw error;
        }
    }

    /**
    * Creates a transport for receiving media (Consuming).
    */
    async createRecvTransport() {
        try {
            // 1. Request receive transport parameters from server (sender: false)
            const params = await socketManager.createWebRtcTransport(false);

            // 2. Create local receive transport
            this.recvTransport = this.device.createRecvTransport(params);

            // 3. Handle 'connect' event for DTLS handshake
            this.recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                try {
                    console.log('[SFU] RecvTransport sending DTLS parameters to server...');
                    await socketManager.connectTransport(this.recvTransport.id, dtlsParameters);
                    callback();
                } catch (error) {
                    errback(error);
                }
            });

            this.recvTransport.on('connectionstatechange', (state) => {
                console.log(`[SFU] RecvTransport connection state changed: ${state}`);
            });

            console.log('[SFU] Receive Transport created successfully.');
        } catch (error) {
            console.error('[SFU] Failed to create receive transport:', error);
        }
    }

    /**
     * Consumes a specific producer from the server.
     * @param {string} producerId - The ID of the media source.
     * @param {string} socketId - The owner's socket ID (for UI mapping).
     */
    async consume(producerId, socketId) {
        try {
            // 1. Request consumer parameters from the server
            const params = await socketManager.consume(this.recvTransport.id, producerId, this.device.rtpCapabilities);

            // 2. Create local consumer via the receive transport
            const consumer = await this.recvTransport.consume(params);

            // 3. Notify server to resume the consumer (consumers start paused by default)
            await socketManager.consumerResume(consumer.id);

            // 4. Get the media track from the consumer
            const { track } = consumer;

            // 5. ATTACH TO DOM: Create an audio element to play the sound
            const stream = new MediaStream([track]);

            let remoteAudio = document.getElementById(`remote-audio-${producerId}`);
            if (!remoteAudio) {
                remoteAudio = document.createElement('audio');
                remoteAudio.id = `remote-audio-${producerId}`;
                const container = document.getElementById('audioContainer');
                if (container) {
                    container.appendChild(remoteAudio);
                } else {
                    // console.error('[SFU] audioContainer not found! Appending to body fallback.');
                    document.body.appendChild(remoteAudio);
                }
            }

            remoteAudio.srcObject = stream;
            remoteAudio.controls = false;
            remoteAudio.style.display = 'none';

            // Respect global deafen state
            remoteAudio.muted = this.isDeafenedGlobal;

            // 6. PLAY: Handle browser autoplay restrictions
            // Wait for metadata to ensure we are ready to play
            remoteAudio.onloadedmetadata = async () => {
                try {
                    await remoteAudio.play();
                    console.log(`[SFU] Audio started for producer: ${producerId}`);

                    // Start audio analysis for the remote peer's meter using SOCKET ID
                    if (socketId) {
                        audioAnalyzer.analyze(socketId, stream, (level) => {
                            uiManager.updateAudioLevel(socketId, level);
                        });
                    }

                } catch (error) {
                    console.warn('[SFU] Autoplay prevented:', error);
                    // Create a manual play button
                    const btn = document.createElement('button');
                    btn.innerText = `🔊 Oynat (${producerId})`;
                    btn.style.display = 'block';
                    btn.style.marginTop = '5px';
                    btn.onclick = () => {
                        remoteAudio.play();
                        btn.remove();
                    };
                    remoteAudio.parentNode.insertBefore(btn, remoteAudio.nextSibling);
                }
            };
        } catch (error) {
            console.error('[SFU] Consume failed:', error);
        }
    }

    /**
     * Toggles the local microphone audio track.
     * @returns {boolean} isMuted - The new state.
     */
    toggleMic() {
        if (this.producer && this.producer.track) {
            this.producer.track.enabled = !this.producer.track.enabled;
            const isMuted = !this.producer.track.enabled;
            console.log(`[SFU] Microphone is now ${isMuted ? 'Muted' : 'Active'}`);
            return isMuted;
        }
        console.warn('[SFU] toggleMic called but no producer found.');
        return false;
    }

    /**
     * Explicitly sets the microphone mute state.
     * @param {boolean} shouldMute 
     */
    setMicMute(shouldMute) {
        if (this.producer && this.producer.track) {
            this.producer.track.enabled = !shouldMute;
            console.log(`[SFU] Microphone set to ${shouldMute ? 'Muted' : 'Active'}`);
            return shouldMute;
        }
        return false;
    }

    /**
     * Toggles all remote audio (Deafen).
     * @returns {boolean} isDeafened - The new state.
     */
    toggleDeafen() {
        // Toggle global state first
        this.isDeafenedGlobal = !this.isDeafenedGlobal;

        const audioElements = document.querySelectorAll('audio[id^="remote-audio-"]');

        // Apply to all existing elements
        audioElements.forEach(el => {
            el.muted = this.isDeafenedGlobal;
        });

        console.log(`[SFU] Deafen is now ${this.isDeafenedGlobal ? 'Active (Muted)' : 'Disabled (Sound On)'}`);
        return this.isDeafenedGlobal;
    }
}
export const sfuManager = new SFUManager();