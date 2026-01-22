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

const HiddenMessageSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    messageId: { type: String, required: true },
    hiddenAt: { type: Date, default: Date.now, expires: 30 * 24 * 60 * 60 } // 30 days TTL
});
HiddenMessageSchema.index({ userId: 1, messageId: 1 }, { unique: true });

// Models
const Session = mongoose.model('Session', SessionSchema);
const Message = mongoose.model('Message', MessageSchema);
const HiddenMessage = mongoose.model('HiddenMessage', HiddenMessageSchema);

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

/**
 * Hide a message for a specific user
 * @param {string} userId 
 * @param {string} messageId 
 */
async function hideMessage(userId, messageId) {
    try {
        await HiddenMessage.create({
            userId,
            messageId,
            hiddenAt: new Date()
        });
        return true;
    } catch (err) {
        if (err.code === 11000) return true; // Already hidden
        console.error('Error hiding message:', err);
        return false;
    }
}

/**
 * Get set of hidden message IDs for a user from a list of potential message IDs
 * @param {string} userId 
 * @param {Array<string>} messageIds 
 * @returns {Promise<Set<string>>}
 */
async function getHiddenMessageIds(userId, messageIds) {
    if (!messageIds || messageIds.length === 0) return new Set();

    const hidden = await HiddenMessage.find({
        userId,
        messageId: { $in: messageIds }
    });

    return new Set(hidden.map(h => h.messageId));
}

/**
 * Hide ALL messages in a room for a specific user
 * @param {string} userId 
 * @param {string} roomId 
 */
async function hideAllMessages(userId, roomId) {
    try {
        const messages = await Message.find({ roomId }, { _id: 1 });
        if (messages.length === 0) return true;

        const hiddenDocs = messages.map(m => ({
            userId,
            messageId: m._id.toString(),
            hiddenAt: new Date()
        }));

        // Efficient Bulk Write (Ordered: false to ignore duplicates)
        await HiddenMessage.insertMany(hiddenDocs, { ordered: false });
        return true;
    } catch (err) {
        // Ignore duplicate key errors (code 11000)
        if (err.code !== 11000 && (!err.writeErrors || err.writeErrors.some(e => e.code !== 11000))) {
            console.error('Error hiding all messages:', err);
            return false;
        }
        return true;
    }
}

module.exports = {
    connectDB,
    createSession,
    validateSession,
    saveMessage,
    getMessages,
    hideMessage,
    getHiddenMessageIds,
    hideAllMessages
};
