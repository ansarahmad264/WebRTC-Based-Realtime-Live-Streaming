const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from "public" directory
app.use(express.static('public'));

// In-memory stream registry (no database)
// streamId -> { hostId, title, viewers: Map<socketId, { socketId, displayName, avatarUrl }> }
const streams = {};

/**
 * Send viewer count + list to the host of a given stream.
 */
function sendViewerListUpdate(streamId) {
  const stream = streams[streamId];
  if (!stream) return;

  const viewersArray = Array.from(stream.viewers.values()).map((v) => ({
    socketId: v.socketId,
    displayName: v.displayName || null,
    avatarUrl: v.avatarUrl || null
  }));

  io.to(stream.hostId).emit('viewer-list-update', {
    streamId,
    count: viewersArray.length,
    viewers: viewersArray
  });
}

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
      viewers: new Map()
    };

    socket.isHost = true;
    socket.streamId = trimmedId;

    console.log(`Stream created: ${trimmedId} by host ${socket.id}`);

    // Acknowledge to the host
    socket.emit('stream-created', { streamId: trimmedId, title: streamTitle });

    // Notify all clients that a new stream is available
    io.emit('stream-added', { streamId: trimmedId, title: streamTitle });

    // Initial empty viewer list for host
    sendViewerListUpdate(trimmedId);
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
    for (const [viewerId] of stream.viewers) {
      io.to(viewerId).emit('stream-ended', { streamId });
    }

    delete streams[streamId];
    io.emit('stream-removed', { streamId });

    socket.streamId = null;
    socket.isHost = false;
  });

  // Viewer chooses to watch a specific stream
  // user = { displayName, avatarUrl } (optional; can come from OAuth later)
  socket.on('viewer-join-stream', ({ streamId, user }) => {
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
        sendViewerListUpdate(socket.currentStreamId);
      }
    }

    const viewerInfo = {
      socketId: socket.id,
      displayName: user && user.displayName ? String(user.displayName) : null,
      avatarUrl: user && user.avatarUrl ? String(user.avatarUrl) : null
    };

    stream.viewers.set(socket.id, viewerInfo);
    socket.currentStreamId = streamId;
    socket.isViewer = true;
    socket.viewerInfo = viewerInfo;

    console.log(`Viewer ${socket.id} joined stream ${streamId}`);

    // Notify host to start WebRTC negotiation for this viewer
    io.to(stream.hostId).emit('new-viewer', { viewerId: socket.id });

    // Send updated viewer list to host
    sendViewerListUpdate(streamId);
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
      sendViewerListUpdate(streamId);
    }

    socket.currentStreamId = null;
    socket.isViewer = false;
    socket.viewerInfo = null;
  });

  // Host sends SDP offer to a viewer
  socket.on('host-offer', ({ offer, viewerId }) => {
    io.to(viewerId).emit('receive-offer', { offer, hostId: socket.id });
  });

  // Viewer sends SDP answer back to host
  socket.on('viewer-answer', ({ answer, hostId: hId }) => {
    io.to(hId).emit('receive-answer', { answer, viewerId: socket.id });
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
        for (const [viewerId] of stream.viewers) {
          io.to(viewerId).emit('stream-ended', { streamId });
        }
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
        sendViewerListUpdate(streamId);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
