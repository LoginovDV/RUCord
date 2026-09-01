const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || '62.173.148.71',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'rucordbase',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'Alena71980324!',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const COLUMN_MAP = {
  serverid: 'serverId',
  userid: 'userId',
  channelid: 'channelId',
  authorid: 'authorId',
  createdby: 'createdBy',
  maxuses: 'maxUses',
  socketid: 'socketId',
  customstatus: 'customStatus',
  joinedat: 'joinedAt',
  createdat: 'createdAt',
  ownerid: 'ownerId',
};

function mapRow(row) {
  if (!row) return row;
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    result[COLUMN_MAP[key] || key] = value;
  }
  return result;
}

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT DEFAULT NULL,
      status TEXT DEFAULT 'online',
      customStatus TEXT DEFAULT NULL,
      createdAt TEXT DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT DEFAULT NULL,
      ownerId TEXT NOT NULL,
      createdAt TEXT DEFAULT NOW(),
      FOREIGN KEY (ownerId) REFERENCES users(id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'text',
      serverId TEXT NOT NULL,
      createdAt TEXT DEFAULT NOW(),
      FOREIGN KEY (serverId) REFERENCES servers(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      authorId TEXT NOT NULL,
      channelId TEXT NOT NULL,
      createdAt TEXT DEFAULT NOW(),
      FOREIGN KEY (authorId) REFERENCES users(id),
      FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS server_members (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      serverId TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      joinedAt TEXT DEFAULT NOW(),
      FOREIGN KEY (userId) REFERENCES users(id),
      FOREIGN KEY (serverId) REFERENCES servers(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS friends (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      friendId TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      createdAt TEXT DEFAULT NOW(),
      FOREIGN KEY (userId) REFERENCES users(id),
      FOREIGN KEY (friendId) REFERENCES users(id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS voice_channels (
      id TEXT PRIMARY KEY,
      channelId TEXT NOT NULL,
      userId TEXT NOT NULL,
      socketId TEXT NOT NULL,
      FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      serverId TEXT NOT NULL,
      createdBy TEXT NOT NULL,
      uses INTEGER DEFAULT 0,
      maxUses INTEGER DEFAULT NULL,
      createdAt TEXT DEFAULT NOW(),
      FOREIGN KEY (serverId) REFERENCES servers(id) ON DELETE CASCADE,
      FOREIGN KEY (createdBy) REFERENCES users(id)
    )
  `);

  console.log('PostgreSQL database initialized');
  return pool;
}

function convertPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function get(sql, params = []) {
  const converted = convertPlaceholders(sql);
  const result = await pool.query(converted, params);
  return mapRow(result.rows[0]) || null;
}

async function all(sql, params = []) {
  const converted = convertPlaceholders(sql);
  const result = await pool.query(converted, params);
  return result.rows.map(mapRow);
}

async function run(sql, params = []) {
  const converted = convertPlaceholders(sql);
  return pool.query(converted, params);
}

module.exports = { initDatabase, get, all, run, pool };
