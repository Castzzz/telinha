/**
 * server.js - Telinha Signaling & Channel Server
 * Discord / TeamSpeak style voice & screen sharing architecture
 */

import express from 'express';
import http from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { randomUUID, createHash, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Process-Level Defensive Error Boundaries
process.on('uncaughtException', (err) => {
  console.error('💥 [Server Process] Trapped uncaught exception:', err?.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [Server Process] Trapped unhandled rejection:', reason);
});

const PORT = Number(process.env.PORT) || 8080;
// Com SFU_SECRET (servidor na nuvem), as transmissões de tela passam pelo SFU em Go
// (atrás do mesmo endereço, em /sfu/): quem transmite manda o vídeo uma vez só.
const SFU_SECRET = process.env.SFU_SECRET || '';
const SFU_PATH = process.env.SFU_PATH || '/sfu/ws';
const PUBLIC_DIR = path.join(import.meta.dirname, 'public');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e7 // 10MB
});

// Middleware for method validation on static files
app.use((req, res, next) => {
  if (req.method === 'POST' && (req.path === '/' || req.path.endsWith('.html') || req.path.endsWith('.css') || req.path.endsWith('.js'))) {
    return res.status(405).send('Method Not Allowed');
  }
  next();
});

// Serve static assets from public/
app.use(express.static(PUBLIC_DIR));

// ----------------------------------------------------
// Signaling / Compatibility Endpoints & Raw WebSocket Handler
// ----------------------------------------------------
const ROOM_RE = /^[\w-]{1,64}$/;

function wsFrame(opcode, payload = Buffer.alloc(0)) {
  const len = payload.length;
  let head;
  if (len < 126) {
    head = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, payload]);
}

function wsAccept(req, socket, onText) {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);

  let buf = Buffer.alloc(0);
  let fragments = [];
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80;
      const opcode = buf[0] & 0x0f;
      const maskLen = buf[1] & 0x80 ? 4 : 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      if (len > 1 << 20) return socket.destroy();
      if (buf.length < off + maskLen + len) return;

      const mask = buf.subarray(off, off + maskLen);
      const payload = Buffer.from(buf.subarray(off + maskLen, off + maskLen + len));
      if (maskLen) for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      buf = buf.subarray(off + maskLen + len);

      if (opcode === 0x8) return socket.end(wsFrame(0x8)); // close
      if (opcode === 0x9) socket.write(wsFrame(0xa, payload)); // ping -> pong
      else if (opcode === 0x1 || opcode === 0x0) {
        fragments.push(payload);
        if (fin) {
          const text = Buffer.concat(fragments).toString();
          fragments = [];
          if (onText) onText(text);
        }
      }
    }
  });
  socket.on('error', () => socket.destroy());
}

// Attach upgrade listener for /ws endpoint
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/ws' && req.headers.upgrade?.toLowerCase() === 'websocket') {
    const sala = url.searchParams.get('sala') ?? '';
    if (!ROOM_RE.test(sala)) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    wsAccept(req, socket, (text) => {
      // Raw WebSocket message handler (if used)
    });
  }
});

// Endpoint for checking WS compatibility & room validation over HTTP (T2.1.2)
app.all('/ws', (req, res) => {
  const sala = req.query.sala;
  if (!sala || !ROOM_RE.test(sala)) {
    return res.status(400).send('Invalid room name');
  }
  return res.status(426).send('Upgrade Required');
});

// ----------------------------------------------------
// Data Store: Channels & Users
// ----------------------------------------------------

const USER_COLORS = [
  '#5865F2', // Discord Blurple
  '#57F287', // Discord Green
  '#FEE75C', // Discord Yellow
  '#EB459E', // Discord Fuchsia
  '#ED4245', // Discord Red
  '#F47B67', // Discord Coral
  '#9B84EC', // Discord Lavender
  '#00A8FC'  // Discord Cyan
];

const DEFAULT_CHANNELS = [
  { id: 'geral', name: 'Geral', isDefault: true },
  { id: 'cinema', name: 'Cinema', isDefault: true },
  { id: 'futebol', name: 'Futebol', isDefault: true },
  { id: 'gameplay', name: 'Gameplay', isDefault: true }
];

// Map<channelId, Channel>
const channels = new Map();

for (const def of DEFAULT_CHANNELS) {
  channels.set(def.id, {
    id: def.id,
    name: def.name,
    isDefault: true,
    createdAt: Date.now(),
    users: new Map(),
    messages: []
  });
}

// O que os outros podem ver de um usuário (a foto vai à parte, por /api/avatar/:id)
function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    color: u.color,
    bio: u.bio,
    profileId: u.profileId,
    avatarV: u.avatar ? u.avatarV : 0,
    channelId: u.channelId,
    isSharing: u.isSharing,
    shareKind: u.shareKind,
    isMicOn: u.isMicOn,
    isDeafened: u.isDeafened,
    isSpeaking: u.isSpeaking,
    streamQuality: u.streamQuality,
    joinedAt: u.joinedAt
  };
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const PROFILE_ID_RE = /^[a-z0-9-]{8,64}$/i;
const AVATAR_RE = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i;
const MAX_AVATAR_BYTES = 200 * 1024;

// Aplica os campos válidos do perfil; retorna true se algo mudou
function applyProfile(user, raw) {
  const profile = safeObject(raw);
  let changed = false;
  const name = safeString(profile.name, '', 25);
  if (name && name !== user.name) {
    user.name = name;
    changed = true;
  }
  if (typeof profile.color === 'string' && HEX_COLOR_RE.test(profile.color) && profile.color !== user.color) {
    user.color = profile.color;
    changed = true;
  }
  if (typeof profile.bio === 'string') {
    const bio = profile.bio.trim().slice(0, 140);
    if (bio !== user.bio) {
      user.bio = bio;
      changed = true;
    }
  }
  if (typeof profile.profileId === 'string' && PROFILE_ID_RE.test(profile.profileId)) {
    user.profileId = profile.profileId;
  }
  if (profile.avatar === '' && user.avatar) {
    user.avatar = null;
    changed = true;
  } else if (typeof profile.avatar === 'string' && profile.avatar) {
    const match = profile.avatar.match(AVATAR_RE);
    const data = match ? Buffer.from(match[2], 'base64') : null;
    if (data && data.length <= MAX_AVATAR_BYTES && !(user.avatar && user.avatar.data.equals(data))) {
      user.avatar = { mime: match[1].toLowerCase(), data };
      user.avatarV = Date.now();
      changed = true;
    }
  }
  return changed;
}

function getChannelsSummary() {
  const list = [];
  for (const channel of channels.values()) {
    const userList = Array.from(channel.users.values()).map(publicUser);
    const sharers = userList.filter(u => u.isSharing).map(u => u.name);

    list.push({
      id: channel.id,
      name: channel.name,
      isDefault: channel.isDefault,
      userCount: channel.users.size,
      activeStreams: sharers.length,
      sharers,
      users: userList
    });
  }
  return list;
}

function getChannelUsersList(channelId) {
  const ch = channels.get(channelId);
  if (!ch) return [];
  return Array.from(ch.users.values()).map(publicUser);
}

function isSameChannel(socket, targetId) {
  const targetSocket = io.sockets.sockets.get(targetId);
  if (!targetSocket) return false;
  const targetUser = targetSocket.data?.user;
  const senderUser = socket.data?.user;
  return Boolean(targetUser && senderUser && targetUser.channelId && targetUser.channelId === senderUser.channelId);
}

// ----------------------------------------------------
// REST API & Health Endpoints
// ----------------------------------------------------

app.get('/api/channels', (req, res) => {
  res.json(getChannelsSummary());
});

app.get('/api/avatar/:userId', (req, res) => {
  const user = io.sockets.sockets.get(req.params.userId)?.data?.user;
  if (!user?.avatar) return res.status(404).end();
  res.set({
    'Content-Type': user.avatar.mime,
    'Cache-Control': 'public, max-age=86400, immutable',
    'X-Content-Type-Options': 'nosniff'
  });
  res.send(user.avatar.data);
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    channelsCount: channels.size,
    totalUsers: io.engine.clientsCount
  });
});

// ----------------------------------------------------
// Defensive Helpers & Schema Validation
// ----------------------------------------------------

function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function safeObject(val) {
  return isPlainObject(val) ? val : {};
}

function safeString(val, fallback = '', maxLength = 1000) {
  if (typeof val !== 'string') return fallback;
  const trimmed = val.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}

function safeBoolean(val, fallback = undefined) {
  return typeof val === 'boolean' ? val : fallback;
}

function safeCallback(callback) {
  return typeof callback === 'function' ? callback : () => {};
}

function safeHandler(fn) {
  return function (...args) {
    try {
      return fn.apply(this, args);
    } catch (err) {
      console.error(`💥 [Socket Error] Handler "${fn.name || 'anonymous'}" encountered unhandled exception:`, err);
      const lastArg = args[args.length - 1];
      if (typeof lastArg === 'function') {
        try {
          lastArg({ success: false, error: 'Internal server error' });
        } catch {}
      }
    }
  };
}

io.engine.on('connection_error', (err) => {
  console.error('⚠️ [Socket.IO Engine Connection Error]:', err?.message || err);
});

// ----------------------------------------------------
// Socket.IO Real-time Signaling
// ----------------------------------------------------

io.on('connection', (socket) => {
  socket.on('error', (err) => {
    console.error(`⚠️ [Socket Error] Socket ID ${socket.id}:`, err?.message || err);
  });
  const colorIndex = (channels.size + io.engine.clientsCount) % USER_COLORS.length;
  const user = {
    id: socket.id,
    name: `Amigo-${socket.id.slice(0, 4)}`,
    color: USER_COLORS[colorIndex],
    bio: '',
    profileId: null,
    avatar: null,
    avatarV: 0,
    channelId: null,
    isSharing: false,
    isMicOn: false,
    isDeafened: false,
    isSpeaking: false,
    streamQuality: '1080p60',
    joinedAt: Date.now()
  };

  socket.data.user = user;

  // Send initial channel list and identity to client
  const summary = getChannelsSummary();
  socket.emit('channels-list', summary);
  socket.emit('channels-summary', summary);
  socket.emit('me', { id: user.id, name: user.name, color: user.color, sfu: Boolean(SFU_SECRET) });

  // Client requests channels update
  socket.on('get-channels', safeHandler(() => {
    const list = getChannelsSummary();
    socket.emit('channels-list', list);
    socket.emit('channels-summary', list);
  }));

  // Dynamic channel creation (Defensive & collision-safe)
  socket.on('create-channel', safeHandler((rawPayload, maybeCallback) => {
    let payload = rawPayload;
    let callback = maybeCallback;

    // Handle case where client called socket.emit('create-channel', callback)
    if (typeof rawPayload === 'function') {
      callback = rawPayload;
      payload = {};
    }

    const data = safeObject(payload);
    const cb = safeCallback(callback);

    const rawName = typeof data.name === 'string' ? data.name.trim() : '';
    const cleanName = rawName.slice(0, 30) || `Sala-${Date.now().toString(36).slice(-4)}`;
    const slug = cleanName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || `sala-${Date.now().toString(36).slice(-4)}`;

    let finalId = slug;
    let counter = 2;
    // Disambiguate against ALL existing channels (default and dynamic)
    while (channels.has(finalId)) {
      finalId = `${slug}-${counter++}`;
    }

    if (!channels.has(finalId)) {
      const newChan = {
        id: finalId,
        name: cleanName,
        isDefault: false,
        createdAt: Date.now(),
        users: new Map(),
        messages: []
      };
      channels.set(finalId, newChan);
      const summaryList = getChannelsSummary();
      io.emit('channels-list', summaryList);
      io.emit('channels-summary', summaryList);
      io.emit('channel-created', {
        channel: {
          id: finalId,
          name: cleanName,
          userCount: 0,
          activeStreams: 0
        }
      });
    }

    cb({ success: true, channelId: finalId, channelName: cleanName });
  }));

  // Channel Joining & Switching (Defensive)
  socket.on('join-channel', safeHandler((rawPayload) => {
    const payload = safeObject(rawPayload);
    const rawChanId = typeof payload.channelId === 'string' ? payload.channelId.trim().toLowerCase() : '';
    const cleanChannelId = rawChanId.slice(0, 64).replace(/[^a-z0-9_-]/g, '') || 'geral';

    const userName = safeString(payload.userName, '', 25);
    if (payload.profile) applyProfile(user, payload.profile);
    const isMicOn = safeBoolean(payload.isMicOn);
    const isDeafened = safeBoolean(payload.isDeafened);
    const isSharing = safeBoolean(payload.isSharing);

    // If switching from another channel, leave previous channel first
    if (user.channelId && user.channelId !== cleanChannelId) {
      leaveCurrentChannel(socket);
    } else if (user.channelId === cleanChannelId) {
      // Already in this channel, just update name/flags if provided
      if (userName) user.name = userName;
      if (isMicOn !== undefined) user.isMicOn = isMicOn;
      if (isDeafened !== undefined) user.isDeafened = isDeafened;
      if (isSharing !== undefined) user.isSharing = isSharing;
      const stateEvt = {
        userId: socket.id,
        channelId: cleanChannelId,
        isMicOn: user.isMicOn,
        isDeafened: user.isDeafened,
        isSharing: user.isSharing,
        isSpeaking: user.isSpeaking
      };
      io.to(cleanChannelId).emit('user-state-changed', stateEvt);
      io.to(cleanChannelId).emit('user-state-updated', stateEvt);
      const summaryList = getChannelsSummary();
      io.emit('channels-list', summaryList);
      io.emit('channels-summary', summaryList);
      return;
    }

    if (userName) {
      user.name = userName;
    }
    if (isMicOn !== undefined) user.isMicOn = isMicOn;
    if (isDeafened !== undefined) user.isDeafened = isDeafened;
    if (isSharing !== undefined) user.isSharing = isSharing;

    // Create custom channel if it does not exist
    if (!channels.has(cleanChannelId)) {
      const formattedName = cleanChannelId.charAt(0).toUpperCase() + cleanChannelId.slice(1);
      channels.set(cleanChannelId, {
        id: cleanChannelId,
        name: formattedName,
        isDefault: false,
        createdAt: Date.now(),
        users: new Map(),
        messages: []
      });
    }

    const channel = channels.get(cleanChannelId);
    user.channelId = cleanChannelId;
    channel.users.set(socket.id, user);

    socket.join(cleanChannelId);

    // 1. Send channel state & history to joining user
    socket.emit('channel-state', {
      channelId: cleanChannelId,
      channelName: channel.name,
      me: publicUser(user),
      users: getChannelUsersList(cleanChannelId),
      recentMessages: channel.messages.slice(-50)
    });

    // 2. Notify other channel members
    const joinedPayload = {
      userId: socket.id,
      name: user.name,
      color: user.color,
      channelId: cleanChannelId,
      user: publicUser(user),
      users: getChannelUsersList(cleanChannelId)
    };
    socket.to(cleanChannelId).emit('user-joined', joinedPayload);
    socket.to(cleanChannelId).emit('user-channel-joined', joinedPayload);

    // 3. Broadcast channels list globally so all users see updated presence
    const summaryList = getChannelsSummary();
    io.emit('channels-list', summaryList);
    io.emit('channels-summary', summaryList);
  }));

  // State Change: AO VIVO badge, Mic Mute, Deafen, VAD Speaking
  const handleStateUpdate = safeHandler((rawPayload) => {
    if (!user.channelId || !isPlainObject(rawPayload)) return;
    const channelId = user.channelId;

    let presenceChanged = false;

    if (typeof rawPayload.isSharing === 'boolean' && user.isSharing !== rawPayload.isSharing) {
      user.isSharing = rawPayload.isSharing;
      presenceChanged = true;
    }
    // O que está sendo transmitido: tela ou câmera (muda o selo "AO VIVO" dos outros)
    if (rawPayload.shareKind === 'screen' || rawPayload.shareKind === 'camera') {
      user.shareKind = rawPayload.shareKind;
    }
    if (typeof rawPayload.isMicOn === 'boolean' && user.isMicOn !== rawPayload.isMicOn) {
      user.isMicOn = rawPayload.isMicOn;
      presenceChanged = true;
    }
    if (typeof rawPayload.isDeafened === 'boolean' && user.isDeafened !== rawPayload.isDeafened) {
      user.isDeafened = rawPayload.isDeafened;
      presenceChanged = true;
    }
    if (typeof rawPayload.isSpeaking === 'boolean' && user.isSpeaking !== rawPayload.isSpeaking) {
      user.isSpeaking = rawPayload.isSpeaking;
    }
    if (typeof rawPayload.streamQuality === 'string' && rawPayload.streamQuality.trim()) {
      user.streamQuality = rawPayload.streamQuality.trim().slice(0, 16);
    }

    const statePayload = {
      userId: socket.id,
      channelId,
      isSharing: user.isSharing,
      shareKind: user.shareKind,
      isMicOn: user.isMicOn,
      isDeafened: user.isDeafened,
      isSpeaking: user.isSpeaking,
      streamQuality: user.streamQuality
    };

    // Emit state update to everyone in the channel
    io.to(channelId).emit('user-state-changed', statePayload);
    io.to(channelId).emit('user-state-updated', statePayload);

    // If presence-affecting attributes changed, broadcast global channels-list
    if (presenceChanged) {
      const summaryList = getChannelsSummary();
      io.emit('channels-list', summaryList);
      io.emit('channels-summary', summaryList);
    }
  });

  // Senha temporária pro SFU. Sala do SFU = "<canal>__<quem transmite>":
  // só o próprio dono transmite nela, e só quem está no mesmo canal assiste.
  socket.on('sfu-token', safeHandler((rawPayload, maybeCallback) => {
    const callback = safeCallback(maybeCallback);
    const payload = safeObject(rawPayload);
    if (!SFU_SECRET || !user.channelId) return callback({ ok: false });
    const ownerId = typeof payload.ownerId === 'string' ? payload.ownerId : '';
    const role = payload.role === 'host' ? 'host' : 'viewer';
    const owner = io.sockets.sockets.get(ownerId)?.data?.user;
    if (!owner || owner.channelId !== user.channelId) return callback({ ok: false });
    if (role === 'host' && ownerId !== socket.id) return callback({ ok: false });
    const sala = `${user.channelId}__${ownerId}`;
    const exp = String(Math.floor(Date.now() / 1000) + 60);
    const token = createHmac('sha256', SFU_SECRET).update(`${sala}|${role}|${exp}`).digest('hex');
    callback({ ok: true, path: SFU_PATH, sala, role, exp, token });
  }));

  // Perfil (nome, cor, bio, foto): vale pra todas as salas, então avisa todo mundo
  socket.on('update-profile', safeHandler((rawPayload) => {
    if (!applyProfile(user, rawPayload)) return;
    io.emit('user-profile-updated', { userId: socket.id, user: publicUser(user) });
    const summaryList = getChannelsSummary();
    io.emit('channels-list', summaryList);
    io.emit('channels-summary', summaryList);
  }));

  socket.on('user-state-changed', handleStateUpdate);
  socket.on('user-state-update', handleStateUpdate);

  // Channel-Scoped WebRTC Signaling (Unified)
  socket.on('webrtc-signal', safeHandler((rawPayload) => {
    if (!isPlainObject(rawPayload) || !user.channelId) return;
    const { target, type, signal } = rawPayload;
    if (typeof target !== 'string' || !target.trim()) return;
    if (!signal || typeof signal !== 'object') return;
    if (!isSameChannel(socket, target)) return;

    io.to(target).emit('webrtc-signal', {
      sender: socket.id,
      target,
      type: (typeof type === 'string' && type.trim()) ? type.trim() : 'screen',
      signal
    });
  }));

  // Granular WebRTC Signals (Dual-Mesh WebRTC routing)
  socket.on('webrtc-offer', safeHandler((rawPayload) => {
    if (!isPlainObject(rawPayload) || !user.channelId) return;
    const { targetId, sdp, type } = rawPayload;
    if (typeof targetId !== 'string' || !targetId.trim()) return;
    if (!sdp || (typeof sdp !== 'object' && typeof sdp !== 'string')) return;
    if (!isSameChannel(socket, targetId)) return;

    io.to(targetId).emit('webrtc-offer', {
      senderId: socket.id,
      sdp,
      type: (typeof type === 'string' && type.trim()) ? type.trim() : 'screen'
    });
  }));

  socket.on('webrtc-answer', safeHandler((rawPayload) => {
    if (!isPlainObject(rawPayload) || !user.channelId) return;
    const { targetId, sdp, type } = rawPayload;
    if (typeof targetId !== 'string' || !targetId.trim()) return;
    if (!sdp || (typeof sdp !== 'object' && typeof sdp !== 'string')) return;
    if (!isSameChannel(socket, targetId)) return;

    io.to(targetId).emit('webrtc-answer', {
      senderId: socket.id,
      sdp,
      type: (typeof type === 'string' && type.trim()) ? type.trim() : 'screen'
    });
  }));

  socket.on('webrtc-ice-candidate', safeHandler((rawPayload) => {
    if (!isPlainObject(rawPayload) || !user.channelId) return;
    const { targetId, candidate, type } = rawPayload;
    if (typeof targetId !== 'string' || !targetId.trim()) return;
    if (!candidate || (typeof candidate !== 'object' && typeof candidate !== 'string')) return;
    if (!isSameChannel(socket, targetId)) return;

    io.to(targetId).emit('webrtc-ice-candidate', {
      senderId: socket.id,
      candidate,
      type: (typeof type === 'string' && type.trim()) ? type.trim() : 'screen'
    });
  }));

  socket.on('request-stream', safeHandler((rawPayload) => {
    if (!isPlainObject(rawPayload) || !user.channelId) return;
    const { targetId, type } = rawPayload;
    if (typeof targetId !== 'string' || !targetId.trim()) return;
    if (!isSameChannel(socket, targetId)) return;

    io.to(targetId).emit('request-stream', {
      requesterId: socket.id,
      type: (typeof type === 'string' && type.trim()) ? type.trim() : 'screen'
    });
  }));

  // Channel Text Chat
  socket.on('chat-message', safeHandler((rawPayload) => {
    if (!isPlainObject(rawPayload) || !user.channelId) return;
    if (typeof rawPayload.text !== 'string') return;

    const rawText = rawPayload.text.trim();
    if (!rawText) return;

    const channel = channels.get(user.channelId);
    if (!channel) return;

    const chatMsg = {
      id: `msg-${Date.now()}-${randomUUID().slice(0, 8)}`,
      channelId: user.channelId,
      senderId: socket.id,
      userId: socket.id,
      senderName: user.name,
      userName: user.name,
      userColor: user.color,
      userAvatarV: user.avatar ? user.avatarV : 0,
      text: rawText.slice(0, 600),
      timestamp: Date.now()
    };

    channel.messages.push(chatMsg);
    if (channel.messages.length > 50) {
      channel.messages.shift();
    }

    io.to(user.channelId).emit('chat-message', chatMsg);
  }));

  // Stage reactions (floating emojis)
  socket.on('reaction', safeHandler((rawPayload) => {
    if (!isPlainObject(rawPayload) || !user.channelId) return;
    if (typeof rawPayload.emoji !== 'string') return;

    const cleanEmoji = rawPayload.emoji.trim().slice(0, 8);
    if (!cleanEmoji) return;

    io.to(user.channelId).emit('reaction', {
      channelId: user.channelId,
      userId: socket.id,
      userName: user.name,
      emoji: cleanEmoji
    });
  }));

  // Explicit Channel Leave
  socket.on('leave-channel', safeHandler(() => {
    leaveCurrentChannel(socket);
  }));

  // Disconnect Handling
  socket.on('disconnect', () => {
    try {
      leaveCurrentChannel(socket);
    } catch (err) {
      console.error(`[Disconnect Error] Socket ${socket.id}:`, err);
    }
  });
});

function leaveCurrentChannel(socket) {
  const user = socket.data?.user;
  if (!user || !user.channelId) return;

  const channelId = user.channelId;
  const channel = channels.get(channelId);

  if (channel) {
    channel.users.delete(socket.id);
    socket.leave(channelId);

    const leftPayload = {
      userId: socket.id,
      userName: user.name,
      name: user.name,
      channelId,
      users: getChannelUsersList(channelId)
    };

    // Notify remaining channel members
    socket.to(channelId).emit('user-left', leftPayload);
    socket.to(channelId).emit('user-channel-left', leftPayload);

    // Prune custom channel if empty
    if (!channel.isDefault && channel.users.size === 0) {
      channels.delete(channelId);
    }
  }

  user.channelId = null;
  user.isSharing = false;
  user.isSpeaking = false;

  const summaryList = getChannelsSummary();
  io.emit('channels-list', summaryList);
  io.emit('channels-summary', summaryList);
}

// ----------------------------------------------------
// System Loopback Initialization & Server Startup
// ----------------------------------------------------

function ensureLinuxSystemAudioSource() {
  if (process.platform !== 'linux') return;
  try {
    const sources = execSync('pactl list short sources', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (!sources.includes('som_do_pc')) {
      const sink = execSync('pactl get-default-sink', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (sink) {
        execSync(
          `pactl load-module module-remap-source master="${sink}.monitor" source_name=som_do_pc source_properties=device.description="Som_do_PC_Jogos_e_Videos"`,
          { stdio: 'ignore' }
        );
        console.log('🔊 [Audio Loopback] Fonte virtual "som_do_pc" configurada via pactl.');
      }
    } else {
      console.log('🔊 [Audio Loopback] Fonte virtual "som_do_pc" já ativa no PipeWire/PulseAudio.');
    }
  } catch {
    // Silently continue if pactl is not installed or running in container
  }
}

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

function startServer(port = PORT, host = '0.0.0.0') {
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      ensureLinuxSystemAudioSource();
      const ips = getLocalIPs();
      console.log('\n=======================================================');
      console.log('📺 TELINHA - SERVIDOR DE SINALIZAÇÃO & CANAIS INICIADO');
      console.log('📺 Telinha - Servidor de Sinalização & Canais Iniciado');
      console.log('=======================================================');
      console.log(`👉 Acesso Local:   http://localhost:${port}`);
      ips.forEach(ip => {
        console.log(`👉 Na mesma rede:  http://${ip}:${port}`);
      });
      console.log('🔊 Canais ativos: Geral, Cinema, Futebol, Gameplay');
      console.log('=======================================================\n');
      resolve(server);
    });
  });
}

const isDirectRun = Boolean(process.argv[1]) && (
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
  (process.argv[1].endsWith('server.js') && !process.argv[1].includes('tests'))
);

if (isDirectRun) {
  startServer(PORT, '0.0.0.0');
}

export { app, server, io, channels, getChannelsSummary, startServer, safeHandler, isPlainObject, safeObject };
