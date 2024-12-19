const WebSocket = require('ws');
const messageHandler = require('./messageHandler');

class ConnectionManager {
    constructor() {
        this.connections = new Set();
        this.CONSTANTS = {
            CHUNK_DELAY: 250,      // 250ms between processing chunks
            MEDIA_DURATION: 4000,  // 4 seconds to capture media
            DEFAULT_STREAM_SID: 'default-sid'
        };
        console.log("\n=== Connection Manager Initialized ===");
    }

    setupWebSocket(server) {
        console.log("\n🔌 Setting up WebSocket Server");
        const wss = new WebSocket.Server({ server });

        wss.on('connection', (ws) => this.handleNewConnection(ws));
        this.setupServerShutdown(wss);

        console.log("✅ WebSocket Server Ready");
        return wss;
    }

    async handleNewConnection(ws) {
        console.log("\n🔗 New Client Connection");
        this.connections.add(ws);
        console.log("Active Connections:", this.connections.size);

        const state = {
            audioData: [],
            mediaTimer: null,
            rws: await this.openRealtimeWebSocket(ws),
            hasReceivedFirstMedia: false
        };

        this.setupConnectionHandlers(ws, state);
        console.log("✅ Connection Handlers Setup");
    }

    setupConnectionHandlers(ws, state) {
        console.log("\n🎯 Setting up Connection Handlers");
        ws.on('message', (message) => this.handleClientMessage(ws, state, message));
        ws.on('close', () => this.cleanup(ws, state));
        ws.on('error', (error) => {
            console.error("❌ Client Connection Error:", error);
            this.cleanup(ws, state);
        });
    }

    async handleClientMessage(ws, state, message) {
        try {
            // console.log("\n=== Raw Message ===");
            // console.log(message.toString());

            const data = JSON.parse(message);
            const streamSid = data.stream_sid || this.CONSTANTS.DEFAULT_STREAM_SID;

            // console.log("\n📨 Client Message");
            // console.log("Event Type:", data.event);
            // console.log("Stream SID:", streamSid);
            // if (data.media) {
            //     console.log("Has Media Payload:", !!data.media.payload);
            //     console.log("Media Payload Length:", data.media.payload ? data.media.payload.length : 0);
            // }

            switch (data.event) {
                case 'media':
                    await this.handleMediaEvent(ws, state, data);
                    break;

                case 'stop':
                    console.log("🛑 Stop Event");
                    if (state.mediaTimer) {
                        console.log("Clearing media timer on stop");
                        clearTimeout(state.mediaTimer);
                        state.mediaTimer = null;
                    }
                    break;

                case 'start':
                    console.log("▶️ Start Event - Resetting state");
                    state.audioData = [];
                    if (state.mediaTimer) {
                        clearTimeout(state.mediaTimer);
                        state.mediaTimer = null;
                    }
                    break;

                case 'mark':
                    console.log("📍 Mark Event");
                    break;

                default:
                    console.log("❓ Unknown Event:", data.event);
            }
        } catch (error) {
            console.error("Error handling client message:", error);
            console.error("Raw message:", message.toString());
        }
    }

    static hasReceivedFirstMedia = false;

    async handleMediaEvent(ws, state, data) {
        try {
            // Only log the first media event globally
            if (!ConnectionManager.hasReceivedFirstMedia) {
                console.log("\n🎵 First Media Event Received - Audio streaming is working");
                ConnectionManager.hasReceivedFirstMedia = true;
            }
            
            if (!data.media || !data.media.payload) {
                console.warn("⚠️ Invalid media data received");
                return;
            }

            // Skip processing if this is an AI response
            if (data.media.source === 'ai') {
                console.log("🤖 Skipping AI response audio");
                return;
            }

            const chunk = Buffer.from(data.media.payload, 'base64');
            state.audioData.push(chunk);

            // Send chunks to VAD system immediately
            if (state.rws && state.rws.readyState === WebSocket.OPEN) {
                await messageHandler.processAudioData(ws, state.rws, [chunk]);
            }
        } catch (error) {
            console.error("❌ Error handling media event:", error);
            throw error;
        }
    }

    async openRealtimeWebSocket(ws) {
        console.log("\n🔄 Opening OpenAI WebSocket");
        const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";
        const rws = new WebSocket(url, {
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                "OpenAI-Beta": "realtime=v1"
            }
        });

        rws.on('open', () => {
            console.log("✅ OpenAI WebSocket Connected")
            
            rws.send(JSON.stringify({
                type: "session.update",
                session: {
                    turn_detection: {
                        threshold: 1
                    }
                }
            }));
    });
        rws.on('message', (message) => messageHandler.handleOpenAIMessage(ws, this.CONSTANTS.DEFAULT_STREAM_SID, message));
        rws.on('error', (error) => console.error("❌ OpenAI WebSocket Error:", error));
        rws.on('close', () => console.log("🔌 OpenAI WebSocket Closed"));

        return rws;
    }

    cleanup(ws, state) {
        console.log("\n🧹 Cleaning up Connection");
        if (state.mediaTimer) {
            clearTimeout(state.mediaTimer);
            console.log("Cleared media timer");
        }
        if (state.rws) {
            state.rws.close();
            console.log("Closed OpenAI WebSocket");
        }
        this.connections.delete(ws);
        console.log("Remaining Connections:", this.connections.size);
    }

    setupServerShutdown(wss) {
        process.on('SIGINT', () => {
            console.log("\n⚠️ Server Shutdown Initiated");
            console.log("Active Connections:", this.connections.size);

            for (let ws of this.connections) {
                ws.close();
            }
            this.connections.clear();
            wss.close();

            console.log("✅ Server Shutdown Complete");
            process.exit();
        });
    }
}

module.exports = new ConnectionManager();
