const { AUDIO_CONFIG } = require('../config/constants');

class ChunkOptimizer {
  constructor() {
    this.CHUNK_MIN_SIZE = 3200;   // 3.2 KB (100ms of audio)
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
      const padding = Buffer.alloc(paddingSize, 0);
      audioBuffer = Buffer.concat([audioBuffer, padding]);
    }

    // Too Large: Split into Manageable Chunks
    if (audioBuffer.length > this.CHUNK_MAX_SIZE) {
      console.warn("Audio chunk too large. Splitting buffer.");
      const chunks = [];
      let offset = 0;
      
      while (offset < audioBuffer.length) {
        let chunkSize = Math.min(this.CHUNK_MAX_SIZE, audioBuffer.length - offset);
        // Ensure chunk size is multiple of 320
        chunkSize = Math.floor(chunkSize / this.CHUNK_MULTIPLE) * this.CHUNK_MULTIPLE;
        
        if (chunkSize >= this.CHUNK_MIN_SIZE) {
          const chunk = audioBuffer.subarray(offset, offset + chunkSize);
          chunks.push(chunk);
        }
        offset += chunkSize;
      }
      
      // Return first chunk for now, log if we're dropping data
      if (chunks.length > 1) {
        console.warn(`Large audio response split into ${chunks.length} chunks. Using first chunk.`);
      }
      audioBuffer = chunks[0];
    }

    // Ensure Multiple of 320 Bytes
    const remainder = audioBuffer.length % this.CHUNK_MULTIPLE;
    if (remainder !== 0) {
      console.warn("Chunk not multiple of 320 bytes. Adjusting.");
      const paddingSize = this.CHUNK_MULTIPLE - remainder;
      const padding = Buffer.alloc(paddingSize, 0);
      audioBuffer = Buffer.concat([audioBuffer, padding]);
    }

    console.log("Final Audio chunk size:", audioBuffer.length);
    return audioBuffer;
  }
}

module.exports = new ChunkOptimizer();