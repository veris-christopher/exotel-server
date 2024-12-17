const { AUDIO_CONFIG } = require('../config/constants');

class ChunkOptimizer {
  static optimize(audioBuffer) {
    const strategies = {
      PAD: (buffer, targetSize) => {
        const padding = Buffer.alloc(targetSize - buffer.length, 0);
        return Buffer.concat([buffer, padding]);
      },
      TRIM: (buffer, targetSize) => buffer.slice(0, targetSize),
      ADJUST_TO_MULTIPLE: (buffer) => {
        const remainder = buffer.length % AUDIO_CONFIG.CHUNK_MULTIPLE;
        if (remainder === 0) return buffer;

        const paddingSize = AUDIO_CONFIG.CHUNK_MULTIPLE - remainder;
        const padding = Buffer.alloc(paddingSize, 0);
        return Buffer.concat([buffer, padding]);
      }
    };

    // Apply optimization strategies sequentially
    let optimizedBuffer = audioBuffer;
    
    if (optimizedBuffer.length < AUDIO_CONFIG.CHUNK_MIN_SIZE) {
      optimizedBuffer = strategies.PAD(optimizedBuffer, AUDIO_CONFIG.CHUNK_MIN_SIZE);
    }

    if (optimizedBuffer.length > AUDIO_CONFIG.CHUNK_MAX_SIZE) {
      optimizedBuffer = strategies.TRIM(optimizedBuffer, AUDIO_CONFIG.CHUNK_MAX_SIZE);
    }

    optimizedBuffer = strategies.ADJUST_TO_MULTIPLE(optimizedBuffer);

    return optimizedBuffer;
  }

  static calculateOptimalDelay(chunk) {
    const baseDelay = 250; // Default delay in ms
    const chunkSizeFactor = chunk.length / AUDIO_CONFIG.CHUNK_MIN_SIZE;
    return Math.max(50, Math.min(baseDelay * chunkSizeFactor, 500));
  }
}

module.exports = ChunkOptimizer;