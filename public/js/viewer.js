const socket = io();

const streamsContainer = document.getElementById('streamsContainer');
const statusElem = document.getElementById('status');
const remoteVideo = document.getElementById('remoteVideo');
const leaveBtn = document.getElementById('leaveBtn');

let pc = null;
let currentStreamId = null;
let currentHostId = null;

// TEMP demo identity – replace with real OAuth user later
const viewerName = 'Viewer-' + Math.floor(Math.random() * 10000);
const viewerAvatarUrl = null;

// Request initial list of streams
socket.emit('get-streams');

// Render list when received
socket.on('stream-list', (streams) => {
  renderStreamList(streams);
});

// When a new stream is added, refresh the list
socket.on('stream-added', (stream) => {
  socket.emit('get-streams');
});

// When a stream is removed, refresh the list and stop watching if it was the current one
socket.on('stream-removed', ({ streamId }) => {
  if (streamId === currentStreamId) {
    leaveCurrentStream(false);
    statusElem.textContent = 'The stream you were watching has ended.';
  }
  socket.emit('get-streams');
});

// Show any server-side error messages
socket.on('error-message', ({ message }) => {
  alert(message);
});

// Handle WebRTC offer from host
socket.on('receive-offer', async ({ offer, hostId }) => {
  try {
    if (!currentStreamId) {
      console.warn('Received offer but no stream selected; ignoring.');
      return;
    }
    currentHostId = hostId;

    if (pc) {
      pc.close();
      pc = null;
    }

    pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // When we receive the host's media tracks, display them
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

    // Complete WebRTC handshake
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

// Handle ICE candidate from host
socket.on('ice-candidate', ({ candidate, senderId }) => {
  if (pc && senderId === currentHostId) {
    pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((err) => {
      console.error('Error adding ICE candidate', err);
    });
  }
});

// Host ended this viewer's stream
socket.on('stream-ended', ({ streamId }) => {
  if (!streamId || streamId === currentStreamId) {
    leaveCurrentStream(false);
    statusElem.textContent = 'The stream you were watching has ended.';
    socket.emit('get-streams');
  }
});

// Render available live streams as cards
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

// Called when the user clicks "Watch" on a specific stream card
function joinStream(streamId) {
  if (currentStreamId === streamId) {
    return;
  }

  // Leave any currently-watched stream
  leaveCurrentStream();

  currentStreamId = streamId;
  statusElem.textContent = `Connecting to stream: ${streamId} ...`;

  // Send viewer metadata (this is where real OAuth user data goes later)
  socket.emit('viewer-join-stream', {
    streamId,
    user: {
      displayName: viewerName,
      avatarUrl: viewerAvatarUrl
    }
  });
}

// Called when the viewer clicks "Stop Watching" or when a stream ends
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

  if (streamsContainer.children.length === 0) {
    statusElem.textContent = 'No live streams right now.';
  } else {
    statusElem.textContent = 'Select a stream to watch.';
  }
}

// Expose to global scope so the button in HTML can call it
window.leaveCurrentStream = leaveCurrentStream;
