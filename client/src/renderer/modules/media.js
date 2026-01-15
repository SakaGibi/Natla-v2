/**
 * media.js
 * Responsible for enumerating hardware devices (mics/speakers).
 */

export class MediaManager {
    /**
     * Populate the device selection dropdowns
     * @param {HTMLSelectElement} micSelectElement 
     */
    async getDevices(micSelectElement) {
        try {
            // 1. trigger a dummy request for permissions
            // this allows us to get device labels later
            await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(device => device.kind === 'audioinput');

            // clear existing options
            micSelectElement.innerHTML = '';

            audioInputs.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `Microphone ${micSelectElement.length + 1}`;
                micSelectElement.appendChild(option);
            });

            console.log('[Media] Microphones enumerated successfully.');
        } catch (error) {
            console.error('[Media] Failed to enumerate microphones:', error);
            throw error;
        }
    }
}

export const mediaManager = new MediaManager();