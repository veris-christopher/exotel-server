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
            rws: await this.openRealtimeWebSocket(ws)
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
        const data = JSON.parse(message);
        const streamSid = data.stream_sid || this.CONSTANTS.DEFAULT_STREAM_SID;

        console.log("\n📨 Client Message");
        console.log("Event Type:", data.event);
        console.log("Stream SID:", streamSid);

        // Reset or start media timer
        if (state.mediaTimer) {
            clearTimeout(state.mediaTimer);
        }

        state.mediaTimer = setTimeout(async () => {
            console.log("\n⏰ Media Duration Elapsed");
            console.log("Processing accumulated audio...");
            await messageHandler.processAudioData(ws, state.rws, state.audioData);
            state.audioData = [];
            state.mediaTimer = null;
            console.log("✅ Audio Processing Complete");
        }, this.CONSTANTS.MEDIA_DURATION);

        switch (data.event) {
            case 'media':
                await this.handleMediaEvent(ws, state, data);
                break;

            case 'stop':
                console.log("🛑 Stop Event");
                if (state.mediaTimer) {
                    clearTimeout(state.mediaTimer);
                    state.mediaTimer = null;
                }
                break;

            case 'start':
                console.log("▶️ Start Event");
                break;

            case 'mark':
                console.log("📍 Mark Event");
                break;

            default:
                console.log("❓ Unknown Event:", data.event);
        }
    }

    async handleMediaEvent(ws, state, data) {
        console.log("\n🎵 Handling Media Event");
        const chunk = Buffer.from(data.media.payload, 'base64');
        console.log("Chunk Size:", chunk.length, "bytes");
        
        state.audioData.push(chunk);
        console.log("Total Chunks:", state.audioData.length);

        // Add delay between chunks
        await new Promise(resolve => setTimeout(resolve, this.CONSTANTS.CHUNK_DELAY));
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

        rws.on('open', () => console.log("✅ OpenAI WebSocket Connected"));
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
