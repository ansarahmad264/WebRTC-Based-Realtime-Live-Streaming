/**
 * WebRTC signaling handlers
 *
 * WebRTC itself does not define how peers exchange their connection
 * descriptions and ICE candidates. We use Socket.IO as the signaling
 * transport to relay messages between hosts and viewers. Keeping
 * signaling separate from stream control logic allows the code to be
 * reused in other contexts if needed.
 */

/**
 * Register all WebRTC related event handlers on a given socket. Each
 * handler forwards offers, answers and ICE candidates to the intended
 * peer. This function should be called once per connected socket.
 *
 * @param {Server} io – the Socket.IO server instance
 * @param {Socket} socket – the socket that just connected
 */
function registerWebRTCEvents(io, socket) {
  // A host sends an SDP offer to a viewer identified by viewerId. The
  // server simply forwards this offer to the target viewer. The viewer
  // will respond with an answer and the host will complete the handshake.
  socket.on('host-offer', ({ offer, viewerId }) => {
    io.to(viewerId).emit('receive-offer', { offer, hostId: socket.id });
  });

  // A viewer sends an SDP answer back to the host. The host
  // completes the handshake by setting this as the remote description.
  socket.on('viewer-answer', ({ answer, hostId }) => {
    io.to(hostId).emit('receive-answer', { answer, viewerId: socket.id });
  });

  // Both hosts and viewers discover ICE candidates. Here we forward
  // the candidate to the peer specified by targetId. The peer uses
  // addIceCandidate to add it to their RTCPeerConnection.
  socket.on('ice-candidate', ({ candidate, targetId }) => {
    io.to(targetId).emit('ice-candidate', { candidate, senderId: socket.id });
  });
}

module.exports = {
  registerWebRTCEvents,
};