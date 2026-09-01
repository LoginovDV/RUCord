import React, { useEffect, useRef, useState } from 'react';
import { useAuth, useSocket } from '../App';
import './VoiceChannel.css';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

function VoiceChannel({ channelId, voiceUsers, onLeave }) {
  const { user } = useAuth();
  const socket = useSocket();
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef({});
  const audioElementsRef = useRef({});

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
      socket.emit('voice_answer', {
        to: from,
        answer: pc.localDescription,
        from: user.id
      });
    };

    const handleVoiceAnswer = async ({ from, answer }) => {
      const pc = peerConnectionsRef.current[from];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    };

    const handleIceCandidate = async ({ from, candidate }) => {
      const pc = peerConnectionsRef.current[from];
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {}
      }
    };

    socket.on('voice_offer', handleVoiceOffer);
    socket.on('voice_answer', handleVoiceAnswer);
    socket.on('voice_ice_candidate', handleIceCandidate);

    return () => {
      socket.off('voice_offer', handleVoiceOffer);
      socket.off('voice_answer', handleVoiceAnswer);
      socket.off('voice_ice_candidate', handleIceCandidate);
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

  const handleLeave = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    Object.keys(peerConnectionsRef.current).forEach(id => removePeerConnection(id));
    setAudioReady(false);
    onLeave();
  };

  const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  const uniqueUsers = [...new Map(voiceUsers.map(vu => [vu.userId, vu])).values()];

  return (
    <div className="voice-channel-panel">
      <div className="voice-header">
        <span className="voice-icon">🔊</span>
        <span>Voice Connected</span>
      </div>
      {!hasMedia && (
        <div style={{ padding: '8px', color: '#faa61a', fontSize: '12px', background: '#292b2f' }}>
          Microphone unavailable. Open via <b>http://localhost:3000</b> for voice.
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
        <button className="voice-control-btn disconnect" onClick={handleLeave} title="Disconnect">
          📞
        </button>
      </div>
    </div>
  );
}

export default VoiceChannel;
