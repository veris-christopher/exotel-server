require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const audioProcessor = require('./services/audioProcessor');

// Retrieve the OpenAI API key from environment variables.
const { OPENAI_API_KEY } = process.env;

if (!OPENAI_API_KEY) {
  console.error('Missing OpenAI API key. Please set it in the .env file.');
  process.exit(1);
}

// Initialize Express app
const app = express();

// Parse command line arguments
const args = require('yargs')
  .option('port', {
    type: 'number',
    default: 3000,
    description: 'Port for WebSocket server'
  })
  .argv;

// Constants
const SYSTEM_MESSAGE = 'You are a helpful and polite AI assistant for a company called Veris. You love to chat about anything the user is interested about and is prepared to offer them facts. You are keen on learning more about the user and their interests.';
const VOICE = 'alloy';

// List of Event Types to log to the console. See the OpenAI Realtime API Documentation: https://platform.openai.com/docs/api-reference/realtime
const LOG_EVENT_TYPES = [
  'error',
  'response.content.done',
  'rate_limits.updated',
  'response.done',
  'input_audio_buffer.committed',
  'input_audio_buffer.speech_stopped',
  'input_audio_buffer.speech_started',
  'session.created',
  'session.updated'
];

// Show AI response elapsed timing calculations
const SHOW_TIMING_MATH = true;

// Start server
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
  });

  // Root Route
  app.get('/', async (_, res) => {
    res.send({ message: 'Exotel Stream Server is running!' });
  });

  const wss = new WebSocket.Server({ server, path: '/media' });
  const activeConnections = new Set();

  // WebSocket connection
  wss.on('connection', (connection) => {
    console.log('Client connected');
    activeConnections.add(connection);

    // Connection-specific state
    let streamSid = null;
    let latestMediaTimestamp = 0;
    let lastAssistantItem = null;
    let markQueue = [];
    let responseStartTimestamp = null;
    let openAiWs = null;

    const cleanup = () => {
      if (openAiWs && openAiWs.readyState === WebSocket.OPEN) {
        openAiWs.close();
      }
      activeConnections.delete(connection);
      console.log('Cleaned up connection. Active connections:', activeConnections.size);
    };

    // Control initial session with OpenAI
    const initializeSession = () => {
      const sessionUpdate = {
        type: 'session.update',
        session: {
          turn_detection: { type: 'server_vad' },
          voice: VOICE,
          instructions: SYSTEM_MESSAGE,
          modalities: ["text", "audio"],
          temperature: 0.8,
        }
      };

      console.log('Sending session update:', JSON.stringify(sessionUpdate));
      openAiWs.send(JSON.stringify(sessionUpdate));
    };

    // Handle interruption when the caller's speech starts
    const handleSpeechStartedEvent = () => {
      if (markQueue.length > 0 && responseStartTimestamp != null) {
        const elapsedTime = latestMediaTimestamp - responseStartTimestamp;
        if (SHOW_TIMING_MATH) console.log(`Calculating elapsed time for truncation: ${latestMediaTimestamp} - ${responseStartTimestamp} = ${elapsedTime}ms`);

        if (lastAssistantItem) {
          const truncateEvent = {
            type: 'conversation.item.truncate',
            item_id: lastAssistantItem,
            content_index: 0,
            audio_end_ms: elapsedTime
          };
          if (SHOW_TIMING_MATH) console.log('Sending truncation event:', JSON.stringify(truncateEvent));
          openAiWs.send(JSON.stringify(truncateEvent));
        }

        connection.send(JSON.stringify({
          event: 'clear',
          streamSid: streamSid
        }));

        // Reset
        markQueue = [];
        lastAssistantItem = null;
        responseStartTimestamp = null;
      }
    };

    // Send mark messages to Media Streams so we know if and when AI response playback is finished
    const sendMark = (connection, streamSid) => {
      if (streamSid) {
        const markEvent = {
          event: 'mark',
          streamSid: streamSid,
          mark: { name: 'responsePart' }
        };
        connection.send(JSON.stringify(markEvent));
        markQueue.push('responsePart');
      }
    };

    openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1"
      }
    });

    // Open event for OpenAI WebSocket
    openAiWs.on('open', () => {
      console.log('Connected to the OpenAI Realtime API');
      // setTimeout(initializeSession, 500);
    });

    // Listen for messages from the OpenAI WebSocket (and send if necessary)
    openAiWs.on('message', (data) => {
      try {
        const response = JSON.parse(data);

        if (LOG_EVENT_TYPES.includes(response.type)) {
          console.log(`Received event: ${response.type}`, response);
        }

        if (response.type === 'response.audio.delta' && response.delta) {
          const processedBuffer = audioProcessor.processOpenAIResponse(response.delta);

          const audioDelta = {
            event: 'media',
            streamSid: streamSid,
            media: { payload: processedBuffer.toString('base64') }
          };
          connection.send(JSON.stringify(audioDelta));

          // First delta from a new response starts the elapsed time counter
          if (!responseStartTimestamp) {
            responseStartTimestamp = latestMediaTimestamp;
            if (SHOW_TIMING_MATH) console.log(`Setting start timestamp for new response: ${responseStartTimestamp}ms`);
          }

          if (response.item_id) {
            lastAssistantItem = response.item_id;
          }

          sendMark(connection, streamSid);
        }

        if (response.type === 'input_audio_buffer.speech_started') {
          handleSpeechStartedEvent();
        }
      } catch (error) {
        console.error('Error processing OpenAI message:', error, 'Raw message:', data);
      }
    });

    // Handle incoming messages
    connection.on('message', (message) => {
      try {
        const data = JSON.parse(message);

        switch (data.event) {
          case 'media':
            latestMediaTimestamp = data.media.timestamp;
            if (SHOW_TIMING_MATH) console.log(`Received media message with timestamp: ${latestMediaTimestamp}ms`);
            if (openAiWs.readyState === WebSocket.OPEN) {
              const processedBuffer = audioProcessor.processUserAudio(data.media.payload);
              const chunk = processedBuffer.toString('base64');

              const audioAppend = {
                type: 'input_audio_buffer.append',
                audio: chunk
              };
              openAiWs.send(JSON.stringify(audioAppend));
            }
            break;
          case 'start':
            streamSid = data.start.streamSid;
            console.log('Incoming stream has started', streamSid);

            // Reset start and media timestamp on a new stream
            responseStartTimestamp = null;
            latestMediaTimestamp = 0;
            break;
          case 'mark':
            if (markQueue.length > 0) {
              markQueue.shift();
            }
            break;
          default:
            console.log('Received non-media event:', data.event);
            break;
        }
      } catch (error) {
        console.error('Error parsing message:', error, 'Message:', message);
      }
    });

    // Handle connection close
    connection.on('close', () => {
      cleanup();
      console.log('Client disconnected.');
    });

    // Handle WebSocket close and errors
    openAiWs.on('close', () => {
      cleanup();
      console.log('Disconnected from the OpenAI Realtime API');
    });

    openAiWs.on('error', (error) => {
      console.error('Error in the OpenAI WebSocket:', error);
      cleanup();
    });
  });

  // Handle graceful shutdown
  const handleShutdown = () => {
    console.log('\nInitiating graceful shutdown...');
    
    // Close all active WebSocket connections
    activeConnections.forEach(conn => {
      if (conn.readyState === WebSocket.OPEN) {
        conn.close();
      }
    });

    // Close the WebSocket server
    wss.close(() => {
      console.log('WebSocket server closed');
      
      // Close the HTTP server
      server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
      });
    });
  };

  // Register shutdown handler only once
  process.removeAllListeners('SIGINT');
  process.on('SIGINT', handleShutdown);
  
  return { server, wss };
}

startServer(args.port);