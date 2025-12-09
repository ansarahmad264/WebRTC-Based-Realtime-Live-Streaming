const socket = io();

const videoElem = document.getElementById('hostVideo');
const toggleButton = document.getElementById('toggleStreamBtn');
const permissionButton = document.getElementById('permissionBtn');

let localStream = null;
let streaming = false;
const peerConnections = {}; // viewerId -> RTCPeerConnection

// STEP 1: Ask for camera/mic permission
async function requestMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    videoElem.srcObject = localStream; // show preview

    // Disable permission button once granted
    permissionButton.disabled = true;
    permissionButton.textContent = 'Camera & Mic Enabled';

    // Enable the Start Stream button
    toggleButton.disabled = false;

    console.log('User granted camera & mic access.');
  } catch (err) {
    console.error('User denied or error getting media:', err);
    alert('We need camera & microphone permission to start streaming.');
  }
}

// STEP 2: Start/Stop streaming to viewers
async function toggleStream() {
  if (!streaming) {
    if (!localStream) {
      alert('Please enable camera & mic first.');
      return;
    }
    // Tell server we are ready to stream
    socket.emit('host-ready');
    streaming = true;
    toggleButton.textContent = 'Stop Stream';
    console.log('Streaming started.');
  } else {
    // Stop streaming
    for (const viewerId in peerConnections) {
      peerConnections[viewerId].close();
      delete peerConnections[viewerId];
    }

    // We keep localStream so host can still see themselves.
    // If you want to also turn off the camera here, uncomment:
    // localStream.getTracks().forEach(track => track.stop());
    // localStream = null;
    // videoElem.srcObject = null;
    // permissionButton.disabled = false;
    // permissionButton.textContent = 'Enable Camera & Mic';
    // toggleButton.disabled = true;

    socket.emit('end-stream');
    streaming = false;
    toggleButton.textContent = 'Start Stream';
    console.log('Streaming stopped.');
  }
}

// When server notifies of a new viewer, create WebRTC connection for them
socket.on('new-viewer', async ({ viewerId }) => {
  console.log('New viewer connected:', viewerId);
  if (!localStream) return;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  peerConnections[viewerId] = pc;

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = event => {
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

socket.on('receive-answer', ({ answer, viewerId }) => {
  const pc = peerConnections[viewerId];
  if (pc) {
    pc.setRemoteDescription(new RTCSessionDescription(answer));
    console.log('Received answer from viewer', viewerId);
  }
});

socket.on('ice-candidate', ({ candidate, senderId }) => {
  const pc = peerConnections[senderId];
  if (pc) {
    pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(err => {
      console.error('Error adding received ICE candidate', err);
    });
  }
});

socket.on('viewer-left', ({ viewerId }) => {
  const pc = peerConnections[viewerId];
  if (pc) {
    pc.close();
    delete peerConnections[viewerId];
  }
  console.log('Viewer disconnected:', viewerId);
});
