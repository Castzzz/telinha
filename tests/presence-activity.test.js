import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

test('invisível oculta membros, amigos e atividade, preserva voz e respeita outros aparelhos', { timeout: 20000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-presenca-'));
  process.env.TELINHA_DATA_DIR = dir; process.env.TELINHA_MUSIC = '0'; process.env.SFU_SECRET = '';
  const backend = await import('../server.js');
  const server = await backend.startServer(0, '127.0.0.1'), url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await new Promise(resolve => backend.io.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(check) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(20); } assert.ok(check()); }
  async function connect(auth = {}) {
    const s = io(url, { autoConnect: false, reconnection: false, transports: ['websocket'], auth }); clients.push(s);
    s.on('server-members', data => { s.members = data.members; }); s.on('friends-state', data => { s.friends = data; }); s.on('channels-list', data => { s.channels = data; });
    const connected = once(s, 'connect'); s.connect(); await connected; await until(() => s.members && s.friends); return s;
  }
  const emit = (s, event, payload = {}) => s.timeout(5000).emitWithAck(event, payload);
  async function register(name) {
    const s = await connect(); await emit(s, 'update-profile', { profileId: randomUUID(), name });
    const result = await emit(s, 'account-register', { username: name, password: 'senha-dos-testes' }); assert.equal(result.success, true); s.disconnect(); return result;
  }
  const aa = await register('observador'), bb = await register('estudante');
  const a = await connect({ accountToken: aa.token }), b = await connect({ accountToken: bb.token, invisible: true });
  await emit(a, 'friend-request', { username: 'estudante' }); await emit(b, 'friend-accept', { accountId: aa.account.id });
  const row = () => a.members.find(m => m.memberId === bb.account.accessId);
  await until(() => row()?.online === false && a.friends.friends[0]?.online === false);
  assert.equal(row().id, `member-${bb.account.accessId}`, 'Não revela o socket invisível.');
  await emit(b, 'join-channel', { channelId: 'geral' });
  const activity = { id: 'manual', type: 'studying', name: '<matemática>', startedAt: Date.now() };
  assert.equal((await emit(b, 'update-activity', activity)).success, true);
  await until(() => a.channels.find(c => c.id === 'geral')?.users.some(u => u.id === b.id && u.activity === null));
  assert.equal((await emit(b, 'update-presence', { invisible: 'sim' })).success, false);
  assert.equal((await emit(b, 'update-presence', { invisible: false })).success, true);
  await until(() => row()?.online === true && a.friends.friends[0]?.online === true);
  assert.deepEqual(a.channels.find(c => c.id === 'geral').users.find(u => u.id === b.id).activity, activity);
  assert.equal((await emit(b, 'update-activity', { ...activity, type: 'invalido' })).success, false);
  const other = await connect({ accountToken: bb.token });
  await emit(b, 'update-presence', { invisible: true }); await pause(80);
  assert.equal(row().online, true, 'Outro aparelho visível mantém a conta online.');
  other.disconnect(); await until(() => row()?.online === false && a.friends.friends[0]?.online === false);
  for (const type of ['working', 'watching', 'listening', 'custom', 'playing']) assert.equal((await emit(b, 'update-activity', { ...activity, type })).success, true);
  assert.equal((await emit(b, 'update-activity', null)).success, true);
});
