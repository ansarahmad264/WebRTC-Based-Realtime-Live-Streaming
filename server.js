
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from "public" directory
app.use(express.static('public'));

// In-memory stream registry (no database)
const streams = {}; // streamId -> { hostId, title, viewers: Set<socketId> }

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // Client asks for current list of live streams
  socket.on('get-streams', () => {
    const list = Object.entries(streams).map(([streamId, s]) => ({
      streamId,
      title: s.title,
      hostId: s.hostId
    }));
    socket.emit('stream-list', list);
  });

  // Host creates a new stream
  socket.on('create-stream', ({ streamId, title }) => {
    if (!streamId) {
      socket.emit('error-message', { message: 'Stream ID is required.' });
      return;
    }

    const trimmedId = String(streamId).trim();
    const streamTitle = title && title.trim() ? title.trim() : trimmedId;

    streams[trimmedId] = {
      hostId: socket.id,
      title: streamTitle,
      viewers: new Set()
    };

    socket.isHost = true;
    socket.streamId = trimmedId;

    console.log(`Stream created: ${trimmedId} by host ${socket.id}`);

    // Acknowledge to the host
    socket.emit('stream-created', { streamId: trimmedId, title: streamTitle });

    // Notify all clients that a new stream is available
    io.emit('stream-added', { streamId: trimmedId, title: streamTitle });
  });

  // Host ends their stream
  socket.on('end-stream', () => {
    if (!socket.isHost || !socket.streamId) {
      return;
    }
    const streamId = socket.streamId;
    const stream = streams[streamId];
    if (!stream) return;

    console.log(`Stream ended: ${streamId} by host ${socket.id}`);

    // Notify only viewers of this stream that it ended
    stream.viewers.forEach((viewerId) => {
      io.to(viewerId).emit('stream-ended', { streamId });
    });

    delete streams[streamId];
    io.emit('stream-removed', { streamId });

    socket.streamId = null;
    socket.isHost = false;
  });

  // Viewer chooses to watch a specific stream
  socket.on('viewer-join-stream', ({ streamId }) => {
    const stream = streams[streamId];
    if (!stream) {
      socket.emit('error-message', { message: 'Stream not found or has ended.' });
      return;
    }

    // If viewer was already watching another stream, detach from that first
    if (socket.currentStreamId && socket.currentStreamId !== streamId) {
      const oldStream = streams[socket.currentStreamId];
      if (oldStream) {
        oldStream.viewers.delete(socket.id);
        io.to(oldStream.hostId).emit('viewer-left', { viewerId: socket.id });
      }
    }

    stream.viewers.add(socket.id);
    socket.currentStreamId = streamId;
    socket.isViewer = true;

    console.log(`Viewer ${socket.id} joined stream ${streamId}`);

    // Notify host to start WebRTC negotiation for this viewer
    io.to(stream.hostId).emit('new-viewer', { viewerId: socket.id });
  });

  // Viewer stops watching their current stream
  socket.on('viewer-leave-stream', () => {
    if (!socket.currentStreamId) return;

    const streamId = socket.currentStreamId;
    const stream = streams[streamId];
    if (stream) {
      stream.viewers.delete(socket.id);
      io.to(stream.hostId).emit('viewer-left', { viewerId: socket.id });
      console.log(`Viewer ${socket.id} left stream ${streamId}`);
    }

    socket.currentStreamId = null;
    socket.isViewer = false;
  });

  // Host sends SDP offer to a viewer
  socket.on('host-offer', ({ offer, viewerId }) => {
    io.to(viewerId).emit('receive-offer', { offer, hostId: socket.id });
  });

  // Viewer sends SDP answer back to host
  socket.on('viewer-answer', ({ answer, hostId }) => {
    io.to(hostId).emit('receive-answer', { answer, viewerId: socket.id });
  });

  // Either side sends ICE candidate to be forwarded
  socket.on('ice-candidate', ({ candidate, targetId }) => {
    io.to(targetId).emit('ice-candidate', { candidate, senderId: socket.id });
  });

  // Handle disconnects
  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);

    // If this socket was a host, end its stream and notify viewers
    if (socket.isHost && socket.streamId) {
      const streamId = socket.streamId;
      const stream = streams[streamId];
      if (stream) {
        stream.viewers.forEach((viewerId) => {
          io.to(viewerId).emit('stream-ended', { streamId });
        });
        delete streams[streamId];
        io.emit('stream-removed', { streamId });
        console.log(`Stream ${streamId} removed because host disconnected.`);
      }
    }

    // If this socket was a viewer, remove from stream
    if (socket.isViewer && socket.currentStreamId) {
      const streamId = socket.currentStreamId;
      const stream = streams[streamId];
      if (stream) {
        stream.viewers.delete(socket.id);
        io.to(stream.hostId).emit('viewer-left', { viewerId: socket.id });
        console.log(`Viewer ${socket.id} removed from stream ${streamId} on disconnect.`);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
