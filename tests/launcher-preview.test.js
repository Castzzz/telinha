import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import previewModule from '../electron/launcher-preview.cjs';

const { createLauncherPreview } = previewModule;
test('prévia do início limita fotos, reaproveita consultas e trata servidor antigo, sessão e rede', async () => {
  const serverUrl = 'https://sala.test', id = randomUUID(), token = 'a'.repeat(64);
  let calls = [], time = 10000, status = 200;
  let prefs = { accountSessions: { [serverUrl]: { token } } };
  const preview = createLauncherPreview({ serverUrl, getPrefs: () => prefs, now: () => time,
    thumbnail: async () => 'data:image/png;base64,miniatura',
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('friend-avatar')) return new Response('imagem', { headers: { 'Content-Length': '6' } });
      if (status !== 200) return new Response('', { status });
      return Response.json({ supported: true, name: 'Cast', friends: [{ id, name: '<Neves>', online: true, color: '#123456', avatarV: 1 }, { id: randomUUID(), name: 'Offline', online: false }] });
    }
  });
  const result = await preview();
  assert.equal(result.friends.length, 1); assert.equal(result.friends[0].avatar, 'data:image/png;base64,miniatura');
  assert.equal(result.friends[0].name, '<Neves>');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls.some(call => call.url.includes(token)), false);
  assert.deepEqual(await preview(), result); assert.equal(calls.length, 2);
  time += 11000; await preview(); assert.equal(calls.length, 3, 'Foto da mesma versão não é baixada novamente.');
  time += 11000; status = 401; assert.equal((await preview()).status, 'expired');
  time += 11000; status = 404; assert.equal((await preview()).status, 'unsupported');
  time += 11000; status = 500; assert.equal((await preview()).status, 'offline');
  prefs = {}; status = 200;
  assert.equal((await preview()).status, 'guest'); assert.equal(calls.at(-1).url, `${serverUrl}/api/health`);
  const offline = createLauncherPreview({ serverUrl, getPrefs: () => prefs, fetch: async () => { throw new Error('rede'); } });
  assert.equal((await offline()).status, 'offline');
});

test('prévia compartilha consultas concorrentes e mostra no máximo oito miniaturas', async () => {
  let release, calls = 0;
  const serverUrl = 'https://sala.test';
  const preview = createLauncherPreview({ serverUrl, getPrefs: () => ({ accountSessions: { [serverUrl]: { token: 'b'.repeat(64) } } }),
    fetch: async () => { calls++; await new Promise(resolve => { release = resolve; }); return Response.json({ supported: true, friends: Array.from({ length: 12 }, (_, i) => ({ id: randomUUID(), name: `Amigo ${i}`, online: true })) }); }
  });
  const first = preview(), second = preview();
  assert.equal(calls, 1); release();
  const result = await first;
  assert.deepEqual(await second, result); assert.equal(result.friends.length, 8); assert.equal(result.onlineCount, 12);
});

test('prévia HTTP exige conta da sala, respeita invisível e só entrega fotos de amizades aceitas', { timeout: 20000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-inicio-'));
  process.env.TELINHA_DATA_DIR = dir; process.env.TELINHA_MUSIC = '0'; process.env.SFU_SECRET = '';
  const backend = await import('../server.js');
  const server = await backend.startServer(0, '127.0.0.1'), url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  t.after(async () => { clients.forEach(socket => socket.disconnect()); await new Promise(resolve => backend.io.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await wait(20); } assert.ok(check()); }
  async function connect(token) {
    const socket = io(url, { autoConnect: false, reconnection: false, transports: ['websocket'], auth: { accountToken: token } }); clients.push(socket);
    socket.on('friends-state', state => { socket.friends = state; });
    const connected = once(socket, 'connect'); socket.connect(); await connected; await until(() => socket.friends); return socket;
  }
  const emit = (socket, event, payload = {}) => socket.timeout(5000).emitWithAck(event, payload);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ioAAAAASUVORK5CYII=';
  async function register(username) {
    const socket = await connect(); await emit(socket, 'update-profile', { profileId: randomUUID(), name: username, avatar: png });
    const result = await emit(socket, 'account-register', { username, password: 'senha-dos-testes' }); assert.equal(result.success, true); socket.disconnect(); return result;
  }
  const aa = await register('primeiro'), bb = await register('segundo'), cc = await register('terceiro');
  const a = await connect(aa.token), b = await connect(bb.token), c = await connect(cc.token);
  await emit(a, 'friend-request', { username: 'segundo' }); await emit(b, 'friend-accept', { accountId: aa.account.id });
  await emit(a, 'friend-request', { username: 'terceiro' });
  a.disconnect(); await until(() => b.friends.friends[0]?.online === false);
  const headers = { Authorization: `Bearer ${aa.token}` };
  const get = pathname => fetch(url + pathname, { headers });
  assert.equal((await fetch(url + '/api/launcher/friends')).status, 401);
  assert.equal((await fetch(url + '/api/launcher/friends', { headers: { Authorization: 'Bearer errado' } })).status, 401);
  const response = await get('/api/launcher/friends'), data = await response.json();
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(data.name, 'primeiro'); assert.equal(data.friends.length, 1); assert.equal(data.friends[0].online, true);
  let decoded = false;
  const preview = createLauncherPreview({ serverUrl: url, getPrefs: () => ({ accountSessions: { [url]: { token: aa.token } } }), fetch,
    thumbnail: async (buffer, crop) => { decoded = true; assert.equal(buffer.readUInt32BE(0), 0x89504e47); assert.deepEqual(crop, { x: .5, y: .5, zoom: 1 }); return png; }
  });
  const snapshot = await preview();
  assert.equal(snapshot.status, 'ready'); assert.equal(snapshot.friends[0].name, 'segundo'); assert.equal(decoded, true);
  assert.equal(snapshot.friends[0].avatar, png);
  for (const key of ['accessId', 'profileId', 'channelId', 'activity', 'token', 'avatar']) assert.equal(key in data.friends[0], false, key);
  assert.equal((await get(`/api/launcher/friend-avatar/${bb.account.id}`)).status, 200);
  assert.equal((await get(`/api/launcher/friend-avatar/${cc.account.id}`)).status, 404);
  assert.equal((await fetch(url + `/api/launcher/friend-avatar/${bb.account.id}`)).status, 401);
  await emit(b, 'update-presence', { invisible: true });
  assert.equal((await (await get('/api/launcher/friends')).json()).friends.length, 0);
  assert.equal(b.friends.friends[0].online, false, 'Ler a prévia não anuncia o observador online.');
  await emit(b, 'friend-remove', { accountId: aa.account.id });
  assert.equal((await get(`/api/launcher/friend-avatar/${bb.account.id}`)).status, 404);
  await fetch(url + '/api/account/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: aa.token }) });
  assert.equal((await get('/api/launcher/friends')).status, 401);
});
