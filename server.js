const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from the "public" directory
app.use(express.static('public'));

// In-memory state (no database)
let hostId = null;
const viewers = new Set();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Host indicates they are ready to stream
  socket.on('host-ready', () => {
    console.log('Host ready:', socket.id);
    hostId = socket.id;
    // Notify host of any existing viewers waiting
    for (const viewerId of viewers) {
      io.to(hostId).emit('new-viewer', { viewerId });
    }
  });

  // Viewer joins to watch
  socket.on('viewer-join', () => {
    console.log('Viewer joined:', socket.id);
    viewers.add(socket.id);
    // If a host is active, let the host know a new viewer is here
    if (hostId) {
      io.to(hostId).emit('new-viewer', { viewerId: socket.id });
    } else {
      // No host yet – viewer will wait until a host starts streaming
      console.log('No host available for viewer', socket.id);
      // (Optionally, could socket.emit('no-host') to inform the viewer UI)
    }
  });

  // Relay host's WebRTC offer to a specific viewer
  socket.on('host-offer', ({ offer, viewerId }) => {
    io.to(viewerId).emit('receive-offer', { offer, hostId: socket.id });
  });

  // Relay viewer's WebRTC answer back to the host
  socket.on('viewer-answer', ({ answer, hostId: hId }) => {
    io.to(hId).emit('receive-answer', { answer, viewerId: socket.id });
  });

  // Relay ICE candidate (from host or viewer) to the other peer
  socket.on('ice-candidate', ({ candidate, targetId }) => {
    io.to(targetId).emit('ice-candidate', { candidate, senderId: socket.id });
  });

  // Host ends the stream
  socket.on('end-stream', () => {
    console.log('Host ended stream.');
    // Notify all viewers that stream ended
    socket.broadcast.emit('stream-ended');
    // Reset state for a new session
    hostId = null;
    viewers.clear();
  });

  // Handle client disconnections
  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    if (socket.id === hostId) {
      // Host disconnected -> end stream for all viewers
      io.emit('stream-ended');
      hostId = null;
      viewers.clear();
    } else {
      // A viewer disconnected
      viewers.delete(socket.id);
      if (hostId) {
        io.to(hostId).emit('viewer-left', { viewerId: socket.id });
      }
    }
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});
