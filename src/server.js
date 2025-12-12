const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// Import our modularised routes and socket handlers. Keeping server.js focused on setup
// makes it easy to see how the pieces fit together.
const apiRoutes = require('./routes');
const { registerSocketHandlers } = require('./socket/socketHandlers');

// Create the Express application and an HTTP server. We need the HTTP server
// separately so we can attach Socket.IO to it.
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Enable parsing of JSON bodies on incoming requests. While we don't have
// any JSON‑accepting endpoints yet, this makes it trivial to add them later.
app.use(express.json());

// Mount our REST API under the /api path. All API endpoints are defined
// in the routes directory.
app.use('/api', apiRoutes);

// Serve all of the frontend files from the src/public directory. Because
// Express uses the first match, this will only handle requests for static
// assets (HTML, JS, CSS, images) and leave /api routes to the API router.
app.use(express.static(path.join(__dirname, 'public')));

// Attach Socket.IO handlers. All WebSocket events are registered through
// this function to keep server.js tidy.
registerSocketHandlers(io);

// Start the server. Listen on the port specified by the environment or
// default to 3000. Logging out a friendly message helps confirm that
// everything started correctly.
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server listening on http://localhost:${PORT}`);
});