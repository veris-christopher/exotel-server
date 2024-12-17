module.exports = {
    AUDIO_CONFIG: {
      CHUNK_MIN_SIZE: 3200,    // 3.2 KB
      CHUNK_MAX_SIZE: 100000,  // 100 KB
      CHUNK_MULTIPLE: 320,     // Must be multiple of 320 bytes
      MAX_BUFFER_DURATION: 6000, // 6 seconds max buffer
    },
    WEBSOCKET_CONFIG: {
      MAX_RECONNECT_ATTEMPTS: 3,
      RECONNECT_BASE_DELAY: 1000, // milliseconds
      OPENAI_API_URL: "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01"
    },
    PERFORMANCE_TRACKING: {
      TRACKING_INTERVAL: 60000, // 1 minute
    }
  };