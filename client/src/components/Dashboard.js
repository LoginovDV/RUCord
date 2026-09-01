import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useAuth, useSocket } from '../App';
import VoiceChannel from './VoiceChannel';
import './Dashboard.css';

const isDev = window.location.port === '3000';
const API_URL = isDev
  ? `http://${window.location.hostname}:3001`
  : window.location.origin;

function Dashboard() {
  const { user, logout } = useAuth();
  const socket = useSocket();
  const [servers, setServers] = useState([]);
  const [selectedServer, setSelectedServer] = useState(null);
  const [channels, setChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [typingUsers, setTypingUsers] = useState([]);
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [newServerName, setNewServerName] = useState('');
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelType, setNewChannelType] = useState('text');
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [friends, setFriends] = useState([]);
  const [activeTab, setActiveTab] = useState('friends');
  const [newFriendUsername, setNewFriendUsername] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const searchTimeoutRef = useRef(null);
  const [connectedVoiceChannel, setConnectedVoiceChannel] = useState(null);
  const [voiceUsers, setVoiceUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [newInviteLink, setNewInviteLink] = useState('');
  const [remoteScreen, setRemoteScreen] = useState(null);
  const [localScreenStream, setLocalScreenStream] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [allVoiceChannels, setAllVoiceChannels] = useState({});
  const [speakingUsers, setSpeakingUsers] = useState({});
  const toggleMuteRef = useRef(null);
  const toggleDeafenRef = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    loadServers();
    loadFriends();
    loadAllVoiceChannels();
  }, []);

  useEffect(() => {
    if (selectedServer) {
      setSelectedChannel(null);
      setMessages([]);
      loadChannels(selectedServer.id);
    }
  }, [selectedServer]);

  useEffect(() => {
    if (selectedChannel) {
      loadMessages(selectedChannel.id);
      socket.emit('join_channel', selectedChannel.id);
    }
    return () => {
      if (selectedChannel) {
        socket.emit('leave_channel', selectedChannel.id);
      }
    };
  }, [selectedChannel]);

  useEffect(() => {
    socket.on('new_message', (message) => {
      setMessages(prev => [...prev, message]);
    });

    socket.on('user_typing', ({ username }) => {
      setTypingUsers(prev => [...prev.filter(u => u !== username), username]);
    });

    socket.on('user_stop_typing', ({ username }) => {
      setTypingUsers(prev => prev.filter(u => u !== username));
    });

    socket.on('user_status_change', ({ userId, status }) => {
      setOnlineUsers(prev => {
        if (status === 'online') {
          return [...prev.filter(id => id !== userId), userId];
        } else {
          return prev.filter(id => id !== userId);
        }
      });
    });

    socket.on('voice_users_update', (users) => {
      setVoiceUsers(users);
    });

    socket.on('all_voice_channels_update', (channelUsers) => {
      const grouped = {};
      channelUsers.forEach(({ channelid, userid, username }) => {
        if (!grouped[channelid]) grouped[channelid] = [];
        grouped[channelid].push({ userid, username });
      });
      setAllVoiceChannels(grouped);
    });

    socket.on('user_speaking', ({ userId, speaking }) => {
      setSpeakingUsers(prev => {
        const next = { ...prev };
        if (speaking) {
          next[userId] = true;
        } else {
          delete next[userId];
        }
        return next;
      });
    });

    return () => {
      socket.off('new_message');
      socket.off('user_typing');
      socket.off('user_stop_typing');
      socket.off('user_status_change');
      socket.off('voice_users_update');
      socket.off('all_voice_channels_update');
      socket.off('user_speaking');
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadServers = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/servers`);
      setServers(res.data);
      if (res.data.length > 0) {
        setSelectedServer(res.data[0]);
      }
    } catch (error) {
      console.error('Error loading servers:', error);
    }
  };

  const loadChannels = async (serverId) => {
    try {
      const res = await axios.get(`${API_URL}/api/servers/${serverId}/channels`);
      setChannels(res.data);
      if (res.data.length > 0) {
        setSelectedChannel(res.data[0]);
      }
    } catch (error) {
      console.error('Error loading channels:', error);
    }
  };

  const loadMessages = async (channelId) => {
    try {
      const res = await axios.get(`${API_URL}/api/channels/${channelId}/messages`);
      setMessages(res.data);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const loadFriends = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/friends`);
      setFriends(res.data);
    } catch (error) {
      console.error('Error loading friends:', error);
    }
  };

  const loadAllVoiceChannels = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/voice-channels`);
      const grouped = {};
      res.data.forEach(({ channelid, userid, username }) => {
        if (!grouped[channelid]) grouped[channelid] = [];
        grouped[channelid].push({ userid, username });
      });
      setAllVoiceChannels(grouped);
    } catch (error) {
      console.error('Error loading voice channels:', error);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedChannel) return;

    socket.emit('send_message', {
      channelId: selectedChannel.id,
      content: newMessage,
      authorId: user.id
    });

    setNewMessage('');
    socket.emit('stop_typing', { channelId: selectedChannel.id, username: user.username });
  };

  const handleTyping = () => {
    if (selectedChannel) {
      socket.emit('typing', { channelId: selectedChannel.id, username: user.username });
      
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('stop_typing', { channelId: selectedChannel.id, username: user.username });
      }, 2000);
    }
  };

  const handleCreateServer = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_URL}/api/servers`, { name: newServerName });
      setServers([...servers, res.data]);
      setSelectedServer(res.data);
      setShowCreateServer(false);
      setNewServerName('');
    } catch (error) {
      console.error('Error creating server:', error);
    }
  };

  const handleCreateChannel = async (e) => {
    e.preventDefault();
    if (!selectedServer) {
      alert('Select a server first');
      return;
    }
    try {
      const res = await axios.post(`${API_URL}/api/servers/${selectedServer.id}/channels`, { 
        name: newChannelName, 
        type: newChannelType 
      });
      setChannels([...channels, res.data]);
      setShowCreateChannel(false);
      setNewChannelName('');
      setNewChannelType('text');
    } catch (error) {
      console.error('Error creating channel:', error);
      alert('Error: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleAddFriend = async (e) => {
    e.preventDefault();
    if (!newFriendUsername.trim()) return;
    try {
      await axios.post(`${API_URL}/api/friends/add`, { username: newFriendUsername.trim() });
      loadFriends();
      setNewFriendUsername('');
      setSearchResults([]);
      setShowSearch(false);
    } catch (error) {
      alert(error.response?.data?.error || 'Error adding friend');
    }
  };

  const handleSearchUsers = (value) => {
    setNewFriendUsername(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!value.trim()) {
      setSearchResults([]);
      setShowSearch(false);
      return;
    }
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await axios.get(`${API_URL}/api/users/search?q=${encodeURIComponent(value.trim())}`);
        setSearchResults(res.data);
        setShowSearch(res.data.length > 0);
      } catch (err) {
        console.error('Search error:', err);
      }
    }, 300);
  };

  const handleSelectUser = (username) => {
    setNewFriendUsername(username);
    setSearchResults([]);
    setShowSearch(false);
  };

  const handleCreateInvite = async () => {
    if (!selectedServer) return;
    try {
      const res = await axios.post(`${API_URL}/api/servers/${selectedServer.id}/invites`);
      const link = `http://${window.location.host}/invite/${res.data.code}`;
      setNewInviteLink(link);
      setInvites([...invites, res.data]);
    } catch (error) {
      console.error('Error creating invite:', error);
    }
  };

  const handleJoinByInvite = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_URL}/api/invites/${inviteCode}/join`);
      setServers([...servers, res.data]);
      setSelectedServer(res.data);
      setShowInviteModal(false);
      setInviteCode('');
    } catch (error) {
      alert(error.response?.data?.error || 'Invalid invite');
    }
  };

  const handleJoinVoiceChannel = (channelId) => {
    if (connectedVoiceChannel) {
      socket.emit('leave_voice_channel', { channelId: connectedVoiceChannel, userId: user.id });
    }
    setConnectedVoiceChannel(channelId);
    socket.emit('join_voice_channel', { channelId, userId: user.id });
  };

  const handleLeaveVoiceChannel = () => {
    if (connectedVoiceChannel) {
      socket.emit('leave_voice_channel', { channelId: connectedVoiceChannel, userId: user.id });
      setConnectedVoiceChannel(null);
      setVoiceUsers([]);
      setRemoteScreen(null);
      setLocalScreenStream(null);
      setIsMuted(false);
      setIsDeafened(false);
    }
  };

  return (
    <div className="dashboard">
      {/* Servers sidebar */}
      <div className="servers-sidebar">
        <div className="server-icon home-icon" onClick={() => setActiveTab('friends')}>
          <span>R</span>
        </div>
        <div className="server-divider"></div>
        {servers.map(server => (
          <div
            key={server.id}
            className={`server-icon ${selectedServer?.id === server.id ? 'selected' : ''}`}
            onClick={() => {
              setSelectedServer(server);
              setActiveTab('servers');
              setSelectedChannel(null);
              setMessages([]);
            }}
          >
            {server.name.charAt(0).toUpperCase()}
          </div>
        ))}
        <div className="server-icon add-server" onClick={() => setShowCreateServer(true)}>
          <span>+</span>
        </div>
      </div>

      {/* Channels sidebar */}
      <div className="channels-sidebar">
        <div className="channels-header">
          <h3>{activeTab === 'friends' ? 'Friends' : selectedServer?.name || 'Select Server'}</h3>
          {activeTab !== 'friends' && selectedServer && (
            <div className="header-buttons">
              <button className="header-btn" onClick={handleCreateInvite} title="Create Invite">+</button>
              <button className="header-btn" onClick={() => setShowInviteModal(true)} title="Join by Invite">🔗</button>
            </div>
          )}
        </div>

        {activeTab === 'friends' ? (
          <div className="friends-section">
            <form className="add-friend-form" onSubmit={handleAddFriend}>
              <div className="search-wrapper">
                <input
                  type="text"
                  placeholder="Search username..."
                  value={newFriendUsername}
                  onChange={(e) => handleSearchUsers(e.target.value)}
                  onFocus={() => searchResults.length > 0 && setShowSearch(true)}
                  onBlur={() => setTimeout(() => setShowSearch(false), 200)}
                />
                {showSearch && searchResults.length > 0 && (
                  <div className="search-dropdown">
                    {searchResults.map(u => (
                      <div key={u.id} className="search-item" onMouseDown={() => handleSelectUser(u.username)}>
                        <div className="search-avatar">{u.username.charAt(0).toUpperCase()}</div>
                        <span>{u.username}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button type="submit">Add</button>
            </form>
            <div className="friends-label">Friends — {friends.length}</div>
            <div className="friends-list">
              {friends.map(friend => (
                <div key={friend.id} className="friend-item">
                  <div className="friend-avatar-small">{friend.username.charAt(0).toUpperCase()}</div>
                  <div className={`friend-status ${friend.status}`}></div>
                  <div className="friend-item-info">
                    <span className="friend-item-name">{friend.username}</span>
                    <span className={`friend-item-status ${friend.status}`}>{friend.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="channels-list">
              <div className="channel-category">
                <span>Text Channels</span>
                <button className="add-channel-btn" onClick={() => setShowCreateChannel(true)}>+</button>
              </div>
              {channels.filter(ch => ch.type === 'text').map(channel => (
                <div
                  key={channel.id}
                  className={`channel-item ${selectedChannel?.id === channel.id ? 'selected' : ''}`}
                  onClick={() => setSelectedChannel(channel)}
                >
                  # {channel.name}
                </div>
              ))}
            </div>

            <div className="channels-list">
              <div className="channel-category">
                <span>Voice Channels</span>
                <button className="add-channel-btn" onClick={() => { setNewChannelType('voice'); setShowCreateChannel(true); }}>+</button>
              </div>
              {channels.filter(ch => ch.type === 'voice').map(channel => {
                const usersInChannel = allVoiceChannels[channel.id] || [];
                return (
                  <div key={channel.id} className="voice-channel-group">
                    <div
                      className={`channel-item voice-channel ${connectedVoiceChannel === channel.id ? 'connected' : ''} ${usersInChannel.length > 0 ? 'has-users' : ''}`}
                      onClick={() => handleJoinVoiceChannel(channel.id)}
                    >
                      <svg className="voice-channel-svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 3a1 1 0 0 0-1-1h-.06a1 1 0 0 0-.74.32L5.92 7H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2.92l4.28 4.68a1 1 0 0 0 .74.32H11a1 1 0 0 0 1-1V3ZM15.1 20.75c-.58.14-1.1-.33-1.1-.92v-.03c0-.42.29-.77.67-.9a7.006 7.006 0 0 0 0-13.08.93.93 0 0 1-.67-.9v-.03c0-.6.52-1.06 1.1-.92a9.006 9.006 0 0 1 0 16.78Z"/>
                        <path d="M15.16 16.51c-.57.28-1.16-.2-1.16-.83v-.14c0-.43.28-.8.63-1.02a3.006 3.006 0 0 0 0-5.04c-.35-.23-.63-.6-.63-1.02v-.14c0-.63.59-1.1 1.16-.83a5.006 5.006 0 0 1 0 9.02Z"/>
                      </svg>
                      <span className="voice-channel-name">{channel.name}</span>
                    </div>
                    {usersInChannel.map(vu => (
                      <div key={vu.userid} className="voice-channel-user">
                        <div className={`voice-channel-user-avatar ${speakingUsers && speakingUsers[vu.userid] ? 'speaking' : ''}`}>
                          {vu.username?.charAt(0).toUpperCase()}
                        </div>
                        <span className="voice-channel-user-name">{vu.username}</span>
                      </div>
                    ))}
                    {connectedVoiceChannel === channel.id && (
                      <div className="voice-channel-invite" onClick={(e) => { e.stopPropagation(); handleCreateInvite(); }}>
                        Пригласить в голосовой чат
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Voice Channel Panel */}
        {connectedVoiceChannel && (
          <VoiceChannel
            channelId={connectedVoiceChannel}
            voiceUsers={voiceUsers}
            onLeave={handleLeaveVoiceChannel}
            remoteScreen={remoteScreen}
            onRemoteScreenChange={setRemoteScreen}
            onLocalScreenChange={setLocalScreenStream}
            isMuted={isMuted}
            setIsMuted={setIsMuted}
            isDeafened={isDeafened}
            setIsDeafened={setIsDeafened}
            onToggleMute={toggleMuteRef}
            onToggleDeafen={toggleDeafenRef}
            speakingUsers={speakingUsers}
          />
        )}

        {/* User panel */}
        <div className="user-panel">
          <div className="user-info">
            <div className="user-avatar-wrapper">
              <div className="user-avatar">{user.username.charAt(0).toUpperCase()}</div>
              <div className="user-status-dot"></div>
            </div>
            <div className="user-details">
              <span className="username">{user.username}</span>
              <span className="user-status">Online</span>
            </div>
          </div>
          {connectedVoiceChannel ? (
            <div className="user-panel-controls">
              <button
                className={`user-panel-btn ${isMuted ? 'active red' : ''}`}
                onClick={() => toggleMuteRef.current?.()}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  {isMuted ? (
                    <path d="M12 2C10.34 2 9 3.34 9 5V11C9 12.66 10.34 14 12 14C13.66 14 15 12.66 15 11V5C15 3.34 13.66 2 12 2ZM19 11C19 14.53 16.39 17.44 13 17.93V21H11V17.93C7.61 17.44 5 14.53 5 11H7C7 13.76 9.24 16 12 16C14.76 16 17 13.76 17 11H19Z" />
                  ) : (
                    <path d="M12 2C10.34 2 9 3.34 9 5V11C9 12.66 10.34 14 12 14C13.66 14 15 12.66 15 11V5C15 3.34 13.66 2 12 2ZM19 11C19 14.53 16.39 17.44 13 17.93V21H11V17.93C7.61 17.44 5 14.53 5 11H7C7 13.76 9.24 16 12 16C14.76 16 17 13.76 17 11H19Z" />
                  )}
                </svg>
              </button>
              <button
                className={`user-panel-btn ${isDeafened ? 'active red' : ''}`}
                onClick={() => toggleDeafenRef.current?.()}
                title={isDeafened ? 'Undeafen' : 'Deafen'}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  {isDeafened ? (
                    <path d="M12 2C6.48 2 2 6.48 2 12V20C2 21.1 2.9 22 4 22H8V12H4.5C4.5 7.31 7.81 4 12 4C16.19 4 19.5 7.31 19.5 12H16V22H20C21.1 22 22 21.1 22 20V12C22 6.48 17.52 2 12 2ZM7 14V18H5V14H7ZM19 18H17V14H19V18Z" />
                  ) : (
                    <path d="M12 2C6.48 2 2 6.48 2 12V20C2 21.1 2.9 22 4 22H8V12H4.5C4.5 7.31 7.81 4 12 4C16.19 4 19.5 7.31 19.5 12H16V22H20C21.1 22 22 21.1 22 20V12C22 6.48 17.52 2 12 2ZM7 14V18H5V14H7ZM19 18H17V14H19V18Z" />
                  )}
                </svg>
              </button>
              <button
                className="user-panel-btn disconnect"
                onClick={handleLeaveVoiceChannel}
                title="Disconnect"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 9C10.4 9 8.85 9.25 7.4 9.7V12.82C7.4 13.22 7.17 13.56 6.84 13.72C5.86 14.21 4.97 14.84 4.18 15.57C4 15.75 3.75 15.85 3.48 15.85C3.2 15.85 2.95 15.74 2.77 15.56L0.29 13.08C0.11 12.9 0 12.65 0 12.38C0 12.1 0.11 11.85 0.29 11.67C3.34 8.78 7.46 7 12 7C16.54 7 20.66 8.78 23.71 11.67C23.89 11.85 24 12.1 24 12.38C24 12.65 23.89 12.9 23.71 13.08L21.23 15.56C21.05 15.74 20.8 15.85 20.52 15.85C20.25 15.85 20 15.75 19.82 15.57C19.03 14.84 18.14 14.21 17.16 13.72C16.83 13.56 16.6 13.22 16.6 12.82V9.7C15.15 9.25 13.6 9 12 9Z" />
                </svg>
              </button>
            </div>
          ) : (
            <div className="user-panel-controls">
              <button className="user-panel-btn" onClick={logout} title="Log Out">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17 7L15.59 8.41L18.17 11H8V13H18.17L15.59 15.59L17 17L22 12L17 7ZM4 5H12V3H4C2.9 3 2 3.9 2 5V19C2 20.1 2.9 21 4 21H12V19H4V5Z" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="chat-area">
        {activeTab === 'friends' ? (
          <div className="friends-page">
            <h2>Friends</h2>
            <div className="friends-grid">
              {friends.map(friend => (
                <div key={friend.id} className="friend-card">
                  <div className="friend-avatar">{friend.username.charAt(0).toUpperCase()}</div>
                  <div className="friend-info">
                    <span className="friend-name">{friend.username}</span>
                    <span className={`friend-status-text ${friend.status}`}>{friend.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : selectedChannel ? (
          <>
            <div className="chat-header">
              <span className="channel-name"># {selectedChannel.name}</span>
              {remoteScreen && (
                <span className="screen-share-indicator">🖥️ Screen Share Active</span>
              )}
            </div>

            {remoteScreen && remoteScreen.stream ? (
              <div className="screen-share-center">
                <div className="screen-share-center-header">
                  <span>🖥️ Screen Share</span>
                  <button onClick={() => setRemoteScreen(null)}>✕ Close</button>
                </div>
                <video
                  autoPlay
                  playsInline
                  ref={el => { if (el) el.srcObject = remoteScreen.stream; }}
                  className="screen-share-center-video"
                />
              </div>
            ) : localScreenStream ? (
              <div className="screen-share-center">
                <div className="screen-share-center-header">
                  <span>🖥️ Your Screen</span>
                  <button onClick={() => {}}>✕ Close</button>
                </div>
                <video
                  autoPlay
                  playsInline
                  muted
                  ref={el => { if (el) el.srcObject = localScreenStream; }}
                  className="screen-share-center-video"
                />
              </div>
            ) : (
              <div className="messages-container">
                {messages.map(message => (
                  <div key={message.id} className="message">
                    <div className="message-avatar">{message.username?.charAt(0).toUpperCase()}</div>
                    <div className="message-content">
                      <div className="message-header">
                        <span className="message-author">{message.username}</span>
                        <span className="message-time">
                          {new Date(message.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="message-text">{message.content}</div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}

            {typingUsers.length > 0 && (
              <div className="typing-indicator">
                {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
              </div>
            )}

            <form className="message-form" onSubmit={handleSendMessage}>
              <input
                type="text"
                placeholder={`Message #${selectedChannel.name}`}
                value={newMessage}
                onChange={(e) => {
                  setNewMessage(e.target.value);
                  handleTyping();
                }}
              />
              <button type="submit">Send</button>
            </form>
          </>
        ) : (
          <div className="no-channel-selected">
            <h2>Welcome to RUCord!</h2>
            <p>Select a channel to start chatting</p>
          </div>
        )}
      </div>

      {/* Members sidebar */}
      <div className="members-sidebar">
        <div className="members-header">
          <h3>Members — {onlineUsers.length}</h3>
        </div>
        <div className="members-list">
          {friends.map(friend => (
            <div key={friend.id} className="member-item">
              <div className="member-avatar">{friend.username.charAt(0).toUpperCase()}</div>
              <div className="member-info">
                <span className="member-name">{friend.username}</span>
                <span className={`member-status ${friend.status}`}>{friend.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create Server Modal */}
      {showCreateServer && (
        <div className="modal-overlay" onClick={() => setShowCreateServer(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Create a Server</h2>
            <form onSubmit={handleCreateServer}>
              <input
                type="text"
                placeholder="Server Name"
                value={newServerName}
                onChange={(e) => setNewServerName(e.target.value)}
                required
              />
              <div className="modal-buttons">
                <button type="button" onClick={() => setShowCreateServer(false)}>Cancel</button>
                <button type="submit">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Channel Modal */}
      {showCreateChannel && (
        <div className="modal-overlay" onClick={() => setShowCreateChannel(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Create a Channel</h2>
            <form onSubmit={handleCreateChannel}>
              <input
                type="text"
                placeholder="Channel Name"
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                required
              />
              <div className="channel-type-selector">
                <label>
                  <input
                    type="radio"
                    name="channelType"
                    value="text"
                    checked={newChannelType === 'text'}
                    onChange={(e) => setNewChannelType(e.target.value)}
                  />
                  <span>Text</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="channelType"
                    value="voice"
                    checked={newChannelType === 'voice'}
                    onChange={(e) => setNewChannelType(e.target.value)}
                  />
                  <span>Voice</span>
                </label>
              </div>
              <div className="modal-buttons">
                <button type="button" onClick={() => setShowCreateChannel(false)}>Cancel</button>
                <button type="submit">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="modal-overlay" onClick={() => setShowInviteModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Join a Server</h2>
            <form onSubmit={handleJoinByInvite}>
              <input
                type="text"
                placeholder="Enter invite code"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                required
              />
              <div className="modal-buttons">
                <button type="button" onClick={() => setShowInviteModal(false)}>Cancel</button>
                <button type="submit">Join</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invite Link Popup */}
      {newInviteLink && (
        <div className="modal-overlay" onClick={() => setNewInviteLink('')}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Invite Created!</h2>
            <p>Share this link:</p>
            <input
              type="text"
              value={newInviteLink}
              readOnly
              onClick={(e) => {
                navigator.clipboard.writeText(newInviteLink);
                alert('Copied!');
              }}
              style={{ cursor: 'pointer' }}
            />
            <div className="modal-buttons">
              <button onClick={() => setNewInviteLink('')}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
