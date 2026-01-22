/**
 * settings.js
 * Handles the visual logic for the Settings Modal.
 */

class SettingsManager {
    constructor() {
        this.modal = document.getElementById('settingsModal');
        this.btnOpen = document.getElementById('btnSettings');
        this.btnClose = document.getElementById('btnCloseSettings');

        this.init();
    }

    init() {
        if (!this.modal || !this.btnOpen || !this.btnClose) {
            console.error('[Settings] Missing DOM elements for settings modal.');
            return;
        }

        // Open Modal
        this.btnOpen.addEventListener('click', () => {
            this.open();
        });

        // Close Modal (Button)
        this.btnClose.addEventListener('click', () => {
            this.close();
        });

        // Close Modal (Overlay Click)
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.close();
            }
        });

        // UI Sliders Text Update (Visual Only)
        this.bindSliderText('micVolume', 'micVolumeVal');
        this.bindSliderText('masterVolume', 'masterVolumeVal');
    }

    bindSliderText(sliderId, textId) {
        const slider = document.getElementById(sliderId);
        const text = document.getElementById(textId);
        if (slider && text) {
            slider.addEventListener('input', (e) => {
                text.innerText = `${e.target.value}%`;
            });
        }
    }

    open() {
        this.modal.classList.add('active');
    }

    close() {
        this.modal.classList.remove('active');
    }
}

export const settingsManager = new SettingsManager();
