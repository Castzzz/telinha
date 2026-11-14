import express from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Só links canônicos dos dois serviços atravessam a sessão; nunca URLs de login ou tokens.
function mediaUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (['www.youtube.com', 'youtube.com', 'youtu.be'].includes(url.hostname)) {
      const id = url.hostname === 'youtu.be' ? url.pathname.slice(1)
        : url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/shorts\/([^/]+)$/)?.[1];
      if (/^[\w-]{11}$/.test(id || '')) return `https://www.youtube.com/watch?v=${id}`;
    }
    if (['www.netflix.com', 'netflix.com'].includes(url.hostname)) {
      const id = url.pathname.match(/^\/watch\/(\d{1,20})\/?$/)?.[1];
      if (id) return `https://www.netflix.com/watch/${id}`;
    }
  } catch {}
  return null;
}

// ZIP sem dependência de ferramentas da VM, com uma lista fixa de arquivos públicos.
export function watchExtensionZip() {
  const names = ['manifest.json', 'background.js', 'content.js', 'netflix-bridge.js', 'popup.html', 'popup.js', 'popup.css', 'LEIA-ME.md'];
  const local = [], central = [];
  let offset = 0;
  for (const name of names) {
    const data = readFileSync(new URL(`./public/watch-extension/${name}`, import.meta.url));
    const filename = Buffer.from(`Teletela-Assistir-Juntos/${name}`);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(33, 14);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    local.push(header, filename, data); central.push(entry, filename);
    offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export function installWatchTogether({ app, io, channels, server }) {
  const sessions = new Map(), pairing = new Map(), credentials = new Map();
  const secret = () => randomBytes(32).toString('base64url');
  const userFor = id => {
    const socket = io.sockets.sockets.get(id), user = socket?.data.user;
    return socket?.connected && !socket.data.accountEnding && user?.channelId
      && channels.get(user.channelId)?.users.has(id) ? user : null;
  };
  const sessionFor = id => {
    const user = userFor(id), session = sessions.get(user?.channelId);
    return session?.members.has(id) ? session : null;
  };
  const snapshot = session => {
    if (!session) return null;
    const now = Date.now(), stale = !session.lastReport || now - session.lastReport > 6000;
    return { id: session.id, channelId: session.channelId, hostId: session.hostId,
      hostName: userFor(session.hostId)?.name || 'Amigo', url: session.url,
      position: session.position, playing: session.playing && !stale, rate: session.rate,
      controlRevision: session.controlRevision,
      updatedAt: session.updatedAt, serverTime: now, waiting: stale || session.waiting,
      members: [...session.members].map(id => ({ id, name: userFor(id)?.name || 'Amigo',
        connected: now - (session.seen.get(id) || 0) < 6000 })) };
  };
  const emit = session => io.to(session.channelId).emit('watch-together:state', { channelId: session.channelId, session: snapshot(session) });
  const revoke = id => {
    for (const [key, value] of pairing) if (value.id === id) pairing.delete(key);
    for (const [key, value] of credentials) if (value.id === id) credentials.delete(key);
  };
  const end = session => {
    sessions.delete(session.channelId);
    for (const id of session.members) revoke(id);
    io.to(session.channelId).emit('watch-together:state', { channelId: session.channelId, session: null });
  };
  const leave = id => {
    const session = [...sessions.values()].find(item => item.members.has(id));
    revoke(id);
    if (!session) return;
    if (session.hostId === id) return end(session);
    session.members.delete(id); session.seen.delete(id); emit(session);
  };
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of pairing) if (value.expires < now) pairing.delete(key);
    for (const [key, value] of credentials) if (!sessionFor(value.id) || value.expires < now) credentials.delete(key);
    for (const session of sessions.values()) emit(session);
  }, 5000);
  timer.unref(); server.on('close', () => clearInterval(timer));

  app.get('/api/watch-together/extension.zip', (_req, res) => {
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="Teletela-Assistir-Juntos.zip"' }).send(watchExtensionZip());
  });
  const router = express.Router();
  router.use(express.json({ limit: '4kb', strict: true }));
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.post('/pair', (req, res) => {
    const key = typeof req.body?.code === 'string' ? req.body.code : '';
    const grant = pairing.get(key);
    if (!grant || grant.expires < Date.now() || !sessionFor(grant.id)) return res.status(401).json({ error: 'Código vencido. Gere outro no Teletela.' });
    pairing.delete(key); revoke(grant.id);
    const token = secret();
    credentials.set(token, { id: grant.id, expires: Date.now() + 12 * 3600000, count: 0, window: 0 });
    res.json({ token, userId: grant.id, session: snapshot(sessionFor(grant.id)) });
  });
  router.use((req, res, next) => {
    const token = req.get('authorization')?.replace(/^Bearer /, ''), credential = credentials.get(token);
    if (!credential || credential.expires < Date.now() || !sessionFor(credential.id)) {
      if (token) credentials.delete(token);
      return res.status(401).json({ error: 'A conexão terminou. Conecte de novo pelo Teletela.' });
    }
    const now = Date.now();
    if (now - credential.window > 1000) { credential.window = now; credential.count = 0; }
    if (++credential.count > 20) return res.status(429).json({ error: 'Espere um instante.' });
    req.watchCredential = credential; next();
  });
  router.post('/disconnect', (req, res) => {
    const id = req.watchCredential.id, session = sessionFor(id);
    revoke(id); session?.seen.delete(id); if (session) emit(session);
    res.json({ success: true });
  });
  router.post('/status', (req, res) => res.json({ userId: req.watchCredential.id, session: snapshot(sessionFor(req.watchCredential.id)) }));
  router.post('/sync', (req, res) => {
    const id = req.watchCredential.id, session = sessionFor(id), now = Date.now();
    session.seen.set(id, now);
    const report = req.body?.report;
    if (session.hostId === id && report && typeof report === 'object') {
      const url = mediaUrl(report.url), position = report.position, rate = report.rate;
      if (url && typeof position === 'number' && Number.isFinite(position) && position >= 0 && position <= 7 * 86400
        && typeof rate === 'number' && Number.isFinite(rate) && rate >= .25 && rate <= 4 && typeof report.playing === 'boolean') {
        const expected = session.position + (session.playing ? (now - session.updatedAt) / 1000 * session.rate : 0);
        if (url !== session.url || report.playing !== session.playing || rate !== session.rate || Math.abs(position - expected) > .4) session.controlRevision++;
        session.url = url; session.position = position; session.rate = rate;
        session.playing = report.playing; session.waiting = Boolean(report.waiting);
        session.updatedAt = now; session.lastReport = now;
      } else {
        session.playing = false; session.waiting = true; session.lastReport = now;
      }
    }
    res.json({ userId: id, session: snapshot(session) });
  });
  router.use((err, _req, res, _next) => res.status(err.status || 400).json({ error: 'Não deu para ler a mensagem da extensão.' }));
  app.use('/api/watch-together', router);

  const setup = socket => {
    const reply = (callback, data) => { if (typeof callback === 'function') callback(data); };
    const actions = {
      state: () => ({ session: snapshot(sessions.get(userFor(socket.id)?.channelId)) }),
      join: () => {
        const user = userFor(socket.id);
        if (!user) throw new Error('Entre numa call para assistir junto.');
        let session = sessions.get(user.channelId);
        if (!session) {
          session = { id: randomUUID(), channelId: user.channelId, hostId: socket.id, members: new Set(), seen: new Map(),
            url: null, position: 0, rate: 1, playing: false, waiting: true, updatedAt: Date.now(), lastReport: 0, controlRevision: 0 };
          sessions.set(user.channelId, session);
        }
        session.members.add(socket.id); emit(session); return { session: snapshot(session) };
      },
      pair: () => {
        if (!sessionFor(socket.id)) throw new Error('Entre na sessão primeiro.');
        // Um único código por pessoa; gerar outro também desconecta a extensão anterior.
        revoke(socket.id);
        const code = secret(); pairing.set(code, { id: socket.id, expires: Date.now() + 5 * 60000 });
        return { code, expiresAt: Date.now() + 5 * 60000 };
      },
      lead: () => {
        const session = sessionFor(socket.id);
        if (!session) throw new Error('Entre na sessão primeiro.');
        session.hostId = socket.id; session.playing = false; session.lastReport = 0;
        emit(session); return { session: snapshot(session) };
      },
      leave: () => { leave(socket.id); return { session: snapshot(sessions.get(userFor(socket.id)?.channelId)) }; },
      stop: () => {
        const session = sessionFor(socket.id);
        if (session?.hostId !== socket.id) throw new Error('Só quem guia pode encerrar a sessão.');
        end(session); return { session: null };
      }
    };
    let requests = 0, windowStart = 0;
    for (const [action, handler] of Object.entries(actions)) socket.on(`watch-together:${action}`, (_payload, callback) => {
      if (Date.now() - windowStart > 10000) { requests = 0; windowStart = Date.now(); }
      if (++requests > 30) return reply(callback, { success: false, error: 'Espere um instante.' });
      try { reply(callback, { success: true, ...handler() }); }
      catch (err) { reply(callback, { success: false, error: err.message }); }
    });
    socket.on('disconnect', () => leave(socket.id));
  };
  return { setup, leave };
}
