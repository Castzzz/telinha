import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { io } from 'socket.io-client';
import { MemberAvatarStore } from '../member-avatar-store.js';

const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
test('arquivo conserva GIF e recorte, não substitui após falha e registra remoção', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-avatares-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new MemberAvatarStore(dir), id = randomUUID();
  const user = { accessId: id, profileId: randomUUID(), avatar: { mime: 'image/gif', data: gif }, avatarCrop: { x: .2, y: .8, zoom: 2 } };
  store.set(user); const version = store.info(id).version;
  const loaded = new MemberAvatarStore(dir); assert.deepEqual(loaded.read(id).data, gif); assert.deepEqual(loaded.info(id).crop, user.avatarCrop);
  store.set(user); assert.equal(store.info(id).version, version, 'Perfil sem mudança não regrava a imagem.');
  const file = store.file(id); fs.renameSync(file, file + '.backup'); fs.mkdirSync(file);
  try { assert.throws(() => store.set({ ...user, avatar: null })); assert.equal(store.info(id).version, version); }
  finally { fs.rmdirSync(file); fs.renameSync(file + '.backup', file); }
  store.set({ ...user, avatar: null }); assert.equal(new MemberAvatarStore(dir).read(id), null); assert.equal(store.memberForProfile(user.profileId), id);
});

test('histórico usa identidade estável e foto do visitante offline, inclusive após reiniciar', { timeout: 25000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-historico-fotos-'));
  const reservation = http.createServer(); await new Promise(r => reservation.listen(0, '127.0.0.1', r)); const port = reservation.address().port; await new Promise(r => reservation.close(r));
  const url = `http://127.0.0.1:${port}`, clients = []; let child;
  const pause = ms => new Promise(r => setTimeout(r, ms));
  async function until(check) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(20); } assert.ok(check()); }
  async function start() {
    child = spawn('node', ['server.js'], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, PORT: String(port), TELINHA_DATA_DIR: dir, OWNER_KEY: 'dono-fotos', TELINHA_MUSIC: '0', SFU_SECRET: '' }, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(url + '/api/health')).ok) return; } catch {} await pause(30); } throw new Error('Servidor não iniciou');
  }
  async function stop() { clients.forEach(s => s.disconnect()); if (child?.exitCode === null) { const closed = once(child, 'exit'); child.kill(); await closed; } }
  t.after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  async function connect(auth = {}) {
    const s = io(url, { auth, autoConnect: false, reconnection: false, transports: ['websocket'] }); clients.push(s);
    s.on('permissions-state', state => { s.memberId = state.memberId; }); s.on('permission-identity', state => { s.token = state.token; }); s.on('room-info', info => { if (info.assetKey) s.assetKey = info.assetKey; });
    const connected = once(s, 'connect'); s.connect(); await connected; await until(() => s.assetKey && s.memberId && s.token); return s;
  }
  const emit = (s, event, data = {}) => s.timeout(5000).emitWithAck(event, data);
  await start(); const authorProfile = randomUUID(), readerProfile = randomUUID();
  const author = await connect({ profileId: authorProfile }); await emit(author, 'update-profile', { profileId: authorProfile, name: 'Autora', avatar: `data:image/gif;base64,${gif.toString('base64')}`, avatarCrop: { x: .2, y: .8, zoom: 2 } });
  await emit(author, 'owner-claim', { key: 'dono-fotos' });
  const channel = await emit(author, 'create-text-channel', { name: 'Conversa' });
  let reader = await connect({ profileId: readerProfile }); await emit(reader, 'update-profile', { profileId: readerProfile, name: 'Leitora' });
  const readerToken = reader.token, authorId = author.memberId;
  await emit(author, 'text-message', { channelId: channel.channelId, text: 'Mensagem com GIF', authorMemberId: reader.memberId });
  const history = await emit(reader, 'text-history', { channelId: channel.channelId });
  assert.equal(history.messages[0].authorMemberId, authorId, 'O cliente não escolhe a identidade do autor.');
  author.disconnect(); await pause(50);
  const imageUrl = `${url}/api/member-avatar/${authorId}`;
  assert.equal((await fetch(imageUrl)).status, 404);
  assert.deepEqual(Buffer.from(await (await fetch(imageUrl + '?access=' + reader.assetKey)).arrayBuffer()), gif);
  const file = path.join(dir, 'text', `${channel.channelId}.jsonl`);
  fs.appendFileSync(file, JSON.stringify({ ...history.messages[0], id: 'antiga', authorMemberId: undefined, userAvatarV: 0, senderId: 'conexao-antiga' }) + '\n');
  const oldAccess = reader.assetKey; await stop(); await start();
  reader = await connect({ profileId: readerProfile, permissionToken: readerToken });
  assert.equal((await fetch(imageUrl + '?access=' + oldAccess)).status, 404);
  const restored = await emit(reader, 'text-history', { channelId: channel.channelId });
  assert.equal(restored.messages.length, 2);
  for (const msg of restored.messages) { assert.equal(msg.authorMemberId, authorId); assert.ok(msg.userAvatarV); assert.deepEqual(msg.userAvatarCrop, { x: .2, y: .8, zoom: 2 }); }
  const response = await fetch(imageUrl + '?access=' + reader.assetKey);
  assert.equal(response.headers.get('content-type'), 'image/gif'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), gif);
});
