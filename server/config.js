const os = require('os');
require('dotenv').config();

/** 
 * Global Configuration for Natla SFU Server
 * Includes WebRTC port ranges and IP configurations for aws deployment
 */
module.exports = {
    // basic server settings
    domain: process.env.DOMAIN || 'localhost',
    https: {
        listenIP: '0.0.0.0',
        listenPort: process.env.HTTPS_PORT || 3030,
    },

    // mediasoup SFU settings
    mediasoup: {
        //number of workers to create
        // for my use case (aws t3.small) 2 worker is enough
        numWorkers: 2,

        // worker settings
        worker: {
            logLevel: 'warn',
            logTags: [
                'info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp',
            ],
            rtcMinPort: Number(process.env.RTC_MIN_PORT),
            rtcMaxPort: Number(process.env.RTC_MAX_PORT),
        },

        // router (Room) settings
        router: {
            mediaCodecs: [
                {
                    kind: 'audio',
                    mimeType: 'audio/opus',
                    clockRate: 48000,
                    channels: 2,
                }
            ],
        },

        // WebRTC transport settings
        webRtcTransport: {
            listenIps: [
                /**
                 * OPTION 1: LOCAL DEVELOPMENT
                 * Standard setup for running on your own machine.
                 */
                {
                    ip: '0.0.0.0',
                    announcedIp: process.env.ANNOUNCED_IP || '127.0.0.1',
                },

                /**
                 * OPTION 2: LIVE PRODUCTION (Uncomment when deploying)
                 * 'ip' must be the Private IP of your instance.
                 * 'announcedIp' must be the Public (Elastic) IP of your instance.
                 */
                /*
                {
                    ip: 'your instance private IP', // Internal Private IP
                    announcedIp: '3.X.X.X', // External Public IP
                }
                */
            ],
            initialAvailableOutgoingBitrate: 1000000,
        },
    },
};