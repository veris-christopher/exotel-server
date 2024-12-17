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
    }

    setupWebSocket(server) {
        console.log("Setting up WebSocket server");
        const wss = new WebSocket.Server({ server });

        wss.on('connection', (ws) => this.handleNewConnection(ws));
        this.setupServerShutdown(wss);

        return wss;
    }

    async handleNewConnection(ws) {
        console.log("New connection accepted");
        this.connections.add(ws);

        const state = {
            audioData: [],
            mediaTimer: null,
            rws: await this.openRealtimeWebSocket(ws)
        };

        this.setupConnectionHandlers(ws, state);
    }

    setupConnectionHandlers(ws, state) {
        ws.on('message', (message) => this.handleClientMessage(ws, state, message));
        ws.on('close', () => this.cleanup(ws, state));
        ws.on('error', (error) => {
            console.error("Client connection error:", error);
            this.cleanup(ws, state);
        });
    }

    async handleClientMessage(ws, state, message) {
        const data = JSON.parse(message);
        const streamSid = data.stream_sid || this.CONSTANTS.DEFAULT_STREAM_SID;

        switch (data.event) {
            case 'media':
                await this.handleMediaEvent(ws, state, data);
                break;

            case 'stop':
                if (state.mediaTimer) {
                    clearTimeout(state.mediaTimer);
                    state.mediaTimer = null;
                }
                break;

            case 'start':
            case 'mark':
                console.log(`${data.event} event received`);
                break;

            default:
                console.log("Unhandled event type:", data.event);
        }
    }

    async handleMediaEvent(ws, state, data) {
        const chunk = Buffer.from(data.media.payload, 'base64');
        state.audioData.push(chunk);

        // Reset or start media timer
        if (state.mediaTimer) {
            clearTimeout(state.mediaTimer);
        }

        state.mediaTimer = setTimeout(async () => {
            console.log("Media duration elapsed, processing audio");
            await messageHandler.processAudioData(ws, state.rws, state.audioData);
            state.audioData = [];
            state.mediaTimer = null;
        }, this.CONSTANTS.MEDIA_DURATION);

        // Add delay between chunks
        await new Promise(resolve => setTimeout(resolve, this.CONSTANTS.CHUNK_DELAY));
    }

    async openRealtimeWebSocket(ws) {
        const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";
        const rws = new WebSocket(url, {
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                "OpenAI-Beta": "realtime=v1"
            }
        });

        rws.on('open', () => console.log("OpenAI WebSocket connected"));
        rws.on('message', (message) => messageHandler.handleOpenAIMessage(ws, this.CONSTANTS.DEFAULT_STREAM_SID, message));
        rws.on('error', (error) => console.error("OpenAI WebSocket error:", error));
        rws.on('close', () => console.log("OpenAI WebSocket closed"));

        return rws;
    }

    cleanup(ws, state) {
        console.log("Cleaning up connection");
        if (state.mediaTimer) {
            clearTimeout(state.mediaTimer);
        }
        if (state.rws) {
            state.rws.close();
        }
        this.connections.delete(ws);
    }

    setupServerShutdown(wss) {
        process.on('SIGINT', () => {
            console.log("Server shutdown initiated");
            for (let ws of this.connections) {
                ws.close();
            }
            this.connections.clear();
            wss.close();
            process.exit();
        });
    }
}

module.exports = new ConnectionManager();
