const mediasoup = require('mediasoup');
const config = require('../config');
const e = require('express');

/**
 * sfu.manager.js
 * Responsible for managing Mediasoup Workers, Routers (Rooms), and Transports.
 */

let workers = [];
let nextWorkerIndex = 0;

// Store for rooms: { roomId: { router: mediasoupRouter, peers: [id1, id2] } }
const rooms = new Map();

/**
 * Initialize Mediasoup Workers
 */
async function initMediasoupWorkers() {
    const { numWorkers } = config.mediasoup;

    for (let i = 0; i < numWorkers; i++) {
        const worker = await mediasoup.createWorker({
            logLevel: config.mediasoup.worker.logLevel,
            logTags: config.mediasoup.worker.logTags,
            rtcMinPort: config.mediasoup.worker.rtcMinPort,
            rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
        });

        worker.on('died', () => {
            console.error(`Mediasoup Worker died, exiting in 2 seconds... [pid:${worker.pid}]`);
            setTimeout(() => process.exit(1), 2000);
        });

        workers.push(worker);
    }
}

/**
 * Get or Create a Room (Router)
 * Each room in your app maps to one Mediasoup Router.
 */
async function getOrCreateRoom(roomId) {
    if (rooms.has(roomId)) {
        return rooms.get(roomId).router;
    }

    // pick the next worker in round-robin fashion
    const worker = workers[nextWorkerIndex];
    nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;

    const router = await worker.createRouter({
        mediaCodecs: config.mediasoup.router.mediaCodecs,
    });

    rooms.set(roomId, { router, peers: [] });
    console.log(`Created new room with ID: ${roomId} on worker PID: ${worker.pid}`);
    return router;
}

/**
 * Create a WebRTC Transport for a Peer
 * This is the 'pipe' through which audio travels.
 */
async function createWebRtcTransport(router) {
    const transport = await router.createWebRtcTransport(config.mediasoup.webRtcTransport);

    // If you're on a restricted network (like AWS), these events help debug connection issues.
    // If you're on a restricted network (like AWS), these events help debug connection issues.
    transport.on('dtlsstatechange', (dtlsState) => {
        console.log(`[SFU] Transport ${transport.id} DTLS state: ${dtlsState}`);
        if (dtlsState === 'closed') transport.close();
    });

    transport.on('icestatechange', (iceState) => {
        console.log(`[SFU] Transport ${transport.id} ICE state: ${iceState}`);
    });

    return {
        params: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
        },
        transport
    };
}

/**
 * Create a Consumer to receive media from a specific Producer
 * @param {Object} router - The room's router
 * @param {Object} transport - The receiver's transport
 * @param {string} producerId - The ID of the media source
 * @param {Object} rtpCapabilities - The receiver's device capabilities
 */
async function createConsumer(router, transport, producerId, rtpCapabilities) {
    // check if the router can consume this producer based on client's device capabilities
    if (!router.canConsume({ producerId, rtpCapabilities })) {
        console.warn('[SFU] Cannot consume: Invalid capabilities');
        return;
    }

    const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true, // best practice: start paused and resume after client is ready
    });

    return {
        params: {
            id: consumer.id,
            producerId: producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
        },
        consumer
    };
}

module.exports = {
    initMediasoupWorkers,
    getOrCreateRoom,
    createWebRtcTransport,
    createConsumer,
    rooms
};