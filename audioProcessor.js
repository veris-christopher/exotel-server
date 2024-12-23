class AudioProcessor {
  constructor() {
    this.SAMPLE_RATE = {
      INPUT: 24000, // OpenAI sends at 24kHz
      OUTPUT: 8000 // We want 8kHz
    };
    this.BYTES_PER_SAMPLE = 2; // 16-bit PCM
    console.log("\n=== Audio Processor Initialized ===");
  }

  downsampleTo8k(buffer) {
    // console.log("Downsampling Audio");
    // console.log("Input Buffer Size:", buffer.length, "bytes");

    const downsampleRatio = this.SAMPLE_RATE.INPUT / this.SAMPLE_RATE.OUTPUT;
    const inputSamples = buffer.length / this.BYTES_PER_SAMPLE;
    const outputSamples = Math.floor(inputSamples / downsampleRatio);

    const outputBuffer = Buffer.alloc(outputSamples * this.BYTES_PER_SAMPLE);

    for (let i = 0; i < outputSamples; i++) {
      const inputIndex = i * downsampleRatio * this.BYTES_PER_SAMPLE;
      const sample = buffer.readInt16LE(inputIndex);
      outputBuffer.writeInt16LE(sample, i * this.BYTES_PER_SAMPLE);
    }

    // console.log("Output Buffer Size:", outputBuffer.length, "bytes");
    return outputBuffer;
  }

  upsampleTo24k(buffer) {
    console.log("Upsampling Audio");
    console.log("Input Buffer Size:", buffer.length, "bytes");

    const upsampleRatio = this.SAMPLE_RATE.INPUT / this.SAMPLE_RATE.OUTPUT;
    const inputSamples = buffer.length / this.BYTES_PER_SAMPLE;
    const outputSamples = Math.floor(inputSamples * upsampleRatio);

    const outputBuffer = Buffer.alloc(outputSamples * this.BYTES_PER_SAMPLE);

    for (let i = 0; i < outputSamples; i++) {
      const inputIndex = i / upsampleRatio;
      const inputIndexFloor = Math.floor(inputIndex);
      const inputIndexCeil = Math.min(inputIndexFloor + 1, inputSamples - 1);
      const fraction = inputIndex - inputIndexFloor;

      const sample1 = buffer.readInt16LE(
        inputIndexFloor * this.BYTES_PER_SAMPLE
      );
      const sample2 = buffer.readInt16LE(
        inputIndexCeil * this.BYTES_PER_SAMPLE
      );

      // Linear interpolation between samples
      const interpolatedSample = Math.round(
        sample1 * (1 - fraction) + sample2 * fraction
      );
      outputBuffer.writeInt16LE(interpolatedSample, i * this.BYTES_PER_SAMPLE);
    }

    console.log("Output Buffer Size:", outputBuffer.length, "bytes");
    return outputBuffer;
  }

  optimizeChunk(audioBuffer) {
    console.log("\n🔧 Optimizing Audio Chunk");
    const CHUNK_CONSTRAINTS = {
      MIN_SIZE: 3200, // 3.2 KB
      MAX_SIZE: 100000, // 100 KB
      MULTIPLE: 320 // Must be multiple of 320 bytes
    };

    console.log("Original chunk size:", audioBuffer.length, "bytes");

    // Handle too small chunks
    if (audioBuffer.length < CHUNK_CONSTRAINTS.MIN_SIZE) {
      console.log("Chunk too small, padding to minimum size");
      const paddingSize = CHUNK_CONSTRAINTS.MIN_SIZE - audioBuffer.length;
      const padding = Buffer.alloc(paddingSize, 0);
      audioBuffer = Buffer.concat([audioBuffer, padding]);
      console.log("Added padding:", paddingSize, "bytes");
    }

    // Handle too large chunks
    if (audioBuffer.length > CHUNK_CONSTRAINTS.MAX_SIZE) {
      console.log("Chunk too large, truncating to maximum size");
      audioBuffer = audioBuffer.subarray(0, CHUNK_CONSTRAINTS.MAX_SIZE);
    }

    // Ensure multiple of 320 bytes
    const remainder = audioBuffer.length % CHUNK_CONSTRAINTS.MULTIPLE;
    if (remainder !== 0) {
      console.log("Adjusting chunk to be multiple of 320 bytes");
      const paddingSize = CHUNK_CONSTRAINTS.MULTIPLE - remainder;
      const padding = Buffer.alloc(paddingSize, 0);
      audioBuffer = Buffer.concat([audioBuffer, padding]);
      console.log("Added padding:", paddingSize, "bytes");
    }

    console.log("Final chunk size:", audioBuffer.length, "bytes");
    return audioBuffer;
  }

  processOpenAIResponse(base64AudioChunk) {
    console.log("Processing OpenAI Audio Response");

    let audioBuffer = Buffer.from(base64AudioChunk, "base64");
    console.log("Original Audio (24kHz):", audioBuffer.length, "bytes");

    // Downsample from 24kHz to 8kHz
    audioBuffer = this.downsampleTo8k(audioBuffer);
    console.log("Downsampled Audio (8kHz):", audioBuffer.length, "bytes");

    // Optimize chunk size
    const optimizedBuffer = this.optimizeChunk(audioBuffer);
    console.log("Optimized Audio:", optimizedBuffer.length, "bytes");

    return optimizedBuffer;
  }

  processUserAudio(audioBuffer) {
    // console.log("Processing User Audio");

    // // First optimize the chunk size
    // let processedBuffer = this.optimizeChunk(audioBuffer);
    // console.log("Optimized Audio:", processedBuffer.length, "bytes");

    // Upsample from 8kHz to 24kHz
    let processedBuffer = this.upsampleTo24k(audioBuffer);
    // console.log("Upsampled Audio (24kHz):", processedBuffer.length, "bytes");

    return processedBuffer;
  }
}

module.exports = new AudioProcessor();
