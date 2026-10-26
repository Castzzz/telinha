import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { io } from 'socket.io-client';

test('cargos e canais invisíveis sem conta, com servidor real', { timeout: 45000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-permissoes-'));
  const base = 'http://127.0.0.1:19115';
  const clients = [], revocations = [];
  let process;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async predicate => {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await wait(20); }
    assert.ok(predicate(), 'O estado atualizado precisa chegar ao outro cliente.');
  };
  const emit = (socket, event, payload = {}) => socket.timeout(4000).emitWithAck(event, payload);
  const revoked = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    assert.equal(req.headers.authorization, 'Bearer sfu-permissoes-teste');
    revocations.push(JSON.parse(body).id); res.writeHead(204); res.end();
  });
  await new Promise(resolve => revoked.listen(0, '127.0.0.1', resolve));
  async function start() {
    process = spawn('node', ['server.js'], { cwd: path.resolve(import.meta.dirname, '..'), stdio: 'ignore', env: { ...globalThis.process.env,
      PORT: '19115', TELINHA_DATA_DIR: directory, ADMIN_KEY: 'admin-permissoes-teste', SFU_SECRET: 'sfu-permissoes-teste', SFU_INTERNAL_URL: `http://127.0.0.1:${revoked.address().port}` } });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
      await wait(50);
    }
    throw new Error('Servidor de permissões não iniciou.');
  }
  async function stop() {
    clients.forEach(client => client.disconnect());
    if (process?.exitCode === null) { const exited = once(process, 'exit'); process.kill(); await exited; }
  }
  async function connect(name, token = '', profileId = 'perfil-publico-0001') {
    const socket = io(base, { autoConnect: false, transports: ['websocket'], reconnection: false, auth: { permissionToken: token, profileId } });
    clients.push(socket);
    const record = { socket, events: [] };
    socket.onAny((event, data) => record.events.push([event, data]));
    socket.on('channels-list', data => { record.channels = data; });
    socket.on('permissions-state', data => { record.permissions = data; });
    const identity = once(socket, 'permission-identity');
    socket.connect(); record.token = (await identity)[0].token;
    assert.equal((await emit(socket, 'update-profile', { name, profileId })).success, true);
    record.memberId = record.token.split('.')[0];
    return record;
  }
  try {
    await start();
    const owner = await connect('Dono'), alice = await connect('Alice'), bob = await connect('Bob');
    await emit(owner.socket, 'admin-login', { key: 'admin-permissoes-teste' });
    let role, highRole, channelId, mediaId;
    await t.test('somente o dono cria e atribui cargos; perfil público não concede poderes', async () => {
      role = (await emit(owner.socket, 'role-save', { name: 'Moderador', position: 10, permissions: ['muteMembers', 'kickMembers'] })).role;
      highRole = (await emit(owner.socket, 'role-save', { name: 'Coordenação', position: 20, permissions: ['muteMembers'] })).role;
      assert.equal((await emit(alice.socket, 'role-save', { name: 'Dono', position: 99, permissions: ['manageChannels'] })).success, false);
      assert.equal((await emit(owner.socket, 'member-roles', { memberId: alice.memberId, roles: [role.id] })).success, true);
      assert.equal((await emit(alice.socket, 'member-roles', { memberId: bob.memberId, roles: [role.id] })).success, false);
      assert.equal(alice.permissions.owner, false);
      assert.ok(alice.permissions.permissions.includes('muteMembers'));
      assert.equal(bob.permissions.permissions.length, 0);
      const forged = await connect('Cópia', alice.memberId + '.' + '0'.repeat(64));
      assert.notEqual(forged.memberId, alice.memberId);
      assert.equal(forged.permissions.permissions.length, 0);
    });
    await t.test('hierarquia protege cargos superiores e não libera permissões ausentes', async () => {
      for (const client of [alice, bob]) assert.equal((await emit(client.socket, 'join-channel', { channelId: 'geral' })).success, true);
      assert.equal((await emit(alice.socket, 'admin-mute-user', { userId: bob.socket.id, on: true })).success, true);
      assert.equal((await emit(alice.socket, 'admin-deafen-user', { userId: bob.socket.id, on: true })).success, false);
      await emit(owner.socket, 'member-roles', { memberId: bob.memberId, roles: [highRole.id] });
      assert.equal((await emit(alice.socket, 'kick-user', { userId: bob.socket.id })).success, false);
      await emit(owner.socket, 'member-roles', { memberId: bob.memberId, roles: [] });
    });
    await t.test('canal nasce invisível e não vaza em eventos, REST, sinalização nem token SFU', async () => {
      bob.events.length = 0;
      const created = await emit(owner.socket, 'create-channel', { name: 'Segredo da turma', password: 'senha-canal', access: { private: true, roles: [role.id], members: [] } });
      assert.equal(created.success, true); channelId = created.channelId;
      assert.ok(alice.channels.some(ch => ch.id === channelId));
      assert.ok(!bob.channels.some(ch => ch.id === channelId));
      assert.equal((await emit(alice.socket, 'join-channel', { channelId })).code, 'channel-password');
      assert.equal((await emit(owner.socket, 'join-channel', { channelId })).code, 'channel-password');
      assert.equal((await emit(alice.socket, 'join-channel', { channelId, password: 'senha-canal' })).success, true);
      assert.equal((await emit(alice.socket, 'update-profile', { name: 'Nome dentro do segredo' })).success, true);
      const publicList = await fetch(base + '/api/channels').then(r => r.json());
      assert.ok(!JSON.stringify(publicList).includes(channelId));
      assert.ok(!JSON.stringify(bob.events).includes('Segredo da turma'));
      assert.ok(!JSON.stringify(bob.events).includes('Nome dentro do segredo'));
      assert.equal((await emit(bob.socket, 'join-channel', { channelId, password: 'senha-canal' })).code, 'channel-unavailable');
      assert.equal((await emit(bob.socket, 'sfu-token', { ownerId: alice.socket.id, role: 'viewer' })).ok, false);
      const signal = once(alice.socket, 'request-stream');
      bob.socket.emit('request-stream', { targetId: alice.socket.id });
      assert.equal(await Promise.race([signal.then(() => true), wait(80).then(() => false)]), false);
      assert.equal((await emit(bob.socket, 'channel-access', { channelId, access: { private: false, roles: [], members: [] } })).success, false);
      assert.equal((await emit(bob.socket, 'create-channel', { name: 'Tentativa', access: { private: true, roles: [], members: [] } })).success, false);
      assert.equal((await emit(alice.socket, 'delete-channel', { channelId })).success, false, 'profileId público copiado não autoriza apagar canal privado');
    });
    await t.test('tirar o cargo retira da call e revoga a mídia já autorizada', async () => {
      const auth = await emit(alice.socket, 'sfu-token', { ownerId: alice.socket.id, role: 'host' });
      assert.equal(auth.ok, true);
      const [id, signature] = auth.token.split('.'); mediaId = id;
      assert.equal(signature, createHmac('sha256', 'sfu-permissoes-teste').update(`${auth.sala}|${auth.role}|${auth.exp}|${id}`).digest('hex'));
      const kicked = once(alice.socket, 'kicked');
      await emit(owner.socket, 'member-roles', { memberId: alice.memberId, roles: [] });
      await kicked; await wait(80);
      assert.ok(!alice.channels.some(ch => ch.id === channelId));
      assert.equal((await emit(alice.socket, 'sfu-token', { ownerId: alice.socket.id, role: 'host' })).ok, false);
      assert.ok(revocations.includes(mediaId));
    });
    await t.test('acesso direto por pessoa funciona sem cargo e sem cadastro', async () => {
      assert.equal((await emit(owner.socket, 'channel-access', { channelId, access: { private: true, roles: [], members: [bob.memberId] } })).success, true);
      await waitFor(() => bob.channels.some(ch => ch.id === channelId));
      assert.ok(bob.channels.some(ch => ch.id === channelId));
      assert.equal((await emit(bob.socket, 'join-channel', { channelId, password: 'senha-canal' })).success, true);
      assert.equal((await emit(owner.socket, 'member-roles', { memberId: alice.memberId, roles: [role.id] })).success, true);
    });
    await t.test('identificação, cargos e canais permanecem após reiniciar o servidor', async () => {
      await stop(); await start();
      const restoredAlice = await connect('Alice', alice.token), restoredBob = await connect('Bob', bob.token);
      assert.equal(restoredAlice.memberId, alice.memberId);
      assert.ok(restoredAlice.permissions.permissions.includes('muteMembers'));
      assert.ok(!restoredAlice.channels.some(ch => ch.id === channelId));
      assert.ok(restoredBob.channels.some(ch => ch.id === channelId));
      const fresh = await connect('Alice');
      assert.equal(fresh.permissions.permissions.length, 0);
      assert.ok(!fresh.channels.some(ch => ch.id === channelId));
      assert.equal(fs.statSync(path.join(directory, 'permissions.json')).mode & 0o777, 0o600);
    });
    await t.test('remover cargo e carregar regra inválida nunca publica o canal', async () => {
      const admin = await connect('Dono', owner.token);
      await emit(admin.socket, 'admin-login', { key: 'admin-permissoes-teste' });
      await emit(admin.socket, 'channel-access', { channelId, access: { private: true, roles: [role.id], members: [] } });
      assert.equal((await emit(admin.socket, 'role-delete', { id: role.id })).success, true);
      await stop(); await start();
      const visitor = await connect('Pessoa sem cargo', bob.token);
      assert.ok(!visitor.channels.some(ch => ch.id === channelId));
      await stop();
      const file = path.join(directory, 'channels.json');
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      saved.channels.find(ch => ch.id === channelId).access = { private: 'valor inválido' };
      fs.writeFileSync(file, JSON.stringify(saved));
      await start();
      const after = await connect('Visitante após arquivo inválido');
      assert.ok(!after.channels.some(ch => ch.id === channelId));
      assert.equal((await emit(after.socket, 'join-channel', { channelId })).success, false);
      assert.ok(!JSON.stringify(await fetch(base + '/api/channels').then(r => r.json())).includes(channelId));
    });
  } finally { await stop(); revoked.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
