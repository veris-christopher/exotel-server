const WebSocket = require('ws');
const { WEBSOCKET_CONFIG } = require('../config/constants');
const audioBuffer = require('./audioBuffer');
const chunkOptimizer = require('./chunkOptimizer');

class WebSocketManager {
  constructor() {
    this.reconnectAttempts = 0;
  }

  async openRealtimeWebSocket(clientWebSocket, streamSid) {
    const initializeWebSocket = () => {
      const realtimeWebSocket = new WebSocket(WEBSOCKET_CONFIG.OPENAI_API_URL, {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1"
        }
      });

      this.setupWebSocketListeners(realtimeWebSocket, clientWebSocket, streamSid);
      return realtimeWebSocket;
    };

    return this.connectWithRetry(initializeWebSocket);
  }

  setupWebSocketListeners(realtimeWebSocket, clientWebSocket, streamSid) {
    realtimeWebSocket.on('open', () => {
      console.log("🌐 OpenAI WebSocket Connected");
      this.reconnectAttempts = 0;
    });

    realtimeWebSocket.on('message', async (message) => {
      await this.handleOpenAIMessage(message, clientWebSocket, streamSid);
    });

    realtimeWebSocket.on('error', this.handleWebSocketError.bind(this, clientWebSocket));
    realtimeWebSocket.on('close', this.handleWebSocketClose.bind(this));
  }

  async connectWithRetry(connectFunction) {
    try {
      return connectFunction();
    } catch (error) {
      if (this.reconnectAttempts < WEBSOCKET_CONFIG.MAX_RECONNECT_ATTEMPTS) {
        const delay = WEBSOCKET_CONFIG.RECONNECT_BASE_DELAY * (this.reconnectAttempts + 1);
        console.log(`🔄 Reconnecting in ${delay}ms. Attempt ${this.reconnectAttempts + 1}`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        this.reconnectAttempts++;
        return this.connectWithRetry(connectFunction);
      }
      throw error;
    }
  }

  // Implement other methods for message handling, error management
}

module.exports = new WebSocketManager();