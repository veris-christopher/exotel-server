const WebSocket = require('ws');

class AudioBuffer {
  constructor() {
    this.buffer = [];
  }

  collectAudioChunk(chunk) {
    this.buffer.push(chunk);
  }

  async sendToOpenAI(realtimeWebSocket) {
    if (this.buffer.length === 0) {
      console.log("No audio data to send");
      return;
    }

    console.log("\n=== Processing Audio Data ===");
    const audioBuffer = Buffer.concat(this.buffer);
    console.log("Audio buffer size:", audioBuffer.length);

    if (realtimeWebSocket.readyState === WebSocket.OPEN) {
      console.log("Sending audio data to OpenAI");
      
      realtimeWebSocket.send(JSON.stringify({
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

      realtimeWebSocket.send(JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["text", "audio"],
          instructions: "Please assist the user."
        }
      }));

      this.buffer = [];
      console.log("Audio data sent to OpenAI");
    } else {
      console.warn("OpenAI WebSocket not open, cannot send audio data");
    }
  }
}

module.exports = new AudioBuffer();