
const socket = io();

const videoElem = document.getElementById('hostVideo');
const toggleButton = document.getElementById('toggleStreamBtn');
const permissionButton = document.getElementById('permissionBtn');
const streamIdInput = document.getElementById('streamIdInput');
const streamTitleInput = document.getElementById('streamTitleInput');

let localStream = null;
let streaming = false;
const peerConnections = {}; // viewerId -> RTCPeerConnection

// Step 1: ask user for camera & mic permission
async function requestMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    videoElem.srcObject = localStream;

    permissionButton.disabled = true;
    permissionButton.textContent = 'Camera & Mic Enabled';
    toggleButton.disabled = false;

    console.log('Camera & mic permission granted.');
  } catch (err) {
    console.error('Error accessing camera/mic', err);
    alert('Camera & microphone permission is required to stream.');
  }
}

// Step 2: start or stop the stream
function toggleStream() {
  if (!streaming) {
    if (!localStream) {
      alert('Please enable camera & mic first.');
      return;
    }

    const streamId = streamIdInput.value.trim();
    if (!streamId) {
      alert('Please enter a Stream ID (e.g. "host-a").');
      return;
    }
    const title = streamTitleInput.value.trim();

    // Tell server to create this stream
    socket.emit('create-stream', { streamId, title });

    streaming = true;
    toggleButton.textContent = 'Stop Stream';
    streamIdInput.disabled = true;
    streamTitleInput.disabled = true;

    console.log('Stream created with ID:', streamId);
  } else {
    // Stop streaming
    socket.emit('end-stream');

    // Close all peer connections to viewers
    for (const viewerId in peerConnections) {
      peerConnections[viewerId].close();
      delete peerConnections[viewerId];
    }

    streaming = false;
    toggleButton.textContent = 'Start Stream';
    streamIdInput.disabled = false;
    streamTitleInput.disabled = false;

    console.log('Stream stopped.');
  }
}

// Optional: confirmation when stream is created on server
socket.on('stream-created', ({ streamId, title }) => {
  console.log('Stream created on server:', streamId, title);
});

// A new viewer joined this host's stream
socket.on('new-viewer', async ({ viewerId }) => {
  console.log('New viewer joined:', viewerId);
  if (!localStream) return;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  peerConnections[viewerId] = pc;

  // Send our local tracks to the viewer
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  // Forward ICE candidates to viewer via signaling server
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { candidate: event.candidate, targetId: viewerId });
    }
  };

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('host-offer', { offer, viewerId });
    console.log('Sent offer to viewer', viewerId);
  } catch (err) {
    console.error('Error creating offer for viewer', viewerId, err);
  }
});

// Receive a viewer's answer
socket.on('receive-answer', ({ answer, viewerId }) => {
  const pc = peerConnections[viewerId];
  if (pc) {
    pc.setRemoteDescription(new RTCSessionDescription(answer));
    console.log('Received answer from viewer', viewerId);
  }
});

// Receive ICE candidate from a viewer
socket.on('ice-candidate', ({ candidate, senderId }) => {
  const pc = peerConnections[senderId];
  if (pc) {
    pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((err) => {
      console.error('Error adding ICE candidate from viewer', err);
    });
  }
});

// Handle viewer leaving
socket.on('viewer-left', ({ viewerId }) => {
  const pc = peerConnections[viewerId];
  if (pc) {
    pc.close();
    delete peerConnections[viewerId];
  }
  console.log('Viewer left:', viewerId);
});

// Expose functions to global scope for inline onclick handlers
window.requestMedia = requestMedia;
window.toggleStream = toggleStream;
