/**
 * authService.js
 * Handles anonymous session creation and persistence.
 */
const API_URL = 'http://localhost:3030';

export const authService = {
    session: null,

    async init() {
        // 1. Try to load from localStorage
        const stored = localStorage.getItem('natla_session');
        if (stored) {
            try {
                this.session = JSON.parse(stored);
                if (new Date(this.session.expiresAt) < new Date()) {
                    console.warn('[Auth] Session expired locally, getting new one.');
                    this.session = null;
                }
            } catch (e) {
                console.error('Corrupt session data', e);
                localStorage.removeItem('natla_session');
            }
        }

        // 2. If no valid session, create one
        if (!this.session) {
            await this.createSession();
        }

        return this.session;
    },

    async createSession() {
        try {
            // Double check if we already have a session in memory to avoid race conditions
            if (this.session && new Date(this.session.expiresAt) > new Date()) {
                return;
            }

            const res = await fetch(`${API_URL}/auth/session`, {
                method: 'POST'
            });

            if (res.status === 429) {
                console.error('[Auth] Rate Limit Exceeded: Too many session requests.');
                alert('Oturum açma sınırı aşıldı. Lütfen bir süre bekleyin.');
                throw new Error('Rate Limit Exceeded');
            }

            if (!res.ok) throw new Error('Session creation failed');

            const data = await res.json();
            this.session = data; // { userId, token, expiresAt }
            localStorage.setItem('natla_session', JSON.stringify(data));
            console.log('[Auth] New session created:', data.userId);
        } catch (error) {
            console.error('[Auth] Error:', error);
        }
    },

    getToken() {
        return this.session?.token;
    },

    getUserId() {
        return this.session?.userId;
    },

    logout() {
        localStorage.removeItem('natla_session');
        this.session = null;
        window.location.reload();
    }
};
