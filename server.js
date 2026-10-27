/**
 * server.js - Teletela Signaling & Channel Server
 * Discord / TeamSpeak style voice & screen sharing architecture
 */

import express from 'express';
import http from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { randomUUID, createHash, createHmac, timingSafeEqual, scryptSync, randomBytes, createPublicKey, verify } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalizeImageCrop } from './public/image-crop.js';
import { PermissionStore, PERMISSIONS } from './permission-store.js';

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
// Pasta onde os canais criados ficam salvos (sobrevivem a reinício e deploy). Sem ela, só na memória.
const DATA_DIR = process.env.TELINHA_DATA_DIR || '';
const CHANNELS_FILE = DATA_DIR ? path.join(DATA_DIR, 'channels.json') : '';
// Chave para assumir ou recuperar a propriedade; os poderes comuns vêm dos cargos.
const ADMIN_KEY = process.env.ADMIN_KEY || '';
// A antiga senha compartilhada de admin nunca autoriza propriedade.
const OWNER_KEY = process.env.OWNER_KEY || '';
const permissions = new PermissionStore(DATA_DIR);

function verifiedProfileKey(socket) {
  const proof = socket.handshake.auth?.profileProof;
  if (!proof || typeof proof.challenge !== 'string' || !/^\d{13}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(proof.challenge)
    || typeof proof.signature !== 'string' || !/^[a-f0-9]{128}$/.test(proof.signature)
    || typeof proof.publicKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(proof.publicKey)) return null;
  const [expires, nonce, signature] = proof.challenge.split('.');
  if (Number(expires) < Date.now() || Number(expires) > Date.now() + 65000) return null;
  const expected = permissions.signature(`profile-challenge|${expires}.${nonce}`);
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const rawKey = Buffer.from(proof.publicKey, 'base64url');
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawKey]), format: 'der', type: 'spki' });
    const host = String(socket.handshake.headers.host || '').toLowerCase();
    return verify(null, Buffer.from(`teletela-profile|${host}|${proof.challenge}`), key, Buffer.from(proof.signature, 'hex')) ? rawKey.toString('hex') : null;
  } catch { return null; }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 3e7 // 30MB (acomoda GIFs de 10MB em base64)
});
app.get('/api/identity', (_req, res) => {
  const challenge = `${Date.now() + 60000}.${randomBytes(16).toString('hex')}`;
  res.set({ 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }).json({ challenge: `${challenge}.${permissions.signature('profile-challenge|' + challenge)}` });
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

// Uma reação: um emoji só (com tom de pele, ZWJ, bandeira...), sem texto junto
const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\p{Emoji_Component}|\u200d|\ufe0f|[\u{E0020}-\u{E007F}])+$/u;

// Só o Geral é fixo; o resto a turma cria (e apaga) pelo app
const DEFAULT_CHANNELS = [
  { id: 'geral', name: 'Geral', isDefault: true }
];

// Map<channelId, Channel>
// Canal criado pelo "Criar Canal" é salvo e fica até alguém apagar. Canal que nasce de um
// link antigo (?channel=x) ou de versão antiga do app é temporário: some quando esvazia.
const channels = new Map();

function newChannel({ id, name, isDefault = false, temporary = false, createdBy = null, createdAt = Date.now(), password = null, access = null, writeAccess = null, description = '' }) {
  return { id, name, isDefault, temporary, createdBy, createdAt, password, access, writeAccess, description, users: new Map(), messages: [] };
}

for (const def of DEFAULT_CHANNELS) {
  channels.set(def.id, newChannel({ id: def.id, name: def.name, isDefault: true }));
}

const CHANNEL_ID_RE = /^[a-z0-9_-]{1,64}$/;
function validChannelPasswordHash(password) {
  return typeof password?.salt === 'string' && /^[a-f0-9]{32}$/.test(password.salt)
    && typeof password?.hash === 'string' && /^[a-f0-9]{64}$/.test(password.hash);
}

// Cada pessoa transmite até 3 telas: a 1 (isSharing) e as extras 2 e 3
const EXTRA_SCREEN_NUMBERS = [2, 3];

function storedAccess(raw) {
  if (raw == null) return null;
  try { return permissions.access(raw, true); }
  catch { return { private: true, roles: [], members: [] }; }
}

function loadSavedChannels() {
  if (!CHANNELS_FILE) return;
  try {
    const saved = JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf8'));
    const general = saved.defaultSettings?.geral;
    if (general && typeof general === 'object') Object.assign(channels.get('geral'), {
      name: safeString(general.name, 'Geral', 30), description: safeString(general.description, '', 200),
      writeAccess: storedAccess(general.writeAccess),
      password: general.password == null ? null : validChannelPasswordHash(general.password) ? general.password : { salt: '', hash: '' }
    });
    for (const c of Array.isArray(saved?.channels) ? saved.channels : []) {
      if (typeof c?.id !== 'string' || !CHANNEL_ID_RE.test(c.id) || channels.has(c.id)) continue;
      // Um hash corrompido nunca deve transformar um canal protegido em aberto.
      const password = c.password == null ? null : validChannelPasswordHash(c.password) ? c.password : { salt: '', hash: '' };
      const name = typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 30) : c.id;
      const createdBy = typeof c.createdBy === 'string' ? c.createdBy : null;
      // Regra inválida falha fechada: nunca publica um canal privado por erro no arquivo.
      let access = null;
      if (c.access != null) {
        try { access = permissions.access(c.access, true); }
        catch { access = { private: true, roles: [], members: [] }; }
      }
      channels.set(c.id, newChannel({ id: c.id, name, createdBy, createdAt: Number(c.createdAt) || Date.now(), password, access, writeAccess: storedAccess(c.writeAccess), description: safeString(c.description, '', 200) }));
    }
    for (const c of Array.isArray(saved?.textChannels) ? saved.textChannels : []) {
      if (typeof c?.id !== 'string' || !CHANNEL_ID_RE.test(c.id) || textChannels.has(c.id)) continue;
      const name = typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 30) : c.id;
      textChannels.set(c.id, newTextChannel({
        id: c.id,
        name,
        createdBy: typeof c.createdBy === 'string' ? c.createdBy : null,
        createdAt: Number(c.createdAt) || Date.now(), access: storedAccess(c.access), writeAccess: storedAccess(c.writeAccess), description: safeString(c.description, '', 200)
      }));
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('⚠️ [Canais] Não deu pra ler os canais salvos:', err.message);
  }
}

// Grava num arquivo temporário e renomeia: se o servidor cair no meio, o arquivo antigo fica inteiro
function saveChannels(strict = false) {
  if (!CHANNELS_FILE) return;
  const list = [...channels.values()]
    .filter((c) => !c.isDefault && !c.temporary)
    .map(({ id, name, createdBy, createdAt, password, access, writeAccess, description }) => ({ id, name, createdBy, createdAt, password, access, writeAccess, description }));
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${CHANNELS_FILE}.tmp`;
    const textList = [...textChannels.values()].map(({ id, name, createdBy, createdAt, access, writeAccess, description }) => ({ id, name, createdBy, createdAt, access, writeAccess, description }));
    const { name, description, writeAccess, password } = channels.get('geral');
    fs.writeFileSync(tmp, JSON.stringify({ channels: list, textChannels: textList, defaultSettings: { geral: { name, description, writeAccess, password } } }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, CHANNELS_FILE);
  } catch (err) {
    console.error('⚠️ [Canais] Não deu pra salvar os canais:', err.message);
    if (strict) throw new Error('O servidor não conseguiu salvar as permissões do canal.');
  }
}

// ----------------------------------------------------
// Canais de texto: o histórico fica salvo (um arquivo por canal, uma mensagem por linha).
// Na memória só as últimas mensagens de cada um; as antigas vêm do disco quando alguém rola.
// Separados dos canais de voz (outro Map, outros eventos): app antigo nem fica sabendo deles.
// ----------------------------------------------------
const TEXT_DIR = DATA_DIR ? path.join(DATA_DIR, 'text') : path.join(os.tmpdir(), `teletela-text-${process.pid}`);
const TEXT_IMAGE_DIR = path.join(TEXT_DIR, 'images');
const MAX_TEXT_MESSAGES_PER_CHANNEL = 50000; // passou disso, apaga as mais antigas
const TEXT_RECENT_IN_MEMORY = 250;
const TEXT_PAGE_SIZE = 50;
const MAX_TEXT_LENGTH = 4000;
const MAX_TEXT_IMAGES_TOTAL_BYTES = 25 * 1024 * 1024 * 1024; // 25 GB (passou disso, apaga as imagens mais antigas)
const TEXT_IMAGE_FILE_RE = /^[a-f0-9-]{36}\.(png|jpg|webp|gif)$/;

// Map<id, { id, name, createdBy, createdAt, recent: [], count, lastMessageAt }>
const textChannels = new Map();
const assetChannels = new Map();
function indexAssets(ch, messages, type = 'text') {
  for (const msg of messages) for (const asset of [msg.image, msg.attachment]) {
    if (asset?.url) assetChannels.set(asset.url, { type, id: ch.id });
  }
}
function canReadAsset(req) {
  const reference = assetChannels.get(req.path);
  if (!reference) return false;
  const ch = (reference.type === 'text' ? textChannels : channels).get(reference.id);
  if (!ch) return false;
  if (!ch.access?.private) return true;
  const viewer = [...io.sockets.sockets.values()].find(client => client.data.user?.assetKey === req.query.access)?.data.user;
  return Boolean(viewer && permissions.visible(viewer, ch));
}
const textImages = []; // [{ file, size, mtime }] do mais antigo pro mais novo
let textImagesBytes = 0;

function newTextChannel({ id, name, createdBy = null, createdAt = Date.now(), access = null, writeAccess = null, description = '' }) {
  return { id, name, createdBy, createdAt, access, writeAccess, description, recent: [], count: 0, lastMessageAt: 0 };
}

function textFile(id) {
  return path.join(TEXT_DIR, `${id}.jsonl`);
}

// O arquivo só cresce: mensagem nova é uma linha, e editar/apagar/reagir vira uma linha
// com "op" que é aplicada aqui na leitura. De tempos em tempos ele é reescrito limpo.
function readTextLines(id) {
  try {
    return fs.readFileSync(textFile(id), 'utf8').split('\n').filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`⚠️ [Texto] Não deu pra ler #${id}:`, err.message);
    return [];
  }
}

function readTextMessages(id) {
  const list = [];
  const byId = new Map();
  for (const item of readTextLines(id)) {
    if (!item.op) {
      list.push(item);
      byId.set(item.id, item);
      continue;
    }
    const msg = byId.get(item.id);
    if (!msg) continue;
    if (item.op === 'edit') {
      msg.text = item.text;
      msg.editedAt = item.editedAt;
    } else if (item.op === 'reactions') {
      msg.reactions = item.reactions;
    } else if (item.op === 'delete') {
      msg.deleted = true;
    } else if (item.op === 'pin') {
      if (item.pinned) msg.pinned = item.pinned;
      else delete msg.pinned;
    }
  }
  return list.filter((m) => !m.deleted);
}

function rewriteTextFile(ch, messages) {
  const tmp = `${textFile(ch.id)}.tmp`;
  fs.writeFileSync(tmp, messages.length ? messages.map((m) => JSON.stringify(m)).join('\n') + '\n' : '');
  fs.renameSync(tmp, textFile(ch.id));
  ch.opCount = 0;
}

const MAX_TEXT_OPS_BEFORE_COMPACT = 1000;

function appendTextOp(ch, op) {
  fs.mkdirSync(TEXT_DIR, { recursive: true });
  fs.appendFileSync(textFile(ch.id), `${JSON.stringify(op)}\n`);
  ch.opCount = (ch.opCount || 0) + 1;
  if (ch.opCount > MAX_TEXT_OPS_BEFORE_COMPACT) rewriteTextFile(ch, readTextMessages(ch.id));
}

function loadTextChannelHistory(ch) {
  const all = readTextMessages(ch.id);
  indexAssets(ch, all);
  ch.opCount = readTextLines(ch.id).filter((l) => l.op).length;
  ch.count = all.length;
  ch.recent = all.slice(-TEXT_RECENT_IN_MEMORY);
  ch.lastMessageAt = all.length ? all[all.length - 1].timestamp || 0 : 0;
}

function textImageFileOf(msg) {
  const file = typeof msg?.image?.url === 'string' ? msg.image.url.split('/').pop() : '';
  return TEXT_IMAGE_FILE_RE.test(file) ? file : null;
}

function removeTextImage(file) {
  const i = textImages.findIndex((img) => img.file === file);
  if (i !== -1) {
    textImagesBytes -= textImages[i].size;
    textImages.splice(i, 1);
  }
  fs.rm(path.join(TEXT_IMAGE_DIR, file), { force: true }, () => {});
}

function appendTextMessage(ch, msg) {
  indexAssets(ch, [msg]);
  fs.mkdirSync(TEXT_DIR, { recursive: true });
  fs.appendFileSync(textFile(ch.id), `${JSON.stringify(msg)}\n`);
  ch.recent.push(msg);
  if (ch.recent.length > TEXT_RECENT_IN_MEMORY) ch.recent.shift();
  ch.count++;
  ch.lastMessageAt = msg.timestamp;
  // Passou do limite: fica com 90% (não reescreve o arquivo a cada mensagem nova)
  if (ch.count > MAX_TEXT_MESSAGES_PER_CHANNEL) {
    const all = readTextMessages(ch.id);
    const keep = all.slice(-Math.floor(MAX_TEXT_MESSAGES_PER_CHANNEL * 0.9));
    for (const old of all.slice(0, all.length - keep.length)) {
      const file = textImageFileOf(old);
      if (file) removeTextImage(file);
      removeTextAttachment(old);
    }
    rewriteTextFile(ch, keep);
    ch.count = keep.length;
  }
}

function saveTextImage(data, mime) {
  fs.mkdirSync(TEXT_IMAGE_DIR, { recursive: true });
  const file = `${randomUUID()}.${CHAT_IMAGE_TYPES[mime]}`;
  fs.writeFileSync(path.join(TEXT_IMAGE_DIR, file), data);
  textImages.push({ file, size: data.length, mtime: Date.now() });
  textImagesBytes += data.length;
  while (textImagesBytes > MAX_TEXT_IMAGES_TOTAL_BYTES && textImages.length > 1) {
    const old = textImages.shift();
    textImagesBytes -= old.size;
    fs.rm(path.join(TEXT_IMAGE_DIR, old.file), { force: true }, () => {});
  }
  return file;
}

function loadTextStorage() {
  try {
    fs.mkdirSync(TEXT_IMAGE_DIR, { recursive: true });
    const files = fs.readdirSync(TEXT_IMAGE_DIR).filter((f) => TEXT_IMAGE_FILE_RE.test(f));
    for (const file of files) {
      const st = fs.statSync(path.join(TEXT_IMAGE_DIR, file));
      textImages.push({ file, size: st.size, mtime: st.mtimeMs });
      textImagesBytes += st.size;
    }
    textImages.sort((a, b) => a.mtime - b.mtime);
  } catch (err) {
    console.error('⚠️ [Texto] Pasta de imagens indisponível:', err.message);
  }
  for (const ch of textChannels.values()) loadTextChannelHistory(ch);
}

function deleteTextChannelData(ch) {
  for (const msg of readTextMessages(ch.id)) {
    const file = textImageFileOf(msg);
    if (file) removeTextImage(file);
    removeTextAttachment(msg);
  }
  fs.rm(textFile(ch.id), { force: true }, () => {});
}

function getTextChannelsSummary(viewer = null) {
  return [...textChannels.values()].filter(ch => permissions.visible(viewer, ch))
    .map(ch => ({ id: ch.id, name: ch.name, description: ch.description, createdBy: ch.createdBy, createdAt: ch.createdAt,
      lastMessageAt: ch.lastMessageAt, isPrivate: Boolean(ch.access?.private), canWrite: permissions.canWrite(viewer, ch),
      canManageAccess: permissions.has(viewer, 'manageChannels') }))
    .sort((a, b) => a.createdAt - b.createdAt);
}
function broadcastTextChannels() {
  for (const client of io.sockets.sockets.values()) client.emit('text-channels', getTextChannelsSummary(client.data.user));
}
function emitText(ch, event, data, except = null) {
  for (const client of io.sockets.sockets.values()) if (client !== except && permissions.visible(client.data.user, ch)) client.emit(event, data);
}

loadSavedChannels();
loadTextStorage();

// ----------------------------------------------------
// SOUNDBOARD: sons que cada um sobe (ficam salvos) + os áudios dos amigos que vêm no app
// ----------------------------------------------------
const SOUNDBOARD_DIR = DATA_DIR ? path.join(DATA_DIR, 'soundboard') : path.join(os.tmpdir(), `teletela-soundboard-${process.pid}`);
const SOUNDBOARD_INDEX = path.join(SOUNDBOARD_DIR, 'index.json');
const MAX_SOUNDBOARD_BYTES = 1024 * 1024;
const MAX_SOUNDS_PER_PROFILE = 16;
const MAX_SOUNDS_TOTAL = 300;
const SOUNDBOARD_ID_RE = /^[a-f0-9-]{36}$/;
const BUILTIN_SOUND_RE = /^amigo-[1-9]$/;
const SOUND_EXT = { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac' };
let soundboard = []; // [{ id, profileId, ownerName, name, emoji, mime, file, createdAt }]

function loadSoundboard() {
  try {
    const list = JSON.parse(fs.readFileSync(SOUNDBOARD_INDEX, 'utf8'));
    if (Array.isArray(list)) {
      soundboard = list.filter((s) => s && SOUNDBOARD_ID_RE.test(s.id) && fs.existsSync(path.join(SOUNDBOARD_DIR, s.file || '')));
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('⚠️ [Soundboard] Não deu pra ler:', err.message);
  }
}

function saveSoundboard() {
  fs.mkdirSync(SOUNDBOARD_DIR, { recursive: true });
  const tmp = `${SOUNDBOARD_INDEX}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(soundboard, null, 2));
  fs.renameSync(tmp, SOUNDBOARD_INDEX);
}

function addSoundboardSound({ profileId, ownerName, name, emoji, mime, data }) {
  fs.mkdirSync(SOUNDBOARD_DIR, { recursive: true });
  const id = randomUUID();
  const file = `${id}.${SOUND_EXT[mime] || 'bin'}`;
  fs.writeFileSync(path.join(SOUNDBOARD_DIR, file), data);
  const sound = { id, profileId, ownerName, name, emoji, mime, file, createdAt: Date.now() };
  soundboard.push(sound);
  saveSoundboard();
  return sound;
}

function removeSoundboardSound(sound) {
  soundboard = soundboard.filter((s) => s.id !== sound.id);
  saveSoundboard();
  fs.rm(path.join(SOUNDBOARD_DIR, sound.file), { force: true }, () => {});
}

function soundboardList() {
  return soundboard.map(({ id, profileId, ownerName, name, emoji }) => ({ id, profileId, ownerName, name, emoji }));
}

loadSoundboard();

// Imagens do chat: ficam em disco (não na memória da VM) e vão sendo apagadas as mais
// antigas quando passam do limite. O histórico do chat não sobrevive a reinício, então
// as imagens também começam do zero quando o servidor sobe.
const CHAT_IMAGE_DIR = DATA_DIR ? path.join(DATA_DIR, 'chat-images') : path.join(os.tmpdir(), `teletela-chat-images-${process.pid}`);
const MAX_CHAT_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_CHAT_IMAGES_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const CHAT_IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const CHAT_IMAGE_ID_RE = /^[a-f0-9-]{36}\.(png|jpg|webp|gif)$/;
const chatImages = []; // [{ file, size }] do mais antigo pro mais novo
let chatImagesBytes = 0;

try {
  fs.rmSync(CHAT_IMAGE_DIR, { recursive: true, force: true });
  fs.mkdirSync(CHAT_IMAGE_DIR, { recursive: true });
} catch (err) {
  console.error('⚠️ [Chat] Pasta de imagens indisponível:', err.message);
}

// Confere pelos primeiros bytes que é mesmo o tipo de imagem dito (não confia no cliente)
function imageMatchesType(data, mime) {
  if (mime === 'image/png') return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/jpeg') return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mime === 'image/gif') return data.subarray(0, 6).toString('latin1').startsWith('GIF8');
  if (mime === 'image/webp') return data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP';
  return false;
}

function saveChatImage(data, mime) {
  const file = `${randomUUID()}.${CHAT_IMAGE_TYPES[mime]}`;
  fs.writeFileSync(path.join(CHAT_IMAGE_DIR, file), data);
  chatImages.push({ file, size: data.length });
  chatImagesBytes += data.length;
  while (chatImagesBytes > MAX_CHAT_IMAGES_TOTAL_BYTES && chatImages.length > 1) {
    const old = chatImages.shift();
    chatImagesBytes -= old.size;
    fs.rm(path.join(CHAT_IMAGE_DIR, old.file), { force: true }, () => {});
  }
  return file;
}

// Arquivos ficam fora da pasta pública; só vídeos reconhecidos podem abrir no player.
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ATTACHMENT_FILE_RE = /^[a-f0-9-]{36}\.(bin|mp4|webm)$/;
function attachmentStorage(directory, maxBytes, temporary = false) {
  if (temporary) fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
  const files = fs.readdirSync(directory).filter((file) => ATTACHMENT_FILE_RE.test(file)).map((file) => {
    const st = fs.statSync(path.join(directory, file));
    return { file, size: st.size, time: st.mtimeMs };
  }).sort((a, b) => a.time - b.time);
  let bytes = files.reduce((sum, item) => sum + item.size, 0);
  const remove = (file) => {
    const i = files.findIndex((item) => item.file === file);
    if (i < 0) return;
    fs.rmSync(path.join(directory, file), { force: true });
    bytes -= files[i].size;
    files.splice(i, 1);
  };
  const trim = () => { while (bytes > maxBytes && files.length) remove(files[0].file); };
  trim();
  return {
    directory, remove,
    save(data, ext) {
      const file = `${randomUUID()}.${ext}`;
      fs.writeFileSync(path.join(directory, file), data, { flag: 'wx' });
      files.push({ file, size: data.length, time: Date.now() });
      bytes += data.length;
      trim();
      return file;
    }
  };
}
const textAttachments = attachmentStorage(path.join(TEXT_DIR, 'files'), 5 * 1024 ** 3);
const chatAttachments = attachmentStorage(DATA_DIR ? path.join(DATA_DIR, 'chat-files') : path.join(os.tmpdir(), `teletela-files-${process.pid}`), 1024 ** 3, true);

function attachmentName(raw) {
  return (typeof raw === 'string' ? raw : '').replace(/[\\/\x00-\x1f\x7f]/g, '_').trim().slice(0, 160).replace(/[\uD800-\uDFFF]/gu, '_') || 'arquivo';
}

function prepareAttachment(payload) {
  const data = Buffer.isBuffer(payload.data) ? payload.data : null;
  if (!data?.length) throw new Error('Escolha um arquivo que não esteja vazio.');
  if (data.length > MAX_ATTACHMENT_BYTES) throw new Error('Arquivo grande demais (máximo 20 MB).');
  let mime = 'application/octet-stream', ext = 'bin';
  if (payload.mime === 'video/mp4' || payload.mime === 'video/webm') {
    const mp4 = data.length >= 12 && data.subarray(4, 8).toString('ascii') === 'ftyp';
    const webm = data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    if (!(payload.mime === 'video/mp4' ? mp4 : webm)) throw new Error('O conteúdo não corresponde ao tipo de vídeo.');
    mime = payload.mime;
    ext = mp4 ? 'mp4' : 'webm';
  }
  return { data, mime, ext, name: attachmentName(payload.name) };
}

function removeTextAttachment(msg) {
  const match = typeof msg?.attachment?.url === 'string' && msg.attachment.url.match(/^\/api\/text-file\/([a-f0-9-]{36}\.(?:bin|mp4|webm))$/);
  if (match) textAttachments.remove(match[1]);
}

function isAdminKey(key) {
  return matchesKey(key, ADMIN_KEY);
}
function isOwnerKey(key) { return matchesKey(key, OWNER_KEY); }
function matchesKey(key, expected) {
  if (!expected || typeof key !== 'string') return false;
  const a = Buffer.from(key);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Mutado/ensurdecido pelo admin: guardado pelo perfil, pra não escapar reconectando
const serverMutedProfiles = new Set();
const serverDeafenedProfiles = new Set();

function applyServerModeration(user) {
  user.serverMuted = Boolean(user.profileId && serverMutedProfiles.has(user.profileId));
  user.serverDeafened = Boolean(user.profileId && serverDeafenedProfiles.has(user.profileId));
  // Mutado pelo admin não abre o microfone; ensurdecido também não ouve nem fala
  if (user.serverMuted || user.serverDeafened) user.isMicOn = false;
  if (user.serverDeafened) user.isDeafened = true;
}

// Apaga: admin apaga qualquer um; quem criou apaga o seu. O Geral nunca.
function canDeleteChannel(user, channel) {
  if (!channel || channel.isDefault) return false;
  if (!permissions.visible(user, channel)) return false;
  if (permissions.has(user, 'manageChannels')) return true;
  // O profileId dos visitantes é público; não autoriza apagar um canal privado.
  if (channel.access?.private) return false;
  return Boolean(channel.createdBy && user.profileId && channel.createdBy === user.profileId);
}

// O que os outros podem ver de um usuário (a foto vai à parte, por /api/avatar/:id)
function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    color: u.color,
    nameColor: u.nameColor || '',
    nameColor2: u.nameColor2 || '',
    frame: u.frame || '',
    frameColor: u.frameColor || '',
    bannerColor: u.bannerColor || '',
    bannerV: u.banner ? u.bannerV : 0,
    bannerCrop: normalizeImageCrop(u.bannerCrop),
    joinSoundV: u.joinSound ? u.joinSoundV : 0,
    bio: u.bio,
    activity: u.activity || null,
    profileId: u.profileId,
    isAdmin: permissions.isOwner(u),
    isOwner: permissions.isOwner(u),
    displayRoleId: u.displayRoleId || '',
    roles: permissions.roles(u).map(({ id, name }) => ({ id, name })),
    serverMuted: Boolean(u.serverMuted),
    serverDeafened: Boolean(u.serverDeafened),
    avatarV: u.avatar ? u.avatarV : 0,
    avatarCrop: normalizeImageCrop(u.avatarCrop),
    channelId: u.channelId,
    isSharing: u.isSharing,
    isCameraOn: u.isCameraOn,
    extraScreens: u.extraScreens,
    watching: u.watching,
    isMicOn: u.isMicOn,
    isDeafened: u.isDeafened,
    isSpeaking: u.isSpeaking,
    streamQuality: u.streamQuality,
    joinedAt: u.joinedAt
  };
}

const WATCH_KEY_RE = /^[A-Za-z0-9_-]{1,40}(?:__(?:cam|s[23]))?$/;
const MAX_WATCHING = 8;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const PROFILE_ID_RE = /^[a-z0-9-]{8,64}$/i;
const AVATAR_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=]+)$/i;
const MAX_AVATAR_BYTES = 200 * 1024;
// GIF vai sem redimensionar (senão para de mexer), então pode ser maior
const MAX_GIF_AVATAR_BYTES = 10 * 1024 * 1024;
const MAX_BANNER_BYTES = 1024 * 1024;
const MAX_GIF_BANNER_BYTES = 10 * 1024 * 1024; // só é baixado quando clicam na pessoa
const SOUND_RE = /^data:(audio\/(?:ogg|mpeg|mp3|wav|x-wav|webm|mp4|x-m4a|aac));base64,([a-z0-9+/=]+)$/i;
const MAX_JOIN_SOUND_BYTES = 1024 * 1024;
const FRAME_PRESETS = ['', 'cor', 'ouro', 'neon', 'fogo', 'gelo', 'arco-iris'];

// Aplica os campos válidos do perfil; retorna true se algo mudou
function applyProfile(user, raw) {
  const profile = safeObject(raw);
  let changed = false;
  if (typeof profile.displayRoleId === 'string' && profile.displayRoleId.length <= 36 && profile.displayRoleId !== user.displayRoleId) { user.displayRoleId = profile.displayRoleId; changed = true; }
  for (const key of ['avatarCrop', 'bannerCrop']) {
    if (!profile[key] || typeof profile[key] !== 'object' || Array.isArray(profile[key])) continue;
    const crop = normalizeImageCrop(profile[key]);
    if (JSON.stringify(crop) !== JSON.stringify(normalizeImageCrop(user[key]))) {
      user[key] = crop;
      changed = true;
    }
  }
  const name = safeString(profile.name, '', 25);
  if (name && name !== user.name) {
    user.name = name;
    changed = true;
  }
  if (typeof profile.color === 'string' && HEX_COLOR_RE.test(profile.color) && profile.color !== user.color) {
    user.color = profile.color;
    changed = true;
  }
  // Cor do nome (vazio = cor normal do tema)
  if (typeof profile.nameColor === 'string' && (profile.nameColor === '' || HEX_COLOR_RE.test(profile.nameColor))
    && profile.nameColor !== user.nameColor) {
    user.nameColor = profile.nameColor;
    changed = true;
  }
  if (typeof profile.nameColor2 === 'string' && (profile.nameColor2 === '' || HEX_COLOR_RE.test(profile.nameColor2))
    && profile.nameColor2 !== user.nameColor2) {
    user.nameColor2 = profile.nameColor2;
    changed = true;
  }
  if (typeof profile.frame === 'string' && FRAME_PRESETS.includes(profile.frame) && profile.frame !== user.frame) {
    user.frame = profile.frame;
    changed = true;
  }
  for (const key of ['frameColor', 'bannerColor']) {
    if (typeof profile[key] === 'string' && (profile[key] === '' || HEX_COLOR_RE.test(profile[key])) && profile[key] !== user[key]) {
      user[key] = profile[key];
      changed = true;
    }
  }
  // Banner do perfil: imagem igual à foto (GIF pode ser maior)
  if (profile.banner === '' && user.banner) {
    user.banner = null;
    changed = true;
  } else if (typeof profile.banner === 'string' && profile.banner) {
    const match = profile.banner.match(AVATAR_RE);
    const data = match ? Buffer.from(match[2], 'base64') : null;
    const maxBytes = match?.[1].toLowerCase() === 'image/gif' ? MAX_GIF_BANNER_BYTES : MAX_BANNER_BYTES;
    if (data && data.length <= maxBytes && !(user.banner && user.banner.data.equals(data))) {
      user.banner = { mime: match[1].toLowerCase(), data };
      user.bannerV = Date.now();
      changed = true;
    }
  }
  // Som de entrada
  if (profile.joinSound === '' && user.joinSound) {
    user.joinSound = null;
    changed = true;
  } else if (typeof profile.joinSound === 'string' && profile.joinSound) {
    const match = profile.joinSound.match(SOUND_RE);
    const data = match ? Buffer.from(match[2], 'base64') : null;
    if (data && data.length <= MAX_JOIN_SOUND_BYTES && !(user.joinSound && user.joinSound.data.equals(data))) {
      user.joinSound = { mime: match[1].toLowerCase(), data };
      user.joinSoundV = Date.now();
      changed = true;
    }
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
    const maxBytes = match?.[1].toLowerCase() === 'image/gif' ? MAX_GIF_AVATAR_BYTES : MAX_AVATAR_BYTES;
    if (data && data.length <= maxBytes && !(user.avatar && user.avatar.data.equals(data))) {
      user.avatar = { mime: match[1].toLowerCase(), data };
      user.avatarV = Date.now();
      changed = true;
    }
  }
  return changed;
}

function getChannelsSummary(viewer = null) {
  const list = [];
  for (const channel of channels.values()) {
    if (!permissions.visible(viewer, channel)) continue;
    const userList = Array.from(channel.users.values()).map(publicUser);
    const sharers = userList.filter(u => u.isSharing).map(u => u.name);

    list.push({
      id: channel.id,
      name: channel.name,
      isDefault: channel.isDefault,
      createdBy: channel.createdBy,
      hasPassword: Boolean(channel.password),
      isPrivate: Boolean(channel.access?.private),
      canManageAccess: permissions.has(viewer, 'manageChannels'),
      description: channel.description, canWrite: permissions.canWrite(viewer, channel),
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

function broadcastChannels() {
  for (const socket of io.sockets.sockets.values()) {
    const list = getChannelsSummary(socket.data.user);
    socket.emit('channels-list', list);
    socket.emit('channels-summary', list);
  }
}

function emitVisibleUserEvent(event, payload, subject) {
  const channel = channels.get(subject.channelId);
  for (const socket of io.sockets.sockets.values()) {
    if (permissions.visible(socket.data.user, channel)) socket.emit(event, payload);
  }
}

function sendPermissions(socket) {
  const user = socket.data.user;
  const directory = ['manageChannels', 'manageRoles'].some(p => permissions.has(user, p)) ? permissions.snapshot() : null;
  socket.emit('permissions-state', { supported: true, ownershipVersion: 2, owner: permissions.isOwner(user), ownerClaimed: Boolean(permissions.data.ownerId), memberId: user.accessId,
    permissions: PERMISSIONS.filter(p => permissions.has(user, p)), roles: permissions.roles(user), directory });
}

function refreshPermissions() {
  for (const socket of io.sockets.sockets.values()) {
    const user = socket.data.user;
    const wasOwner = user.isAdmin;
    user.isAdmin = permissions.isOwner(user);
    if (wasOwner !== user.isAdmin) emitVisibleUserEvent('user-profile-updated', { userId: user.id, user: publicUser(user) }, user);
    if (user.channelId && !permissions.visible(user, channels.get(user.channelId))) {
      socket.emit('kicked', { by: 'A permissão desse canal mudou' });
      leaveCurrentChannel(socket);
    }
    sendPermissions(socket);
  }
  broadcastChannels();
  broadcastTextChannels();
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
  // Sala com senha: a lista de quem está online não fica aberta pra qualquer um
  if (roomPassword) return res.status(401).json({ error: 'Sala com senha' });
  res.json(getChannelsSummary());
});

app.get('/api/chat-image/:file', (req, res) => {
  const file = req.params.file;
  if (!CHAT_IMAGE_ID_RE.test(file) || !canReadAsset(req)) return res.status(404).end();
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.sendFile(path.join(CHAT_IMAGE_DIR, file), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

app.get('/api/text-image/:file', (req, res) => {
  const file = req.params.file;
  if (!TEXT_IMAGE_FILE_RE.test(file) || !canReadAsset(req)) return res.status(404).end();
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.sendFile(path.join(TEXT_IMAGE_DIR, file), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

for (const [scope, storage] of [['text', textAttachments], ['chat', chatAttachments]]) {
  app.get(`/api/${scope}-file/:file`, (req, res) => {
    const file = req.params.file;
    if (!ATTACHMENT_FILE_RE.test(file) || !canReadAsset(req)) return res.status(404).end();
    res.set({ 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
    // Arquivos arbitrários nunca são interpretados como HTML/SVG na origem da sala.
    const download = file.endsWith('.bin') || req.query.download === '1';
    if (download) {
      res.attachment(attachmentName(req.query.name));
      res.type('application/octet-stream');
    }
    res.sendFile(path.join(storage.directory, file), (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });
}

// Banner e som de entrada: mesmo esquema da foto (some quando a pessoa sai da sala)
function serveUserMedia(field) {
  return (req, res) => {
    const media = io.sockets.sockets.get(req.params.userId)?.data?.user?.[field];
    if (!media) return res.status(404).end();
    res.set({
      // O app abre de telinha://app e baixa o som com fetch: sem isso o navegador bloqueia
      'Access-Control-Allow-Origin': '*',
      'Content-Type': media.mime,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.send(media.data);
  };
}
app.get('/api/soundboard/:id', (req, res) => {
  const sound = soundboard.find((s) => s.id === req.params.id);
  if (!sound) return res.status(404).end();
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Content-Type': sound.mime,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.sendFile(path.join(SOUNDBOARD_DIR, sound.file), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});
app.get('/api/banner/:userId', serveUserMedia('banner'));
app.get('/api/join-sound/:userId', serveUserMedia('joinSound'));

app.get('/api/avatar/:userId', (req, res) => {
  const user = io.sockets.sockets.get(req.params.userId)?.data?.user;
  if (!user?.avatar) return res.status(404).end();
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Content-Type': user.avatar.mime,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.send(user.avatar.data);
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    channelsCount: [...channels.values()].filter(channel => permissions.visible(null, channel)).length,
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
// SENHA DA SALA: o admin define pelo app. Sem ela (ou sem a senha de admin) o Socket.IO
// não conecta. Fica em DATA_DIR/room.json só o hash (scrypt), nunca a senha.
// ----------------------------------------------------
// Quem já entrou uma vez ganha uma "chave de membro" (HMAC do profileId) que o app guarda:
// com ela não precisa digitar a senha. Trocar o memberSecret faz todo mundo precisar de novo.
const ROOM_FILE = DATA_DIR ? path.join(DATA_DIR, 'room.json') : null;
let roomPassword = null; // { salt, hash } ou null (sala aberta)
let memberSecret = randomBytes(32).toString('hex');

function hashRoomPassword(password, salt) {
  return scryptSync(password, Buffer.from(salt, 'hex'), 32).toString('hex');
}

function loadRoomPassword() {
  if (!ROOM_FILE) return;
  try {
    const data = JSON.parse(fs.readFileSync(ROOM_FILE, 'utf8'));
    if (data?.password?.salt && data?.password?.hash) roomPassword = data.password;
    if (typeof data?.memberSecret === 'string' && data.memberSecret.length >= 32) memberSecret = data.memberSecret;
    else saveRoomFile();
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('⚠️ [Sala] Não deu pra ler a senha da sala:', err.message);
    else saveRoomFile();
  }
}

function saveRoomFile() {
  if (!ROOM_FILE) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${ROOM_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ password: roomPassword, memberSecret }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, ROOM_FILE);
  } catch (err) {
    console.error('⚠️ [Sala] Não deu pra salvar room.json:', err.message);
  }
}

function memberKeyFor(profileId) {
  return createHmac('sha256', memberSecret).update(String(profileId)).digest('hex');
}

function isMemberKey(profileId, key) {
  if (typeof profileId !== 'string' || !PROFILE_ID_RE.test(profileId) || typeof key !== 'string' || key.length !== 64) return false;
  const a = Buffer.from(memberKeyFor(profileId));
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

function resetMembers() {
  memberSecret = randomBytes(32).toString('hex');
  saveRoomFile();
}

function setRoomPassword(password) {
  if (password) {
    const salt = randomBytes(16).toString('hex');
    roomPassword = { salt, hash: hashRoomPassword(password, salt) };
  } else {
    roomPassword = null;
  }
  saveRoomFile();
}

function isRoomPassword(password) {
  if (!roomPassword) return true;
  if (typeof password !== 'string' || !password || password.length > 100) return false;
  const a = Buffer.from(hashRoomPassword(password, roomPassword.salt), 'hex');
  const b = Buffer.from(roomPassword.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

loadRoomPassword();

// Quem não tem a senha nem chega a entrar (a senha de admin também abre a porta)
io.use((socket, next) => {
  const auth = socket.handshake.auth || {};
  socket.data.profileKey = verifiedProfileKey(socket);
  const accessId = permissions.authenticatedId(auth.permissionToken, socket.data.profileKey);
  if (permissions.isOwner({ accessId })) return next();
  if (isRoomPassword(auth.roomPassword) || isAdminKey(auth.adminKey) || isMemberKey(auth.profileId, auth.memberKey)) return next();
  const err = new Error('room-password');
  err.data = { reason: auth.roomPassword ? 'wrong' : 'required' };
  next(err);
});

// ----------------------------------------------------
// Socket.IO Real-time Signaling
// ----------------------------------------------------

// Música central: habilitada pelo serviço da Oracle e opcional nas salas locais.
const music = process.env.TELINHA_MUSIC === '1'
  ? (await import('./music/integration.mjs')).installMusic({ io, channels, permissions, sfuSecret: SFU_SECRET,
    sfuInternalUrl: process.env.SFU_INTERNAL_URL || 'http://127.0.0.1:8081' }) : null;

io.on('connection', (socket) => {
  // Mede a ida e volta até este servidor, inclusive sem ninguém mais na call.
  socket.on('connection-ping', (callback) => safeCallback(callback)({ success: true }));
  socket.on('error', (err) => {
    console.error(`⚠️ [Socket Error] Socket ID ${socket.id}:`, err?.message || err);
  });
  const colorIndex = (channels.size + io.engine.clientsCount) % USER_COLORS.length;
  const accessIdentity = permissions.identity(socket.handshake.auth?.permissionToken, socket.data.profileKey, safeString(socket.handshake.auth?.profileId, '', 64));
  const user = {
    accessId: accessIdentity.id,
    mediaId: randomBytes(16).toString('hex'),
    id: socket.id,
    name: `Amigo-${socket.id.slice(0, 4)}`,
    color: USER_COLORS[colorIndex],
    bio: '',
    activity: null,
    nameColor: '',
    nameColor2: '', // com as duas cores o nome vira gradiente
    frame: '', // moldura da foto (FRAME_PRESETS)
    frameColor: '',
    bannerColor: '',
    banner: null,
    bannerV: 0,
    joinSound: null, // áudio que toca pra todo mundo quando a pessoa entra na call
    joinSoundV: 0,
    profileId: null,
    isAdmin: false,
    assetKey: randomBytes(32).toString('hex'),
    serverMuted: false,
    serverDeafened: false,
    avatar: null,
    avatarV: 0,
    channelId: null,
    isSharing: false,
    isCameraOn: false,
    extraScreens: [],
    watching: [], // transmissões que essa pessoa está assistindo (chaves "<id>", "<id>__cam", "<id>__s2"...)
    isMicOn: false,
    isDeafened: false,
    isSpeaking: false,
    streamQuality: '1080p60',
    joinedAt: Date.now()
  };

  user.isAdmin = permissions.isOwner(user);
  socket.data.user = user;
  socket.emit('permission-identity', { token: accessIdentity.token });
  sendPermissions(socket);
  // Scrypt tem custo alto; limita criações e tentativas antes de calcular qualquer hash.
  let channelPasswordAttempts = [];
  const channelPasswordRateLimited = () => {
    const now = Date.now();
    channelPasswordAttempts = channelPasswordAttempts.filter((at) => now - at < 10000);
    if (channelPasswordAttempts.length >= 10) return true;
    channelPasswordAttempts.push(now);
    return false;
  };

  // Send initial channel list and identity to client
  const summary = getChannelsSummary(user);
  socket.emit('channels-list', summary);
  socket.emit('channels-summary', summary);
  socket.emit('me', { id: user.id, name: user.name, color: user.color, sfu: Boolean(SFU_SECRET), admin: Boolean(OWNER_KEY), music: Boolean(music) });


  // Clientes antigos continuam reconhecendo o dono por sua identidade, sem promover admins.
  socket.on('admin-login', safeHandler((raw, callback) => {
    const cb = safeCallback(callback);
    if (permissions.isOwner(user)) return cb({ success: true });
    cb({ success: false, error: 'A administração agora é definida pelos cargos. Peça ao dono do servidor.' });
  }));
  socket.on('owner-claim', safeHandler((raw, callback) => {
    const cb = safeCallback(callback);
    if (permissions.isOwner(user)) return cb({ success: true });
    if (permissions.data.ownerId) return cb({ success: false, error: 'O servidor já tem dono. Peça um cargo ou use a recuperação de propriedade.' });
    if (!isOwnerKey(safeObject(raw).key)) return cb({ success: false, error: 'Chave de propriedade incorreta.' });
    try { permissions.setOwner(user.accessId); refreshPermissions(); cb({ success: true }); }
    catch { cb({ success: false, error: 'Não foi possível salvar a propriedade.' }); }
  }));
  socket.on('owner-recover', safeHandler((raw, callback) => {
    const cb = safeCallback(callback);
    if (!isOwnerKey(safeObject(raw).key)) return cb({ success: false, error: 'Chave de recuperação incorreta.' });
    try { permissions.setOwner(user.accessId); refreshPermissions(); cb({ success: true }); }
    catch { cb({ success: false, error: 'Não foi possível recuperar a propriedade.' }); }
  }));
  socket.on('owner-transfer', safeHandler((raw, callback) => {
    const cb = safeCallback(callback);
    if (!permissions.isOwner(user)) return cb({ success: false, error: 'Só o dono pode transferir a propriedade.' });
    try { permissions.setOwner(safeObject(raw).memberId); refreshPermissions(); cb({ success: true }); }
    catch (err) { cb({ success: false, error: err.message }); }
  }));

  const permissionAction = (permission, action) => safeHandler((raw, callback) => {
    const cb = safeCallback(callback);
    if (!permissions.has(user, permission)) return cb({ success: false, error: 'Você não tem permissão para fazer isso.' });
    try { const result = action(safeObject(raw)); refreshPermissions(); cb({ success: true, ...result }); }
    catch (err) { cb({ success: false, error: err.message || 'Não deu para salvar as permissões.' }); }
  });
  socket.on('role-save', permissionAction('manageRoles', payload => {
    const existing = permissions.data.roles.find(r => r.id === payload.id);
    if (existing) permissions.checkRole(user, existing);
    permissions.checkRole(user, payload);
    return { role: permissions.saveRole(payload) };
  }));
  socket.on('role-delete', permissionAction('manageRoles', payload => {
    const role = permissions.data.roles.find(r => r.id === payload.id);
    if (!role) throw new Error('Esse cargo não existe mais.');
    permissions.checkRole(user, role); permissions.deleteRole(payload.id);
  }));
  socket.on('member-roles', permissionAction('manageRoles', payload => {
    const target = { accessId: payload.memberId };
    if (!permissions.isOwner(user) && (target.accessId === user.accessId || permissions.rank(target) >= permissions.rank(user))) throw new Error('Você só pode atribuir cargos a pessoas abaixo de você.');
    if (!Array.isArray(payload.roles)) throw new Error('Cargos inválidos.');
    const previous = permissions.roles(target).map(r => r.id);
    for (const id of new Set([...previous, ...payload.roles])) {
      if (previous.includes(id) === payload.roles.includes(id)) continue;
      const role = permissions.data.roles.find(r => r.id === id);
      if (!role) throw new Error('Cargo inválido.');
      permissions.checkRole(user, role);
    }
    permissions.assign(payload.memberId, payload.roles);
  }));
  socket.on('channel-access', permissionAction('manageChannels', payload => {
    const channel = channels.get(payload.channelId);
    if (!channel || !permissions.visible(user, channel)) throw new Error('Esse canal não está disponível.');
    if (channel.isDefault) throw new Error('O Geral fica visível para todos.');
    const previous = channel.access;
    channel.access = permissions.access(payload.access);
    try { saveChannels(true); } catch (err) { channel.access = previous; throw err; }
  }));
  socket.on('get-channel-access', safeHandler((raw, callback) => {
    const cb = safeCallback(callback);
    const channel = channels.get(safeObject(raw).channelId);
    if (!permissions.has(user, 'manageChannels') || !channel || !permissions.visible(user, channel)) return cb({ success: false, error: 'Canal indisponível.' });
    cb({ success: true, access: channel.access || { private: false, roles: [], members: [] } });
  }));

  const settingsChannel = payload => (payload.type === 'text' ? textChannels : channels).get(payload.channelId);
  socket.on('get-channel-settings', safeHandler((raw, callback) => {
    const cb = safeCallback(callback), payload = safeObject(raw), ch = settingsChannel(payload);
    if (!ch || !permissions.visible(user, ch) || !permissions.has(user, 'manageChannels')) return cb({ success: false, error: 'Canal indisponível.' });
    cb({ success: true, channel: { id: ch.id, name: ch.name, description: ch.description, isDefault: Boolean(ch.isDefault), hasPassword: Boolean(ch.password),
      access: ch.access || { private: false, roles: [], members: [] }, writeAccess: ch.writeAccess || { private: false, roles: [], members: [] } } });
  }));
  socket.on('channel-settings', permissionAction('manageChannels', payload => {
    const ch = settingsChannel(payload);
    if (!ch || !permissions.visible(user, ch)) throw new Error('Canal indisponível.');
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name || name.length > 30) throw new Error('O nome precisa ter de 1 a 30 caracteres.');
    if (typeof payload.description !== 'string' || payload.description.length > 200) throw new Error('Descrição inválida.');
    const access = permissions.access(payload.access), writeAccess = permissions.access(payload.writeAccess);
    if (ch.isDefault && access.private) throw new Error('O Geral fica visível para todos.');
    const patch = { name, description: payload.description.trim(), access, writeAccess };
    if (payload.type !== 'text' && typeof payload.password === 'string') {
      if (channelPasswordRateLimited()) throw new Error('Aguarde antes de alterar a senha de novo.');
      if (payload.password && (payload.password.length < 4 || payload.password.length > 100)) throw new Error('A senha precisa ter de 4 a 100 caracteres.');
      const salt = randomBytes(16).toString('hex');
      patch.password = payload.password ? { salt, hash: hashRoomPassword(payload.password, salt) } : null;
    }
    const previous = { ...ch }; Object.assign(ch, patch);
    try { saveChannels(true); } catch (err) { Object.assign(ch, previous); throw err; }
  }));

  // Entrou (com senha, chave de membro ou sala aberta): ganha a chave pra próxima vez
  const sendMemberKey = (s) => {
    const pid = s.handshake.auth?.profileId;
    if (typeof pid === 'string' && PROFILE_ID_RE.test(pid)) s.emit('member-key', { profileId: pid, key: memberKeyFor(pid) });
  };
  sendMemberKey(socket);

  // Admin: define ou tira a senha da sala. Quem está conectado recebe a nova e guarda.
  socket.emit('room-info', { hasPassword: Boolean(roomPassword), connectionPing: true, assetKey: user.assetKey });
  socket.on('admin-reset-members', safeHandler((_rawPayload, maybeCallback) => {
    const cb = safeCallback(maybeCallback);
    if (!permissions.has(user, 'manageServer')) return cb({ success: false, error: 'Seu cargo não permite pode fazer isso.' });
    resetMembers();
    // Quem está online agora continua sendo de confiança: ganha a chave nova
    for (const s of io.sockets.sockets.values()) sendMemberKey(s);
    cb({ success: true });
  }));
  socket.on('admin-set-room-password', safeHandler((rawPayload, maybeCallback) => {
    const cb = safeCallback(maybeCallback);
    if (!permissions.has(user, 'manageServer')) return cb({ success: false, error: 'Seu cargo não permite pode mudar a senha da sala.' });
    const raw = safeObject(rawPayload).password;
    const password = typeof raw === 'string' ? raw.trim() : '';
    if (password && (password.length < 4 || password.length > 100)) return cb({ success: false, error: 'A senha precisa ter de 4 a 100 caracteres.' });
    try {
      setRoomPassword(password);
    } catch (err) {
      console.error('⚠️ [Sala] Não deu pra salvar a senha da sala:', err.message);
      return cb({ success: false, error: 'O servidor não conseguiu salvar.' });
    }
    io.emit('room-password-changed', { password, by: user.name });
    io.emit('room-info', { hasPassword: Boolean(password), connectionPing: true });
    cb({ success: true });
  }));

  // Admin: tira alguém da call (a pessoa continua no app e pode entrar de novo)
  socket.on('kick-user', safeHandler((rawPayload, maybeCallback) => {
    const cb = safeCallback(maybeCallback);
    if (!permissions.has(user, 'kickMembers')) return cb({ success: false, error: 'Você não pode tirar pessoas da call.' });
    const targetId = safeObject(rawPayload).userId;
    const target = typeof targetId === 'string' && targetId !== socket.id ? io.sockets.sockets.get(targetId) : null;
    if (!target?.data?.user?.channelId) return cb({ success: false, error: 'Essa pessoa não está em nenhuma call.' });
    if (!permissions.canModerate(user, target.data.user, 'kickMembers') || !permissions.visible(user, channels.get(target.data.user.channelId))) return cb({ success: false, error: 'Seu cargo não permite moderar essa pessoa.' });
    target.emit('kicked', { by: user.name });
    leaveCurrentChannel(target);
    cb({ success: true });
  }));

  // Admin: arrasta alguém pra outra call (o app da pessoa troca de canal sozinho)
  socket.on('admin-move-user', safeHandler((rawPayload, maybeCallback) => {
    const cb = safeCallback(maybeCallback);
    if (!permissions.has(user, 'moveMembers')) return cb({ success: false, error: 'Você não pode mudar pessoas de call.' });
    const payload = safeObject(rawPayload);
    const target = typeof payload.userId === 'string' ? io.sockets.sockets.get(payload.userId) : null;
    const targetUser = target?.data?.user;
    const channel = typeof payload.channelId === 'string' ? channels.get(payload.channelId) : null;
    if (!targetUser?.channelId) return cb({ success: false, error: 'Essa pessoa não está em nenhuma call.' });
    if (!channel) return cb({ success: false, error: 'Esse canal não existe mais.' });
    if (!permissions.canModerate(user, targetUser, 'moveMembers') || !permissions.visible(user, channels.get(targetUser.channelId))
      || !permissions.visible(user, channel) || !permissions.visible(targetUser, channel)) return cb({ success: false, error: 'Sem permissão para mover essa pessoa para esse canal.' });
    if (targetUser.channelId === channel.id) return cb({ success: true });
    if (channel.password) return cb({ success: false, error: 'Esse canal tem senha. A pessoa precisa entrar por conta própria.' });
    target.emit('moved-by-admin', { channelId: channel.id, channelName: channel.name, by: user.name });
    cb({ success: true });
  }));

  // Admin: muta / ensurdece pra todo mundo (vale até o admin desfazer, mesmo reconectando)
  const moderate = (kind) => safeHandler((rawPayload, maybeCallback) => {
    const cb = safeCallback(maybeCallback);
    if (!permissions.has(user, kind === 'mute' ? 'muteMembers' : 'deafenMembers')) return cb({ success: false, error: 'Você não pode moderar o áudio.' });
    const payload = safeObject(rawPayload);
    const target = typeof payload.userId === 'string' ? io.sockets.sockets.get(payload.userId) : null;
    const targetUser = target?.data?.user;
    if (!targetUser) return cb({ success: false, error: 'Essa pessoa saiu.' });
    if (!permissions.canModerate(user, targetUser, kind === 'mute' ? 'muteMembers' : 'deafenMembers') || !permissions.visible(user, channels.get(targetUser.channelId))) return cb({ success: false, error: 'Seu cargo não permite moderar essa pessoa.' });
    if (!targetUser.profileId) return cb({ success: false, error: 'Essa pessoa está com uma versão antiga do app.' });
    const on = payload.on === true;
    const set = kind === 'mute' ? serverMutedProfiles : serverDeafenedProfiles;
    if (on) set.add(targetUser.profileId);
    else set.delete(targetUser.profileId);
    const wasDeafened = targetUser.serverDeafened;
    applyServerModeration(targetUser);
    // Tirou o ensurdecer do admin: volta a ouvir (o mic continua como a pessoa deixar)
    if (kind === 'deafen' && !on && wasDeafened) targetUser.isDeafened = false;
    target.emit('server-moderation', { serverMuted: targetUser.serverMuted, serverDeafened: targetUser.serverDeafened, by: user.name });
    if (targetUser.channelId) {
      const statePayload = {
        userId: target.id,
        channelId: targetUser.channelId,
        isSharing: targetUser.isSharing,
        isCameraOn: targetUser.isCameraOn,
        extraScreens: targetUser.extraScreens,
        isMicOn: targetUser.isMicOn,
        isDeafened: targetUser.isDeafened,
        serverMuted: targetUser.serverMuted,
        serverDeafened: targetUser.serverDeafened,
        isSpeaking: false,
        streamQuality: targetUser.streamQuality
      };
      io.to(targetUser.channelId).emit('user-state-changed', statePayload);
      io.to(targetUser.channelId).emit('user-state-updated', statePayload);
    }
    broadcastChannels();
    cb({ success: true });
  });
  socket.on('admin-mute-user', moderate('mute'));
  socket.on('admin-deafen-user', moderate('deafen'));

  // Apagar canal: quem estiver nele sai da call
  socket.on('delete-channel', safeHandler((rawPayload, maybeCallback) => {
    const cb = safeCallback(maybeCallback);
    const channelId = safeObject(rawPayload).channelId;
    const channel = typeof channelId === 'string' ? channels.get(channelId) : null;
    if (!channel) return cb({ success: false, error: 'Esse canal não existe mais.' });
    if (!canDeleteChannel(user, channel)) {
      return cb({ success: false, error: channel.isDefault ? 'O Geral não pode ser apagado.' : 'Só quem gerencia canais ou quem criou o canal pode apagar.' });
    }
    // Avisa antes: quem está no canal sai da call sozinho no app
    for (const client of io.sockets.sockets.values()) if (permissions.visible(client.data.user, channel)) client.emit('channel-deleted', { channelId: channel.id, channelName: channel.name, by: user.name });
    for (const memberId of [...channel.users.keys()]) {
      const member = io.sockets.sockets.get(memberId);
      if (member) leaveCurrentChannel(member);
    }
    channels.delete(channel.id);
    saveChannels();
    broadcastChannels();
    cb({ success: true });
  }));

  // Client requests channels update
  socket.on('get-channels', safeHandler(() => {
    const list = getChannelsSummary(user);
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
    let access = null;
    if (data.access != null) {
      if (!permissions.has(user, 'manageChannels')) return cb({ success: false, error: 'Seu cargo não permite configurar canais invisíveis.' });
      try { access = permissions.access(data.access); }
      catch (err) { return cb({ success: false, error: err.message }); }
    }
    const password = data.password ?? '';
    if (typeof password !== 'string' || (password && (password.length < 4 || password.length > 100))) {
      return cb({ success: false, error: 'A senha precisa ter de 4 a 100 caracteres.' });
    }
    if (password && channelPasswordRateLimited()) return cb({ success: false, error: 'Muitas tentativas. Espere 10 segundos e tente de novo.' });
    // Quem cria fora da call ainda não mandou o perfil: o id dele vem junto pra poder apagar depois
    if (!user.profileId && typeof data.profileId === 'string' && PROFILE_ID_RE.test(data.profileId) && !data.profileId.toLowerCase().startsWith('conta-')) {
      user.profileId = data.profileId;
    }

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
      const salt = password ? randomBytes(16).toString('hex') : null;
      const protectedPassword = password ? { salt, hash: hashRoomPassword(password, salt) } : null;
      channels.set(finalId, newChannel({ id: finalId, name: cleanName, createdBy: user.profileId, password: protectedPassword, access }));
      try { saveChannels(true); }
      catch (err) { channels.delete(finalId); return cb({ success: false, error: err.message }); }
      broadcastChannels();
      for (const client of io.sockets.sockets.values()) if (permissions.visible(client.data.user, channels.get(finalId))) client.emit('channel-created', {
        channel: {
          id: finalId,
          name: cleanName,
          hasPassword: Boolean(password),
          userCount: 0,
          activeStreams: 0
        }
      });
    }

    cb({ success: true, channelId: finalId, channelName: cleanName });
  }));

  // Channel Joining & Switching (Defensive)
  socket.on('join-channel', safeHandler((rawPayload, maybeCallback) => {
    const payload = safeObject(rawPayload);
    const cb = safeCallback(maybeCallback);
    const rawChanId = typeof payload.channelId === 'string' ? payload.channelId.trim().toLowerCase() : '';
    const cleanChannelId = rawChanId.slice(0, 64).replace(/[^a-z0-9_-]/g, '') || 'geral';

    // Confere antes de mexer no perfil ou sair da call atual. Admin e criador também precisam.
    const destination = channels.get(cleanChannelId);
    if (destination && !permissions.visible(user, destination)) {
      const result = { success: false, code: 'channel-unavailable', error: 'Esse canal não está disponível.' };
      if (typeof maybeCallback !== 'function') socket.emit('channel-join-error', result);
      return cb(result);
    }
    if (destination?.password && user.channelId !== cleanChannelId) {
      let reason = payload.password ? 'wrong' : 'required';
      let allowed = false;
      if (channelPasswordRateLimited()) reason = 'rate-limited';
      else if (validChannelPasswordHash(destination.password) && typeof payload.password === 'string' && payload.password.length >= 4 && payload.password.length <= 100) {
        const hash = Buffer.from(hashRoomPassword(payload.password, destination.password.salt), 'hex');
        allowed = timingSafeEqual(hash, Buffer.from(destination.password.hash, 'hex'));
      }
      if (!allowed) {
        const result = { success: false, code: 'channel-password', reason, channelId: cleanChannelId,
          error: reason === 'rate-limited' ? 'Muitas tentativas. Espere 10 segundos e tente de novo.' : 'Esse canal precisa da senha certa para entrar.' };
        if (typeof maybeCallback !== 'function') socket.emit('channel-join-error', result);
        return cb(result);
      }
    }

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
      applyServerModeration(user);
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
      broadcastChannels();
      return cb({ success: true });
    }

    if (userName) {
      user.name = userName;
    }
    if (isMicOn !== undefined) user.isMicOn = isMicOn;
    if (isDeafened !== undefined) user.isDeafened = isDeafened;
    if (isSharing !== undefined) user.isSharing = isSharing;
    applyServerModeration(user);

    // Canal que não existe (link antigo, versão antiga do app): cria temporário, some quando esvaziar
    if (!channels.has(cleanChannelId)) {
      const formattedName = cleanChannelId.charAt(0).toUpperCase() + cleanChannelId.slice(1);
      channels.set(cleanChannelId, newChannel({ id: cleanChannelId, name: formattedName, temporary: true }));
    }

    const channel = channels.get(cleanChannelId);
    user.mediaId = randomBytes(16).toString('hex');
    user.channelId = cleanChannelId;
    user.watching = [];
    channel.users.set(socket.id, user);

    socket.join(cleanChannelId);

    // Som de entrada sorteado aqui, pra quem entrou e quem já estava ouvirem o mesmo áudio
    const soundSeed = callSoundSeed();

    // 1. Send channel state & history to joining user
    socket.emit('channel-state', {
      channelId: cleanChannelId,
      channelName: channel.name,
      me: publicUser(user),
      users: getChannelUsersList(cleanChannelId),
      recentMessages: channel.messages.slice(-50),
      soundSeed
    });

    // 2. Notify other channel members
    const joinedPayload = {
      userId: socket.id,
      name: user.name,
      color: user.color,
      channelId: cleanChannelId,
      user: publicUser(user),
      users: getChannelUsersList(cleanChannelId),
      soundSeed
    };
    socket.to(cleanChannelId).emit('user-joined', joinedPayload);
    socket.to(cleanChannelId).emit('user-channel-joined', joinedPayload);

    // 3. Broadcast channels list globally so all users see updated presence
    broadcastChannels();
    cb({ success: true });
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
    // Câmera é uma transmissão separada da tela (dá pra ter as duas ao mesmo tempo)
    if (typeof rawPayload.isCameraOn === 'boolean' && user.isCameraOn !== rawPayload.isCameraOn) {
      user.isCameraOn = rawPayload.isCameraOn;
      presenceChanged = true;
    }
    // Telas a mais da mesma pessoa: números 2 e 3 (a tela 1 é o isSharing)
    if (Array.isArray(rawPayload.extraScreens)) {
      const next = [...new Set(rawPayload.extraScreens.filter((n) => EXTRA_SCREEN_NUMBERS.includes(n)))].sort();
      if (next.join() !== user.extraScreens.join()) {
        user.extraScreens = next;
        presenceChanged = true;
      }
    }
    // Mutado/ensurdecido pelo admin não consegue se desmutar
    const micLocked = user.serverMuted || user.serverDeafened;
    if (typeof rawPayload.isMicOn === 'boolean' && user.isMicOn !== rawPayload.isMicOn && !(micLocked && rawPayload.isMicOn)) {
      user.isMicOn = rawPayload.isMicOn;
      presenceChanged = true;
    }
    if (typeof rawPayload.isDeafened === 'boolean' && user.isDeafened !== rawPayload.isDeafened && !(user.serverDeafened && !rawPayload.isDeafened)) {
      user.isDeafened = rawPayload.isDeafened;
      presenceChanged = true;
    }
    if (typeof rawPayload.isSpeaking === 'boolean' && user.isSpeaking !== rawPayload.isSpeaking) {
      user.isSpeaking = rawPayload.isSpeaking;
    }
    // Quem está assistindo o quê (as fotinhas do lado do nome de quem transmite)
    if (Array.isArray(rawPayload.watching)) {
      const next = [...new Set(rawPayload.watching.filter((k) => typeof k === 'string' && WATCH_KEY_RE.test(k)))]
        .slice(0, MAX_WATCHING).sort();
      if (next.join() !== user.watching.join()) user.watching = next;
    }
    if (typeof rawPayload.streamQuality === 'string' && rawPayload.streamQuality.trim()) {
      user.streamQuality = rawPayload.streamQuality.trim().slice(0, 16);
    }

    const statePayload = {
      userId: socket.id,
      channelId,
      isSharing: user.isSharing,
      isCameraOn: user.isCameraOn,
      extraScreens: user.extraScreens,
      watching: user.watching,
      isMicOn: user.isMicOn,
      isDeafened: user.isDeafened,
      serverMuted: user.serverMuted,
      serverDeafened: user.serverDeafened,
      isSpeaking: user.isSpeaking,
      streamQuality: user.streamQuality
    };

    // Emit state update to everyone in the channel
    io.to(channelId).emit('user-state-changed', statePayload);
    io.to(channelId).emit('user-state-updated', statePayload);

    // If presence-affecting attributes changed, broadcast global channels-list
    if (presenceChanged) {
      broadcastChannels();
    }
  });

  // Senha temporária pro SFU. Sala do SFU = "<canal>__<quem transmite>":
  // só o próprio dono transmite nela, e só quem está no mesmo canal assiste.
  socket.on('sfu-token', safeHandler((rawPayload, maybeCallback) => {
    const callback = safeCallback(maybeCallback);
    const payload = safeObject(rawPayload);
    if (!SFU_SECRET || !user.channelId || !permissions.visible(user, channels.get(user.channelId))) return callback({ ok: false });
    if (payload.kind === 'music') {
      const state = music?.state(user.channelId);
      if (payload.role !== 'viewer' || !state || !['playing', 'paused'].includes(state.phase)) return callback({ ok: false });
      const sala = `${user.channelId}__musica`;
      const exp = String(Math.floor(Date.now() / 1000) + 60);
      const signature = createHmac('sha256', SFU_SECRET).update(`${sala}|viewer|${exp}|${user.mediaId}`).digest('hex');
      return callback({ ok: true, path: SFU_PATH, sala, role: 'viewer', exp, token: `${user.mediaId}.${signature}` });
    }
    const ownerId = typeof payload.ownerId === 'string' ? payload.ownerId : '';
    const role = payload.role === 'host' ? 'host' : 'viewer';
    const owner = io.sockets.sockets.get(ownerId)?.data?.user;
    if (!owner || owner.channelId !== user.channelId) return callback({ ok: false });
    if (role === 'host' && ownerId !== socket.id) return callback({ ok: false });
    // Voz também passa pelo SFU: cada um que fala tem a sua sala de voz no canal
    // Voz e câmera também passam pelo SFU, cada uma na sua sala (separada da tela)
    // Telas a mais: "screen2" → "__s2"
    const extra = typeof payload.kind === 'string' && /^screen([23])$/.exec(payload.kind);
    const suffix = payload.kind === 'voice' ? '__voz' : payload.kind === 'camera' ? '__cam' : extra ? `__s${extra[1]}` : '';
    const sala = `${user.channelId}__${ownerId}${suffix}`;
    const exp = String(Math.floor(Date.now() / 1000) + 60);
    const signature = createHmac('sha256', SFU_SECRET).update(`${sala}|${role}|${exp}|${user.mediaId}`).digest('hex');
    const token = `${user.mediaId}.${signature}`;
    callback({ ok: true, path: SFU_PATH, sala, role, exp, token });
  }));

  // O perfil continua local; só publica a aparência para a sala.
  socket.on('update-profile', safeHandler((rawPayload, callback) => {
    const cb = safeCallback(callback);
    if (!applyProfile(user, rawPayload)) return cb({ success: true });
    permissions.remember(user.accessId, user.name);
    emitVisibleUserEvent('user-profile-updated', { userId: socket.id, user: publicUser(user) }, user);
    for (const client of io.sockets.sockets.values()) if (permissions.has(client.data.user, 'manageChannels')) sendPermissions(client);
    broadcastChannels();
    cb({ success: true });
  }));

  let activityChanges = [];
  socket.on('update-activity', safeHandler((raw, callback) => {
    const cb = safeCallback(callback);
    let activity = null;
    if (raw !== null) {
      if (!isPlainObject(raw) || typeof raw.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(raw.id)
        || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 80
        || !Number.isSafeInteger(raw.startedAt) || raw.startedAt < Date.now() - 30 * 86400000
        || raw.startedAt > Date.now() + 60000) return cb({ success: false });
      activity = { id: raw.id, name: raw.name.trim(), startedAt: Math.min(raw.startedAt, Date.now()) };
    }
    if (JSON.stringify(activity) === JSON.stringify(user.activity)) return cb({ success: true });
    activityChanges = activityChanges.filter((time) => Date.now() - time < 10000);
    if (activity && activityChanges.length >= 10) return cb({ success: false });
    activityChanges.push(Date.now());
    user.activity = activity;
    emitVisibleUserEvent('user-activity-updated', { userId: socket.id, activity }, user);
    if (user.channelId) broadcastChannels();
    cb({ success: true });
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
    if (!channel || !permissions.canWrite(user, channel)) return;

    const chatMsg = {
      id: `msg-${Date.now()}-${randomUUID().slice(0, 8)}`,
      channelId: user.channelId,
      senderId: socket.id,
      userId: socket.id,
      profileId: user.profileId,
      replyTo: replySnippet({ scope: 'call', channel }, rawPayload.replyTo),
      senderName: user.name,
      userName: user.name,
      userColor: user.color,
      userNameColor: user.nameColor || '',
      userNameColor2: user.nameColor2 || '',
      userAvatarV: user.avatar ? user.avatarV : 0,
      text: rawText.slice(0, 600),
      timestamp: Date.now()
    };

    indexAssets(channel, [chatMsg], 'voice');
    channel.messages.push(chatMsg);
    if (channel.messages.length > 50) {
      channel.messages.shift();
    }

    io.to(user.channelId).emit('chat-message', chatMsg);
  }));

  // ---------------- Responder, editar, apagar e reagir (chat da call e canais de texto) ----------------
  // target: { scope: 'call', channel } (o canal de voz em que a pessoa está) ou { scope: 'text', ch }
  const chatTarget = (payload) => {
    if (payload.scope === 'text') {
      const ch = typeof payload.channelId === 'string' ? textChannels.get(payload.channelId) : null;
      return ch && permissions.visible(user, ch) ? { scope: 'text', ch } : null;
    }
    const channel = user.channelId ? channels.get(user.channelId) : null;
    return channel ? { scope: 'call', channel } : null;
  };
  const findChatMessage = (target, id) => {
    if (typeof id !== 'string') return null;
    if (target.scope === 'call') return target.channel.messages.find((m) => m.id === id) || null;
    return target.ch.recent.find((m) => m.id === id) || readTextMessages(target.ch.id).find((m) => m.id === id) || null;
  };
  function replySnippet(target, id) {
    const m = findChatMessage(target, id);
    if (!m) return undefined;
    return { id: m.id, userName: m.userName, text: (m.text || m.attachment?.name || '').slice(0, 140), image: Boolean(m.image) };
  }
  const announceChat = (target, event, data) => {
    if (target.scope === 'call') io.to(target.channel.id).emit(`chat-${event}`, data);
    else emitText(target.ch, `text-${event}`, { channelId: target.ch.id, ...data });
  };
  // A cópia que está na memória (call ou as recentes do canal de texto) também muda
  const patchChatMessage = (target, message) => {
    const list = target.scope === 'call' ? target.channel.messages : target.ch.recent;
    const i = list.findIndex((m) => m.id === message.id);
    if (i !== -1) list[i] = message;
  };
  const chatOpTimes = [];
  const chatOpRateLimited = () => {
    const now = Date.now();
    while (chatOpTimes.length && now - chatOpTimes[0] > 3000) chatOpTimes.shift();
    if (chatOpTimes.length >= 10) return true;
    chatOpTimes.push(now);
    return false;
  };
  const chatOpPrelude = (rawPayload, cb) => {
    const payload = safeObject(rawPayload);
    const target = chatTarget(payload);
    if (!target) return cb({ success: false, error: 'Esse chat não existe mais.' }), null;
    if (!user.profileId) return cb({ success: false, error: 'Atualize o app pra fazer isso.' }), null;
    if (chatOpRateLimited()) return cb({ success: false, error: 'Calma, muita coisa seguida.' }), null;
    const msg = findChatMessage(target, payload.messageId);
    if (!msg) return cb({ success: false, error: 'Essa mensagem não existe mais.' }), null;
    return { payload, target, msg };
  };

  socket.on('message-edit', safeHandler((rawPayload, maybeCallback) => {
    const cb = safeCallback(maybeCallback);
    const ctx = chatOpPrelude(rawPayload, cb);
    if (!ctx) return;
    const { payload, target, msg } = ctx;
    if (!permissions.canWrite(user, target.ch || target.channel)) return cb({ success: false, error: 'Você não pode escrever neste canal.' });
    if (!msg.profileId || msg.profileId !== user.profileId) return cb({ success: false, error: 'Só dá pra editar as suas mensagens.' });
    const max = target.scope === 'text' ? MAX_TEXT_LENGTH : 600;
    const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, max) : '';
    if (!text && !msg.image && !msg.attachment) return cb({ success: false, error: 'Mensagem vazia: use apagar.' });
    const updated = { ...msg, text, editedAt: Date.now() };
    try {
      if (target.scope === 'text') appendTextOp(target.ch, { op: 'edit', id: msg.id, text, editedAt: updated.editedAt });
    } catch (err) {
      console.error('⚠️ [Texto] Não deu pra salvar a edição:', err.message);
      return cb({ success: false, error: 'O servidor não conseguiu salvar.' });
    }
    patchChatMessage(target, updated);
    announceChat(target, 'message-updated', { message: updated });
    cb({ success: true });
  }));

  socket.on('message-delete', safeHandler((rawPayload, maybeCallback) => {
    const cb = safeCallback(maybeCallback);
    const ctx = chatOpPrelude(rawPayload, cb);
    if (!ctx) return;
    const { target, msg } = ctx;
    const mine = msg.profileId && msg.profileId === user.profileId;
    if (!mine && !permissions.has(user, 'manageMessages')) return cb({ success: false, error: 'Só dá pra apagar as suas mensagens.' });
    try {
      if (target.scope === 'text') {
        appendTextOp(target.ch, { op: 'delete', id: msg.id });
        const file = textImageFileOf(msg);
        if (file) removeTextImage(file);
        removeTextAttachment(msg);
        target.ch.count = Math.max(0, target.ch.count - 1);
      } else if (msg.attachment) {
        const file = msg.attachment.url.split('/').pop();
        if (ATTACHMENT_FILE_RE.test(file)) chatAttachments.remove(file);
      }
    } catch (err) {
      console.error('⚠️ [Texto] Não deu pra apagar:', err.message);
      return cb({ success: false, error: 'O servidor não conseguiu apagar.' });
    }
    const list = target.scope === 'call' ? target.channel.messages : target.ch.recent;
    const i = list.findIndex((m) => m.id === msg.id);
    if (i !== -1) list.splice(i, 1);
    announceChat(target, 'message-deleted', { messageId: msg.id });
    cb({ success: true });
  }));

  // Reação numa mensagem: clica de novo pra tirar. Guardada pelo perfil (vale reconectando).
  const MAX_REACTION_EMOJIS = 20;
  socket.on('message-react', safeHandler((rawPayload, maybeCallback) => {
    const cb = safeCallback(maybeCallback);
    const ctx = chatOpPrelude(rawPayload, cb);
    if (!ctx) return;
    const { payload, target, msg } = ctx;
    const emoji = typeof payload.emoji === 'string' ? payload.emoji.trim() : '';
    if (!emoji || emoji.length > 32 || !EMOJI_RE.test(emoji)) return cb({ success: false, error: 'Emoji inválido.' });
    const reactions = Object.fromEntries(Object.entries(msg.reactions || {}).map(([e, list]) => [e, [...list]]));
    const list = reactions[emoji] || [];
    const i = list.findIndex((r) => r.p === user.profileId);
    if (i !== -1) list.splice(i, 1);
    else {
      if (!reactions[emoji] && Object.keys(reactions).length >= MAX_REACTION_EMOJIS) return cb({ success: false, error: 'Emoji demais nessa mensagem.' });
      list.push({ p: user.profileId, n: user.name });
    }
    if (list.length) reactions[emoji] = list;
    else delete reactions[emoji];
    const updated = { ...msg, reactions };
    try {
      if (target.scope === 'text') appendTextOp(target.ch, { op: 'reactions', id: msg.id, reactions });
    } catch (err) {
      console.error('⚠️ [Texto] Não deu pra salvar a reação:', err.message);
      return cb({ success: false, error: 'O servidor não conseguiu salvar.' });
    }
    patchChatMessage(target, updated);
    announceChat(target, 'message-updated', { message: updated });
    cb({ success: true });
  }));

  // Fixar mensagem (só canal de texto): qualquer um fixa e desfixa
  const MAX_PINS_PER_CHANNEL = 50;
  socket.on('message-pin', safeHandler((rawPayload, maybeCallback) => {
    const cb = safeCallback(maybeCallback);
    const ctx = chatOpPrelude({ ...safeObject(rawPayload), scope: 'text' }, cb);
    if (!ctx) return;
    const { payload, target, msg } = ctx;
    const pin = payload.pinned === true;
    if (pin && !msg.pinned && readTextMessages(target.ch.id).filter((m) => m.pinned).length >= MAX_PINS_PER_CHANNEL) {
      return cb({ success: false, error: `Esse canal já tem ${MAX_PINS_PER_CHANNEL} fixadas: desfixe alguma.` });
    }
    const pinned = pin ? { by: user.name, at: Date.now() } : null;
    const updated = { ...msg };
    if (pinned) updated.pinned = pinned;
    else delete updated.pinned;
    try {
      appendTextOp(target.ch, { op: 'pin', id: msg.id, pinned });
    } catch (err) {
      console.error('⚠️ [Texto] Não deu pra fixar:', err.message);
      return cb({ success: false, error: 'O servidor não conseguiu salvar.' });
    }
    patchChatMessage(target, updated);
    announceChat(target, 'message-updated', { message: updated });
    cb({ success: true });
  }));

  socket.on('text-pins', safeHandler((rawPayload, maybeCallback) => {
    const cb = safeCallback(maybeCallback);
    const id = safeObject(rawPayload).channelId;
    const ch = typeof id === 'string' ? textChannels.get(id) : null;
    if (!ch || !permissions.visible(user, ch)) return cb({ success: false, messages: [] });
    const messages = readTextMessages(ch.id).filter((m) => m.pinned).sort((a, b) => b.pinned.at - a.pinned.at);
    cb({ success: true, messages });
  }));

  // "Fulano está digitando…": o app manda a cada ~3 s enquanto a pessoa digita
  let lastTypingAt = 0;
  socket.on('typing', safeHandler((rawPayload) => {
    const now = Date.now();
    if (now - lastTypingAt < 1500) return;
    lastTypingAt = now;
    const payload = safeObject(rawPayload);
    const data = { userId: socket.id, name: user.name };
    if (payload.scope === 'text') {
      const ch = textChannels.get(payload.channelId);
      if (!ch || !permissions.canWrite(user, ch)) return;
      emitText(ch, 'typing', { ...data, scope: 'text', channelId: payload.channelId }, socket);
    } else if (user.channelId && permissions.canWrite(user, channels.get(user.channelId))) {
      socket.to(user.channelId).emit('typing', { ...data, scope: 'call', channelId: user.channelId });
    }
  }));

  // ---------------- Soundboard ----------------
  socket.emit('soundboard-list', soundboardList());

  socket.on('soundboard-add', safeHandler((rawPayload, maybeCallback) => {
    const cb = safeCallback(maybeCallback);
    const payload = safeObject(rawPayload);
    if (!user.profileId) return cb({ success: false, error: 'Atualize o app pra fazer isso.' });
    const name = (typeof payload.name === 'string' ? payload.name.trim() : '').slice(0, 30);
    if (!name) return cb({ success: false, error: 'Dê um nome pro som.' });
    const emoji = typeof payload.emoji === 'string' && payload.emoji.trim().length <= 32 && EMOJI_RE.test(payload.emoji.trim())
      ? payload.emoji.trim() : '🔊';
    const match = typeof payload.data === 'string' ? payload.data.match(SOUND_RE) : null;
    const data = match ? Buffer.from(match[2], 'base64') : null;
    if (!data || !data.length) return cb({ success: false, error: 'Esse arquivo não é um áudio.' });
    if (data.length > MAX_SOUNDBOARD_BYTES) return cb({ success: false, error: 'Áudio grande demais (máximo 1 MB).' });
    if (soundboard.filter((s) => s.profileId === user.profileId).length >= MAX_SOUNDS_PER_PROFILE) {
      return cb({ success: false, error: `Você já tem ${MAX_SOUNDS_PER_PROFILE} sons: apague um pra pôr outro.` });
    }
    if (soundboard.length >= MAX_SOUNDS_TOTAL) return cb({ success: false, error: 'O soundboard está cheio.' });
    try {
      const sound = addSoundboardSound({ profileId: user.profileId, ownerName: user.name, name, emoji, mime: match[1].toLowerCase(), data });
      io.emit('soundboard-list', soundboardList());
      cb({ success: true, id: sound.id });
    } catch (err) {
      console.error('⚠️ [Soundboard] Não deu pra salvar:', err.message);
      cb({ success: false, error: 'O servidor não conseguiu guardar o som.' });
    }
  }));

  socket.on('soundboard-delete', safeHandler((rawPayload, maybeCallback) => {
    const cb = safeCallback(maybeCallback);
    const id = safeObject(rawPayload).id;
    const sound = soundboard.find((s) => s.id === id);
    if (!sound) return cb({ success: false, error: 'Esse som não existe mais.' });
    if (sound.profileId !== user.profileId && !permissions.has(user, 'manageMessages')) return cb({ success: false, error: 'Só quem colocou ou quem modera o soundboard pode apagar.' });
    removeSoundboardSound(sound);
    io.emit('soundboard-list', soundboardList());
    cb({ success: true });
  }));

  let lastSoundboardAt = 0;
  socket.on('soundboard-play', safeHandler((rawPayload, maybeCallback) => {
    const cb = safeCallback(maybeCallback);
    const id = safeObject(rawPayload).id;
    if (!user.channelId) return cb({ success: false, error: 'Entre numa call pra tocar.' });
    const builtIn = typeof id === 'string' && BUILTIN_SOUND_RE.test(id);
    if (!builtIn && !soundboard.some((s) => s.id === id)) return cb({ success: false, error: 'Esse som não existe mais.' });
    const now = Date.now();
    if (now - lastSoundboardAt < 2500) return cb({ success: false, error: 'Calma, um som de cada vez.' });
    lastSoundboardAt = now;
    io.to(user.channelId).emit('soundboard-played', { id, userId: socket.id, userName: user.name });
    cb({ success: true });
  }));

  // ---------------- Canais de texto ----------------
  socket.emit('text-channels', getTextChannelsSummary(user));

  socket.on('create-text-channel', safeHandler((rawPayload, maybeCallback) => {
    const cb = safeCallback(maybeCallback);
    const data = safeObject(rawPayload);
    if (!user.profileId && typeof data.profileId === 'string' && PROFILE_ID_RE.test(data.profileId)) {
      user.profileId = data.profileId;
    }
    const cleanName = (typeof data.name === 'string' ? data.name.trim() : '').slice(0, 30);
    if (!cleanName) return cb({ success: false, error: 'Dê um nome pro canal.' });
    const slug = cleanName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || `texto-${Date.now().toString(36).slice(-4)}`;
    let id = slug.slice(0, 60);
    for (let n = 2; textChannels.has(id); n++) id = `${slug.slice(0, 56)}-${n}`;
    let access = null;
    try {
      if (data.access) {
        if (!permissions.has(user, 'manageChannels')) throw new Error('Seu cargo não permite configurar canais invisíveis.');
        access = permissions.access(data.access);
      }
      textChannels.set(id, newTextChannel({ id, name: cleanName, createdBy: user.profileId, access }));
      saveChannels(true);
    } catch (err) { textChannels.delete(id); return cb({ success: false, error: err.message }); }
    broadcastTextChannels();
    cb({ success: true, channelId: id, channelName: cleanName });
  }));

  socket.on('delete-text-channel', safeHandler((rawPayload, maybeCallback) => {
    const cb = safeCallback(maybeCallback);
    const id = safeObject(rawPayload).channelId;
    const ch = typeof id === 'string' ? textChannels.get(id) : null;
    if (!ch || !permissions.visible(user, ch)) return cb({ success: false, error: 'Canal indisponível ou sem permissão para enviar.' });
    if (!canDeleteChannel(user, ch)) return cb({ success: false, error: 'Só quem gerencia canais ou quem criou o canal pode apagar.' });
    textChannels.delete(ch.id);
    deleteTextChannelData(ch);
    saveChannels();
    emitText(ch, 'text-channel-deleted', { channelId: ch.id, channelName: ch.name, by: user.name });
    broadcastTextChannels();
    cb({ success: true });
  }));

  // Histórico: sem "before", as últimas; com "before" (id de mensagem), as anteriores a ela
  socket.on('text-history', safeHandler((rawPayload, maybeCallback) => {
    const cb = safeCallback(maybeCallback);
    const payload = safeObject(rawPayload);
    const ch = typeof payload.channelId === 'string' ? textChannels.get(payload.channelId) : null;
    if (!ch || !permissions.visible(user, ch)) return cb({ success: false, messages: [], hasMore: false });
    if (typeof payload.before !== 'string') {
      const messages = ch.recent.slice(-TEXT_PAGE_SIZE);
      return cb({ success: true, messages, hasMore: ch.count > messages.length });
    }
    const all = readTextMessages(ch.id);
    const idx = all.findIndex((m) => m.id === payload.before);
    if (idx <= 0) return cb({ success: true, messages: [], hasMore: false });
    const start = Math.max(0, idx - TEXT_PAGE_SIZE);
    cb({ success: true, messages: all.slice(start, idx), hasMore: start > 0 });
  }));

  // Até 5 mensagens a cada 3 s por pessoa (texto e anexos juntos)
  const textSendTimes = [];
  const textRateLimited = () => {
    const now = Date.now();
    while (textSendTimes.length && now - textSendTimes[0] > 3000) textSendTimes.shift();
    if (textSendTimes.length >= 5) return true;
    textSendTimes.push(now);
    return false;
  };

  const textMessageBase = (ch) => ({
    id: `msg-${Date.now()}-${randomUUID().slice(0, 8)}`,
    channelId: ch.id,
    senderId: socket.id,
    userId: socket.id,
    profileId: user.profileId,
    userName: user.name,
    userColor: user.color,
    userNameColor: user.nameColor || '',
    userNameColor2: user.nameColor2 || '',
    userAvatarV: user.avatar ? user.avatarV : 0,
    timestamp: Date.now()
  });

  const publishTextMessage = (ch, msg, cb) => {
    try {
      appendTextMessage(ch, msg);
    } catch (err) {
      console.error('⚠️ [Texto] Não deu pra salvar a mensagem:', err.message);
      return cb({ success: false, error: 'O servidor não conseguiu salvar a mensagem.' });
    }
    emitText(ch, 'text-message', msg);
    cb({ success: true });
  };

  socket.on('text-message', safeHandler((rawPayload, maybeCallback) => {
    const cb = safeCallback(maybeCallback);
    const payload = safeObject(rawPayload);
    const ch = typeof payload.channelId === 'string' ? textChannels.get(payload.channelId) : null;
    if (!ch || !permissions.canWrite(user, ch)) return cb({ success: false, error: 'Canal indisponível ou sem permissão para enviar.' });
    const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, MAX_TEXT_LENGTH) : '';
    if (!text) return cb({ success: false, error: 'Mensagem vazia.' });
    if (textRateLimited()) return cb({ success: false, error: 'Calma, muitas mensagens seguidas.' });
    publishTextMessage(ch, { ...textMessageBase(ch), replyTo: replySnippet({ scope: 'text', ch }, payload.replyTo), text }, cb);
  }));

  socket.on('text-image', safeHandler((rawPayload, maybeCallback) => {
    const cb = safeCallback(maybeCallback);
    const payload = safeObject(rawPayload);
    const ch = typeof payload.channelId === 'string' ? textChannels.get(payload.channelId) : null;
    if (!ch || !permissions.canWrite(user, ch)) return cb({ success: false, error: 'Canal indisponível ou sem permissão para enviar.' });
    const mime = typeof payload.mime === 'string' ? payload.mime.toLowerCase() : '';
    const data = Buffer.isBuffer(payload.data) ? payload.data : null;
    if (!CHAT_IMAGE_TYPES[mime] || !data || data.length === 0) return cb({ success: false, error: 'Esse arquivo não é uma imagem.' });
    if (data.length > MAX_CHAT_IMAGE_BYTES) return cb({ success: false, error: 'Imagem grande demais (máximo 15 MB).' });
    if (!imageMatchesType(data, mime)) return cb({ success: false, error: 'Esse arquivo não é uma imagem.' });
    if (textRateLimited()) return cb({ success: false, error: 'Calma, muitas mensagens seguidas.' });
    let file;
    try {
      file = saveTextImage(data, mime);
    } catch (err) {
      console.error('⚠️ [Texto] Não deu pra salvar a imagem:', err.message);
      return cb({ success: false, error: 'O servidor não conseguiu guardar a imagem.' });
    }
    const dim = (v) => (Number.isInteger(v) && v > 0 && v <= 20000 ? v : null);
    const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, MAX_TEXT_LENGTH) : '';
    publishTextMessage(ch, {
      ...textMessageBase(ch),
      replyTo: replySnippet({ scope: 'text', ch }, payload.replyTo),
      text,
      image: { url: `/api/text-image/${file}`, width: dim(payload.width), height: dim(payload.height) }
    }, cb);
  }));

  for (const scope of ['text', 'chat']) {
    socket.on(`${scope}-file`, safeHandler((rawPayload, maybeCallback) => {
      const cb = safeCallback(maybeCallback);
      const payload = safeObject(rawPayload);
      const isText = scope === 'text';
      const channel = isText ? textChannels.get(payload.channelId) : channels.get(user.channelId);
      if (!channel || !permissions.canWrite(user, channel)) return cb({ success: false, error: isText ? 'Esse canal não existe mais.' : 'Entre numa call pra enviar arquivos.' });
      let prepared;
      try { prepared = prepareAttachment(payload); }
      catch (err) { return cb({ success: false, error: err.message }); }
      if (isText ? textRateLimited() : Date.now() - lastChatImageAt < 2000) {
        return cb({ success: false, error: 'Calma, aguarde um pouco antes do próximo envio.' });
      }
      const storage = isText ? textAttachments : chatAttachments;
      let file;
      try {
        file = storage.save(prepared.data, prepared.ext);
        const msg = {
          ...textMessageBase(channel),
          replyTo: replySnippet(isText ? { scope: 'text', ch: channel } : { scope: 'call', channel }, payload.replyTo),
          text: typeof payload.text === 'string' ? payload.text.trim().slice(0, isText ? MAX_TEXT_LENGTH : 600) : '',
          attachment: { url: `/api/${scope}-file/${file}`, name: prepared.name, mime: prepared.mime, size: prepared.data.length }
        };
        if (isText) {
          appendTextMessage(channel, msg);
          emitText(channel, 'text-message', msg);
        } else {
          lastChatImageAt = Date.now();
          msg.senderName = user.name;
          indexAssets(channel, [msg], 'voice');
          channel.messages.push(msg);
          if (channel.messages.length > 50) channel.messages.shift();
          io.to(channel.id).emit('chat-message', msg);
        }
        cb({ success: true });
      } catch (err) {
        if (file) storage.remove(file);
        console.error('⚠️ [Anexo] Não deu pra guardar o arquivo:', err.message);
        cb({ success: false, error: 'O servidor não conseguiu guardar o arquivo.' });
      }
    }));
  }

  // Imagem no chat (com legenda opcional). Uma a cada 2 s por pessoa.
  let lastChatImageAt = 0;
  socket.on('chat-image', safeHandler((rawPayload, maybeCallback) => {
    const cb = safeCallback(maybeCallback);
    const payload = safeObject(rawPayload);
    const channel = user.channelId ? channels.get(user.channelId) : null;
    if (!channel || !permissions.canWrite(user, channel)) return cb({ success: false, error: 'Você não pode enviar imagens neste canal.' });
    const now = Date.now();
    if (now - lastChatImageAt < 2000) return cb({ success: false, error: 'Calma, uma imagem de cada vez.' });
    const mime = typeof payload.mime === 'string' ? payload.mime.toLowerCase() : '';
    const data = Buffer.isBuffer(payload.data) ? payload.data : null;
    if (!CHAT_IMAGE_TYPES[mime] || !data || data.length === 0) return cb({ success: false, error: 'Esse arquivo não é uma imagem.' });
    if (data.length > MAX_CHAT_IMAGE_BYTES) return cb({ success: false, error: 'Imagem grande demais (máximo 15 MB).' });
    if (!imageMatchesType(data, mime)) return cb({ success: false, error: 'Esse arquivo não é uma imagem.' });
    lastChatImageAt = now;

    let file;
    try {
      file = saveChatImage(data, mime);
    } catch (err) {
      console.error('⚠️ [Chat] Não deu pra salvar a imagem:', err.message);
      return cb({ success: false, error: 'O servidor não conseguiu guardar a imagem.' });
    }
    // Tamanho só pra reservar o espaço na tela antes de carregar
    const dim = (v) => (Number.isInteger(v) && v > 0 && v <= 20000 ? v : null);
    const chatMsg = {
      id: `msg-${now}-${randomUUID().slice(0, 8)}`,
      channelId: user.channelId,
      senderId: socket.id,
      userId: socket.id,
      profileId: user.profileId,
      replyTo: replySnippet({ scope: 'call', channel }, payload.replyTo),
      senderName: user.name,
      userName: user.name,
      userColor: user.color,
      userNameColor: user.nameColor || '',
      userNameColor2: user.nameColor2 || '',
      userAvatarV: user.avatar ? user.avatarV : 0,
      text: typeof payload.text === 'string' ? payload.text.trim().slice(0, 600) : '',
      image: { url: `/api/chat-image/${file}`, width: dim(payload.width), height: dim(payload.height) },
      timestamp: now
    };
    indexAssets(channel, [chatMsg], 'voice');
    channel.messages.push(chatMsg);
    if (channel.messages.length > 50) channel.messages.shift();
    io.to(user.channelId).emit('chat-message', chatMsg);
    cb({ success: true });
  }));

  // Stage reactions (floating emojis)
  socket.on('reaction', safeHandler((rawPayload) => {
    if (!isPlainObject(rawPayload) || !user.channelId) return;
    if (typeof rawPayload.emoji !== 'string') return;

    // Qualquer emoji (família, bandeira e tom de pele passam de 8 caracteres), mas só emoji
    const cleanEmoji = rawPayload.emoji.trim();
    if (!cleanEmoji || cleanEmoji.length > 32 || !EMOJI_RE.test(cleanEmoji)) return;

    io.to(user.channelId).emit('reaction', {
      channelId: user.channelId,
      userId: socket.id,
      userName: user.name,
      emoji: cleanEmoji
    });
  }));

  // Explicit Channel Leave
  // Responde com o som sorteado, pra quem saiu ouvir o mesmo áudio que ficou pros outros
  socket.on('leave-channel', safeHandler((_rawPayload, maybeCallback) => {
    const soundSeed = leaveCurrentChannel(socket);
    safeCallback(maybeCallback)({ soundSeed });
  }));

  // Disconnect Handling
  socket.on('disconnect', () => {
    try {
      if (user.activity) {
        user.activity = null;
        emitVisibleUserEvent('user-activity-updated', { userId: socket.id, activity: null }, user);
      }
      leaveCurrentChannel(socket);
    } catch (err) {
      console.error(`[Disconnect Error] Socket ${socket.id}:`, err);
    }
  });
});

// Número sorteado pro som de entrada/saída; cada app escolhe o áudio por ele (seed % quantidade)
function callSoundSeed() {
  return Math.floor(Math.random() * 1_000_000);
}

function leaveCurrentChannel(socket) {
  const user = socket.data?.user;
  if (!user || !user.channelId) return;
  if (SFU_SECRET) revokeSfuMedia(user.mediaId);

  const channelId = user.channelId;
  const soundSeed = callSoundSeed();
  const channel = channels.get(channelId);

  if (channel) {
    channel.users.delete(socket.id);
    socket.leave(channelId);
    music?.leave(channelId, socket.id);

    const leftPayload = {
      userId: socket.id,
      userName: user.name,
      name: user.name,
      channelId,
      users: getChannelUsersList(channelId),
      soundSeed
    };

    // Notify remaining channel members
    socket.to(channelId).emit('user-left', leftPayload);
    socket.to(channelId).emit('user-channel-left', leftPayload);

    // Canal temporário vazio some (os criados pelo "Criar Canal" ficam salvos)
    if (channel.temporary && channel.users.size === 0) {
      channels.delete(channelId);
    }
  }

  user.channelId = null;
  user.isSharing = false;
  user.isCameraOn = false;
  user.extraScreens = [];
  user.watching = [];
  user.isSpeaking = false;

  broadcastChannels();
  return soundSeed;
}

function revokeSfuMedia(id, attempt = 0) {
  // O SFU encerra também uma conexão que ignore o aviso de saída enviado ao app.
  fetch(`${process.env.SFU_INTERNAL_URL || 'http://127.0.0.1:8081'}/revoke`, {
    method: 'POST', headers: { Authorization: `Bearer ${SFU_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }), signal: AbortSignal.timeout(2000)
  }).then(response => { if (!response.ok) throw new Error('SFU indisponível'); }).catch(() => {
    if (attempt < 2) setTimeout(() => revokeSfuMedia(id, attempt + 1), 1000).unref();
    else console.error('⚠️ [Permissões] Não consegui encerrar a mídia revogada no SFU.');
  });
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
  if (music) {
    let closingMusic = false;
    const stopMusicServer = async () => {
      if (closingMusic) return;
      closingMusic = true;
      await music.close();
      io.close();
    };
    process.once('SIGINT', stopMusicServer);
    process.once('SIGTERM', stopMusicServer);
  }
}

export { app, server, io, channels, music, getChannelsSummary, startServer, safeHandler, isPlainObject, safeObject };
