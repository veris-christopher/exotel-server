const WebSocket = require('ws');

class AudioBuffer {
  constructor() {
    this.buffer = [];
    this.isProcessing = false;  // Flag to prevent multiple simultaneous requests
  }

  collectAudioChunk(chunk) {
    this.buffer.push(chunk);
  }

  async sendToOpenAI(realtimeWebSocket) {
    if (this.buffer.length === 0) {
      console.log("No audio data to send");
      return;
    }

    // Prevent multiple simultaneous requests
    if (this.isProcessing) {
      console.log("Already processing a request, skipping");
      return;
    }

    try {
      this.isProcessing = true;
      console.log("\n=== Processing Audio Data ===");
      const audioBuffer = Buffer.concat(this.buffer);
      console.log("Audio buffer size:", audioBuffer.length);

      if (realtimeWebSocket.readyState === WebSocket.OPEN) {
        console.log("Sending audio data to OpenAI");
        
        // Send only the conversation item first
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

        // Wait a bit before sending response request
        await new Promise(resolve => setTimeout(resolve, 100));

        // Send response request
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
    } finally {
      this.isProcessing = false;
    }
  }
}

module.exports = new AudioBuffer();