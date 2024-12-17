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
  
  let mediaTimer = null;
  const MEDIA_DURATION = 6000; // 6 seconds to capture media

  let realtimeWebSocket;
  try {
    realtimeWebSocket = await webSocketManager.openRealtimeWebSocket(clientWebSocket, 'default-sid');

    // Handle OpenAI messages
    realtimeWebSocket.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        console.log("OpenAI message type:", data.type);

        if (data.type === "response.audio.delta") {
          const audioBuffer = Buffer.from(data.delta, 'base64');
          const optimizedBuffer = chunkOptimizer.optimizeOpenAIResponse(audioBuffer);
          
          if (clientWebSocket.readyState === WebSocket.OPEN) {
            clientWebSocket.send(JSON.stringify({
              event: 'media',
              stream_sid: 'default-sid',
              media: {
                payload: optimizedBuffer.toString('base64')
              }
            }));
          }
        }
      } catch (error) {
        console.error("Error handling OpenAI message:", error);
      }
    });

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

  let mediaConnected = false;

  clientWebSocket.on('message', async (message) => {
    const data = JSON.parse(message);
    
    switch (data.event) {
      case 'start':
        console.log("Start event received");
        break;

      case 'media':
        if (!mediaConnected) {
          console.log("Media event received, starting audio collection");
          mediaConnected = true;
          
          // Start timer to send collected audio to OpenAI after 6 seconds
          mediaTimer = setTimeout(async () => {
            console.log("6 seconds elapsed, sending audio to OpenAI");
            await audioBuffer.sendToOpenAI(realtimeWebSocket);
          }, MEDIA_DURATION);
        }
        
        const chunk = Buffer.from(data.media.payload, 'base64');
        audioBuffer.collectAudioChunk(chunk);
        break;

      case 'stop':
        console.log("Stop event received");
        if (mediaTimer) {
          clearTimeout(mediaTimer);
          // Send any remaining audio
          await audioBuffer.sendToOpenAI(realtimeWebSocket);
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