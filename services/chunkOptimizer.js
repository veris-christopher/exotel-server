const { AUDIO_CONFIG } = require('../config/constants');

class ChunkOptimizer {
  constructor() {
    this.CHUNK_MIN_SIZE = 3200;   // 3.2 KB (100ms of audio)
    this.CHUNK_MAX_SIZE = 100000; // 100 KB
    this.CHUNK_MULTIPLE = 320;    // Must be multiple of 320 bytes
    this.CHUNK_INTERVAL = 20;     // 20ms standard interval
  }

  optimizeOpenAIResponse(audioBuffer) {
    console.log("\n=== Optimizing OpenAI Audio Response ===");
    const originalSize = audioBuffer.length;
    let chunks = [];

    // Handle oversized buffer by splitting into proper chunks
    if (originalSize > this.CHUNK_MAX_SIZE) {
      console.log("Splitting large buffer into proper chunks");
      let offset = 0;
      while (offset < originalSize) {
        let chunkSize = Math.min(this.CHUNK_MAX_SIZE, originalSize - offset);
        // Ensure chunk size is multiple of 320
        chunkSize = Math.floor(chunkSize / this.CHUNK_MULTIPLE) * this.CHUNK_MULTIPLE;
        
        if (chunkSize >= this.CHUNK_MIN_SIZE) {
          chunks.push({
            data: audioBuffer.subarray(offset, offset + chunkSize),
            timestamp: Date.now(),
            duration: this.calculateDuration(chunkSize)
          });
        }
        offset += chunkSize;
      }
    } else {
      // Handle single chunk
      let adjustedBuffer = audioBuffer;
      
      // Ensure minimum size
      if (originalSize < this.CHUNK_MIN_SIZE) {
        console.log("Padding small chunk to minimum size");
        const paddingSize = this.CHUNK_MIN_SIZE - originalSize;
        const padding = Buffer.alloc(paddingSize, 0);
        adjustedBuffer = Buffer.concat([audioBuffer, padding]);
      }
      
      // Ensure multiple of 320
      const remainder = adjustedBuffer.length % this.CHUNK_MULTIPLE;
      if (remainder !== 0) {
        console.log("Adjusting chunk to be multiple of 320 bytes");
        const paddingSize = this.CHUNK_MULTIPLE - remainder;
        const padding = Buffer.alloc(paddingSize, 0);
        adjustedBuffer = Buffer.concat([adjustedBuffer, padding]);
      }

      chunks.push({
        data: adjustedBuffer,
        timestamp: Date.now(),
        duration: this.calculateDuration(adjustedBuffer.length)
      });
    }

    console.log(`Processed ${chunks.length} chunks`);
    return chunks;
  }

  calculateDuration(byteSize) {
    // Calculate duration in milliseconds based on chunk size
    // 320 bytes = 20ms (as per phone service requirements)
    return (byteSize / this.CHUNK_MULTIPLE) * this.CHUNK_INTERVAL;
  }
}

module.exports = new ChunkOptimizer();