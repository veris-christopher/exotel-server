require('dotenv').config();
const express = require('express');
const connectionManager = require('./services/connectionManager');

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

// Start server
function startServer(port) {
    const server = app.listen(port, () => {
        console.log(`🚀 Server running on port ${port}`);
    });

    // Setup WebSocket handling
    connectionManager.setupWebSocket(server);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        server.close(() => process.exit(0));
    });
}

startServer(args.port);