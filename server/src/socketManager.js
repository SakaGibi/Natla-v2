const sfuManager = require('./sfuManager');
const database = require('./database');
const rateLimit = require('./rateLimit');

/**
 * socketManager.js
 * Manages signaling events between clients and the SFU.
 */

// Local state to track peers: { socketId: { roomId, displayName, ... } }
const peers = new Map();

function handleConnection(socket, io) {

    // Check auth token
    const token = socket.handshake.auth.token;
    let userId = null;

    (async () => {
        if (!token) {
            console.log(`[Socket] Auth failed for ${socket.id}: No token`);
        }

        if (token) {
            userId = await database.validateSession(token);
            if (!userId) {
                console.log(`[Socket] Auth failed for ${socket.id}: Invalid token`);
                socket.disconnect();
                return;
            }
            // Store userId on socket
            socket.userId = userId;
            console.log(`[Socket] User Verified: ${userId} (${socket.id})`);
        }
    })();


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
            if (!socket.userId) {
                // Double check auth if they managed to stay connected
                return callback({ error: 'Unauthorized' });
            }

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
                isDeafened: false,
                userId: socket.userId // Bind session ID to peer
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

            // Fetch Message History
            let messages = await database.getMessages(roomId, 50);

            // Filter hidden messages
            if (socket.userId && messages.length > 0) {
                const messageIds = messages.map(m => m._id.toString());
                const hiddenIds = await database.getHiddenMessageIds(socket.userId, messageIds);
                if (hiddenIds.size > 0) {
                    messages = messages.filter(m => !hiddenIds.has(m._id.toString()));
                }
            }

            callback({
                rtpCapabilities: router.rtpCapabilities,
                existingProducers,
                messages: messages // Send history
            });

            console.log(`[Socket] User ${socket.id} (ID: ${socket.userId}) joined room: ${roomId}`);
            io.emit('room-update', { roomId });

        } catch (error) {
            console.error(`[Socket] joinRoom error: ${error}`);
            callback({ error: error.message });
        }
    });

    // --- NEW: CHAT MESSAGES ---
    socket.on('chat-message', async (data) => {
        const { roomId, message, type, fileData } = data;
        const peer = peers.get(socket.id);

        if (!peer || !socket.userId) return;

        // Rate Limit (10 messages per 5 seconds)
        if (!rateLimit.checkLimit(`msg:${socket.userId}`, 10, 5000)) {
            socket.emit('error', 'Rate limit exceeded. Please slow down.');
            return;
        }

        const msgData = {
            roomId,
            senderId: socket.userId,
            senderName: peer.displayName,
            type: type || 'text',
            content: {
                text: message,
                file: fileData // { fileId, fileName, mimeType, size }
            }
        };

        // Determine retention based on type
        const retention = (type === 'file') ? 24 : (24 * 30); // 24h for files, 30 days for text

        try {
            const savedMessage = await database.saveMessage(msgData, retention);

            // Broadcast to room
            io.to(roomId).emit('chat-message', savedMessage);

        } catch (err) {
            console.error('Save message error:', err);
        }
    });

    // --- NEW: DELETE MESSAGE FOR ME ---
    socket.on('deleteMessageForMe', async ({ messageId }, callback) => {
        try {
            if (!socket.userId) {
                return callback({ error: 'Unauthorized' });
            }
            const success = await database.hideMessage(socket.userId, messageId);
            callback({ success, messageId });
        } catch (error) {
            console.error('Delete Message Error:', error);
            callback({ error: error.message });
        }
    });

    // --- NEW: DELETE ALL MESSAGES FOR ME ---
    socket.on('deleteRoomHistoryForMe', async ({ roomId }, callback) => {
        try {
            if (!socket.userId) {
                return callback({ error: 'Unauthorized' });
            }
            const success = await database.hideAllMessages(socket.userId, roomId);
            callback({ success, roomId });
        } catch (error) {
            console.error('Delete All Error:', error);
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

            // Notify others
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
        console.log(`[Socket] Resuming consumer: ${consumerId}`);
        const peer = peers.get(socket.id);

        if (!peer) {
            console.warn(`[Socket] consumerResume fail: Peer not found for socket ${socket.id}`);
            if (callback) callback({ error: 'Peer not found' });
            return;
        }

        const consumer = peer.consumers.get(consumerId);
        if (consumer) {
            await consumer.resume();
            if (callback) callback({});
        } else {
            console.warn(`[Socket] consumerResume failed: Consumer ${consumerId} not found for peer ${socket.id}`);
            if (callback) callback({ error: 'Consumer not found' });
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
                senderIds: socket.id
            });
        }
    });


    // Handle disconnection
    socket.on('disconnect', () => {
        const peer = peers.get(socket.id);
        if (peer) {
            console.log(`[Socket] User ${socket.id} disconnected.`);
            peer.producers.forEach((p, producerId) => {
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