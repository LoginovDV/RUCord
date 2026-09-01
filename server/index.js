const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { initDatabase, get, all, run } = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const JWT_SECRET = process.env.JWT_SECRET || 'rucord-secret-key-2024';
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"]
}));
app.use(express.json());

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const existingUser = await get('SELECT * FROM users WHERE email = $1 OR username = $2', [email, username]);
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    await run('INSERT INTO users (id, username, email, password) VALUES ($1, $2, $3, $4)', [userId, username, email, hashedPassword]);
    const token = jwt.sign({ id: userId, username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: userId, username, email } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await get('SELECT * FROM users WHERE email = $1 OR username = $2', [email, email]);
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid password' });
    }
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  const user = await get('SELECT id, username, email, avatar, status, customstatus FROM users WHERE id = $1', [req.user.id]);
  res.json(user);
});

// Server routes
app.post('/api/servers', authenticateToken, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    const existing = await get('SELECT * FROM servers WHERE name = $1 AND ownerid = $2', [name.trim(), req.user.id]);
    if (existing) {
      return res.status(400).json({ error: 'You already have a server with this name' });
    }
    const serverId = uuidv4();
    const channelId = uuidv4();
    await run('INSERT INTO servers (id, name, ownerid) VALUES ($1, $2, $3)', [serverId, name, req.user.id]);
    await run('INSERT INTO channels (id, name, type, serverid) VALUES ($1, $2, $3, $4)', [channelId, 'general', 'text', serverId]);
    await run('INSERT INTO server_members (id, userid, serverid, role) VALUES ($1, $2, $3, $4)', [uuidv4(), req.user.id, serverId, 'owner']);
    const srv = await get('SELECT * FROM servers WHERE id = $1', [serverId]);
    const channel = await get('SELECT * FROM channels WHERE id = $1', [channelId]);
    io.emit('server_created', srv);
    io.emit('channel_created', channel);
    res.json(srv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/servers', authenticateToken, async (req, res) => {
  const servers = await all(`
    SELECT s.* FROM servers s
    INNER JOIN server_members sm ON s.id = sm.serverid
    WHERE sm.userid = $1
  `, [req.user.id]);
  res.json(servers);
});

app.get('/api/voice-channels', authenticateToken, async (req, res) => {
  const allVoiceState = await all(`
    SELECT vc.channelid, vc.userid, u.username 
    FROM voice_channels vc 
    INNER JOIN users u ON vc.userid = u.id
  `);
  res.json(allVoiceState);
});

app.get('/api/all-channels', authenticateToken, async (req, res) => {
  const channelsList = await all(`
    SELECT c.* FROM channels c
    INNER JOIN server_members sm ON c.serverid = sm.serverid
    WHERE sm.userid = $1
  `, [req.user.id]);
  res.json(channelsList);
});

app.post('/api/servers/:serverId/join', authenticateToken, async (req, res) => {
  try {
    const { serverId } = req.params;
    const srv = await get('SELECT * FROM servers WHERE id = $1', [serverId]);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const existing = await get('SELECT * FROM server_members WHERE userid = $1 AND serverid = $2', [req.user.id, serverId]);
    if (existing) return res.status(400).json({ error: 'Already a member' });
    await run('INSERT INTO server_members (id, userid, serverid) VALUES ($1, $2, $3)', [uuidv4(), req.user.id, serverId]);
    res.json({ message: 'Joined server' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Server edit/delete routes
app.put('/api/servers/:serverId', authenticateToken, async (req, res) => {
  try {
    const { name } = req.body;
    const srv = await get('SELECT * FROM servers WHERE id = $1', [req.params.serverId]);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const serverOwnerId = srv.ownerId || srv.ownerid;
    if (serverOwnerId !== req.user.id) return res.status(403).json({ error: 'Only the server owner can edit' });
    if (name !== undefined && name.trim()) {
      const existing = await get('SELECT * FROM servers WHERE name = $1 AND ownerid = $2 AND id != $3', [name.trim(), req.user.id, req.params.serverId]);
      if (existing) return res.status(400).json({ error: 'You already have a server with this name' });
      await run('UPDATE servers SET name = $1 WHERE id = $2', [name.trim(), req.params.serverId]);
    }
    const updated = await get('SELECT * FROM servers WHERE id = $1', [req.params.serverId]);
    io.emit('server_updated', updated);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/servers/:serverId/avatar', authenticateToken, async (req, res) => {
  try {
    const srv = await get('SELECT * FROM servers WHERE id = $1', [req.params.serverId]);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const serverOwnerId = srv.ownerId || srv.ownerid;
    if (serverOwnerId !== req.user.id) return res.status(403).json({ error: 'Only the server owner can edit' });
    const { avatar } = req.body;
    await run('UPDATE servers SET avatar = $1 WHERE id = $2', [avatar, req.params.serverId]);
    const updated = await get('SELECT * FROM servers WHERE id = $1', [req.params.serverId]);
    io.emit('server_updated', updated);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/servers/:serverId', authenticateToken, async (req, res) => {
  try {
    const srv = await get('SELECT * FROM servers WHERE id = $1', [req.params.serverId]);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const serverOwnerId = srv.ownerId || srv.ownerid;
    if (serverOwnerId !== req.user.id) return res.status(403).json({ error: 'Only the server owner can delete' });
    await run('DELETE FROM servers WHERE id = $1', [req.params.serverId]);
    io.emit('server_deleted', { id: req.params.serverId });
    res.json({ message: 'Server deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Invite routes
app.post('/api/servers/:serverId/invites', authenticateToken, async (req, res) => {
  try {
    const { serverId } = req.params;
    const member = await get('SELECT * FROM server_members WHERE userid = $1 AND serverid = $2', [req.user.id, serverId]);
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const code = Math.random().toString(36).substring(2, 10);
    const inviteId = uuidv4();
    await run('INSERT INTO invites (id, code, serverid, createdby) VALUES ($1, $2, $3, $4)', [inviteId, code, serverId, req.user.id]);

    const invite = await get('SELECT * FROM invites WHERE id = $1', [inviteId]);
    res.json(invite);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/servers/:serverId/invites', authenticateToken, async (req, res) => {
  const invites = await all('SELECT * FROM invites WHERE serverid = $1', [req.params.serverId]);
  res.json(invites);
});

app.post('/api/invites/:code/join', authenticateToken, async (req, res) => {
  try {
    const invite = await get('SELECT * FROM invites WHERE code = $1', [req.params.code]);
    if (!invite) return res.status(404).json({ error: 'Invalid invite' });

    if (invite.maxUses && invite.uses >= invite.maxUses) {
      return res.status(400).json({ error: 'Invite expired' });
    }

    const existing = await get('SELECT * FROM server_members WHERE userid = $1 AND serverid = $2', [req.user.id, invite.serverId]);
    if (existing) {
      const srv = await get('SELECT * FROM servers WHERE id = $1', [invite.serverId]);
      return res.json(srv);
    }

    await run('INSERT INTO server_members (id, userid, serverid) VALUES ($1, $2, $3)', [uuidv4(), req.user.id, invite.serverId]);
    await run('UPDATE invites SET uses = uses + 1 WHERE id = $1', [invite.id]);

    const srv = await get('SELECT * FROM servers WHERE id = $1', [invite.serverId]);
    res.json(srv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Channel routes
app.get('/api/servers/:serverId/channels', authenticateToken, async (req, res) => {
  const channels = await all('SELECT * FROM channels WHERE serverid = $1', [req.params.serverId]);
  res.json(channels);
});

app.post('/api/servers/:serverId/channels', authenticateToken, async (req, res) => {
  try {
    const { name, type = 'text' } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    const server = await get('SELECT * FROM servers WHERE id = $1', [req.params.serverId]);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    const member = await get('SELECT * FROM server_members WHERE userid = $1 AND serverid = $2', [req.user.id, req.params.serverId]);
    if (!member) return res.status(403).json({ error: 'Not a member' });
    const serverOwnerId = server.ownerId || server.ownerid;
    if (serverOwnerId !== req.user.id && member.role !== 'admin') {
      return res.status(403).json({ error: 'Only the server owner or admin can create channels' });
    }
    const existing = await get('SELECT * FROM channels WHERE name = $1 AND serverid = $2', [name.trim(), req.params.serverId]);
    if (existing) return res.status(400).json({ error: 'Channel already exists' });
    const channelId = uuidv4();
    await run('INSERT INTO channels (id, name, type, serverid) VALUES ($1, $2, $3, $4)', [channelId, name, type, req.params.serverId]);
    const channel = await get('SELECT * FROM channels WHERE id = $1', [channelId]);
    io.emit('channel_created', channel);
    res.json(channel);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Channel edit/delete routes
app.put('/api/channels/:channelId', authenticateToken, async (req, res) => {
  try {
    const { name, description } = req.body;
    const channel = await get('SELECT * FROM channels WHERE id = $1', [req.params.channelId]);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    const server = await get('SELECT * FROM servers WHERE id = $1', [channel.serverId]);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    if (server.ownerId !== req.user.id) return res.status(403).json({ error: 'Only the server owner can edit channels' });
    if (name !== undefined) {
      const existing = await get('SELECT * FROM channels WHERE name = $1 AND serverid = $2 AND id != $3', [name.trim(), channel.serverId, req.params.channelId]);
      if (existing) return res.status(400).json({ error: 'Channel name already exists' });
      await run('UPDATE channels SET name = $1 WHERE id = $2', [name.trim(), req.params.channelId]);
    }
    if (description !== undefined) {
      await run('UPDATE channels SET description = $1 WHERE id = $2', [description, req.params.channelId]);
    }
    const updated = await get('SELECT * FROM channels WHERE id = $1', [req.params.channelId]);
    io.emit('channel_updated', updated);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/channels/:channelId/avatar', authenticateToken, async (req, res) => {
  try {
    const channel = await get('SELECT * FROM channels WHERE id = $1', [req.params.channelId]);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    const server = await get('SELECT * FROM servers WHERE id = $1', [channel.serverId]);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    if (server.ownerId !== req.user.id) return res.status(403).json({ error: 'Only the server owner can edit channels' });
    const { avatar } = req.body;
    await run('UPDATE channels SET avatar = $1 WHERE id = $2', [avatar, req.params.channelId]);
    const updated = await get('SELECT * FROM channels WHERE id = $1', [req.params.channelId]);
    io.emit('channel_updated', updated);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/channels/:channelId', authenticateToken, async (req, res) => {
  try {
    const channel = await get('SELECT * FROM channels WHERE id = $1', [req.params.channelId]);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    const server = await get('SELECT * FROM servers WHERE id = $1', [channel.serverId]);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    if (server.ownerId !== req.user.id) return res.status(403).json({ error: 'Only the server owner can delete channels' });
    await run('DELETE FROM channels WHERE id = $1', [req.params.channelId]);
    io.emit('channel_deleted', { id: req.params.channelId, serverId: channel.serverId });
    res.json({ message: 'Channel deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get('/api/channels/:channelId/messages', authenticateToken, async (req, res) => {
  const messages = await all(`
    SELECT m.*, u.username, u.avatar
    FROM messages m
    INNER JOIN users u ON m.authorid = u.id
    WHERE m.channelid = $1
    ORDER BY m.createdat DESC
    LIMIT 50
  `, [req.params.channelId]);
  res.json(messages.reverse());
});

// Friend routes
app.get('/api/friends', authenticateToken, async (req, res) => {
  const friends = await all(`
    SELECT u.id, u.username, u.avatar, u.status
    FROM friends f
    INNER JOIN users u ON (f.friendid = u.id OR f.userid = u.id)
    WHERE (f.userid = $1 OR f.friendid = $2) AND f.status = 'accepted'
    AND u.id != $3
  `, [req.user.id, req.user.id, req.user.id]);
  res.json(friends);
});

app.post('/api/friends/add', authenticateToken, async (req, res) => {
  try {
    const { username } = req.body;
    const friend = await get('SELECT * FROM users WHERE username = $1', [username]);
    if (!friend) return res.status(404).json({ error: 'User not found' });
    if (friend.id === req.user.id) return res.status(400).json({ error: 'Cannot add yourself' });
    const existing = await get(
      'SELECT * FROM friends WHERE (userid = $1 AND friendid = $2) OR (userid = $3 AND friendid = $4)',
      [req.user.id, friend.id, friend.id, req.user.id]
    );
    if (existing) return res.status(400).json({ error: 'Friend request already exists' });
    await run('INSERT INTO friends (id, userid, friendid, status) VALUES ($1, $2, $3, $4)', [uuidv4(), req.user.id, friend.id, 'accepted']);
    const targetSocketId = users.get(friend.id);
    if (targetSocketId) {
      io.to(targetSocketId).emit('friend_added');
    }
    res.json({ message: 'Friend added' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users/search', authenticateToken, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 1) return res.json([]);
    const users = await all(
      'SELECT id, username FROM users WHERE username ILIKE $1 AND id != $2 LIMIT 5',
      [`%${q}%`, req.user.id]
    );
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Socket.io
const users = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('user_online', async (userId) => {
    users.set(userId, socket.id);
    await run('UPDATE users SET status = $1 WHERE id = $2', ['online', userId]);
    io.emit('user_status_change', { userId, status: 'online' });
    const allVoiceState = await all('SELECT channelid, userid FROM voice_channels');
    socket.emit('all_voice_channels_update', allVoiceState);
  });

  socket.on('join_channel', (channelId) => {
    socket.join(channelId);
  });

  socket.on('leave_channel', (channelId) => {
    socket.leave(channelId);
  });

  socket.on('send_message', async (data) => {
    const { channelId, content, authorId } = data;
    const messageId = uuidv4();
    await run('INSERT INTO messages (id, content, authorid, channelid) VALUES ($1, $2, $3, $4)', [messageId, content, authorId, channelId]);
    const message = await get(`
      SELECT m.*, u.username, u.avatar
      FROM messages m
      INNER JOIN users u ON m.authorid = u.id
      WHERE m.id = $1
    `, [messageId]);
    io.to(channelId).emit('new_message', message);
  });

  socket.on('typing', (data) => {
    socket.to(data.channelId).emit('user_typing', { username: data.username, channelId: data.channelId });
  });

  socket.on('stop_typing', (data) => {
    socket.to(data.channelId).emit('user_stop_typing', { username: data.username, channelId: data.channelId });
  });

  socket.on('join_voice_channel', async (data) => {
    const { channelId, userId } = data;
    socket.join(`voice_${channelId}`);
    await run('INSERT INTO voice_channels (id, channelid, userid, socketid) VALUES ($1, $2, $3, $4)', [uuidv4(), channelId, userId, socket.id]);
    const voiceUsers = await all('SELECT vc.*, u.username FROM voice_channels vc INNER JOIN users u ON vc.userid = u.id WHERE vc.channelid = $1', [channelId]);
    io.to(`voice_${channelId}`).emit('voice_users_update', voiceUsers);
    const allVoiceState = await all(`
      SELECT vc.channelid, vc.userid, u.username 
      FROM voice_channels vc 
      INNER JOIN users u ON vc.userid = u.id
    `);
    io.emit('all_voice_channels_update', allVoiceState);
  });

  socket.on('leave_voice_channel', async (data) => {
    const { channelId, userId } = data;
    socket.leave(`voice_${channelId}`);
    await run('DELETE FROM voice_channels WHERE channelid = $1 AND userid = $2', [channelId, userId]);
    const voiceUsers = await all('SELECT vc.*, u.username FROM voice_channels vc INNER JOIN users u ON vc.userid = u.id WHERE vc.channelid = $1', [channelId]);
    io.to(`voice_${channelId}`).emit('voice_users_update', voiceUsers);
    const allVoiceState = await all(`
      SELECT vc.channelid, vc.userid, u.username 
      FROM voice_channels vc 
      INNER JOIN users u ON vc.userid = u.id
    `);
    io.emit('all_voice_channels_update', allVoiceState);
  });

  socket.on('user_speaking', (data) => {
    const { channelId, userId, speaking } = data;
    socket.to(`voice_${channelId}`).emit('user_speaking', { userId, speaking });
  });

  // WebRTC signaling
  socket.on('voice_offer', (data) => {
    const { to, offer, from } = data;
    console.log(`Voice offer from ${from} to ${to}`);
    const targetSocketId = users.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('voice_offer', { from, offer, socketId: socket.id });
    } else {
      console.log(`Target ${to} not found in users map`);
    }
  });

  socket.on('voice_answer', (data) => {
    const { to, answer, from } = data;
    const targetSocketId = users.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('voice_answer', { from, answer, socketId: socket.id });
    }
  });

  socket.on('voice_ice_candidate', (data) => {
    const { to, candidate, from } = data;
    const targetSocketId = users.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('voice_ice_candidate', { from, candidate, socketId: socket.id });
    }
  });

  // Screen share signaling
  socket.on('screen_share_start', (data) => {
    const { channelId, from } = data;
    socket.to(`voice_${channelId}`).emit('screen_share_start', { from, socketId: socket.id });
  });

  socket.on('screen_share_stop', (data) => {
    const { channelId, from } = data;
    socket.to(`voice_${channelId}`).emit('screen_share_stop', { from });
  });

  socket.on('screen_request', (data) => {
    const { to, from } = data;
    const targetSocketId = users.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('screen_request', { from });
    }
  });

  socket.on('screen_offer', (data) => {
    const { to, offer, from } = data;
    const targetSocketId = users.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('screen_offer', { from, offer, socketId: socket.id });
    }
  });

  socket.on('screen_answer', (data) => {
    const { to, answer, from } = data;
    const targetSocketId = users.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('screen_answer', { from, answer, socketId: socket.id });
    }
  });

  socket.on('screen_ice_candidate', (data) => {
    const { to, candidate, from } = data;
    const targetSocketId = users.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('screen_ice_candidate', { from, candidate, socketId: socket.id });
    }
  });

  socket.on('disconnect', async () => {
    for (const [userId, socketId] of users.entries()) {
      if (socketId === socket.id) {
        users.delete(userId);
        await run('UPDATE users SET status = $1 WHERE id = $2', ['offline', userId]);
        io.emit('user_status_change', { userId, status: 'offline' });
        const leftChannels = await all('SELECT channelid FROM voice_channels WHERE userid = $1', [userId]);
        await run('DELETE FROM voice_channels WHERE userid = $1', [userId]);
        for (const ch of leftChannels) {
          const voiceUsers = await all('SELECT vc.*, u.username FROM voice_channels vc INNER JOIN users u ON vc.userid = u.id WHERE vc.channelid = $1', [ch.channelid]);
          io.to(`voice_${ch.channelid}`).emit('voice_users_update', voiceUsers);
        }
        if (leftChannels.length > 0) {
          const allVoiceState = await all(`
            SELECT vc.channelid, vc.userid, u.username 
            FROM voice_channels vc 
            INNER JOIN users u ON vc.userid = u.id
          `);
          io.emit('all_voice_channels_update', allVoiceState);
        }
        break;
      }
    }
    console.log('User disconnected:', socket.id);
  });
});

const clientBuild = path.join(__dirname, '..', 'client', 'build');
app.use(express.static(clientBuild));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientBuild, 'index.html'));
});

async function start() {
  await initDatabase();
  server.listen({ port: PORT, reuseAddress: true }, () => {
    console.log(`RUCord server running on port ${PORT}`);
  });
}

start();
