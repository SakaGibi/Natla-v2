import { authService } from "./authService.js";
import { socketManager } from "./socket.js";

const API_URL = 'http://localhost:3030';

export const chatService = {

    /**
     * Send a text message
     */
    sendText(roomId, text) {
        if (!text.trim()) return;
        socketManager.sendMessage(roomId, text, 'text');
    },

    /**
     * Upload a file and send it as a message
     */
    async uploadAndSend(roomId, file) {
        const token = authService.getToken();
        if (!token) return;

        const formData = new FormData();
        formData.append('file', file);
        formData.append('fileName', file.name);

        try {
            const res = await fetch(`${API_URL}/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            if (!res.ok) {
                if (res.status === 429) throw new Error("Slow down! You are uploading too fast.");
                throw new Error("Upload failed");
            }

            const fileData = await res.json(); // { fileId, fileName, mimeType, size }

            // Send to socket
            socketManager.sendMessage(roomId, '', 'file', fileData);

        } catch (error) {
            console.error('[Chat] Upload error:', error);
            alert(error.message);
        }
    },

    /**
     * Get a secure download URL for a file
     */
    getFileUrl(fileId) {
        const token = authService.getToken();
        return `${API_URL}/download/${fileId}?token=${token}`;
    },

    /**
     * Format bytes to human readable string
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
};
