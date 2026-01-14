const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const config = require('../config');
const sfuManager = require('./sfuManager');
const socketManager = require('./socketManager');

/**
 * Main Server Class
 * Coordinates Express, Socket.io and Mediasoup SFU.
 */
async function runServer(){
    const app = express();
    const server = http.createServer(app);

    // Initialize Socket.io with CORS enabled
    const io = new socketio.Server(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    });

    try {
        console.log('Starting SFU Manager...');

        // step-1 : Initialize mediasoup workers
        // this starts the C++ media processing engines
        await sfuManager.initMediasoupWorkers();
        console.log('[SFU] Mediasoup Workers started successfully.');

        // step-2 : Handle socket.io connections
        // every client connection will be managed by socketManager
        io.on('connection', socket => {
            console.log(`[Socket] New client connected: ${socket.id}`);
            socketManager.handleSocketConnection(socket, io);
        });

        // step-3 : Start the HTTP server
        const { listenIP, listenPort } = config.https;
        server.listen(listenPort, listenIP, () => {
            console.log(`[Server] Listening on http://${listenIP}:${listenPort}`);
            console.log(`[System] Ready for voice chat connections.`);
        });

    } catch (error) {
        console.error('[Critical Error] Failed to start server:', error);
        process.exit(1);
    }
}

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Unhandled Rejection] at:', promise, 'reason:', reason);
});

runServer();