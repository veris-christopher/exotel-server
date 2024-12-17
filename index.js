require('dotenv').config();
const WebSocket = require('ws');
const express = require('express');
const EventEmitter = require('events');
EventEmitter.defaultMaxListeners = 15;
const { Buffer } = require('buffer');

const CHUNK_DELAY = 250; // 250ms between processing chunks

const app = express();

async function handleMessage(ws, streamSid, messageStr) {
  console.log("\n=== Handling OpenAI Message ===");
  console.log("Stream SID:", streamSid);

  const message = JSON.parse(messageStr);
  console.log("Parsed message type:", message.type);
  console.log("Full message:", message.toString());

  switch (message.type) {
    case "response.audio.delta":
      console.log("\n--- Received Audio Delta ---");
      const base64AudioChunk = message.delta;
      const audioBuffer = handleResponseChunks(base64AudioChunk);
      if (ws.readyState === WebSocket.OPEN) {
        console.log("Sending audio chunk to client WebSocket");

        ws.send(JSON.stringify({
          event: 'media',
          stream_sid: streamSid,
          media: {
            payload: audioBuffer.toString('base64')
          }
        }));
      } else {
        console.warn("WebSocket not open, cannot write audio");
      }
      break;

    case "response.audio.done":
      console.log("\n--- Audio Response Complete ---");
      break;

    case "response.done":
      console.log("\n--- Session Complete ---");
      break;

    case "session.created":
      console.log("\n--- Session Created ---");
      console.log("Session ID:", message.session.id);
      // Additional handling if needed
      break;

    default:
      console.log("\n--- Unhandled Message Type ---");
      console.log("Type:", message.type);
  }
}

async function processAudioData(ws, rws, audioData) {
  console.log("\n=== Processing Audio Data ===");
  const audioBuffer = Buffer.concat(audioData);
  console.log("Audio buffer size:", audioBuffer.length);

  if (rws.readyState === WebSocket.OPEN) {
    console.log("Sending audio data to OpenAI");
    rws.send(JSON.stringify({
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

    rws.send(JSON.stringify(createResponseEvent));
  } else {
    console.warn("OpenAI WebSocket not open, cannot send audio data");
  }
}

function downsampleTo8k(buffer) {
  // Input: 24kHz PCM16 buffer
  // Output: 8kHz PCM16 buffer
  // Ratio: 24000/8000 = 3 (we'll take every 3rd sample)
  
  const inputSamples = buffer.length / 2; // 2 bytes per sample
  const outputSamples = Math.floor(inputSamples / 3);
  const outputBuffer = Buffer.alloc(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    // Read sample from input (every 3rd sample)
    const inputIndex = i * 3 * 2; // *2 because 2 bytes per sample
    const sample = buffer.readInt16LE(inputIndex);
    
    // Write to output
    outputBuffer.writeInt16LE(sample, i * 2);
  }

  return outputBuffer;
}

function handleResponseChunks(base64AudioChunk) {
  console.log("\n=== Handling Response Chunks ===");

  let audioBuffer = Buffer.from(base64AudioChunk, "base64");
  console.log("Original Audio chunk size (24kHz):", audioBuffer.length);

  // Downsample from 24kHz to 8kHz
  audioBuffer = downsampleTo8k(audioBuffer);
  console.log("Downsampled Audio chunk size (8kHz):", audioBuffer.length);

  const adjustedBuffer = optimizeAudioChunk(audioBuffer);

  return adjustedBuffer;
}

function optimizeAudioChunk(audioBuffer) {
  // 1. Size Validation
  const CHUNK_MIN_SIZE = 3200;   // 3.2 KB
  const CHUNK_MAX_SIZE = 100000; // 100 KB
  const CHUNK_MULTIPLE = 320;    // Must be multiple of 320 bytes

  // Too Small: Potential Audio Gaps
  if (audioBuffer.length < CHUNK_MIN_SIZE) {
    console.warn("Audio chunk too small. Padding buffer.");
    const paddingSize = CHUNK_MIN_SIZE - audioBuffer.length;
    const padding = Buffer.alloc(paddingSize, 0); // Zero-filled padding
    audioBuffer = Buffer.concat([audioBuffer, padding]);
  }

  // Too Large: Split into Manageable Chunks
  if (audioBuffer.length > CHUNK_MAX_SIZE) {
    console.warn("Audio chunk too large. Splitting buffer.");
    const chunks = [];
    for (let i = 0; i < audioBuffer.length; i += CHUNK_MAX_SIZE) {
      chunks.push(audioBuffer.subarray(i, i + CHUNK_MAX_SIZE));
    }
    audioBuffer = chunks[0]; // Use first chunk for now
  }

  // Ensure Multiple of 320 Bytes
  if (audioBuffer.length % CHUNK_MULTIPLE !== 0) {
    console.warn("Chunk not multiple of 320 bytes. Adjusting.");
    const remainder = audioBuffer.length % CHUNK_MULTIPLE;
    const paddingSize = CHUNK_MULTIPLE - remainder;
    const padding = Buffer.alloc(paddingSize, 0);
    audioBuffer = Buffer.concat([audioBuffer, padding]);
  }

  console.log("Adjusted Audio chunk size:", audioBuffer.length);
  return audioBuffer;
}

function openRealtimeWebSocket(ws, streamSid) {
  console.log("\n=== Opening OpenAI Realtime WebSocket ===");
  console.log("Stream SID:", streamSid);

  const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";
  console.log("Connecting to URL:", url);

  const rws = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1"
    }
  });

  const messageHandler = async (message) => {
    console.log("\n--- Received OpenAI Message ---");
    await handleMessage(ws, streamSid, message);
  };

  rws.on('open', () => {
    console.log("\n=== OpenAI WebSocket Connected ===");
  });

  rws.on('close', () => {
    console.log("\n=== OpenAI WebSocket Closed ===");
    console.log("Removing message handler");
    rws.removeListener('message', messageHandler);
  });

  rws.on('error', (error) => {
    console.error("\n=== OpenAI WebSocket Error ===");
    console.error("Error details:", error);
    console.log("Removing message handler and closing connection");
    rws.removeListener('message', messageHandler);
    rws.close();
  });

  rws.on("message", messageHandler);
  return rws;
}

function setupWebSocket(server) {
  console.log("\n=== Setting up WebSocket Server ===");
  const wss = new WebSocket.Server({ server });
  let connections = new Set();

  wss.on('connection', async (ws, req) => {
    console.log("\n=== New Connection Accepted ===");
    console.log("Current active connections:", connections.size);

    let audioData = [];
    let messageDelivered = false;
    let silenceTimer = null;
    const SILENCE_THRESHOLD = 2000; // 2 seconds of silence to trigger processing
    let mediaTimer = null;
    const MEDIA_DURATION = 4000; // 4 seconds to capture media

    console.log("Initializing OpenAI WebSocket");
    const rws = openRealtimeWebSocket(ws, 'default-sid');

    connections.add(ws);
    console.log("Connection added to tracking set");
    console.log("Total connections:", connections.size);

    const cleanup = () => {
      console.log("\n=== Cleaning up Connection ===");
      if (silenceTimer) {
        clearTimeout(silenceTimer);
      }
      if (mediaTimer) {
        clearTimeout(mediaTimer);
      }
      if (rws) {
        console.log("Closing OpenAI WebSocket");
        rws.removeAllListeners();
        rws.close();
      }
      console.log("Removing all listeners from client WebSocket");
      ws.removeAllListeners();
      connections.delete(ws);
      console.log("Remaining connections:", connections.size);
    };

    const processSpeech = async () => {
      console.log("\n=== Processing Speech ===");

      if (audioData.length > 0 && !messageDelivered) {
        console.log("Silence detected, processing speech");
        messageDelivered = true;
        await processAudioData(ws, rws, audioData);
        audioData = [];
        messageDelivered = false;
        console.log("Audio buffer cleared");
      }
    };

    let mediaConnected = false; // Add flag to track media connection status

    ws.on('message', async (message) => {
      const data = JSON.parse(message);

      switch (data.event) {
        case 'start':
          console.log("Start event received");
          break;

        case 'media':
          if (!mediaConnected) {
            console.log("Media event received:", JSON.stringify(data));
            mediaConnected = true;
          }
          const payload = data.media.payload;
          const chunk = Buffer.from(payload, 'base64');

          await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY));

          audioData.push(chunk);

          // Start a timer to process audio after 6 seconds
          if (!mediaTimer) {
            mediaTimer = setTimeout(async () => {
              console.log("6 seconds elapsed, processing audio");
              await processSpeech();
            }, MEDIA_DURATION);
          }

          // Reset the silence timer
          if (silenceTimer) {
            clearTimeout(silenceTimer);
          }

          // Set a new silence timer
          // silenceTimer = setTimeout(async () => {
          //   console.log("Silence detected");
          //   await processSpeech();
          // }, SILENCE_THRESHOLD);

          break;

        case 'mark':
          console.log("Mark event received");
          break;

        case 'stop':
          console.log("Stop event received");
          // Process any remaining audio when stop is received
          if (silenceTimer) {
            clearTimeout(silenceTimer);
          }
          if (mediaTimer) {
            clearTimeout(mediaTimer);
          }
          // await processSpeech();
          break;

        default:
          console.log("Unhandled event type:", data.event);
      }
    });

    ws.on('close', () => {
      console.log("\n=== Client Connection Closed ===");
      cleanup();
    });

    ws.on('error', (error) => {
      console.error("\n=== Client Connection Error ===");
      console.error("Error details:", error);
      cleanup();
    });
  });

  process.on('SIGINT', () => {
    console.log("\n=== Server Shutdown Initiated ===");
    console.log("Closing all connections:", connections.size);
    for (let ws of connections) {
      ws.close();
    }
    connections.clear();
    wss.close();
    console.log("Server shutdown complete");
    process.exit();
  });

  return wss;
}

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`Server listening on: http://localhost:${port}`);
    console.log(`Route for media: http://localhost:${port}/media`);
  });

  setupWebSocket(server);

  process.on('SIGINT', () => {
    server.close(() => {
      process.exit(0);
    });
  });
}

const args = require('yargs')
  .option('port', {
    type: 'number',
    default: 3000,
    description: 'Specify the port on which WS server should be listening'
  })
  .argv;

startServer(args.port);