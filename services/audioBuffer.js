const WebSocket = require('ws');

class AudioBuffer {
  constructor() {
    this.buffer = [];
    this.windowSize = 3200 * 30; // Store 30 chunks of minimum size
    this.lastProcessedTime = 0;
    this.processingInterval = 2000; // Process every 2 seconds
  }

  collectAudioChunk(chunk) {
    this.buffer.push({
      data: chunk,
      timestamp: Date.now()
    });

    // Keep only recent chunks within window size
    while (this.getTotalBufferSize() > this.windowSize) {
      this.buffer.shift();
    }
  }

  getTotalBufferSize() {
    return this.buffer.reduce((total, chunk) => total + chunk.data.length, 0);
  }

  async sendToOpenAI(realtimeWebSocket) {
    if (this.buffer.length === 0) {
      console.log("No audio data to send");
      return;
    }

    const currentTime = Date.now();
    if (currentTime - this.lastProcessedTime < this.processingInterval) {
      console.log("Waiting for processing interval");
      return;
    }

    console.log("\n=== Processing Audio Data ===");
    
    // Combine chunks while preserving timing
    const chunks = this.buffer.map(chunk => chunk.data);
    const audioBuffer = Buffer.concat(chunks);
    const bufferDuration = (chunks.length * 320) / 16; // Approximate duration in ms

    console.log(`Sending ${chunks.length} chunks, total size: ${audioBuffer.length} bytes`);
    console.log(`Approximate duration: ${bufferDuration}ms`);

    if (realtimeWebSocket.readyState === WebSocket.OPEN) {
      console.log("Sending audio data to OpenAI");
      
      // Send conversation item
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

      // Send response request
      realtimeWebSocket.send(JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["text", "audio"],
          instructions: "Please assist the user."
        }
      }));

      // Clear processed chunks and update timestamp
      this.buffer = [];
      this.lastProcessedTime = currentTime;
      
      console.log("Audio data sent to OpenAI");
    } else {
      console.warn("OpenAI WebSocket not open, cannot send audio data");
    }
  }
}

module.exports = new AudioBuffer();