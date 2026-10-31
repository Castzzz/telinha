import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { once } from 'node:events';
import { AccountStore } from '../account-store.js';

test('amizades persistem, exigem aceite do destinatário e preservam dados após falha de escrita', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-amizades-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let store = new AccountStore(dir);
  const register = name => store.register(name, 'senha-dos-testes', { accessId: randomUUID(), profile: { id: randomUUID(), name, color: '#5865F2' } });
  const a = (await register('primeiro')).account.id, b = (await register('segundo')).account.id, c = (await register('terceiro')).account.id;
  await assert.rejects(store.changeFriend(a, 'request', { username: 'primeiro' }), /própria conta/);
  await assert.rejects(store.changeFriend(a, 'request', { username: 'inexistente' }), /Não encontrei/);
  await store.changeFriend(a, 'request', { username: '@SEGUNDO' });
  await assert.rejects(store.changeFriend(b, 'request', { username: 'primeiro' }), /Já existe/);
  await assert.rejects(store.changeFriend(a, 'accept', { accountId: b }), /não está mais/);
  await assert.rejects(store.changeFriend(c, 'accept', { accountId: a }), /não está mais/);
  await assert.rejects(store.changeFriend(b, 'cancel', { accountId: a }), /não está mais/);
  assert.equal(store.friends(a).outgoing[0].id, b);
  assert.equal(store.friends(b).incoming[0].id, a);
  assert.equal('online' in store.friends(b).incoming[0], false);
  await store.changeFriend(b, 'accept', { accountId: a });
  store = new AccountStore(dir);
  assert.deepEqual(store.friends(a, id => id === b).friends, [{ id: b, username: 'segundo', name: 'segundo', online: true }]);
  assert.equal(store.friends(c).friends.length, 0);
  const file = path.join(dir, 'accounts.json'), backup = file + '.backup';
  fs.renameSync(file, backup); fs.mkdirSync(file);
  try {
    await assert.rejects(store.changeFriend(a, 'remove', { accountId: b }));
    assert.equal(store.friends(a).friends.length, 1);
  } finally { fs.rmdirSync(file); fs.renameSync(backup, file); }
  await store.changeFriend(a, 'remove', { accountId: b });
  assert.equal(store.friends(b).friends.length, 0);
  await store.changeFriend(a, 'request', { username: 'segundo' });
  await store.changeFriend(b, 'reject', { accountId: a });
  await store.changeFriend(a, 'request', { username: 'segundo' });
  await store.changeFriend(a, 'cancel', { accountId: b });
  assert.equal(new AccountStore(dir).friends(a).outgoing.length, 0);
  const data = JSON.parse(fs.readFileSync(file)); delete data.friendships;
  fs.writeFileSync(file, JSON.stringify(data));
  assert.deepEqual(new AccountStore(dir).data.friendships, [], 'Contas da versão anterior continuam válidas.');
});

test('servidor autentica amigos, sincroniza aparelhos e só anuncia presença a amizades aceitas', { timeout: 30000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-amigos-servidor-'));
  process.env.TELINHA_DATA_DIR = dir; process.env.TELINHA_MUSIC = '0'; process.env.SFU_SECRET = '';
  const backend = await import('../server.js');
  const server = await backend.startServer(0, '127.0.0.1'), url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  t.after(async () => { clients.forEach(socket => socket.disconnect()); await new Promise(resolve => backend.io.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(predicate) { for (let i = 0; i < 150; i++) { if (predicate()) return; await wait(20); } assert.ok(predicate()); }
  async function connect(token) {
    const socket = io(url, { autoConnect: false, reconnection: false, transports: ['websocket'], auth: { accountToken: token } });
    clients.push(socket); socket.on('friends-state', state => { socket.friends = state; });
    const connected = once(socket, 'connect'); socket.connect(); await connected; await until(() => socket.friends); return socket;
  }
  const emit = (socket, event, payload = {}) => socket.timeout(5000).emitWithAck(event, payload);
  async function register(username) {
    const guest = await connect();
    await emit(guest, 'update-profile', { profileId: randomUUID(), name: username });
    const result = await emit(guest, 'account-register', { username, password: 'senha-dos-testes' });
    assert.equal(result.success, true); guest.disconnect(); return result;
  }
  const aa = await register('amigo_a'), bb = await register('amigo_b'), cc = await register('amigo_c');
  const a = await connect(aa.token), b = await connect(bb.token), secondB = await connect(bb.token), c = await connect(cc.token), guest = await connect();
  assert.equal((await emit(guest, 'friend-request', { username: 'amigo_a' })).success, false);
  assert.equal((await emit(a, 'friend-request', { username: 'amigo_b', from: cc.account.id })).success, false);
  assert.equal((await emit(a, 'friend-request', { username: 'amigo_b' })).success, true);
  await until(() => b.friends.incoming.length === 1 && secondB.friends.incoming.length === 1);
  assert.equal((await emit(a, 'friend-accept', { accountId: bb.account.id })).success, false);
  assert.equal((await emit(c, 'friend-accept', { accountId: aa.account.id })).success, false);
  assert.equal((await emit(b, 'friend-accept', { accountId: aa.account.id })).success, true);
  await until(() => a.friends.friends[0]?.online && secondB.friends.friends[0]?.online);
  assert.equal(c.friends.friends.length, 0);
  assert.deepEqual(Object.keys(a.friends.friends[0]).sort(), ['id', 'name', 'online', 'username']);
  b.disconnect(); await wait(75); assert.equal(a.friends.friends[0].online, true, 'Outro aparelho mantém a presença online.');
  secondB.disconnect(); await until(() => a.friends.friends[0]?.online === false);
  const returnedB = await connect(bb.token); await until(() => a.friends.friends[0]?.online === true);
  await emit(returnedB, 'update-profile', { name: 'Outro apelido' }); await until(() => a.friends.friends[0]?.name === 'Outro apelido');
  assert.equal((await emit(a, 'friend-remove', { accountId: bb.account.id })).success, true);
  await until(() => returnedB.friends.friends.length === 0);
  assert.equal((await emit(a, 'friend-list')).friends.length, 0);
});
