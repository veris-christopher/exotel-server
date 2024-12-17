class AudioProcessor {
    constructor() {
        this.SAMPLE_RATE = {
            INPUT: 24000,  // OpenAI sends at 24kHz
            OUTPUT: 8000   // We want 8kHz
        };
        this.BYTES_PER_SAMPLE = 2; // 16-bit PCM
    }

    downsampleTo8k(buffer) {
        const downsampleRatio = this.SAMPLE_RATE.INPUT / this.SAMPLE_RATE.OUTPUT;
        const inputSamples = buffer.length / this.BYTES_PER_SAMPLE;
        const outputSamples = Math.floor(inputSamples / downsampleRatio);
        const outputBuffer = Buffer.alloc(outputSamples * this.BYTES_PER_SAMPLE);

        for (let i = 0; i < outputSamples; i++) {
            const inputIndex = i * downsampleRatio * this.BYTES_PER_SAMPLE;
            const sample = buffer.readInt16LE(inputIndex);
            outputBuffer.writeInt16LE(sample, i * this.BYTES_PER_SAMPLE);
        }

        return outputBuffer;
    }

    optimizeChunk(audioBuffer) {
        const CHUNK_CONSTRAINTS = {
            MIN_SIZE: 3200,    // 3.2 KB
            MAX_SIZE: 100000,  // 100 KB
            MULTIPLE: 320      // Must be multiple of 320 bytes
        };

        // Handle too small chunks
        if (audioBuffer.length < CHUNK_CONSTRAINTS.MIN_SIZE) {
            const paddingSize = CHUNK_CONSTRAINTS.MIN_SIZE - audioBuffer.length;
            const padding = Buffer.alloc(paddingSize, 0);
            audioBuffer = Buffer.concat([audioBuffer, padding]);
        }

        // Handle too large chunks
        if (audioBuffer.length > CHUNK_CONSTRAINTS.MAX_SIZE) {
            audioBuffer = audioBuffer.subarray(0, CHUNK_CONSTRAINTS.MAX_SIZE);
        }

        // Ensure multiple of 320 bytes
        const remainder = audioBuffer.length % CHUNK_CONSTRAINTS.MULTIPLE;
        if (remainder !== 0) {
            const paddingSize = CHUNK_CONSTRAINTS.MULTIPLE - remainder;
            const padding = Buffer.alloc(paddingSize, 0);
            audioBuffer = Buffer.concat([audioBuffer, padding]);
        }

        return audioBuffer;
    }

    processOpenAIResponse(base64AudioChunk) {
        let audioBuffer = Buffer.from(base64AudioChunk, "base64");
        console.log("Original Audio chunk size (24kHz):", audioBuffer.length);

        // Downsample from 24kHz to 8kHz
        audioBuffer = this.downsampleTo8k(audioBuffer);
        console.log("Downsampled Audio chunk size (8kHz):", audioBuffer.length);

        // Optimize chunk size
        const optimizedBuffer = this.optimizeChunk(audioBuffer);
        console.log("Optimized chunk size:", optimizedBuffer.length);

        return optimizedBuffer;
    }
}

module.exports = new AudioProcessor();
