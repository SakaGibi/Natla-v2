const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const config = require('../config');
const sfuManager = require('./sfuManager');
const socketManager = require('./socketManager');
const database = require('./database');
const rateLimit = require('./rateLimit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Configure Multer for File Uploads
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Use fileId generated in req by auth middleware or random UUID
        // We will rename it to just the UUID (no extension) to be safe
        const fileId = req.fileId || crypto.randomUUID();
        cb(null, fileId);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB
});

/**
 * Main Server Class
 * Coordinates Express, Socket.io, Mediasoup SFU, and Database.
 */
async function runServer() {
    const app = express();
    const server = http.createServer(app);

    // Connect to MongoDB
    await database.connectDB(process.env.MONGO_URI);

    // Middleware
    app.use(express.json());

    // Initialize Socket.io with CORS enabled
    const io = new socketio.Server(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    });

    // --- API ENDPOINTS ---

    // 1. Session Creation (Anonymous Auth)
    app.post('/auth/session', async (req, res) => {
        const ip = req.ip;

        // DEV MODE: Higher limits for local testing
        const isDev = process.env.NODE_ENV === 'development';
        const limit = isDev ? 100 : 3; // 100 per hour for Dev, 3 for Prod

        if (!rateLimit.checkLimit(`sess:${ip}`, limit, 60 * 60 * 1000)) {
            return res.status(429).json({ error: 'Too many session requests. Try again later.' });
        }

        try {
            const session = await database.createSession(ip);
            res.json(session); // { userId, token, expiresAt }
        } catch (err) {
            console.error('Session creation failed:', err);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // 2. File Upload (Secure)
    app.post('/upload', async (req, res, next) => {
        // Custom Auth Middleware for Upload
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const token = authHeader.split(' ')[1];
        const userId = await database.validateSession(token);

        if (!userId) {
            return res.status(403).json({ error: 'Invalid Session' });
        }

        // Rate Limit
        const isDev = process.env.NODE_ENV === 'development';
        const uploadLimit = isDev ? 50 : 2; // 50 per 10m for Dev, 2 for Prod

        if (!rateLimit.checkLimit(`upload:${userId}`, uploadLimit, 10 * 60 * 1000)) {
            return res.status(429).json({ error: 'Rate limit exceeded' });
        }

        // Generate ID early to use in filename
        req.fileId = crypto.randomUUID();
        req.userId = userId;
        next();
    }, upload.single('file'), async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const fileData = {
            fileId: req.file.filename, // This is the UUID
            fileName: req.body.fileName || req.file.originalname,
            mimeType: req.file.mimetype,
            size: req.file.size
        };

        // Note: We don't save the message here directly. The client sends the message via Socket.io
        // and includes this metadata. Or we could save it here.
        // Better: Return the metadata to client, client sends chat message with it.
        // This keeps WebSocket as the single source of truth for chat history.

        res.json(fileData);
    });

    // 3. Secure File Download
    app.get('/download/:fileId', async (req, res) => {
        const { fileId } = req.params;
        const { token } = req.query; // Support ?token=... for <img> tags

        // Also check headers if token not in query
        const authToken = token || (req.headers.authorization?.split(' ')[1]);

        const userId = await database.validateSession(authToken);
        if (!userId) {
            return res.status(401).send('Unauthorized');
        }

        // Check file existence on disk
        const filePath = path.join(uploadDir, fileId);
        if (!fs.existsSync(filePath)) {
            return res.status(404).send('File not found on disk');
        }

        // Optional: Check DB to see if it's expired (Double check)
        // Since we cleanup disk based on time, disk check is usually enough.
        // But checking DB ensures we don't serve "deleted" files that haven't been swept yet.
        // For performance, we can skip DB check if we trust the cleanup job + FS.
        // Let's trust FS + Cleanup job for now to keep it fast.

        res.download(filePath, fileId); // TODO: Set original filename from DB if needed?
        // To set original filename, we'd need to query DB.
        // Let's do a quick DB lookup for the filename content-disposition
        /*
        const msg = await database.Message.findOne({ 'content.file.fileId': fileId });
        if(msg) {
             res.download(filePath, msg.content.file.fileName);
        } else {
             res.download(filePath);
        }
        */
    });


    // --- SERVER STARTUP ---

    try {
        console.log('Starting SFU Manager...');
        await sfuManager.initMediasoupWorkers();
        console.log('[SFU] Mediasoup Workers started successfully.');

        io.on('connection', socket => {
            console.log(`[Socket] New client connected: ${socket.id}`);
            socketManager.handleConnection(socket, io);
        });

        const { listenIP, listenPort } = config.https;
        server.listen(listenPort, listenIP, () => {
            console.log(`[Server] Listening on http://${listenIP}:${listenPort}`);
        });

    } catch (error) {
        console.error('[Critical Error] Failed to start server:', error);
        process.exit(1);
    }
}

// --- CLEANUP JOB ---
const ONE_HOUR = 60 * 60 * 1000;
const FILE_RETENTION = 24 * 60 * 60 * 1000; // 24 Hours

setInterval(() => {
    console.log('[Cleanup] Running file cleanup...');
    fs.readdir(uploadDir, (err, files) => {
        if (err) return console.error('Cleanup read error:', err);

        const now = Date.now();
        files.forEach(file => {
            const filePath = path.join(uploadDir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                if (now - stats.mtimeMs > FILE_RETENTION) {
                    fs.unlink(filePath, err => {
                        if (err) console.error(`Failed to delete ${file}:`, err);
                        else console.log(`[Cleanup] Deleted expired file: ${file}`);
                    });
                }
            });
        });
    });
}, ONE_HOUR);

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Unhandled Rejection] at:', promise, 'reason:', reason);
});

const crypto = require('crypto'); // Late import for usage
runServer();