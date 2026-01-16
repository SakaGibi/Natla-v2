const sfuManager = require('./sfuManager');

/**
 * socketManager.js
 * Manages signaling events between clients and the SFU.
 */

// Local state to track peers: { socketId: { roomId, displayName, transports, producers, consumers, ... } }
const peers = new Map();

function handleConnection(socket, io) {

    // step-0 : Get room stats for preview mode
    socket.on('getRoomStats', ({ roomId }, callback) => {
        try {
            const users = [];
            peers.forEach((peerData) => {
                if (peerData.roomId === roomId) {
                    users.push(peerData.displayName);
                }
            });
            callback({ users });
        } catch (error) {
            console.error(`[Socket] getRoomStats error:`, error);
            callback({ error: error.message });
        }
    });

    // step-1 : Join a room
    socket.on('joinRoom', async ({ roomId, displayName, profilePic }, callback) => {
        try {
            const router = await sfuManager.getOrCreateRoom(roomId);

            // Cleanup potential stale session for the same socket
            if (peers.has(socket.id)) {
                socket.leave(peers.get(socket.id).roomId);
            }

            peers.set(socket.id, {
                roomId,
                displayName: displayName || `User-${socket.id.substr(0, 4)}`,
                profilePic: profilePic || null,
                transports: new Map(),
                producers: new Map(),
                consumers: new Map(),
                isMuted: false,
                isDeafened: false
            });

            socket.join(roomId);

            // Collect existing producers to inform the new joiner
            const existingProducers = [];
            peers.forEach((peerData, peerSocketId) => {
                if (peerData.roomId === roomId && peerSocketId !== socket.id) {
                    peerData.producers.forEach((_, producerId) => {
                        existingProducers.push({
                            producerId,
                            socketId: peerSocketId,
                            displayName: peerData.displayName,
                            profilePic: peerData.profilePic,
                            isMuted: peerData.isMuted,
                            isDeafened: peerData.isDeafened
                        });
                    });
                }
            });

            callback({
                rtpCapabilities: router.rtpCapabilities,
                existingProducers
            });

            console.log(`[Socket] User ${socket.id} joined room: ${roomId}`);
            io.emit('room-update', { roomId });

        } catch (error) {
            console.error(`[Socket] joinRoom error: ${error}`);
            callback({ error: error.message });
        }
    });

    // step-2 : Create WebRTC transport
    socket.on('createWebRtcTransport', async ({ sender }, callback) => {
        try {
            const peer = peers.get(socket.id);
            const router = (await sfuManager.rooms.get(peer.roomId)).router;
            const { params, transport } = await sfuManager.createWebRtcTransport(router);

            peer.transports.set(transport.id, transport);
            callback(params);
        } catch (error) {
            console.error('Create Transport Error:', error);
            callback({ error: error.message });
        }
    });

    // step-3 : Connect Transport
    socket.on('connectTransport', async ({ transportId, dtlsParameters }) => {
        try {
            const peer = peers.get(socket.id);
            const transport = peer.transports.get(transportId);

            if (transport) {
                await transport.connect({ dtlsParameters });
            }
        } catch (error) {
            console.error(`[SFU] connectTransport Error:`, error);
        }
    });

    // step-4 : Produce media
    socket.on('produce', async ({ transportId, kind, rtpParameters }, callback) => {
        try {
            const peer = peers.get(socket.id);
            const transport = peer.transports.get(transportId);

            const producer = await transport.produce({ kind, rtpParameters });
            peer.producers.set(producer.id, producer);

            callback({ id: producer.id });

            // Notify others about the new producer and provide the Socket ID
            socket.to(peer.roomId).emit('new-producer', {
                producerId: producer.id,
                socketId: socket.id,
                displayName: peer.displayName,
                profilePic: peer.profilePic
            });
        } catch (error) {
            console.error('Produce Error:', error);
            callback({ error: error.message });
        }
    });

    // step-5 : Consume media
    socket.on('consume', async ({ transportId, producerId, rtpCapabilities }, callback) => {
        try {
            const peer = peers.get(socket.id);
            const { router } = sfuManager.rooms.get(peer.roomId);
            const transport = peer.transports.get(transportId);

            const { params, consumer } = await sfuManager.createConsumer(
                router,
                transport,
                producerId,
                rtpCapabilities
            );

            peer.consumers.set(consumer.id, consumer);
            consumer.on('transportclose', () => {
                consumer.close();
                peer.consumers.delete(consumer.id);
            });

            callback(params);
        } catch (error) {
            console.error('Consume Error:', error);
            callback({ error: error.message });
        }
    });

    // step-6 : Resume consumer
    socket.on('consumerResume', async ({ consumerId }, callback) => {
        const peer = peers.get(socket.id);
        const consumer = peer.consumers.get(consumerId);
        if (consumer) {
            await consumer.resume();
            if (callback) callback({});
        }
    });

    // step-7 : Peer State Update (Mute/Deafen)
    socket.on('peer-update', ({ isMuted, isDeafened }) => {
        const peer = peers.get(socket.id);
        if (peer) {
            peer.isMuted = isMuted;
            peer.isDeafened = isDeafened;
            socket.to(peer.roomId).emit('peer-update', {
                peerId: socket.id,
                isMuted,
                isDeafened
            });
        }
    });


    // step-8 : Play Sound (Soundpad)
    socket.on('play-sound', ({ soundPath, isCustom }) => {
        const peer = peers.get(socket.id);
        if (peer && peer.roomId) {
            // Broadcast to everyone else in the room
            socket.to(peer.roomId).emit('play-sound', {
                soundPath,
                isCustom,
                senderIds: socket.id // Optional: if we want to show who played it
            });
        }
    });


    // Handle disconnection and cleanup resources
    socket.on('disconnect', () => {
        const peer = peers.get(socket.id);
        if (peer) {
            console.log(`[Socket] User ${socket.id} disconnected.`);
            peer.producers.forEach((p, producerId) => {
                // Include socketId so clients can remove the correct UI card
                socket.to(peer.roomId).emit('producer-closed', {
                    producerId,
                    socketId: socket.id,
                    displayName: peer.displayName
                });
                p.close();
            });
            peer.transports.forEach(t => t.close());
            peers.delete(socket.id);
            io.emit('room-update', { roomId: peer.roomId });
        }
    });
}

module.exports = { handleConnection };