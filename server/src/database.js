const mongoose = require('mongoose');
const crypto = require('crypto');

// Schemas
const SessionSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    token: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true }
});
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const MessageSchema = new mongoose.Schema({
    roomId: { type: String, required: true, index: true },
    senderId: { type: String, required: true },
    senderName: { type: String },
    type: { type: String, enum: ['text', 'file', 'system'], default: 'text' },
    content: {
        text: String,
        file: {
            fileId: String,
            fileName: String,
            mimeType: String,
            size: Number
        }
    },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true }
});
MessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Models
const Session = mongoose.model('Session', SessionSchema);
const Message = mongoose.model('Message', MessageSchema);

// Functions

/**
 * Connect to MongoDB
 */
async function connectDB(uri) {
    if (!uri) return;
    try {
        await mongoose.connect(uri);
        console.log("✅ Connected to MongoDB");
    } catch (err) {
        console.error("❌ MongoDB Connection Error:", err);
    }
}

/**
 * Create a new session for a user (Anonymous Auth)
 * @param {string} ip Client IP for rate limiting/analytics (optional)
 * @returns {Promise<Object>} Session object { userId, token, expiresAt }
 */
async function createSession(ip) {
    const userId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 Days

    const session = new Session({
        userId,
        token,
        expiresAt,
        lastSeenAt: new Date()
    });

    await session.save();
    return { userId, token, expiresAt };
}

/**
 * Validate and extend a session
 * @param {string} token Session token provided by client
 * @returns {Promise<string|null>} userId if valid, null if invalid/expired
 */
async function validateSession(token) {
    if (!token) return null;

    const session = await Session.findOne({ token });
    if (!session) return null;

    // Extend session expiry
    session.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // +7 Days
    session.lastSeenAt = new Date();
    await session.save();

    return session.userId;
}

/**
 * Save a message to the database
 * @param {Object} data Message data
 * @param {number} retentionHours How long to keep the message (default 24h for files, 30d for text)
 */
async function saveMessage(data, retentionHours = 24) {
    const expiresAt = new Date(Date.now() + retentionHours * 60 * 60 * 1000);

    const message = new Message({
        ...data,
        expiresAt
    });

    return await message.save();
}

/**
 * Get recent messages for a room
 * @param {string} roomId 
 * @param {number} limit 
 */
async function getMessages(roomId, limit = 50) {
    return await Message.find({ roomId })
        .sort({ createdAt: 1 })
        .limit(limit);
}

module.exports = {
    connectDB,
    createSession,
    validateSession,
    saveMessage,
    getMessages
};
