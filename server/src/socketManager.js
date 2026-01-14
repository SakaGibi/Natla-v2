const sfuManager = require('./sfuManager');

/**
 * socketManager.js
 * Manages signaling events between clients and the SFU.
 */

// Local state to track which peer is in which room and their transports/producers
// Structure: { socketId: { roomId, transports: [], producers: [], consumers: [] } }
const peers = new Map();

function handleConnection(socket, io) {

    // step-1 : join a room
    // client requests to join a specific room (e.g. 'room1', 'room2', etc.)
    socket.on('joinRoom', async ({ roomId }, callback) => {
        try {
            // get or create a mediasoup Router for this room
            const router = await sfuManager.getOrCreateRouter(roomId);

            // initialize peer state
            peers.set(socket.id, {
                roomId,
                transports: [],
                producers: [],
                consumers: []
            });

            // SFU requires the client to know the server's RTP capabilities
            // (what codecs we support) before anything else
            callback({ rtpCapabilities: router.rtpCapabilities });

            console.log(`[Socket] User ${socket.id} joined room: ${roomId}`);
        } catch (error) {
            console.error(`[Socket] joinRoom error: ${error}`);
            callback({ error: error.message });
        }
    });

    // step-2 : create WebRTC transport
    // the client needs a transport to either SEND (produce) or RECEIVE (consume) media
    socket.on('createWebRtcTransport', async ({ sender }, callback) => {
        try {
            const peer = peers.get(socket.id);
            const router = (await sfuManager.rooms.get(peer.roomId)).router;

            // Create the transport on the server side
            const { params, transport } = await sfuManager.createWebRtcTransport(router);

            // Store transport locally to manage it later (connect/close)
            peer.transports.set(transport.id, transport);

            // Send transport parameters back to the client
            callback(params);
        } catch (error) {
            console.error('Create Transport Error:', error);
            callback({ error: error.message });
        }
    });
    
    // step-3 : connect Transport
    // client side creates its own transport and sends DLTS parameters to link with server
    socket.on('connectTransport', async ({ transpoırtId, dtlsParameters } ) => {
        const peer = peers.get(socket.id);
        const transport = peer.transports.get(transpoırtId);

        if (transport) {
            await transport.connect({ dtlsParameters });
            console.log(`[SFU] Transport ${transportId} connected for ${socket.id}`);
        }
    });

    // step-4 : produce media
    // client requests to start sending media
    socket.on('produce', async ({ transportId, kind, rtpParameters }, callback) => {
        try {
            const peer = peers.get(socket.id);
            const transport = peer.transports.get(transportId);

            // create a producer on the server
            const producer = await transport.procude({ kind, rtpParameters });
            peer.producers.set(producer.id, producer);

            // inform the client of the new producer's id
            callback({ id: producer.id });

            // IMPORTANT: Notify everyone else in the room that a new producer exists

            console.log(`[SFU] User ${socket.id} is now PRODUCING ${kind}`);
        } catch (error) {
            console.error('Produce Error:', error);
            callback({ error: error.message });
        }
    });

    // handle disconnection
    // clean up all mediasoup objects when a user leaves
    socket.on('disconnect', () => {
        const peer = peers.get(socket.id);
        if (peer) {
            console.log(`[Socket] User ${socket.id} disconnected. Cleaning up SFU resources.`);
             
            // close all producers, consumers, and transports
            peer.producers.forEach(p => p.close());
            peer.transports.forEach(t => t.close());

            // remove peer from local state
            peers.delete(socket.id);
        }
    });
}

module.exports = { 
    handleConnection,
};