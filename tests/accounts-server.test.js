import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { profileProof } from '../public/profile-identity.js';

test('contas no servidor real preservam identidade e revogam acesso entre aparelhos', { timeout: 45000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-contas-servidor-'));
  const clients = [], revocations = [];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async predicate => {
    for (let index = 0; index < 150; index++) { if (predicate()) return; await wait(20); }
    assert.ok(predicate(), 'O servidor deve publicar o estado esperado.');
  };
  const emit = (client, event, payload = {}) => client.socket.timeout(5000).emitWithAck(event, payload);
  const revoked = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    if (body) revocations.push(JSON.parse(body).id);
    res.writeHead(204); res.end();
  });
  await new Promise(resolve => revoked.listen(0, '127.0.0.1', resolve));
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let process, serverError = '';
  async function start() {
    process = spawn('node', ['server.js'], { cwd: path.resolve(import.meta.dirname, '..'), stdio: ['ignore', 'ignore', 'pipe'], env: { ...globalThis.process.env,
      PORT: String(port), TELINHA_DATA_DIR: directory, OWNER_KEY: 'dono-contas-teste', ADMIN_KEY: '', TELINHA_MUSIC: '',
      SFU_SECRET: 'sfu-contas-teste', SFU_INTERNAL_URL: `http://127.0.0.1:${revoked.address().port}` } });
    process.stderr.on('data', chunk => { serverError += String(chunk); });
    for (let index = 0; index < 100; index++) {
      try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
      await wait(50);
    }
    throw new Error('Servidor de contas não iniciou: ' + serverError);
  }
  async function stop() {
    clients.forEach(client => client.socket.disconnect());
    if (process?.exitCode === null) { const stopped = once(process, 'exit'); process.kill(); await stopped; }
  }
  async function connect(auth = {}) {
    const socket = io(base, { autoConnect: false, reconnection: false, transports: ['websocket'], auth });
    const record = { socket, events: [] }; clients.push(record);
    socket.onAny((event, payload) => record.events.push([event, payload]));
    socket.on('permission-identity', payload => { record.permissionToken = payload.token; });
    socket.on('permissions-state', payload => { record.permissions = payload; });
    socket.on('account-state', payload => { record.accountState = payload; });
    socket.on('channels-list', payload => { record.channels = payload; });
    socket.on('room-info', payload => { record.assetKey = payload.assetKey; });
    const connected = new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    socket.connect(); await connected;
    await waitFor(() => record.permissions && record.accountState && record.assetKey);
    return record;
  }
  async function post(endpoint, payload) {
    const response = await fetch(base + '/api/account/' + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return response.json();
  }
  t.after(async () => { await stop(); await new Promise(resolve => revoked.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  await start();
  const profileId = randomUUID(), credential = 'c'.repeat(64);
  const challenge = (await fetch(base + '/api/identity').then(response => response.json())).challenge;
  const owner = await connect({ profileId, profileProof: await profileProof(credential, base, challenge) });
  assert.equal((await emit(owner, 'update-profile', { profileId, name: 'Mestre dos amigos', bio: 'Perfil original', color: '#5865F2' })).success, true);
  assert.equal((await emit(owner, 'owner-claim', { key: 'dono-contas-teste' })).success, true);
  const memberId = owner.permissions.memberId, oldToken = owner.permissionToken;
  const role = (await emit(owner, 'role-save', { name: 'Mestre RPG', position: 20, permissions: ['manageChannels'] })).role;
  assert.equal((await emit(owner, 'member-roles', { memberId, roles: [role.id] })).success, true);
  assert.equal((await emit(owner, 'admin-set-room-password', { password: 'senha-da-sala' })).success, true);

  let registered, first, second, attachmentUrl, sfuId;
  await t.test('cadastro vincula perfil/cargos/dono e permite login HTTP sem senha da sala', async () => {
    const disconnected = once(owner.socket, 'disconnect');
    registered = await emit(owner, 'account-register', { username: 'mestre_rpg', password: 'senha-da-conta', profile: { id: randomUUID(), name: 'Perfil forjado' } });
    assert.equal(registered.success, true);
    assert.equal(registered.account.accessId, memberId);
    assert.equal(registered.profile.id, profileId);
    assert.equal(registered.profile.name, 'Mestre dos amigos');
    assert.match(registered.recoveryCode, /^[a-f0-9-]+$/);
    await disconnected;
    const httpLogin = await post('login', { username: 'mestre_rpg', password: 'senha-da-conta' });
    assert.equal(httpLogin.success, true);
    first = await connect({ accountToken: registered.token, profileId: 'perfil-visitante-novo' });
    second = await connect({ accountToken: httpLogin.token, profileId: 'outro-visitante-novo' });
    for (const record of [first, second]) {
      assert.equal(record.permissions.memberId, memberId);
      assert.equal(record.permissions.owner, true);
      assert.ok(record.permissions.roles.some(item => item.id === role.id));
      assert.equal(record.accountState.profile.id, profileId);
      assert.equal(record.accountState.profile.name, 'Mestre dos amigos');
      assert.equal(record.permissionToken, undefined, 'Conta não recebe token legado durável.');
    }
  });
  await t.test('token e prova antigos não recuperam poderes de uma identidade vinculada', async () => {
    const newChallenge = (await fetch(base + '/api/identity').then(response => response.json())).challenge;
    const legacy = await connect({ profileId, permissionToken: oldToken, roomPassword: 'senha-da-sala', profileProof: await profileProof(credential, base, newChallenge) });
    assert.equal(legacy.permissions.owner, false);
    assert.notEqual(legacy.permissions.memberId, memberId);
    assert.equal((await emit(legacy, 'owner-transfer', { memberId: legacy.permissions.memberId })).success, false);
    legacy.socket.disconnect();
  });
  await t.test('visitante que copia o ID público de uma conta não edita nem apaga mensagens dela', async () => {
    const copied = await connect({ profileId, roomPassword: 'senha-da-sala' });
    assert.equal((await emit(copied, 'update-profile', { profileId, name: 'Cópia do mestre' })).success, true);
    assert.equal((await emit(copied, 'join-channel', { channelId: 'geral', profileId })).success, true);
    const shown = copied.channels.flatMap(channel => channel.users || []).find(user => user.id === copied.socket.id);
    assert.notEqual(shown.profileId, profileId);
    assert.notEqual(copied.permissions.memberId, memberId);
    const created = await emit(first, 'create-text-channel', { name: 'Texto público autoria', access: { private: false, members: [], roles: [] } });
    assert.equal(created.success, true);
    assert.equal((await emit(first, 'text-message', { channelId: created.channelId, text: 'Mensagem original da conta' })).success, true);
    const history = await emit(copied, 'text-history', { channelId: created.channelId });
    const message = history.messages.at(-1);
    assert.equal(message.profileId, profileId);
    assert.equal((await emit(copied, 'message-edit', { scope: 'text', channelId: created.channelId, messageId: message.id, text: 'Mensagem adulterada' })).success, false);
    assert.equal((await emit(copied, 'message-delete', { scope: 'text', channelId: created.channelId, messageId: message.id })).success, false);
    const stillPresent = await emit(first, 'text-history', { channelId: created.channelId });
    assert.equal(stillPresent.messages.at(-1).text, 'Mensagem original da conta');
    copied.socket.disconnect();
  });
  await t.test('perfil sincroniza entre aparelhos e id não pode ser trocado por join/update', async () => {
    assert.equal((await emit(first, 'join-channel', { channelId: 'geral', profileId: 'perfil-forjado-123', name: 'Mestre dos amigos' })).success, true);
    assert.equal((await emit(first, 'update-profile', { profileId: 'outro-perfil-forjado', name: 'Mestre atualizado', bio: 'Sincronizado' })).success, true);
    await waitFor(() => second.accountState.profile.name === 'Mestre atualizado');
    assert.equal(second.accountState.profile.id, profileId);
    assert.equal(second.accountState.profile.bio, 'Sincronizado');
    const meInCall = first.channels.flatMap(item => item.users || []).find(user => user.id === first.socket.id);
    assert.equal(meInCall.profileId, profileId);
  });
  await t.test('falha ao persistir perfil não publica mudanças nem troca o estado em memória', async () => {
    const file = path.join(directory, 'accounts.json'), backup = path.join(directory, 'accounts-anterior.json');
    fs.renameSync(file, backup); fs.mkdirSync(file);
    try {
      const failed = await emit(first, 'update-profile', { name: 'Não pode publicar', bio: 'Não salvar' });
      assert.equal(failed.success, false);
      const updated = once(second.socket, 'channels-list');
      second.socket.emit('get-channels'); await updated;
      const shown = second.channels.flatMap(item => item.users || []).find(user => user.id === first.socket.id);
      assert.equal(shown.name, 'Mestre atualizado');
      assert.equal(second.accountState.profile.name, 'Mestre atualizado');
    } finally { fs.rmdirSync(file); fs.renameSync(backup, file); }
  });
  await t.test('recuperação derruba sessões antigas, anexos privados e mídia SFU imediatamente', async () => {
    const created = await emit(first, 'create-text-channel', { name: 'RPG privado conta', access: { private: true, members: [memberId], roles: [] } });
    assert.equal(created.success, true);
    assert.equal((await emit(first, 'text-file', { channelId: created.channelId, name: 'aventura.txt', data: Buffer.from('Segredo do RPG') })).success, true);
    const history = await emit(first, 'text-history', { channelId: created.channelId });
    attachmentUrl = base + history.messages.at(-1).attachment.url + '?access=' + first.assetKey;
    assert.equal((await fetch(attachmentUrl)).status, 200);
    const sfu = await emit(first, 'sfu-token', { ownerId: first.socket.id, role: 'host' });
    assert.equal(sfu.ok, true); sfuId = sfu.token.split('.')[0];
    const firstGone = once(first.socket, 'disconnect'), secondGone = once(second.socket, 'disconnect');
    const recovered = await post('recover', { username: 'mestre_rpg', password: 'senha-recuperada', recoveryCode: registered.recoveryCode });
    assert.equal(recovered.success, true);
    await Promise.all([firstGone, secondGone]);
    assert.equal((await fetch(attachmentUrl)).status, 404);
    await waitFor(() => revocations.includes(sfuId));
    assert.equal((await post('login', { username: 'mestre_rpg', password: 'senha-da-conta' })).success, false);
    registered = recovered;
  });
  await t.test('sessão e perfil persistem após reinício e logout encerra o acesso', async () => {
    await stop(); await start();
    const restored = await connect({ accountToken: registered.token });
    assert.equal(restored.permissions.memberId, memberId);
    assert.equal(restored.permissions.owner, true);
    assert.equal(restored.accountState.profile.name, 'Mestre atualizado');
    assert.equal(restored.accountState.profile.id, profileId);
    assert.ok(restored.permissions.roles.some(item => item.id === role.id));
    const gone = once(restored.socket, 'disconnect');
    assert.equal((await emit(restored, 'account-logout')).success, true);
    await gone;
    await assert.rejects(connect({ accountToken: registered.token }), error => error.message === 'account-session-expired');
    await assert.rejects(connect({ accountToken: registered.token, roomPassword: 'senha-da-sala' }), error => error.message === 'account-session-expired');
  });
});
