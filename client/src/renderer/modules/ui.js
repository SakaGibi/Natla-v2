class UIManager {
    constructor() {
        this.userList = document.getElementById('userList');
    }

    /**
     * Creates and appends a user card to the UI
     * @param {string} peerId - Unique ID of the peer
     * @param {string} displayName - Name to display
     * @param {boolean} isSelf - Is this the local user?
     */
    addPeer(peerId, displayName, isSelf = false) {
        if (document.getElementById(`user-card-${peerId}`)) return;

        const card = document.createElement('div');
        card.className = 'user-card';
        card.id = `user-card-${peerId}`;
        card.innerHTML = `
            <div class="avatar-wrapper">
                <img src="assets/default-avatar.png" class="user-avatar-list" alt="Avatar">
            </div>
            <div class="user-details">
                <div class="user-header">
                    <span style="font-weight: bold; font-size: 14px;">${displayName} ${isSelf ? '(Ben)' : ''}</span>
                    <div class="status-indicators">
                        <span style="font-size: 14px; margin-right: 5px;">${isSelf ? '🎤' : '🔊'}</span>
                        <span class="user-status">Canlı</span>
                    </div>
                </div>

                <!-- Volume Slider (Only for Remote Users) -->
                ${!isSelf ? `
                <div class="user-volume-row">
                    <input type="range" class="peer-volume-slider" min="0" max="100" value="100" oninput="this.style.setProperty('--val', this.value + '%')">
                    <span class="vol-label">100%</span>
                </div>
                ` : ''}

                <!-- Audio Visualizer (Common for all) -->
                 <div class="user-volume-row" style="margin-top: auto;">
                    <div class="meter-bg">
                        <div class="meter-fill" id="volume-meter-${peerId}" style="width: 0%;"></div>
                    </div>
                </div>
            </div>
        `;

        if (isSelf) {
            this.userList.prepend(card);
        } else {
            this.userList.appendChild(card);
        }
    }

    /**
     * Clears all user cards from the list
     */
    clearAll() {
        this.userList.innerHTML = '';
    }

    /**
     * Remove a peer from the UI
     * @param {string} peerId 
     */
    removePeer(peerId) {
        const card = document.getElementById(`user-card-${peerId}`);
        if (card) card.remove();
    }

    /**
     * Update the audio volume meter visually
     * @param {string} peerId 
     * @param {number} level - 0 to 100
     */
    updateAudioLevel(peerId, level) {
        const meter = document.getElementById(`volume-meter-${peerId}`);
        if (meter) {
            meter.style.width = `${level}%`;
        }
    }
}

export const uiManager = new UIManager();
