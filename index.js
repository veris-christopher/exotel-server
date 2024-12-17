require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const webSocketManager = require('./services/webSocketManager');
const audioBuffer = require('./services/audioBuffer');
const chunkOptimizer = require('./services/chunkOptimizer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', async (clientWebSocket) => {
  console.log("\n=== New Connection Accepted ===");
  
  let audioData = [];
  let messageDelivered = false;
  let mediaTimer = null;
  const MEDIA_DURATION = 6000; // 6 seconds to capture media

  let realtimeWebSocket;
  try {
    realtimeWebSocket = await webSocketManager.openRealtimeWebSocket(clientWebSocket, 'default-sid');
  } catch (error) {
    console.error("❌ Failed to establish WebSocket connection:", error);
    clientWebSocket.close();
    return;
  }

  const cleanup = () => {
    console.log("\n=== Cleaning up Connection ===");
    if (mediaTimer) {
      clearTimeout(mediaTimer);
    }
    if (realtimeWebSocket) {
      console.log("Closing OpenAI WebSocket");
      realtimeWebSocket.close();
    }
  };

  const processSpeech = async () => {
    console.log("\n=== Processing Speech ===");
    if (audioData.length > 0 && !messageDelivered) {
      console.log("Processing collected audio data");
      messageDelivered = true;
      await audioBuffer.processAudioData(clientWebSocket, realtimeWebSocket, audioData);
      audioData = [];
      messageDelivered = false;
      console.log("Audio buffer cleared");
    }
  };

  let mediaConnected = false;

  clientWebSocket.on('message', async (message) => {
    const data = JSON.parse(message);
    
    switch (data.event) {
      case 'start':
        console.log("Start event received");
        break;

      case 'media':
        if (!mediaConnected) {
          console.log("Media event received");
          mediaConnected = true;
        }
        
        const chunk = Buffer.from(data.media.payload, 'base64');
        const optimizedChunk = chunkOptimizer.optimizeChunk(chunk);
        
        await new Promise(resolve => setTimeout(resolve, chunkOptimizer.getChunkDelay()));
        
        audioData.push(optimizedChunk);

        // Start a timer to process audio after 6 seconds
        if (!mediaTimer) {
          mediaTimer = setTimeout(async () => {
            console.log("6 seconds elapsed, processing audio");
            await processSpeech();
          }, MEDIA_DURATION);
        }
        break;

      case 'stop':
        console.log("Stop event received");
        if (mediaTimer) {
          clearTimeout(mediaTimer);
        }
        break;

      default:
        console.log("Unhandled event type:", data.event);
    }
  });

  clientWebSocket.on('close', () => {
    console.log("\n=== Client Connection Closed ===");
    cleanup();
  });

  clientWebSocket.on('error', (error) => {
    console.error("\n=== Client Connection Error ===");
    console.error("Error details:", error);
    cleanup();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});