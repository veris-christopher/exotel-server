const WebSocket = require('ws');
const audioProcessor = require('./audioProcessor');

class MessageHandler {
    constructor() {
        this.EVENTS = {
            MEDIA: 'media',
            START: 'start',
            STOP: 'stop',
            MARK: 'mark'
        };
    }

    async handleOpenAIMessage(ws, streamSid, messageStr) {
        const message = JSON.parse(messageStr);
        console.log("OpenAI message type:", message.type);

        switch (message.type) {
            case "response.audio.delta":
                await this.handleAudioDelta(ws, streamSid, message);
                break;

            case "response.audio.done":
                console.log("Audio response complete");
                break;

            case "response.done":
                console.log("Session complete");
                break;

            case "session.created":
                console.log("Session created:", message.session.id);
                break;

            default:
                console.log("Unhandled message type:", message.type);
        }
    }

    async handleAudioDelta(ws, streamSid, message) {
        console.log("Received audio delta");
        const processedBuffer = audioProcessor.processOpenAIResponse(message.delta);

        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                event: this.EVENTS.MEDIA,
                stream_sid: streamSid,
                media: {
                    payload: processedBuffer.toString('base64')
                }
            }));
        } else {
            console.warn("WebSocket not open, cannot send audio");
        }
    }

    async processAudioData(ws, rws, audioData) {
        const audioBuffer = Buffer.concat(audioData);
        console.log("Processing audio data, size:", audioBuffer.length);

        if (rws.readyState === WebSocket.OPEN) {
            // Send audio to OpenAI
            rws.send(JSON.stringify({
                type: "conversation.item.create",
                item: {
                    type: "message",
                    role: "user",
                    content: [{
                        type: "input_audio",
                        data: audioBuffer.toString('base64')
                    }]
                }
            }));

            // Request response
            rws.send(JSON.stringify({
                type: "response.create",
                response: {
                    modalities: ["text", "audio"],
                    instructions: "Please assist the user."
                }
            }));
        } else {
            console.warn("OpenAI WebSocket not open");
        }
    }
}

module.exports = new MessageHandler();
