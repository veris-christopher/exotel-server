const WebSocket = require('ws');

class AudioBuffer {
  constructor() {
    this.buffer = [];
    this.totalDuration = 0;
  }

  async processAudioChunk(chunk, streamSid) {
    this.buffer.push(chunk);
    console.log("Added chunk to buffer. Current size:", this.buffer.length);
  }

  async processAudioData(clientWebSocket, realtimeWebSocket, audioData) {
    console.log("\n=== Processing Audio Data ===");
    const audioBuffer = Buffer.concat(audioData);
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
      console.log("Audio data sent to OpenAI");

      const createResponseEvent = {
        type: "response.create",
        response: {
          modalities: ["text", "audio"],
          instructions: "Please assist the user."
        }
      };

      realtimeWebSocket.send(JSON.stringify(createResponseEvent));
    } else {
      console.warn("OpenAI WebSocket not open, cannot send audio data");
    }
  }

  estimateChunkDuration(chunk) {
    const SAMPLE_RATE = 8000; // Hz
    const BYTES_PER_SAMPLE = 2; // 16-bit audio
    return (chunk.length / (SAMPLE_RATE * BYTES_PER_SAMPLE)) * 1000; // in milliseconds
  }
}

module.exports = new AudioBuffer();