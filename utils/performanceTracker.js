const { PERFORMANCE_TRACKING } = require('../config/constants');

class PerformanceTracker {
  constructor() {
    this.metrics = {
      totalChunksProcessed: 0,
      totalAudioDuration: 0,
      averageChunkSize: 0,
      bufferFlushes: 0
    };

    // Periodic reporting
    setInterval(() => this.generateReport(), PERFORMANCE_TRACKING.TRACKING_INTERVAL);
  }

  trackAudioChunk(chunk) {
    this.metrics.totalChunksProcessed++;
    this.metrics.averageChunkSize = 
      (this.metrics.averageChunkSize + chunk.length) / 2;
  }

  logBufferFlush(buffer) {
    this.metrics.bufferFlushes++;
    this.metrics.totalAudioDuration += buffer.length;
  }

  generateReport() {
    console.log("🎧 Audio Streaming Performance Report:", JSON.stringify(this.metrics, null, 2));
  }
}

module.exports = new PerformanceTracker();