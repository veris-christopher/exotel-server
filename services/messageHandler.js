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

  async handleOpenAIMessage(ws, rws, streamSid, messageStr) {
    try {
      // Log message receipt time for debugging
      const receiptTime = new Date().toISOString();
      console.log(`\n📨 OpenAI Message Received at ${receiptTime}`);
      
      const message = JSON.parse(messageStr);
      console.log("Message Type:", message.type);

      // Track message sequence
      if (!this.messageCount) this.messageCount = 0;
      this.messageCount++;
      console.log(`Message #${this.messageCount}`);

      switch (message.type) {
        case "response.audio.delta":
          console.log("🔊 Processing Audio Delta");
          // Add size logging
          const deltaSize = message.delta ? message.delta.length : 0;
          console.log(`Delta size: ${deltaSize} bytes`);
          if (deltaSize === 0) {
            console.warn("⚠️ Received empty audio delta");
            return;
          }
          await this.handleAudioDelta(ws, streamSid, message);
          break;

        case "response.audio.done":
          console.log("✅ Audio Response Complete");
          // Notify client that audio stream is complete
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              event: this.EVENTS.MARK,
              stream_sid: streamSid,
              mark: { name: 'audio_complete' }
            }));
          }
          break;

        case "response.done":
          console.log("🏁 Response Complete");
          break;

        case "session.created":
          console.log("🆕 Session Created:", message.session.id);
          // Store session ID for debugging
          this.currentSessionId = message.session.id;
          break;

        case "error":
          console.error("❌ OpenAI Error:", message.error);
          // Notify client of error
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              event: this.EVENTS.MARK,
              stream_sid: streamSid,
              mark: { 
                name: 'error',
                error: message.error
              }
            }));
          }
          break;

        case "session.updated":
          console.log("🆕 Session Updated");
          break;

        case "input_audio_buffer.speech_started":
          console.log("🎤 Speech Started");
          break

        case "input_audio_buffer.speech_stopped":
          console.log("🎤 Speech Finished");
          break

        case "input_audio_buffer.committed":
          console.log("🎤 Speech Committed");
          break

        default:
          console.log("❓ Unhandled Message Type:", JSON.stringify(message, null, 2));
      }
    } catch (error) {
      console.error("❌ Error handling OpenAI message:", error);
      console.error("Raw message:", messageStr);
    }
  }

  async handleAudioDelta(ws, streamSid, message) {
    try {
      console.log("\n🎵 Processing Audio Delta");
      console.log("Stream SID:", streamSid);

      const processedBuffer = audioProcessor.processOpenAIResponse(message.delta);
      console.log("Processed Buffer Size:", processedBuffer.length, "bytes");

      if (ws.readyState === WebSocket.OPEN) {
        console.log("📤 Sending processed audio to client");
        const payload = {
          event: this.EVENTS.MEDIA,
          stream_sid: streamSid,
          media: {
            payload: processedBuffer.toString('base64'),
            source: 'ai',
            timestamp: Date.now()
          }
        };
        ws.send(JSON.stringify(payload));
        console.log("✅ Audio sent to client");
      } else {
        console.warn("⚠️ Client WebSocket not open, state:", ws.readyState);
      }
    } catch (error) {
      console.error("❌ Error in handleAudioDelta:", error);
      throw error;
    }
  }

  async processAudioData(ws, rws, audioData) {
    if (rws.readyState === WebSocket.OPEN) {
      // console.log("📤 Sending audio to OpenAI");

      // Send audio to input buffer for VAD processing
      rws.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: audioData.toString('base64')
      }));
    } else {
      console.warn("⚠️ OpenAI WebSocket not open");
    }
  }
}

module.exports = new MessageHandler();
