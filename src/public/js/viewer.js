/* global io */
// Viewer client logic for WebRTC live streaming. This script handles:
//  1. Fetching and rendering the list of current streams
//  2. Choosing a stream to watch, starting WebRTC negotiation
//  3. Switching streams or stopping watching

const socket = io();

// References to DOM elements
const streamsContainer = document.getElementById('streamsContainer');
const statusElem = document.getElementById('status');
const remoteVideo = document.getElementById('remoteVideo');
const leaveBtn = document.getElementById('leaveBtn');

// Keep track of WebRTC state
let pc = null;
let currentStreamId = null;
let currentHostId = null;

// Temporary viewer identity until OAuth is integrated. Each viewer picks
// a random name. The avatarUrl can be null or a real URL from auth.
const viewerName = 'Viewer-' + Math.floor(Math.random() * 10000);
const viewerAvatarUrl = null;

// Request the initial list of live streams from the server
socket.emit('get-streams');

// Render the list when received
socket.on('stream-list', (streams) => {
  renderStreamList(streams);
});

// When a stream is added or removed, refresh the list
socket.on('stream-added', () => {
  socket.emit('get-streams');
});
socket.on('stream-removed', ({ streamId }) => {
  if (streamId === currentStreamId) {
    // If we're watching this stream, stop watching quietly
    leaveCurrentStream(false);
    statusElem.textContent = 'The stream you were watching has ended.';
  }
  socket.emit('get-streams');
});

// Display server error messages to the user
socket.on('error-message', ({ message }) => {
  alert(message);
});

// Handle offer from host and complete WebRTC handshake
socket.on('receive-offer', async ({ offer, hostId }) => {
  try {
    // Only handle offers for the currently selected stream
    if (!currentStreamId) {
      console.warn('Received offer but no stream selected; ignoring.');
      return;
    }
    currentHostId = hostId;

    // If we already have a connection, close it before starting a new one
    if (pc) {
      pc.close();
      pc = null;
    }

    // Create a new RTCPeerConnection
    pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    // When tracks arrive from the host, attach them to the video element
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        remoteVideo.srcObject = event.streams[0];
      } else {
        const inboundStream = new MediaStream();
        inboundStream.addTrack(event.track);
        remoteVideo.srcObject = inboundStream;
      }
      remoteVideo.style.display = 'block';
      leaveBtn.style.display = 'inline-block';
      statusElem.textContent = `Watching stream: ${currentStreamId}`;
      console.log('Remote stream attached.');
    };

    // Send our ICE candidates back to the host
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { candidate: event.candidate, targetId: hostId });
      }
    };

    // Apply the offer and create an answer
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('viewer-answer', { answer, hostId });
    console.log('Sent answer back to host.');
  } catch (err) {
    console.error('Error handling offer from host', err);
    alert('Error connecting to the stream.');
  }
});

// Handle ICE candidates from host
socket.on('ice-candidate', ({ candidate, senderId }) => {
  if (pc && senderId === currentHostId) {
    pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((err) => {
      console.error('Error adding ICE candidate', err);
    });
  }
});

// Handle host ending a stream for this viewer
socket.on('stream-ended', ({ streamId }) => {
  if (!streamId || streamId === currentStreamId) {
    leaveCurrentStream(false);
    statusElem.textContent = 'The stream you were watching has ended.';
    socket.emit('get-streams');
  }
});

/**
 * Render the available streams as cards. When none are live, show an
 * informative message.
 *
 * @param {Array<{streamId: string, title: string, hostId: string}>} streams
 */
function renderStreamList(streams) {
  streamsContainer.innerHTML = '';
  if (!streams || streams.length === 0) {
    statusElem.textContent = 'No live streams right now.';
    return;
  }
  if (!currentStreamId) {
    statusElem.textContent = 'Select a stream to watch.';
  }
  streams.forEach((stream) => {
    const card = document.createElement('div');
    card.className = 'stream-card';
    const titleEl = document.createElement('div');
    titleEl.className = 'stream-title';
    titleEl.textContent = stream.title || stream.streamId;
    const idEl = document.createElement('div');
    idEl.className = 'stream-id';
    idEl.textContent = `ID: ${stream.streamId}`;
    const button = document.createElement('button');
    if (currentStreamId === stream.streamId) {
      button.textContent = 'Watching';
      button.disabled = true;
    } else {
      button.textContent = 'Watch';
      button.onclick = () => joinStream(stream.streamId);
    }
    card.appendChild(titleEl);
    card.appendChild(idEl);
    card.appendChild(button);
    streamsContainer.appendChild(card);
  });
}

/**
 * Join a particular stream. If currently watching another stream, leave
 * it first. Then notify the server of the new stream and send
 * viewer metadata.
 *
 * @param {string} streamId
 */
function joinStream(streamId) {
  if (currentStreamId === streamId) return;
  // Leave current stream (if any)
  leaveCurrentStream();
  currentStreamId = streamId;
  statusElem.textContent = `Connecting to stream: ${streamId} ...`;
  socket.emit('viewer-join-stream', {
    streamId,
    user: {
      displayName: viewerName,
      avatarUrl: viewerAvatarUrl,
    },
  });
}

/**
 * Leave the currently watched stream. Optionally notify the server.
 * When sendSignal is false, we only clean up locally. This is used
 * when the host ends the stream and the server already knows.
 *
 * @param {boolean} sendSignal
 */
function leaveCurrentStream(sendSignal = true) {
  if (pc) {
    pc.close();
    pc = null;
  }
  if (sendSignal && currentStreamId) {
    socket.emit('viewer-leave-stream');
  }
  currentStreamId = null;
  currentHostId = null;
  remoteVideo.srcObject = null;
  remoteVideo.style.display = 'none';
  leaveBtn.style.display = 'none';
  // If there are no streams, show fallback; else prompt user to choose one
  if (streamsContainer.children.length === 0) {
    statusElem.textContent = 'No live streams right now.';
  } else {
    statusElem.textContent = 'Select a stream to watch.';
  }
}

// Expose the leave function so the stop button can call it
window.leaveCurrentStream = leaveCurrentStream;