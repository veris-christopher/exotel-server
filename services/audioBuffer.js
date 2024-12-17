const { AUDIO_CONFIG } = require('../config/constants');
const performanceTracker = require('../utils/performanceTracker');

class AudioBuffer {
  constructor() {
    this.buffer = [];
    this.totalDuration = 0;
    this.performanceTracker = performanceTracker;
  }

  addChunk(chunk, estimatedDuration) {
    // Intelligent buffer management
    if (this.shouldFlushBuffer(estimatedDuration)) {
      this.flush();
    }

    this.buffer.push(chunk);
    this.totalDuration += estimatedDuration;
    this.performanceTracker.trackAudioChunk(chunk);
  }

  shouldFlushBuffer(newChunkDuration) {
    return this.totalDuration + newChunkDuration > AUDIO_CONFIG.MAX_BUFFER_DURATION;
  }

  flush() {
    if (this.buffer.length === 0) return null;

    const combinedBuffer = Buffer.concat(this.buffer);
    this.performanceTracker.logBufferFlush(combinedBuffer);

    // Reset buffer
    this.buffer = [];
    this.totalDuration = 0;

    return combinedBuffer;
  }

  estimateChunkDuration(chunk) {
    // Estimate duration based on chunk size and assumed sample rate
    // This is a simplistic estimation and might need refinement
    const SAMPLE_RATE = 8000; // Hz
    const BYTES_PER_SAMPLE = 2; // 16-bit audio
    return (chunk.length / (SAMPLE_RATE * BYTES_PER_SAMPLE)) * 1000; // in milliseconds
  }
}

module.exports = new AudioBuffer();