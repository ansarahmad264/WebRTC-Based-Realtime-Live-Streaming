/* global io */
// Host client logic for WebRTC live streaming. This script handles:
//  1. Requesting camera and microphone access
//  2. Creating a new stream and notifying the server
//  3. Negotiating WebRTC connections with each viewer
//  4. Displaying a list of current viewers and their count

const socket = io();

// Grab references to DOM elements
const videoElem = document.getElementById('hostVideo');
const toggleButton = document.getElementById('toggleStreamBtn');
const permissionButton = document.getElementById('permissionBtn');
const streamIdInput = document.getElementById('streamIdInput');
const streamTitleInput = document.getElementById('streamTitleInput');
const viewerCountElem = document.getElementById('viewerCount');
const viewerListElem = document.getElementById('viewerList');

// Keep track of local media and peer connections
let localStream = null;
let streaming = false;
const peerConnections = {}; // viewerId -> RTCPeerConnection

/**
 * Ask the user for camera and microphone access. When granted, show
 * the preview and enable the stream button.
 */
async function requestMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    videoElem.srcObject = localStream;

    permissionButton.disabled = true;
    permissionButton.textContent = 'Camera & Mic Enabled';
    toggleButton.disabled = false;

    console.log('Camera & microphone permission granted.');
  } catch (err) {
    console.error('Error accessing camera/mic', err);
    alert('Camera & microphone permission is required to stream.');
  }
}

/**
 * Start or stop streaming. When starting, the host chooses a stream ID and
 * optional title. When stopping, it ends the stream and cleans up.
 */
function toggleStream() {
  if (!streaming) {
    // Attempt to start streaming
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
    socket.emit('create-stream', { streamId, title });

    streaming = true;
    toggleButton.textContent = 'Stop Stream';
    streamIdInput.disabled = true;
    streamTitleInput.disabled = true;

    console.log('Stream creation requested:', streamId);
  } else {
    // Stop streaming
    socket.emit('end-stream');
    // Close all peer connections
    for (const viewerId in peerConnections) {
      peerConnections[viewerId].close();
      delete peerConnections[viewerId];
    }
    streaming = false;
    toggleButton.textContent = 'Start Stream';
    streamIdInput.disabled = false;
    streamTitleInput.disabled = false;
    // Reset viewer UI
    viewerCountElem.textContent = '0';
    viewerListElem.innerHTML = '';
    console.log('Stream stopped.');
  }
}

// Optional: confirm stream creation
socket.on('stream-created', ({ streamId, title }) => {
  console.log('Stream created on server:', streamId, title);
});

// A new viewer joined this host's stream
socket.on('new-viewer', async ({ viewerId }) => {
  console.log('New viewer joined:', viewerId);
  if (!localStream) return;

  // Set up a new peer connection for this viewer
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
  peerConnections[viewerId] = pc;

  // Add all local media tracks to the connection
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  // Send our ICE candidates to the viewer via the server
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

// Handle a viewer leaving
socket.on('viewer-left', ({ viewerId }) => {
  const pc = peerConnections[viewerId];
  if (pc) {
    pc.close();
    delete peerConnections[viewerId];
  }
  console.log('Viewer left:', viewerId);
});

// Update the viewer panel with the current list and count
socket.on('viewer-list-update', ({ count, viewers }) => {
  viewerCountElem.textContent = count != null ? String(count) : '0';
  viewerListElem.innerHTML = '';
  if (!Array.isArray(viewers) || viewers.length === 0) return;
  viewers.forEach((v) => {
    const item = document.createElement('div');
    item.className = 'viewer-item';
    const avatar = document.createElement('div');
    avatar.className = 'viewer-avatar';
    if (v.avatarUrl) {
      const img = document.createElement('img');
      img.src = v.avatarUrl;
      img.alt = v.displayName || 'viewer';
      avatar.appendChild(img);
    } else {
      // Fallback: circle with first letter
      const initials = document.createElement('span');
      const nameForInitials = v.displayName || 'Anon';
      initials.textContent = nameForInitials.charAt(0).toUpperCase();
      initials.style.color = '#fff';
      initials.style.fontSize = '14px';
      initials.style.fontWeight = 'bold';
      avatar.style.background = '#666';
      avatar.appendChild(initials);
    }
    const name = document.createElement('div');
    name.className = 'viewer-name';
    name.textContent = v.displayName || v.socketId;
    item.appendChild(avatar);
    item.appendChild(name);
    viewerListElem.appendChild(item);
  });
});

// Expose functions for inline onclick handlers
window.requestMedia = requestMedia;
window.toggleStream = toggleStream;