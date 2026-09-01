import React, { useEffect, useRef, useState } from 'react';
import { useAuth, useSocket } from '../App';
import './VoiceChannel.css';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

function VoiceChannel({ channelId, voiceUsers, onLeave, remoteScreen, onRemoteScreenChange, onLocalScreenChange }) {
  const { user } = useAuth();
  const socket = useSocket();
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peerConnectionsRef = useRef({});
  const screenPeerConnectionsRef = useRef({});
  const audioElementsRef = useRef({});

  const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  const createPeer = (peerId, isInitiator) => {
    if (peerConnectionsRef.current[peerId]) return;

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionsRef.current[peerId] = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('voice_ice_candidate', {
          to: peerId,
          candidate: event.candidate,
          from: user.id
        });
      }
    };

    pc.ontrack = (event) => {
      let audio = audioElementsRef.current[peerId];
      if (!audio) {
        audio = document.createElement('audio');
        audio.id = `audio-${peerId}`;
        audio.autoplay = true;
        document.body.appendChild(audio);
        audioElementsRef.current[peerId] = audio;
      }
      audio.srcObject = event.streams[0];
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        removePeerConnection(peerId);
      }
    };

    if (isInitiator && localStreamRef.current) {
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
          socket.emit('voice_offer', {
            to: peerId,
            offer: pc.localDescription,
            from: user.id
          });
        })
        .catch(err => console.error('Error creating offer:', err));
    }
  };

  const removePeerConnection = (peerId) => {
    if (peerConnectionsRef.current[peerId]) {
      peerConnectionsRef.current[peerId].close();
      delete peerConnectionsRef.current[peerId];
    }
    if (audioElementsRef.current[peerId]) {
      audioElementsRef.current[peerId].remove();
      delete audioElementsRef.current[peerId];
    }
  };

  const createScreenPeer = (peerId, stream, isInitiator) => {
    if (screenPeerConnectionsRef.current[peerId]) {
      screenPeerConnectionsRef.current[peerId].close();
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    screenPeerConnectionsRef.current[peerId] = pc;

    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('screen_ice_candidate', {
          to: peerId,
          candidate: event.candidate,
          from: user.id
        });
      }
    };

    pc.ontrack = (event) => {
      onRemoteScreenChange({ peerId, stream: event.streams[0] });
    };

    if (isInitiator) {
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
          socket.emit('screen_offer', {
            to: peerId,
            offer: pc.localDescription,
            from: user.id
          });
        })
        .catch(err => console.error('Error creating screen offer:', err));
    }
  };

  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn('getUserMedia not supported (needs HTTPS or localhost)');
      setAudioReady(true);
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(stream => {
        localStreamRef.current = stream;
        setAudioReady(true);
      })
      .catch(err => {
        console.error('Error accessing microphone:', err);
        setAudioReady(true);
      });

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      Object.keys(peerConnectionsRef.current).forEach(id => removePeerConnection(id));
    };
  }, []);

  useEffect(() => {
    if (!audioReady || !localStreamRef.current) return;

    const otherUsers = voiceUsers.filter(vu => vu.userId !== user.id);

    otherUsers.forEach(vu => {
      if (!peerConnectionsRef.current[vu.userId]) {
        const shouldInitiate = user.id > vu.userId;
        createPeer(vu.userId, shouldInitiate);
      }
    });

    Object.keys(peerConnectionsRef.current).forEach(peerId => {
      if (!otherUsers.find(vu => vu.userId === peerId)) {
        removePeerConnection(peerId);
      }
    });
  }, [voiceUsers, audioReady, user.id]);

  useEffect(() => {
    const handleVoiceOffer = async ({ from, offer }) => {
      if (!localStreamRef.current) return;
      let pc = peerConnectionsRef.current[from];
      if (!pc) {
        createPeer(from, false);
        pc = peerConnectionsRef.current[from];
      }
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('voice_answer', { to: from, answer: pc.localDescription, from: user.id });
    };

    const handleVoiceAnswer = async ({ from, answer }) => {
      const pc = peerConnectionsRef.current[from];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
    };

    const handleIceCandidate = async ({ from, candidate }) => {
      const pc = peerConnectionsRef.current[from];
      if (pc) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
      }
    };

    const handleScreenShareStart = ({ from }) => {
      onRemoteScreenChange({ peerId: from, stream: null });
    };

    const handleScreenShareStop = ({ from }) => {
      onRemoteScreenChange(null);
      if (screenPeerConnectionsRef.current[from]) {
        screenPeerConnectionsRef.current[from].close();
        delete screenPeerConnectionsRef.current[from];
      }
    };

    const handleScreenOffer = async ({ from, offer }) => {
      const pc = screenPeerConnectionsRef.current[from] || new RTCPeerConnection(ICE_SERVERS);
      screenPeerConnectionsRef.current[from] = pc;

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('screen_ice_candidate', { to: from, candidate: event.candidate, from: user.id });
        }
      };

      pc.ontrack = (event) => {
        onRemoteScreenChange({ peerId: from, stream: event.streams[0] });
      };

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('screen_answer', { to: from, answer: pc.localDescription, from: user.id });
    };

    const handleScreenAnswer = async ({ from, answer }) => {
      const pc = screenPeerConnectionsRef.current[from];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
    };

    const handleScreenIceCandidate = async ({ from, candidate }) => {
      const pc = screenPeerConnectionsRef.current[from];
      if (pc) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
      }
    };

    socket.on('voice_offer', handleVoiceOffer);
    socket.on('voice_answer', handleVoiceAnswer);
    socket.on('voice_ice_candidate', handleIceCandidate);
    socket.on('screen_share_start', handleScreenShareStart);
    socket.on('screen_share_stop', handleScreenShareStop);
    socket.on('screen_offer', handleScreenOffer);
    socket.on('screen_answer', handleScreenAnswer);
    socket.on('screen_ice_candidate', handleScreenIceCandidate);

    return () => {
      socket.off('voice_offer', handleVoiceOffer);
      socket.off('voice_answer', handleVoiceAnswer);
      socket.off('voice_ice_candidate', handleIceCandidate);
      socket.off('screen_share_start', handleScreenShareStart);
      socket.off('screen_share_stop', handleScreenShareStop);
      socket.off('screen_offer', handleScreenOffer);
      socket.off('screen_answer', handleScreenAnswer);
      socket.off('screen_ice_candidate', handleScreenIceCandidate);
    };
  }, [socket, user.id]);

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleDeafen = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = isDeafened;
        setIsMuted(!isDeafened);
      }
    }
    Object.values(audioElementsRef.current).forEach(audio => {
      audio.muted = !isDeafened;
    });
    setIsDeafened(!isDeafened);
  };

  const startScreenShare = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      alert('Screen sharing not supported in this browser');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = stream;
      setIsScreenSharing(true);
      if (onLocalScreenChange) onLocalScreenChange(stream);

      socket.emit('screen_share_start', { channelId, from: user.id });

      const otherUsers = voiceUsers.filter(vu => vu.userId !== user.id);
      otherUsers.forEach(vu => {
        createScreenPeer(vu.userId, stream, true);
      });

      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };
    } catch (err) {
      console.error('Error sharing screen:', err);
    }
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    setIsScreenSharing(false);
    if (onLocalScreenChange) onLocalScreenChange(null);
    socket.emit('screen_share_stop', { channelId, from: user.id });

    Object.keys(screenPeerConnectionsRef.current).forEach(peerId => {
      screenPeerConnectionsRef.current[peerId].close();
      delete screenPeerConnectionsRef.current[peerId];
    });
  };

  const handleLeave = () => {
    if (isScreenSharing) stopScreenShare();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    Object.keys(peerConnectionsRef.current).forEach(id => removePeerConnection(id));
    setAudioReady(false);
    onLeave();
  };

  const uniqueUsers = [...new Map(voiceUsers.map(vu => [vu.userId, vu])).values()];

  return (
    <div className="voice-channel-panel">
      <div className="voice-header">
        <span className="voice-icon">🔊</span>
        <span>Voice Connected</span>
      </div>
      {!hasMedia && (
        <div style={{ padding: '8px', color: '#faa61a', fontSize: '12px', background: '#292b2f' }}>
          Microphone unavailable. Open via <b>https://localhost:3000</b> for voice.
        </div>
      )}
      <div className="voice-users-list">
        {uniqueUsers.map(vu => (
          <div key={vu.userId} className="voice-user">
            <div className="voice-user-avatar">{vu.username?.charAt(0).toUpperCase()}</div>
            <span className="voice-user-name">{vu.username}</span>
          </div>
        ))}
      </div>
      <div className="voice-controls">
        <button
          className={`voice-control-btn ${isMuted ? 'muted' : ''}`}
          onClick={toggleMute}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? '🔇' : '🎤'}
        </button>
        <button
          className={`voice-control-btn ${isDeafened ? 'deafened' : ''}`}
          onClick={toggleDeafen}
          title={isDeafened ? 'Undeafen' : 'Deafen'}
        >
          {isDeafened ? '🔕' : '🎧'}
        </button>
        <button
          className={`voice-control-btn ${isScreenSharing ? 'sharing' : ''}`}
          onClick={isScreenSharing ? stopScreenShare : startScreenShare}
          title={isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}
        >
          🖥️
        </button>
        <button className="voice-control-btn disconnect" onClick={handleLeave} title="Disconnect">
          📞
        </button>
      </div>
    </div>
  );
}

export default VoiceChannel;
