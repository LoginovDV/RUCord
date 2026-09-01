import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useAuth, useSocket } from '../App';
import VoiceChannel from './VoiceChannel';
import './Dashboard.css';

const API_URL = window.location.origin;

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
  const [activeTab, setActiveTab] = useState('servers');
  const [newFriendUsername, setNewFriendUsername] = useState('');
  const [connectedVoiceChannel, setConnectedVoiceChannel] = useState(null);
  const [voiceUsers, setVoiceUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [newInviteLink, setNewInviteLink] = useState('');
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    loadServers();
    loadFriends();
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

    return () => {
      socket.off('new_message');
      socket.off('user_typing');
      socket.off('user_stop_typing');
      socket.off('user_status_change');
      socket.off('voice_users_update');
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
    }
  };

  const handleAddFriend = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/api/friends/add`, { username: newFriendUsername });
      loadFriends();
      setNewFriendUsername('');
    } catch (error) {
      console.error('Error adding friend:', error);
    }
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
            <div className="add-friend-form">
              <input
                type="text"
                placeholder="Add friend by username"
                value={newFriendUsername}
                onChange={(e) => setNewFriendUsername(e.target.value)}
              />
              <button onClick={handleAddFriend}>Add</button>
            </div>
            <div className="friends-list">
              {friends.map(friend => (
                <div key={friend.id} className="friend-item">
                  <div className={`friend-status ${friend.status}`}></div>
                  <span>{friend.username}</span>
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
              {channels.filter(ch => ch.type === 'voice').map(channel => (
                <div
                  key={channel.id}
                  className={`channel-item voice-channel ${connectedVoiceChannel === channel.id ? 'connected' : ''}`}
                  onClick={() => handleJoinVoiceChannel(channel.id)}
                >
                  🔊 {channel.name}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Voice Channel Panel */}
        {connectedVoiceChannel && activeTab !== 'friends' && (
          <VoiceChannel
            channelId={connectedVoiceChannel}
            voiceUsers={voiceUsers}
            onLeave={handleLeaveVoiceChannel}
          />
        )}

        {/* User panel */}
        <div className="user-panel">
          <div className="user-info">
            <div className="user-avatar">{user.username.charAt(0).toUpperCase()}</div>
            <div className="user-details">
              <span className="username">{user.username}</span>
              <span className="user-status">Online</span>
            </div>
          </div>
          <button className="logout-btn" onClick={logout}>×</button>
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
            </div>

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
