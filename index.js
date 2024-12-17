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
  let realtimeWebSocket;
  
  try {
    realtimeWebSocket = await webSocketManager.openRealtimeWebSocket(clientWebSocket, 'default-sid');
  } catch (error) {
    console.error("❌ Failed to establish WebSocket connection:", error);
    clientWebSocket.close();
    return;
  }

  clientWebSocket.on('message', async (message) => {
    const data = JSON.parse(message);
    
    switch (data.event) {
      case 'media':
        const chunk = Buffer.from(data.media.payload, 'base64');
        const optimizedChunk = chunkOptimizer.optimize(chunk);
        const delay = chunkOptimizer.calculateOptimalDelay(optimizedChunk);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        
        const estimatedDuration = audioBuffer.estimateChunkDuration(optimizedChunk);
        audioBuffer.addChunk(optimizedChunk, estimatedDuration);
        break;
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});