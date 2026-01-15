/**
 * audioAnalyzer.js
 * Analyzes audio volumes from MediaStreams and reports them via callbacks.
 */

class AudioAnalyzer {
    constructor() {
        this.audioContext = null;
        this.analyzers = new Map(); // peerId -> { source, analyser, active: boolean }
    }

    /**
     * Initialize AudioContext on demand
     */
    init() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    /**
     * Starts analyzing a stream for a specific peer
     * @param {string} peerId 
     * @param {MediaStream} stream 
     * @param {Function} onLevel - Callback receiving volume level (0-100)
     */
    analyze(peerId, stream, onLevel) {
        this.init();

        // Cleanup existing for this peer
        this.stop(peerId);

        try {
            const source = this.audioContext.createMediaStreamSource(stream);
            const analyser = this.audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.5;

            source.connect(analyser);

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            const analyzerEntry = { source, analyser, active: true };
            this.analyzers.set(peerId, analyzerEntry);

            const updateLoop = () => {
                if (!analyzerEntry.active) return;

                analyser.getByteFrequencyData(dataArray);

                let sum = 0;
                for (let i = 0; i < bufferLength; i++) {
                    sum += dataArray[i];
                }
                const average = sum / bufferLength;

                // Adjust sensitivity: speech is usually in the 0-128 range of dataArray
                const level = Math.min(100, Math.round((average / 40) * 100));

                onLevel(level);

                requestAnimationFrame(updateLoop);
            };

            updateLoop();
        } catch (err) {
            console.error(`[AudioAnalyzer] Failed to start analysis for ${peerId}:`, err);
        }
    }

    /**
     * Stops analyzing a specific peer
     * @param {string} peerId 
     */
    stop(peerId) {
        const entry = this.analyzers.get(peerId);
        if (entry) {
            entry.active = false;
            try {
                entry.source.disconnect();
            } catch (e) {
                // ignore
            }
            this.analyzers.delete(peerId);
        }
    }

    stopAll() {
        for (const peerId of this.analyzers.keys()) {
            this.stop(peerId);
        }
    }
}

export const audioAnalyzer = new AudioAnalyzer();
