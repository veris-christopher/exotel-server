require('dotenv').config();
const WebSocket = require('ws');
const express = require('express');
const EventEmitter = require('events');
EventEmitter.defaultMaxListeners = 15;
const { Buffer } = require('buffer');

const app = express();

async function handleMessage(ws, streamSid, messageStr) {
    console.log("\n=== Handling OpenAI Message ===");
    console.log("Stream SID:", streamSid);

    const message = JSON.parse(messageStr);
    console.log("Parsed message type:", message.type);
    console.log("Full message:", message);

    switch (message.type) {
        case "response.audio.delta":
            console.log("\n--- Received Audio Delta ---");
            const base64AudioChunk = message.delta;
            const audioBuffer = Buffer.from(base64AudioChunk, "base64");
            if (ws.readyState === WebSocket.OPEN) {
                console.log("Sending audio chunk to client WebSocket");
                
                ws.send(JSON.stringify({
                    event: 'media',
                    stream_sid: streamSid,
                    media: {
                      payload: audioBuffer.toString('base64')
                    }
                  }));
            } else {
                console.warn("WebSocket not open, cannot write audio");
            }
            break;

        case "response.audio.done":
            console.log("\n--- Audio Response Complete ---");
            break;

        case "response.done":
            console.log("\n--- Session Complete ---");
            break;

        default:
            console.log("\n--- Unhandled Message Type ---");
            console.log("Type:", message.type);
    }
}

async function processAudioData(ws, rws, audioData) {
    console.log("\n=== Processing Audio Data ===");
    const audioBuffer = Buffer.concat(audioData);
    console.log("Audio buffer size:", audioBuffer.length);

    if (rws.readyState === WebSocket.OPEN) {
        console.log("Sending audio data to OpenAI");
        rws.send(JSON.stringify({
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "user",
                content: [{
                    type: "audio",
                    data: audioBuffer.toString('base64')
                }]
            }
        }));
        console.log("Audio data sent to OpenAI");

        const createResponseEvent = {
            type: "response.create",
            response: {
              modalities: ["text", "audio"],
              instructions: "Please assist the user."
            }
          };
    
          rws.send(JSON.stringify(createResponseEvent));
    } else {
        console.warn("OpenAI WebSocket not open, cannot send audio data");
    }
}

// const message = {
//     event: 'media',
//     stream_sid: 'tts-response',
//     media: {
//       payload: audioBuffer.toString('base64')
//     }
//   };
//   ws.send(JSON.stringify(message));
//   console.log('Sent TTS response');

function openRealtimeWebSocket(ws, streamSid) {
    console.log("\n=== Opening OpenAI Realtime WebSocket ===");
    console.log("Stream SID:", streamSid);

    const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";
    console.log("Connecting to URL:", url);

    const rws = new WebSocket(url, {
        headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "OpenAI-Beta": "realtime=v1"
        }
    });

    const messageHandler = (message) => {
        console.log("\n--- Received OpenAI Message ---");
        handleMessage(ws, streamSid, message);
    };

    rws.on('open', () => {
        console.log("\n=== OpenAI WebSocket Connected ===");
        if (process.env.STAGE === 'dev') {
            console.log("Development mode: Sending test message");
            rws.send(JSON.stringify({
                type: "conversation.item.create",
                item: {
                    type: "message",
                    role: "user",
                    content: [{
                        type: "input_text",
                        text: "Hello, this is a test message"
                    }]
                }
            }));
            console.log("Test message sent");
        }
    });

    rws.on('close', () => {
        console.log("\n=== OpenAI WebSocket Closed ===");
        console.log("Removing message handler");
        rws.removeListener('message', messageHandler);
    });

    rws.on('error', (error) => {
        console.error("\n=== OpenAI WebSocket Error ===");
        console.error("Error details:", error);
        console.log("Removing message handler and closing connection");
        rws.removeListener('message', messageHandler);
        rws.close();
    });

    rws.on("message", messageHandler);
    return rws;
}

function setupWebSocket(server) {
    console.log("\n=== Setting up WebSocket Server ===");
    const wss = new WebSocket.Server({ server });
    let connections = new Set();

    wss.on('connection', async (ws, req) => {
        console.log("\n=== New Connection Accepted ===");
        console.log("Current active connections:", connections.size);

        let audioData = [];
        let messageDelivered = false;
        console.log("Initializing OpenAI WebSocket");
        const rws = openRealtimeWebSocket(ws, 'default-sid');

        connections.add(ws);
        console.log("Connection added to tracking set");
        console.log("Total connections:", connections.size);

        const cleanup = () => {
            console.log("\n=== Cleaning up Connection ===");
            if (rws) {
                console.log("Closing OpenAI WebSocket");
                rws.removeAllListeners();
                rws.close();
            }
            console.log("Removing all listeners from client WebSocket");
            ws.removeAllListeners();
            connections.delete(ws);
            console.log("Remaining connections:", connections.size);
        };

        ws.on('message', async (message) => {
            console.log("\n=== Received Client Message ===");
            const data = JSON.parse(message);
            console.log("Message event:", data.event);

            switch (data.event) {
                case 'start':
                    console.log("Start event received");
                    break;

                case 'media':
                    console.log("\n--- Processing Media ---");
                    const payload = data.media.payload;
                    const chunk = Buffer.from(payload, 'base64');

                    console.log("Production mode: Processing as audio");
                    audioData.push(chunk);
                    console.log("Audio chunks collected:", audioData.length);

                    if (audioData.length >= 10 && !messageDelivered) {
                        console.log("Processing collected audio chunks");
                        messageDelivered = true;
                        await processAudioData(ws, rws, audioData);
                        audioData = [];
                        messageDelivered = false;
                        console.log("Audio buffer cleared");
                    }
                    break;

                case 'mark':
                    console.log("Mark event received");
                    break;

                case 'stop':
                    console.log("Stop event received");
                    break;

                default:
                    console.log("Unhandled event type:", data.event);
            }
        });

        ws.on('close', () => {
            console.log("\n=== Client Connection Closed ===");
            cleanup();
        });

        ws.on('error', (error) => {
            console.error("\n=== Client Connection Error ===");
            console.error("Error details:", error);
            cleanup();
        });
    });

    process.on('SIGINT', () => {
        console.log("\n=== Server Shutdown Initiated ===");
        console.log("Closing all connections:", connections.size);
        for (let ws of connections) {
            ws.close();
        }
        connections.clear();
        wss.close();
        console.log("Server shutdown complete");
        process.exit();
    });

    return wss;
}

function startServer(port) {
    const server = app.listen(port, () => {
        console.log(`Server listening on: http://localhost:${port}`);
        console.log(`Route for media: http://localhost:${port}/media`);
    });

    setupWebSocket(server);

    process.on('SIGINT', () => {
        server.close(() => {
            process.exit(0);
        });
    });
}

const args = require('yargs')
    .option('port', {
        type: 'number',
        default: 3000,
        description: 'Specify the port on which WS server should be listening'
    })
    .argv;

startServer(args.port);