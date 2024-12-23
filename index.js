const Sentry = require("@sentry/node");

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0
});

require("dotenv").config();
const express = require("express");
const WebSocket = require("ws");
const audioProcessor = require("./audioProcessor");

// Retrieve the OpenAI API key from environment variables.
const { OPENAI_API_KEY } = process.env;

if (!OPENAI_API_KEY) {
  console.error("Missing OpenAI API key. Please set it in the .env file.");
  process.exit(1);
}

// Initialize Express app
const app = express();

// Parse command line arguments
const args = require("yargs").option("port", {
  type: "number",
  default: 3000,
  description: "Port for WebSocket server"
}).argv;

// Constants
const SYSTEM_MESSAGE = `Instructions:
- You are an AI assistant representing Veris (getveris.com), a leader in modern workplace technology focused on secure, efficient, and connected solutions for businesses.
- Your goal is to provide accurate, helpful, and detailed information about Veris’s offerings, ensuring users understand the features and benefits of its products and services.
- Use a friendly, professional tone to represent Veris’s commitment to innovation, security, and seamless user experiences.
- Be proactive in understanding user needs and offering tailored solutions, ensuring every interaction is insightful and engaging.

Core Capabilities:
1. Visitor Management:
   - Explain how Veris’s visitor management solutions streamline workplace access with features like pre-registration, contactless check-ins, QR-based entry, and visitor badges.
   - Highlight integration capabilities with communication platforms such as MS Teams, WhatsApp, Slack, and enterprise tools like ServiceNow or SAP.
   - Provide guidance on real-time notifications, host alerts, and detailed visitor tracking for a secure and organized workplace.

2. Access Control:
   - Discuss Veris’s innovative access systems that leverage face recognition, mobile IDs, and NFC technology for seamless entry.
   - Showcase advanced features like temporary access for contractors, auto-expiring credentials, and integration with existing physical access control systems (PACS).
   - Support users in understanding smart solutions like license plate recognition for parking management and zone-based access control for enhanced security.

3. Employee and Workplace Convenience:
   - Assist with Veris’s solutions for smart lockers, indoor navigation, and room booking systems.
   - Provide information on tools for air quality monitoring and desk scheduling that contribute to employee well-being and productivity.
   - Highlight real-time insights such as occupancy heatmaps, movement tracking, and personnel flow analytics to optimize workplace layouts.

4. Security Enhancements:
   - Elaborate on Veris’s AI-powered insights, including predictive analytics, real-time alerts, and anomaly detection to prevent potential security threats.
   - Detail the comprehensive logging of access activities, zone-based violation alerts, and AI-enhanced incident response for a robust security framework.
   - Discuss Veris’s ability to unify disparate systems like video surveillance, parking management, and access control into one centralized dashboard for easy monitoring.

5. Sustainability and Innovation:
   - Emphasize Veris’s commitment to eco-friendly solutions, such as promoting contactless and paperless systems for visitor and employee interactions.
   - Advocate for the use of sustainable commuting options, such as integrating bike-sharing, electric vehicle (EV) chargers, or carpooling management systems.

6. Analytics and Decision-Making:
   - Showcase Veris’s powerful analytics capabilities, including historical data tracking, real-time heatmaps, and 3D mapping to help users make informed decisions.
   - Explain how AI/ML algorithms transform raw data into actionable insights for optimizing security protocols, personnel allocation, and workplace efficiency.

7. Customer-Centric Innovation:
   - Highlight Veris’s focus on user experience by ensuring every feature is intuitive, efficient, and adaptable to diverse business needs.
   - Promote the idea of a frictionless workplace where every touchpoint, from entry to exit, is designed to enhance user satisfaction and operational efficiency.

Personality:
- Be proactive, knowledgeable, and approachable, reflecting Veris’s innovative and solution-driven ethos.
- Communicate with clarity and warmth, ensuring users feel supported and empowered.
- Always align with Veris’s mission to "redefine workplace experiences with cutting-edge technology."

Additional Notes:
- Use available tools and resources liberally to answer queries or demonstrate features.
- Adapt your tone based on the user’s needs while maintaining professionalism and enthusiasm.
- Proactively suggest additional features or integrations that may enhance the user’s experience or address potential challenges.
`;
const VOICE = "alloy";

// List of Event Types to log to the console.
const LOG_EVENT_TYPES = [
  "error",
  "response.content.done",
  "rate_limits.updated",
  "response.done",
  "input_audio_buffer.committed",
  "input_audio_buffer.speech_stopped",
  "input_audio_buffer.speech_started",
  "session.created",
  "session.updated"
];

// Show AI response elapsed timing calculations
const SHOW_TIMING_MATH = false;

// Start server
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
  });

  // Root Route
  app.get("/", async (_, res) => {
    res.send({ message: "Exotel Stream Server is running!" });
  });

  const wss = new WebSocket.Server({ server, path: "/media" });
  const activeConnections = new Set();

  // WebSocket connection
  wss.on("connection", (connection) => {
    console.log("Client connected");
    activeConnections.add(connection);

    // Connection-specific state
    let streamSid = null;
    let latestMediaTimestamp = 0;
    let lastAssistantItem = null;
    let markQueue = [];
    let responseStartTimestamp = null;
    let openAiWs = null;
    let mediaTimeoutId;
    let startEventTime;

    const cleanup = () => {
      if (openAiWs && openAiWs.readyState === WebSocket.OPEN) {
        openAiWs.close();
      }
      activeConnections.delete(connection);
      console.log(
        "Cleaned up connection. Active connections:",
        activeConnections.size
      );
    };

    // Control initial session with OpenAI
    const initializeSession = () => {
      const sessionUpdate = {
        type: "session.update",
        session: {
          turn_detection: { type: "server_vad" },
          voice: VOICE,
          instructions: SYSTEM_MESSAGE,
          modalities: ["text", "audio"],
          temperature: 0.8
        }
      };

      console.log("Sending session update:", JSON.stringify(sessionUpdate));
      openAiWs.send(JSON.stringify(sessionUpdate));
    };

    // Handle interruption when the caller's speech starts
    const handleSpeechStartedEvent = () => {
      if (markQueue.length > 0 && responseStartTimestamp != null) {
        const elapsedTime = latestMediaTimestamp - responseStartTimestamp;
        if (SHOW_TIMING_MATH)
          console.log(
            `Calculating elapsed time for truncation: ${latestMediaTimestamp} - ${responseStartTimestamp} = ${elapsedTime}ms`
          );

        if (lastAssistantItem) {
          const truncateEvent = {
            type: "conversation.item.truncate",
            item_id: lastAssistantItem,
            content_index: 0,
            audio_end_ms: elapsedTime
          };
          if (SHOW_TIMING_MATH)
            console.log(
              "Sending truncation event:",
              JSON.stringify(truncateEvent)
            );
          openAiWs.send(JSON.stringify(truncateEvent));
        }

        connection.send(
          JSON.stringify({
            event: "clear",
            streamSid: streamSid
          })
        );

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
          event: "mark",
          streamSid: streamSid,
          mark: { name: "responsePart" }
        };
        connection.send(JSON.stringify(markEvent));
        markQueue.push("responsePart");
      }
    };

    openAiWs = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01",
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1"
        }
      }
    );

    // Open event for OpenAI WebSocket
    openAiWs.on("open", () => {
      console.log("Connected to the OpenAI Realtime API");
      setTimeout(initializeSession, 500);
    });

    // Listen for messages from the OpenAI WebSocket (and send if necessary)
    openAiWs.on("message", (data) => {
      try {
        const response = JSON.parse(data);

        if (LOG_EVENT_TYPES.includes(response.type)) {
          console.log(`Received event: ${response.type}`, response);
        }

        if (response.type === "response.audio.delta" && response.delta) {
          const processedBuffer = audioProcessor.processOpenAIResponse(
            response.delta
          );

          const audioDelta = {
            event: "media",
            streamSid: streamSid,
            media: { payload: processedBuffer.toString("base64") }
          };
          connection.send(JSON.stringify(audioDelta));

          // First delta from a new response starts the elapsed time counter
          if (!responseStartTimestamp) {
            responseStartTimestamp = latestMediaTimestamp;
            if (SHOW_TIMING_MATH)
              console.log(
                `Setting start timestamp for new response: ${responseStartTimestamp}ms`
              );
          }

          if (response.item_id) {
            lastAssistantItem = response.item_id;
          }

          sendMark(connection, streamSid);
        }

        if (response.type === "input_audio_buffer.speech_started") {
          handleSpeechStartedEvent();
        }
      } catch (error) {
        console.error(
          "Error processing OpenAI message:",
          error,
          "Raw message:",
          data
        );
        Sentry.captureException(error);
      }
    });

    // Handle incoming messages
    connection.on("message", (message) => {
      try {
        const data = JSON.parse(message);

        switch (data.event) {
          case "media":
            latestMediaTimestamp = data.media.timestamp;
            if (SHOW_TIMING_MATH)
              console.log(
                `Received media message with timestamp: ${latestMediaTimestamp}ms`
              );
            // Clear the timeout since we received media
            if (mediaTimeoutId) {
              clearTimeout(mediaTimeoutId);
              mediaTimeoutId = null;
            }
            if (openAiWs.readyState === WebSocket.OPEN) {
              const inputBuffer = Buffer.from(data.media.payload, "base64");
              const processedBuffer =
                audioProcessor.processUserAudio(inputBuffer);
              const chunk = processedBuffer.toString("base64");

              const audioAppend = {
                type: "input_audio_buffer.append",
                audio: chunk
              };
              openAiWs.send(JSON.stringify(audioAppend));
            }
            break;
          case "start":
            // Set start time and create timeout
            startEventTime = Date.now();
            if (mediaTimeoutId) {
              clearTimeout(mediaTimeoutId);
            }
            mediaTimeoutId = setTimeout(() => {
              console.error(
                "No media event received within 5 seconds of start event"
              );
              Sentry.captureException(
                "No media event received within 5 seconds of start event"
              );
              mediaTimeoutId = null;
            }, 5000);
            streamSid = data.start.streamSid;
            console.log("Incoming stream has started", streamSid);

            // Reset start and media timestamp on a new stream
            responseStartTimestamp = null;
            latestMediaTimestamp = 0;
            break;
          case "mark":
            if (markQueue.length > 0) {
              markQueue.shift();
            }
            break;
          default:
            console.log("Received non-media event:", data.event);
            break;
        }
      } catch (error) {
        console.error("Error parsing message:", error, "Message:", message);
        Sentry.captureException(error);
      }
    });

    // Handle connection close
    connection.on("close", () => {
      cleanup();
      console.log("Client disconnected.");
    });

    // Handle WebSocket close and errors
    openAiWs.on("close", () => {
      cleanup();
      console.log("Disconnected from the OpenAI Realtime API");
    });

    openAiWs.on("error", (error) => {
      console.error("Error in the OpenAI WebSocket:", error);
      Sentry.captureException(error);
      cleanup();
    });
  });

  // Handle graceful shutdown
  const handleShutdown = () => {
    console.log("\nInitiating graceful shutdown...");

    // Close all active WebSocket connections
    activeConnections.forEach((conn) => {
      if (conn.readyState === WebSocket.OPEN) {
        conn.close();
      }
    });

    // Close the WebSocket server
    wss.close(() => {
      console.log("WebSocket server closed");

      // Close the HTTP server
      server.close(() => {
        console.log("HTTP server closed");
        process.exit(0);
      });
    });
  };

  // Register shutdown handler only once
  process.removeAllListeners("SIGINT");
  process.on("SIGINT", handleShutdown);

  return { server, wss };
}

startServer(args.port);
