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

  async handleOpenAIMessage(message, clientWebSocket, streamSid) {
    try {
      console.log("\n=== Handling OpenAI Message ===");
      console.log("Stream SID:", streamSid);

      const data = JSON.parse(message);
      console.log("Parsed message type:", data.type);

      switch (data.type) {
        case "response.audio.delta":
          console.log("\n--- Received Audio Delta ---");
          const audioBuffer = Buffer.from(data.delta, 'base64');
          
          if (clientWebSocket.readyState === WebSocket.OPEN) {
            console.log("Sending audio chunk to client WebSocket");
            clientWebSocket.send(JSON.stringify({
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
          console.log("Session ID:", data.session.id);
          break;

        case "error":
          console.error('🔴 OpenAI WebSocket Error:', data.error);
          if (clientWebSocket.readyState === WebSocket.OPEN) {
            clientWebSocket.send(JSON.stringify({ error: data.error }));
          }
          break;

        default:
          console.log("\n--- Unhandled Message Type ---");
          console.log("Type:", data.type);
      }
    } catch (error) {
      console.error('🔴 Error processing OpenAI message:', error);
      if (clientWebSocket.readyState === WebSocket.OPEN) {
        clientWebSocket.send(JSON.stringify({ error: 'Error processing message' }));
      }
    }
  }

  handleWebSocketError(clientWebSocket, error) {
    console.error('🔴 WebSocket Error:', error);
    if (clientWebSocket.readyState === WebSocket.OPEN) {
      clientWebSocket.send(JSON.stringify({ error: 'WebSocket connection error' }));
    }
  }

  handleWebSocketClose(code, reason) {
    console.log(`🔌 WebSocket Closed. Code: ${code}, Reason: ${reason || 'No reason provided'}`);
    // Reset reconnect attempts on normal closure
    if (code === 1000) {
      this.reconnectAttempts = 0;
    }
  }
}

module.exports = new WebSocketManager();