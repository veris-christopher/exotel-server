const { AUDIO_CONFIG } = require('../config/constants');

class ChunkOptimizer {
  constructor() {
    this.CHUNK_MIN_SIZE = 3200;   // 3.2 KB
    this.CHUNK_MAX_SIZE = 100000; // 100 KB
    this.CHUNK_MULTIPLE = 320;    // Must be multiple of 320 bytes
  }

  optimizeOpenAIResponse(audioBuffer) {
    console.log("\n=== Optimizing OpenAI Audio Response ===");
    console.log("Original Audio chunk size:", audioBuffer.length);

    // Too Small: Potential Audio Gaps
    if (audioBuffer.length < this.CHUNK_MIN_SIZE) {
      console.warn("Audio chunk too small. Padding buffer.");
      const paddingSize = this.CHUNK_MIN_SIZE - audioBuffer.length;
      const padding = Buffer.alloc(paddingSize, 0); // Zero-filled padding
      audioBuffer = Buffer.concat([audioBuffer, padding]);
    }

    // Too Large: Split into Manageable Chunks
    if (audioBuffer.length > this.CHUNK_MAX_SIZE) {
      console.warn("Audio chunk too large. Splitting buffer.");
      const chunks = [];
      for (let i = 0; i < audioBuffer.length; i += this.CHUNK_MAX_SIZE) {
        chunks.push(audioBuffer.subarray(i, i + this.CHUNK_MAX_SIZE));
      }
      audioBuffer = chunks[0]; // Use first chunk for now
    }

    // Ensure Multiple of 320 Bytes
    if (audioBuffer.length % this.CHUNK_MULTIPLE !== 0) {
      console.warn("Chunk not multiple of 320 bytes. Adjusting.");
      const remainder = audioBuffer.length % this.CHUNK_MULTIPLE;
      const paddingSize = this.CHUNK_MULTIPLE - remainder;
      const padding = Buffer.alloc(paddingSize, 0);
      audioBuffer = Buffer.concat([audioBuffer, padding]);
    }

    console.log("Adjusted Audio chunk size:", audioBuffer.length);
    return audioBuffer;
  }
}

module.exports = new ChunkOptimizer();