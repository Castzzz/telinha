import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

test('membros da sala e exclusão persistente do Geral, incluindo falha de gravação e clientes antigos', { timeout: 35000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-membros-'));
  const reservation = http.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve)); const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`, clients = []; let child;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(check) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(25); } assert.ok(check()); }
  async function start() {
    child = spawn('node', ['server.js'], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, PORT: String(port), TELINHA_DATA_DIR: dir, OWNER_KEY: 'membros-teste', SFU_SECRET: '', TELINHA_MUSIC: '0' }, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) return; } catch {} await pause(40); }
    throw new Error('Servidor não iniciou');
  }
  async function stop() { clients.forEach(socket => socket.disconnect()); if (child?.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; } }
  t.after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  async function connect(auth = {}) {
    const socket = io(base, { autoConnect: false, reconnection: false, transports: ['websocket'], auth }); clients.push(socket);
    socket.on('server-members', state => { socket.members = state.members; });
    socket.on('permissions-state', state => { socket.permissions = state; }); socket.on('permission-identity', state => { socket.token = state.token; });
    socket.on('room-info', state => { if (state.assetKey) socket.assetKey = state.assetKey; });
    const connected = once(socket, 'connect'); socket.connect(); await connected; await until(() => socket.permissions && socket.members && socket.assetKey); return socket;
  }
  const emit = (socket, event, payload = {}) => socket.timeout(5000).emitWithAck(event, payload);
  await start();
  let owner = await connect({ profileId: 'membro-dono-teste' });
  await emit(owner, 'update-profile', { profileId: 'membro-dono-teste', name: 'Dono' });
  assert.equal((await emit(owner, 'owner-claim', { key: 'membros-teste' })).success, true);
  const ownerToken = owner.token;
  const guest = await connect();
  await emit(guest, 'update-profile', { profileId: randomUUID(), name: 'Fora da call' });
  await until(() => owner.members.some(member => member.name === 'Fora da call' && member.online));
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ioAAAAASUVORK5CYII=';
  await emit(guest, 'update-profile', { avatar: png });
  const registered = await emit(guest, 'account-register', { username: 'membro_salvo', password: 'senha-dos-testes' }); assert.equal(registered.success, true);
  const a = await connect({ accountToken: registered.token }), b = await connect({ accountToken: registered.token });
  await until(() => owner.members.filter(member => member.memberId === registered.account.accessId && member.online).length === 1);
  const secret = await emit(owner, 'create-channel', { name: 'Segredo da turma', access: { private: true, members: [registered.account.accessId], roles: [] } });
  await emit(a, 'join-channel', { channelId: secret.channelId });
  await until(() => owner.members.some(member => member.memberId === registered.account.accessId && member.online));
  const row = owner.members.find(member => member.memberId === registered.account.accessId);
  for (const field of ['channelId', 'activity', 'isSpeaking', 'isSharing', 'watching', 'credentialHash', 'profileId', 'permissionToken', 'accountToken']) assert.equal(field in row, false, field);
  const avatar = `${base}/api/member-avatar/${row.memberId}`;
  assert.equal((await fetch(avatar)).status, 404);
  assert.equal((await fetch(avatar + '?access=' + owner.assetKey)).status, 200);
  a.disconnect(); await pause(100); assert.equal(owner.members.find(member => member.memberId === row.memberId).online, true);
  b.disconnect(); await until(() => owner.members.find(member => member.memberId === row.memberId)?.online === false);
  assert.equal((await fetch(avatar + '?access=' + owner.assetKey)).status, 200, 'Foto da conta continua disponível offline.');
  assert.equal((await emit(await connect(), 'delete-channel', { channelId: 'geral' })).success, false);
  await emit(owner, 'join-channel', { channelId: 'geral' });
  const file = path.join(dir, 'channels.json'), backup = file + '.backup'; fs.renameSync(file, backup); fs.mkdirSync(file);
  try {
    assert.equal((await emit(owner, 'delete-channel', { channelId: 'geral' })).success, false);
    assert.equal((await emit(owner, 'join-channel', { channelId: 'geral' })).success, true);
  } finally { fs.rmdirSync(file); fs.renameSync(backup, file); }
  assert.equal((await emit(owner, 'delete-channel', { channelId: 'geral' })).success, true);
  assert.equal((await emit(owner, 'join-channel', { channelId: 'geral' })).success, false, 'Link antigo não recria o Geral.');
  await stop(); await start(); owner = await connect({ permissionToken: ownerToken, profileId: 'membro-dono-teste' });
  assert.equal(owner.permissions.owner, true);
  assert.equal((await emit(owner, 'join-channel', { channelId: 'geral' })).success, false);
  assert.equal((await emit(owner, 'create-channel', { name: 'Sala nova' })).success, true, 'Salvar outros canais funciona sem o Geral.');
  const recreated = await emit(owner, 'create-channel', { name: 'Geral' }); assert.equal(recreated.channelId, 'geral');
  await stop(); await start(); owner = await connect({ permissionToken: ownerToken, profileId: 'membro-dono-teste' });
  assert.equal((await emit(owner, 'join-channel', { channelId: 'geral' })).success, true, 'Geral recriado explicitamente funciona após reiniciar.');
});
