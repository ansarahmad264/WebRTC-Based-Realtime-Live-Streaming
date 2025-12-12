const {
  sendStreamList,
  createStream,
  endStream,
  viewerJoinStream,
  viewerLeaveStream,
  handleDisconnect,
} = require('../controllers/streamController');
const { registerWebRTCEvents } = require('../webrtc/webrtcHandlers');

/**
 * Register Socket.IO event handlers for a new connection. This
 * function attaches all of the custom events we handle. Keeping
 * event wiring here makes it easy to see what messages our
 * application supports.
 *
 * @param {Server} io – the Socket.IO server instance
 */
function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log('🔌 New Socket.IO connection:', socket.id);

    // Handle requests to fetch the current list of streams. This is
    // triggered by viewers when they load their page and whenever
    // streams are added or removed.
    socket.on('get-streams', () => {
      sendStreamList(io, socket);
    });

    // Host lifecycle events
    socket.on('create-stream', (payload) => {
      createStream(io, socket, payload);
    });
    socket.on('end-stream', () => {
      endStream(io, socket);
    });

    // Viewer lifecycle events
    socket.on('viewer-join-stream', (payload) => {
      viewerJoinStream(io, socket, payload);
    });
    socket.on('viewer-leave-stream', () => {
      viewerLeaveStream(io, socket);
    });

    // Attach WebRTC signalling. This registers host-offer, viewer-answer
    // and ice-candidate events on this socket.
    registerWebRTCEvents(io, socket);

    // Clean up when the socket disconnects. This will end streams or
    // remove viewers as appropriate.
    socket.on('disconnect', () => {
      handleDisconnect(io, socket);
    });
  });
}

module.exports = {
  registerSocketHandlers,
};