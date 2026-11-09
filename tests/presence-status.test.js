import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { effectivePresence, savedPresence, PRESENCE_IDLE_MS } from '../public/presence.js';

test('a escolha manual tem prioridade sobre ausência automática e migra o invisível', () => {
  assert.equal(savedPresence({ invisible: true }), 'offline');
  assert.equal(savedPresence({ presence: 'away', invisible: true }), 'away');
  for (const presence of ['away', 'dnd', 'offline']) assert.equal(effectivePresence({ presence, automaticAway: true }), presence);
  assert.equal(effectivePresence({ presence: 'online', automaticAway: true }), 'away');
  assert.equal(effectivePresence({ presence: 'online', automaticAway: false }), 'online');
});

test('presença automática retorna ao ativar; ausente manual e não perturbe ficam, inclusive em AFK', { timeout: 20000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-status-'));
  process.env.TELINHA_DATA_DIR = dir; process.env.OWNER_KEY = 'dono-status'; process.env.TELINHA_MUSIC = '0'; process.env.SFU_SECRET = '';
  const backend = await import('../server.js');
  const server = await backend.startServer(0, '127.0.0.1'), url = `http://127.0.0.1:${server.address().port}`, clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await new Promise(resolve => backend.io.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await pause(20); } assert.ok(check()); }
  async function connect(auth = {}) {
    const s = io(url, { transports: ['websocket'], autoConnect: false, reconnection: false, auth }); clients.push(s);
    s.on('presence-state', state => { s.presence = state; }); s.on('server-members', state => { s.members = state.members; });
    const ready = once(s, 'connect'); s.connect(); await ready; await until(() => s.presence && s.members); return s;
  }
  const emit = (s, event, payload = {}) => s.timeout(5000).emitWithAck(event, payload);
  const a = await connect(); await emit(a, 'update-profile', { profileId: randomUUID(), name: 'Ativo' });
  const observer = await connect(); await emit(observer, 'update-profile', { profileId: randomUUID(), name: 'Observador' });
  await emit(observer, 'owner-claim', { key: 'dono-status' });
  const afk = await emit(observer, 'create-channel', { name: 'Ausentes' }); await emit(observer, 'afk-settings', { channelId: afk.channelId, minutes: 5 });
  const user = backend.io.sockets.sockets.get(a.id).data.user;
  a.emit('idle-activity', { enabled: true, active: false }); await until(() => user.afkSupported);
  user.lastPresenceActiveAt = Date.now() - PRESENCE_IDLE_MS - 100;
  backend.sweepPresence(); await until(() => a.presence.presence === 'away');
  assert.equal(a.presence.selected, 'online'); assert.equal(a.presence.automatic, true);
  await until(() => observer.members.find(row => row.name === 'Ativo')?.presence === 'away');
  a.emit('idle-activity', { enabled: true, active: true }); await until(() => a.presence.presence === 'online');
  assert.equal((await emit(a, 'update-presence', { status: 'away' })).success, true);
  a.emit('idle-activity', { enabled: true, active: true }); await pause(40); backend.sweepPresence();
  assert.equal(a.presence.presence, 'away'); assert.equal(a.presence.automatic, false);
  await emit(a, 'update-presence', { status: 'dnd' });
  user.lastPresenceActiveAt = Date.now() - PRESENCE_IDLE_MS - 100; backend.sweepPresence();
  assert.equal(a.presence.presence, 'dnd');
  await emit(a, 'join-channel', { channelId: afk.channelId }); assert.equal(a.presence.presence, 'dnd');
  await emit(a, 'update-presence', { status: 'online' }); assert.equal(a.presence.presence, 'away');
  await emit(a, 'join-channel', { channelId: 'geral' }); await until(() => a.presence.presence === 'online');
  await emit(a, 'update-presence', { status: 'away' });
  await emit(a, 'join-channel', { channelId: afk.channelId }); await emit(a, 'leave-channel');
  assert.equal(a.presence.presence, 'away', 'Sair do AFK não desfaz a escolha manual.');
  await emit(a, 'update-presence', { status: 'offline' });
  a.emit('idle-activity', { enabled: true, active: true }); await pause(30); backend.sweepPresence();
  assert.equal(a.presence.presence, 'offline');
  await until(() => observer.members.find(row => row.name === 'Ativo')?.online === false);
  assert.equal((await emit(a, 'update-presence', { status: 'inventado' })).success, false);
  const reconnected = await connect({ presence: 'away' });
  assert.equal(reconnected.presence.presence, 'away'); assert.equal(reconnected.presence.automatic, false);
});
