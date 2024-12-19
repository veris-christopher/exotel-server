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
        console.log("\n=== Message Handler Initialized ===");
        console.log("Supported Events:", Object.values(this.EVENTS));
    }

    async handleOpenAIMessage(ws, streamSid, messageStr) {
        console.log("\n📨 Handling OpenAI Message");
        console.log("Stream SID:", streamSid);

        const message = JSON.parse(messageStr);
        console.log("Message Type:", message.type);

        switch (message.type) {
            case "response.audio.delta":
                console.log("🔊 Processing Audio Delta");
                await this.handleAudioDelta(ws, streamSid, message);
                break;

            case "response.audio.done":
                console.log("✅ Audio Response Complete");
                break;

            case "response.done":
                console.log("🏁 Session Complete");
                break;

            case "session.created":
                console.log("🆕 Session Created:", message.session.id);
                break;

            default:
                console.log("❓ Unhandled Message Type:", message.type);
        }
    }

    async handleAudioDelta(ws, streamSid, message) {
        console.log("\n🎵 Processing Audio Delta");
        console.log("Stream SID:", streamSid);
        
        const processedBuffer = audioProcessor.processOpenAIResponse(message.delta);
        console.log("Processed Buffer Size:", processedBuffer.length, "bytes");

        if (ws.readyState === WebSocket.OPEN) {
            console.log("📤 Sending processed audio to client");
            ws.send(JSON.stringify({
                event: this.EVENTS.MEDIA,
                stream_sid: streamSid,
                media: {
                    payload: processedBuffer.toString('base64'),
                    source: 'ai'
                }
            }));
            console.log("✅ Audio sent to client");
        } else {
            console.warn("⚠️ WebSocket not open, cannot send audio");
        }
    }

    async processAudioData(ws, rws, audioData) {
        console.log("\n🎤 Processing Input Audio");
        const audioBuffer = Buffer.concat(audioData);
        console.log("Combined Audio Size:", audioBuffer.length, "bytes");

        if (rws.readyState === WebSocket.OPEN) {
            console.log("📤 Sending audio to OpenAI");
            
            // Send audio to input buffer for VAD processing
            rws.send(JSON.stringify({
                event_id: `event_${Date.now()}`,
                type: "input_audio_buffer.append",
                audio: audioBuffer.toString('base64')
            }));
            console.log("✅ Audio sent to OpenAI VAD system");
        } else {
            console.warn("⚠️ OpenAI WebSocket not open");
        }
    }
}

module.exports = new MessageHandler();
