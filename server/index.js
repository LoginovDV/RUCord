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
    const existingUser = get('SELECT * FROM users WHERE email = ? OR username = ?', [email, username]);
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    run('INSERT INTO users (id, username, email, password) VALUES (?, ?, ?, ?)', [userId, username, email, hashedPassword]);
    const token = jwt.sign({ id: userId, username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: userId, username, email } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = get('SELECT * FROM users WHERE email = ? OR username = ?', [email, email]);
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

app.get('/api/auth/me', authenticateToken, (req, res) => {
  const user = get('SELECT id, username, email, avatar, status, customStatus FROM users WHERE id = ?', [req.user.id]);
  res.json(user);
});

// Server routes
app.post('/api/servers', authenticateToken, (req, res) => {
  try {
    const { name } = req.body;
    const serverId = uuidv4();
    const channelId = uuidv4();
    run('INSERT INTO servers (id, name, ownerId) VALUES (?, ?, ?)', [serverId, name, req.user.id]);
    run('INSERT INTO channels (id, name, type, serverId) VALUES (?, ?, ?, ?)', [channelId, 'general', 'text', serverId]);
    run('INSERT INTO server_members (id, userId, serverId, role) VALUES (?, ?, ?, ?)', [uuidv4(), req.user.id, serverId, 'owner']);
    const srv = get('SELECT * FROM servers WHERE id = ?', [serverId]);
    res.json(srv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/servers', authenticateToken, (req, res) => {
  const servers = all(`
    SELECT s.* FROM servers s
    INNER JOIN server_members sm ON s.id = sm.serverId
    WHERE sm.userId = ?
  `, [req.user.id]);
  res.json(servers);
});

app.post('/api/servers/:serverId/join', authenticateToken, (req, res) => {
  try {
    const { serverId } = req.params;
    const srv = get('SELECT * FROM servers WHERE id = ?', [serverId]);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const existing = get('SELECT * FROM server_members WHERE userId = ? AND serverId = ?', [req.user.id, serverId]);
    if (existing) return res.status(400).json({ error: 'Already a member' });
    run('INSERT INTO server_members (id, userId, serverId) VALUES (?, ?, ?)', [uuidv4(), req.user.id, serverId]);
    res.json({ message: 'Joined server' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Invite routes
app.post('/api/servers/:serverId/invites', authenticateToken, (req, res) => {
  try {
    const { serverId } = req.params;
    const member = get('SELECT * FROM server_members WHERE userId = ? AND serverId = ?', [req.user.id, serverId]);
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const code = Math.random().toString(36).substring(2, 10);
    const inviteId = uuidv4();
    run('INSERT INTO invites (id, code, serverId, createdBy) VALUES (?, ?, ?, ?)', [inviteId, code, serverId, req.user.id]);

    const invite = get('SELECT * FROM invites WHERE id = ?', [inviteId]);
    res.json(invite);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/servers/:serverId/invites', authenticateToken, (req, res) => {
  const invites = all('SELECT * FROM invites WHERE serverId = ?', [req.params.serverId]);
  res.json(invites);
});

app.post('/api/invites/:code/join', authenticateToken, (req, res) => {
  try {
    const invite = get('SELECT * FROM invites WHERE code = ?', [req.params.code]);
    if (!invite) return res.status(404).json({ error: 'Invalid invite' });

    if (invite.maxUses && invite.uses >= invite.maxUses) {
      return res.status(400).json({ error: 'Invite expired' });
    }

    const existing = get('SELECT * FROM server_members WHERE userId = ? AND serverId = ?', [req.user.id, invite.serverId]);
    if (existing) {
      const server = get('SELECT * FROM servers WHERE id = ?', [invite.serverId]);
      return res.json(server);
    }

    run('INSERT INTO server_members (id, userId, serverId) VALUES (?, ?, ?)', [uuidv4(), req.user.id, invite.serverId]);
    run('UPDATE invites SET uses = uses + 1 WHERE id = ?', [invite.id]);

    const server = get('SELECT * FROM servers WHERE id = ?', [invite.serverId]);
    res.json(server);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Channel routes
app.get('/api/servers/:serverId/channels', authenticateToken, (req, res) => {
  const channels = all('SELECT * FROM channels WHERE serverId = ?', [req.params.serverId]);
  res.json(channels);
});

app.post('/api/servers/:serverId/channels', authenticateToken, (req, res) => {
  try {
    const { name, type = 'text' } = req.body;
    const channelId = uuidv4();
    run('INSERT INTO channels (id, name, type, serverId) VALUES (?, ?, ?, ?)', [channelId, name, type, req.params.serverId]);
    const channel = get('SELECT * FROM channels WHERE id = ?', [channelId]);
    res.json(channel);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Message routes
app.get('/api/channels/:channelId/messages', authenticateToken, (req, res) => {
  const messages = all(`
    SELECT m.*, u.username, u.avatar
    FROM messages m
    INNER JOIN users u ON m.authorId = u.id
    WHERE m.channelId = ?
    ORDER BY m.createdAt DESC
    LIMIT 50
  `, [req.params.channelId]);
  res.json(messages.reverse());
});

// Friend routes
app.get('/api/friends', authenticateToken, (req, res) => {
  const friends = all(`
    SELECT u.id, u.username, u.avatar, u.status
    FROM friends f
    INNER JOIN users u ON (f.friendId = u.id OR f.userId = u.id)
    WHERE (f.userId = ? OR f.friendId = ?) AND f.status = 'accepted'
    AND u.id != ?
  `, [req.user.id, req.user.id, req.user.id]);
  res.json(friends);
});

app.post('/api/friends/add', authenticateToken, (req, res) => {
  try {
    const { username } = req.body;
    const friend = get('SELECT * FROM users WHERE username = ?', [username]);
    if (!friend) return res.status(404).json({ error: 'User not found' });
    if (friend.id === req.user.id) return res.status(400).json({ error: 'Cannot add yourself' });
    const existing = get(
      'SELECT * FROM friends WHERE (userId = ? AND friendId = ?) OR (userId = ? AND friendId = ?)',
      [req.user.id, friend.id, friend.id, req.user.id]
    );
    if (existing) return res.status(400).json({ error: 'Friend request already exists' });
    run('INSERT INTO friends (id, userId, friendId, status) VALUES (?, ?, ?, ?)', [uuidv4(), req.user.id, friend.id, 'accepted']);
    res.json({ message: 'Friend added' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Socket.io
const users = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('user_online', (userId) => {
    users.set(userId, socket.id);
    run('UPDATE users SET status = ? WHERE id = ?', ['online', userId]);
    io.emit('user_status_change', { userId, status: 'online' });
  });

  socket.on('join_channel', (channelId) => {
    socket.join(channelId);
  });

  socket.on('leave_channel', (channelId) => {
    socket.leave(channelId);
  });

  socket.on('send_message', (data) => {
    const { channelId, content, authorId } = data;
    const messageId = uuidv4();
    run('INSERT INTO messages (id, content, authorId, channelId) VALUES (?, ?, ?, ?)', [messageId, content, authorId, channelId]);
    const message = get(`
      SELECT m.*, u.username, u.avatar
      FROM messages m
      INNER JOIN users u ON m.authorId = u.id
      WHERE m.id = ?
    `, [messageId]);
    io.to(channelId).emit('new_message', message);
  });

  socket.on('typing', (data) => {
    socket.to(data.channelId).emit('user_typing', { username: data.username, channelId: data.channelId });
  });

  socket.on('stop_typing', (data) => {
    socket.to(data.channelId).emit('user_stop_typing', { username: data.username, channelId: data.channelId });
  });

  socket.on('join_voice_channel', (data) => {
    const { channelId, userId } = data;
    socket.join(`voice_${channelId}`);
    run('INSERT INTO voice_channels (id, channelId, userId, socketId) VALUES (?, ?, ?, ?)', [uuidv4(), channelId, userId, socket.id]);
    const voiceUsers = all('SELECT vc.*, u.username FROM voice_channels vc INNER JOIN users u ON vc.userId = u.id WHERE vc.channelId = ?', [channelId]);
    io.to(`voice_${channelId}`).emit('voice_users_update', voiceUsers);
  });

  socket.on('leave_voice_channel', (data) => {
    const { channelId, userId } = data;
    socket.leave(`voice_${channelId}`);
    run('DELETE FROM voice_channels WHERE channelId = ? AND userId = ?', [channelId, userId]);
    const voiceUsers = all('SELECT vc.*, u.username FROM voice_channels vc INNER JOIN users u ON vc.userId = u.id WHERE vc.channelId = ?', [channelId]);
    io.to(`voice_${channelId}`).emit('voice_users_update', voiceUsers);
  });

  // WebRTC signaling
  socket.on('voice_offer', (data) => {
    const { to, offer, from } = data;
    console.log(`Voice offer from ${from} to ${to}`);
    console.log('Users map:', [...users.entries()]);
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

  socket.on('disconnect', () => {
    for (const [userId, socketId] of users.entries()) {
      if (socketId === socket.id) {
        users.delete(userId);
        run('UPDATE users SET status = ? WHERE id = ?', ['offline', userId]);
        io.emit('user_status_change', { userId, status: 'offline' });
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
