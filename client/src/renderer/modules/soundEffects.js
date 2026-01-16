/**
 * soundEffects.js
 * Soundpad & Effect Management
 */
import { socketManager } from './socket.js';
import { sfuManager } from './sfu.js';

// Default sounds
const defaultSounds = [
    { file: 'Fahh_Effect', title: 'Fahh Efekti', short: 'fahh' },
    { file: 'ahhhhhhh_effect', title: 'Ahhhhhhh Efekti', short: 'aaah' },
    { file: 'besili_camis_effect', title: 'besili camış', short: 'besili camış' },
    { file: 'denyo_dangalak_effect', title: 'denyo mu dangalak mı?', short: 'denyo' },
    { file: 'deplasman_yasağı_effect', title: 'deplasman yarağı', short: 'dep. yasak' },
    { file: 'levo_rage_effect', title: 'harika bir oyun', short: 'işte bu' },
    { file: 'masaj_salonu_effect', title: 'mecidiyeköy masaj salonu', short: 'masaj salonu' },
    { file: 'neden_ben_effect', title: 'Neden dede neden beni seçtin', short: 'neden dede' },
    { file: 'samsun_anlık_effect', title: 'adalet mahallesinde gaza', short: 'Samsun Anlık' },
    { file: 'simdi_hoca_effect', title: 'şimdi hocam, position is obvious', short: 'Şimdi Hoca' },
    { file: 'soru_yanlısmıs_effect', title: 'Yauv sen yanlış yapmadın, soru yanlışmış yauv', short: 'Soru Yanlışmış Yauv' },
    { file: 'çok_zor_ya_effect', title: 'çok zor ya', short: 'çok zor ya' },
    { file: 'sus_artık_effect', title: 'yeter be sus artık', short: 'sus artık' },
    { file: 'buz_bira_effect', title: 'buz gibi bira var mı?', short: 'buz bira' },
    { file: 'osu_effect', title: 'yankılı osuruk', short: 'osuruk' },
    { file: 'aglama_oyna_effect', title: 'ağlama hade oyna', short: 'ağlama oyna' }
];


// Current mappings: index -> { path: string, name: string, isCustom: boolean }
let soundMap = {};
let pendingFileScan = null; // Temp storage for selected file

// DOM Elements to act upon (assigned during init)
let elements = {};

// Helper to get asset path
function getSoundUrl(filename, isCustom) {
    if (isCustom) {
        // Handle absolute paths for Electron (normalize slashes)
        if (filename && (filename.includes('/') || filename.includes('\\'))) {
            return `file://${filename.replace(/\\/g, '/')}`;
        }
        return filename;
    }

    // For default assets, use Vite's dynamic URL import
    return new URL(`../../assets/${filename}.mp3`, import.meta.url).href;
}


export const soundEffects = {
    init() {
        this.cacheDom();
        this.loadSoundMap();
        this.renderButtons();
        this.setupFileInput();
        this.setupModalListeners();
    },

    cacheDom() {
        elements = {
            soundpadBtns: document.querySelectorAll('.soundpad-btn'),
            soundpadModal: document.getElementById('soundpadModal'),
            soundpadNameInput: document.getElementById('soundpadNameInput'),
            selectedFileName: document.getElementById('selectedFileName'),
            btnSelectSoundFile: document.getElementById('btnSelectSoundFile'),
            btnSoundpadSave: document.getElementById('btnSoundpadSave'),
            btnSoundpadCancel: document.getElementById('btnSoundpadCancel'),
            btnResetSoundpad: document.getElementById('btnResetSoundpad')
        };
    },

    loadSoundMap() {
        try {
            const saved = localStorage.getItem('soundMap');
            if (saved) {
                soundMap = JSON.parse(saved);
            } else {
                // Populate defaults on first run if empty
                defaultSounds.forEach((s, i) => {
                    soundMap[i] = {
                        path: s.file,
                        name: s.short,
                        title: s.title,
                        isCustom: false
                    };
                });
            }
        } catch (e) {
            console.error("SoundMap load error:", e);
        }
    },

    saveSoundMap() {
        localStorage.setItem('soundMap', JSON.stringify(soundMap));
    },

    renderButtons() {
        const buttons = document.querySelectorAll('.soundpad-btn'); // Re-query in case

        buttons.forEach((btn, index) => {
            const data = soundMap[index];

            // Reset state
            btn.onclick = null;
            btn.oncontextmenu = null;

            if (data) {
                btn.innerText = data.name;
                btn.title = data.title || data.name;
                btn.style.backgroundColor = data.isCustom ? '#4834d4' : '';

                // Left Click: PLAY
                btn.onclick = () => {
                    // Check connection state from socketManager
                    if (!socketManager.socket || !socketManager.socket.connected) {
                        console.warn("Not connected to server.");
                        return;
                    }

                    // Check if we are actually in a room via SFU Manager
                    if (!sfuManager.isConnected) {
                        alert("Ses çalmak için bir odaya bağlı olmalısınız!");
                        return;
                    }

                    // Check deafened state from sfuManager
                    if (sfuManager.isDeafenedGlobal) {
                        console.warn("Cannot play sound while deafened.");
                        return;
                    }

                    this.playLocalSound(data.path, data.isCustom);

                    // Emit to server
                    socketManager.emitPlaySound(data.path, data.isCustom);

                    // Visual feedback
                    btn.style.opacity = '0.5';
                    setTimeout(() => btn.style.opacity = '1', 200);
                };
            } else {
                btn.innerText = "+";
                btn.title = "Sağ tıkla ekle";
                btn.style.backgroundColor = '#2c3e50';
                btn.onclick = () => {
                    alert("Bu butona ses eklemek için SAĞ TIKLAYIN.");
                };
            }

            // Right Click: CONTEXT MENU (Assign Sound or Rename)
            btn.oncontextmenu = (e) => {
                e.preventDefault();
                this.openEditModal(index);
            };
        });
    },

    playLocalSound(path, isCustom) {
        try {
            const src = getSoundUrl(path, isCustom);
            console.log("Playing sound:", src);
            const audio = new Audio(src);
            audio.volume = 0.5; // Default volume, maybe make configurable later
            audio.play().catch(e => console.error("Audio play error:", e));
        } catch (err) {
            console.error("Error playing sound:", err);
        }
    },

    setupFileInput() {
        let input = document.getElementById('soundpadInput');
        if (!input) {
            input = document.createElement('input');
            input.type = 'file';
            input.id = 'soundpadInput';
            input.accept = 'audio/*';
            input.style.display = 'none';
            document.body.appendChild(input);
        }

        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                // Update UI to show selected file
                if (elements.selectedFileName) {
                    elements.selectedFileName.innerText = file.name;
                    elements.selectedFileName.style.color = "#2ecc71";
                }

                // Store file data
                pendingFileScan = {
                    path: file.path || file.name, // Prefer full path (Electron)
                    name: file.name.split('.')[0].substring(0, 10),
                    title: file.name,
                    fileObj: file // Keep reference
                };

                if (elements.soundpadNameInput && elements.soundpadNameInput.value.trim() === "") {
                    elements.soundpadNameInput.value = pendingFileScan.name;
                }
            }
            input.value = '';
        };
    },

    triggerFileSelect() {
        const input = document.getElementById('soundpadInput');
        if (input) input.click();
    },

    openEditModal(index) {
        if (!elements.soundpadModal) return;

        pendingFileScan = null;
        const data = soundMap[index];
        const currentName = (data && data.name) ? data.name : "";
        const currentTitle = (data && data.title) ? data.title : "Mevcut dosya korunacak";

        elements.soundpadNameInput.value = currentName;
        if (elements.selectedFileName) {
            elements.selectedFileName.innerText = (data && data.path) ? (data.title || "Mevcut Ses") : "Henüz dosya seçilmedi";
            elements.selectedFileName.style.color = "#888";
        }

        elements.soundpadModal.style.display = 'flex';
        elements.soundpadNameInput.focus();

        // Bind Save for this specific index
        elements.btnSoundpadSave.onclick = () => {
            const newName = elements.soundpadNameInput.value.trim();

            if (pendingFileScan) {
                soundMap[index] = {
                    path: pendingFileScan.path,
                    name: newName || pendingFileScan.name,
                    title: pendingFileScan.title,
                    isCustom: true
                };
            } else if (soundMap[index] && newName !== "") {
                soundMap[index].name = newName;
            }

            this.saveSoundMap();
            this.renderButtons();
            this.closeEditModal();
        };
    },

    closeEditModal() {
        if (elements.soundpadModal) {
            elements.soundpadModal.style.display = 'none';
            elements.soundpadNameInput.value = '';
        }
        pendingFileScan = null;
    },

    setupModalListeners() {
        if (elements.btnSelectSoundFile) {
            elements.btnSelectSoundFile.onclick = () => {
                this.triggerFileSelect();
            };
        }

        if (elements.btnSoundpadCancel) {
            elements.btnSoundpadCancel.onclick = () => {
                this.closeEditModal();
            };
        }

        if (elements.soundpadNameInput) {
            elements.soundpadNameInput.onkeypress = (e) => {
                if (e.key === 'Enter') elements.btnSoundpadSave.click();
            };
        }

        if (elements.btnResetSoundpad) {
            elements.btnResetSoundpad.onclick = () => {
                if (confirm("Soundpad'i varsayılan ayarlara sıfırlamak istediğinize emin misiniz?")) {
                    localStorage.removeItem('soundMap');
                    this.loadSoundMap();
                    this.renderButtons();
                }
            };
        }
    }
};
