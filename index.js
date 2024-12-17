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
  let chunkQueue = [];
  let processingChunk = false;

  const processNextChunk = async () => {
    if (processingChunk || chunkQueue.length === 0) return;
    
    processingChunk = true;
    const chunk = chunkQueue[0];
    const now = Date.now();
    
    if (now >= chunk.timestamp) {
      if (clientWebSocket.readyState === WebSocket.OPEN) {
        clientWebSocket.send(JSON.stringify({
          event: 'media',
          stream_sid: 'default-sid',
          media: {
            payload: chunk.data.toString('base64')
          }
        }));
      }
      chunkQueue.shift();
      processingChunk = false;
      
      // Process next chunk after duration
      if (chunkQueue.length > 0) {
        setTimeout(processNextChunk, chunkQueue[0].duration);
      }
    } else {
      // Wait until it's time to process this chunk
      setTimeout(processNextChunk, chunk.timestamp - now);
      processingChunk = false;
    }
  };

  let realtimeWebSocket;
  try {
    realtimeWebSocket = await webSocketManager.openRealtimeWebSocket(clientWebSocket, 'default-sid');

    // Handle OpenAI messages
    realtimeWebSocket.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        console.log("OpenAI message type:", data.type);

        if (data.type === "response.audio.delta") {
          const rawBuffer = Buffer.from(data.delta, 'base64');
          const optimizedChunks = chunkOptimizer.optimizeOpenAIResponse(rawBuffer);
          
          // Add chunks to queue with proper timing
          let nextTimestamp = Date.now();
          optimizedChunks.forEach(chunk => {
            chunkQueue.push({
              data: chunk.data,
              timestamp: nextTimestamp,
              duration: chunk.duration
            });
            nextTimestamp += chunk.duration;
          });

          // Start processing if not already started
          if (!processingChunk) {
            processNextChunk();
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
    chunkQueue = [];
    processingChunk = false;
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
          
          // Start periodic processing of collected audio
          mediaTimer = setInterval(async () => {
            await audioBuffer.sendToOpenAI(realtimeWebSocket);
          }, 2000); // Process every 2 seconds
        }
        
        const chunk = Buffer.from(data.media.payload, 'base64');
        audioBuffer.collectAudioChunk(chunk);
        break;

      case 'stop':
        console.log("Stop event received");
        if (mediaTimer) {
          clearInterval(mediaTimer);
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