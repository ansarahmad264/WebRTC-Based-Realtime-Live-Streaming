/**
 * Stream controller module
 *
 * This module encapsulates all of the business logic for managing live streams.
 * Keeping state and functions here ensures we have a single source of truth
 * for streams, their hosts, and the viewers currently attached to them.
 */

// In‑memory registry of live streams. Each stream entry looks like:
// {
//   hostId: <socket.id of host>,
//   title: <string>,
//   viewers: Map<socketId, { socketId, displayName, avatarUrl }>
// }
//
// Note: because this is purely in memory, all data is lost if the server
// restarts. That is acceptable for a demo or simple app where persistence
// isn't required. Production systems would persist to a database.
const streams = {};

/**
 * Build a public list of streams for UI or API consumption. Each entry
 * contains the streamId, title, and hostId but excludes viewer details.
 *
 * @returns {Array<{streamId: string, title: string, hostId: string}>}
 */
function getPublicStreams() {
  return Object.entries(streams).map(([streamId, s]) => ({
    streamId,
    title: s.title,
    hostId: s.hostId,
  }));
}

/**
 * Send the current list of streams to a particular socket. Separating
 * this function makes it easy to reuse both on demand and when streams
 * change.
 *
 * @param {Server} io – the Socket.IO server instance
 * @param {Socket} socket – the socket to send the list to
 */
function sendStreamList(io, socket) {
  socket.emit('stream-list', getPublicStreams());
}

/**
 * Push an updated list of viewers to a host. Hosts need to know the
 * current viewer count and list so they can display it in the UI.
 *
 * @param {Server} io – the Socket.IO server instance
 * @param {string} streamId – the ID of the stream to update
 */
function sendViewerListUpdate(io, streamId) {
  const stream = streams[streamId];
  if (!stream) return;

  // Convert the viewers map into an array of plain objects so it can
  // be serialised over the wire. Each viewer includes displayName
  // and avatarUrl if provided. You can attach more metadata here as
  // needed (e.g. roles, join timestamps, etc.).
  const viewersArray = Array.from(stream.viewers.values()).map((v) => ({
    socketId: v.socketId,
    displayName: v.displayName || null,
    avatarUrl: v.avatarUrl || null,
  }));

  io.to(stream.hostId).emit('viewer-list-update', {
    streamId,
    count: viewersArray.length,
    viewers: viewersArray,
  });
}

/**
 * Create a new stream on behalf of a host. If a stream with the same
 * ID already exists, it will be overwritten (though this situation
 * shouldn't occur if clients choose unique IDs).
 *
 * @param {Server} io – the Socket.IO server instance
 * @param {Socket} socket – the host's socket
 * @param {{streamId: string, title?: string}} payload – creation payload
 */
function createStream(io, socket, { streamId, title }) {
  if (!streamId) {
    socket.emit('error-message', { message: 'Stream ID is required.' });
    return;
  }

  const trimmedId = String(streamId).trim();
  const streamTitle = title && title.trim() ? title.trim() : trimmedId;

  streams[trimmedId] = {
    hostId: socket.id,
    title: streamTitle,
    viewers: new Map(),
  };

  socket.isHost = true;
  socket.streamId = trimmedId;

  console.log(`🎬 Stream created: ${trimmedId} by host ${socket.id}`);

  // Notify host of successful creation.
  socket.emit('stream-created', { streamId: trimmedId, title: streamTitle });

  // Notify all connected clients that a new stream is available. The
  // viewers will refresh their lists upon receiving this.
  io.emit('stream-added', { streamId: trimmedId, title: streamTitle });

  // Start with an empty viewer list.
  sendViewerListUpdate(io, trimmedId);
}

/**
 * End an existing stream. Only the host of the stream should call this.
 * It notifies all viewers that the stream has ended and cleans up.
 *
 * @param {Server} io
 * @param {Socket} socket
 */
function endStream(io, socket) {
  if (!socket.isHost || !socket.streamId) return;

  const streamId = socket.streamId;
  const stream = streams[streamId];
  if (!stream) return;

  console.log(`🛑 Stream ended: ${streamId} by host ${socket.id}`);

  // Inform all viewers of this stream that it has ended.
  for (const [viewerId] of stream.viewers) {
    io.to(viewerId).emit('stream-ended', { streamId });
  }

  // Remove the stream from the registry and notify clients.
  delete streams[streamId];
  io.emit('stream-removed', { streamId });

  socket.streamId = null;
  socket.isHost = false;
}

/**
 * Add a viewer to a stream. If the viewer was previously watching another
 * stream, they are removed from the prior one. Pass along any user
 * metadata (displayName, avatarUrl) so the host can display it.
 *
 * @param {Server} io
 * @param {Socket} socket
 * @param {{streamId: string, user?: {displayName?: string, avatarUrl?: string}}} payload
 */
function viewerJoinStream(io, socket, { streamId, user }) {
  const stream = streams[streamId];
  if (!stream) {
    socket.emit('error-message', { message: 'Stream not found or has ended.' });
    return;
  }

  // If the viewer was already watching another stream, detach them from it.
  if (socket.currentStreamId && socket.currentStreamId !== streamId) {
    const oldStreamId = socket.currentStreamId;
    const oldStream = streams[oldStreamId];
    if (oldStream) {
      oldStream.viewers.delete(socket.id);
      io.to(oldStream.hostId).emit('viewer-left', { viewerId: socket.id });
      sendViewerListUpdate(io, oldStreamId);
    }
  }

  // Store viewer metadata. If no user data is provided, viewerInfo will
  // contain only the socket ID. We normalise to strings to avoid surprises.
  const viewerInfo = {
    socketId: socket.id,
    displayName: user && user.displayName ? String(user.displayName) : null,
    avatarUrl: user && user.avatarUrl ? String(user.avatarUrl) : null,
  };

  stream.viewers.set(socket.id, viewerInfo);
  socket.currentStreamId = streamId;
  socket.isViewer = true;
  socket.viewerInfo = viewerInfo;

  console.log(`👀 Viewer ${socket.id} joined stream ${streamId}`);

  // Request the host to negotiate a WebRTC connection with this viewer.
  io.to(stream.hostId).emit('new-viewer', { viewerId: socket.id });

  // Update the host's viewer list UI.
  sendViewerListUpdate(io, streamId);
}

/**
 * Remove a viewer from their current stream. If they are not watching a
 * stream, this does nothing. Optionally broadcast this to the host.
 *
 * @param {Server} io
 * @param {Socket} socket
 */
function viewerLeaveStream(io, socket) {
  if (!socket.currentStreamId) return;

  const streamId = socket.currentStreamId;
  const stream = streams[streamId];
  if (stream) {
    stream.viewers.delete(socket.id);
    io.to(stream.hostId).emit('viewer-left', { viewerId: socket.id });
    console.log(`🚪 Viewer ${socket.id} left stream ${streamId}`);
    sendViewerListUpdate(io, streamId);
  }

  socket.currentStreamId = null;
  socket.isViewer = false;
  socket.viewerInfo = null;
}

/**
 * Clean up streams and viewers when a socket disconnects. Hosts lose
 * their streams and viewers are removed from whatever they were
 * watching.
 *
 * @param {Server} io
 * @param {Socket} socket
 */
function handleDisconnect(io, socket) {
  console.log('❌ Socket disconnected:', socket.id);

  // If this socket is a host, end the stream.
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

  // If this socket is a viewer, remove them from the stream they're watching.
  if (socket.isViewer && socket.currentStreamId) {
    const streamId = socket.currentStreamId;
    const stream = streams[streamId];
    if (stream) {
      stream.viewers.delete(socket.id);
      io.to(stream.hostId).emit('viewer-left', { viewerId: socket.id });
      console.log(`Viewer ${socket.id} removed from stream ${streamId} on disconnect.`);
      sendViewerListUpdate(io, streamId);
    }
  }
}

module.exports = {
  streams,
  getPublicStreams,
  sendStreamList,
  sendViewerListUpdate,
  createStream,
  endStream,
  viewerJoinStream,
  viewerLeaveStream,
  handleDisconnect,
};