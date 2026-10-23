import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';

test('contas opcionais e amigos com servidor real', { timeout: 45000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-contas-test-'));
  const port = 19108;
  const base = `http://127.0.0.1:${port}`;
  const clients = [];
  let proc;
  const once = (socket, event) => new Promise((resolve, reject) => {
    const done = (value) => { clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { socket.off(event, done); reject(new Error(`Evento não recebido: ${event}`)); }, 4000);
    socket.once(event, done);
  });
  const emit = (socket, event, payload = {}) => new Promise((resolve, reject) => socket.timeout(4000).emit(event, payload, (err, result) => err ? reject(err) : resolve(result)));
  async function start() {
    proc = spawn('node', ['server.js'], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, PORT: String(port), TELINHA_DATA_DIR: dataDir, ADMIN_KEY: 'admin-teste-contas' }, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('O servidor de contas não iniciou.');
  }
  async function stop() {
    if (!proc || proc.exitCode !== null) return;
    const stopped = once(proc, 'exit'); proc.kill(); await stopped;
  }
  async function connect(auth = {}) {
    const socket = io(base, { auth, transports: ['websocket'], reconnection: false, autoConnect: false });
    clients.push(socket);
    const state = once(socket, 'account-state');
    socket.connect();
    return { socket, state: await state };
  }
  const profile = (name, id = `visitante-${name.toLowerCase()}-0001`) => ({ profileId: id, name, color: '#5865F2', bio: 'Meu perfil de visitante', avatarCrop: { x: .2, y: .6, zoom: 2 } });
  const join = async (socket, channelId, p) => {
    const state = once(socket, 'channel-state');
    assert.equal((await emit(socket, 'join-channel', { channelId, profile: p })).success, true);
    return state;
  };
  try {
    await start();
    const { socket: alice, state: initial } = await connect();
    const { socket: bob } = await connect();
    const { socket: guest } = await connect();
    let a, b;
    await t.test('visitantes continuam usando voz e texto, sem acesso a amizades', async () => {
      assert.equal(initial.supported, true); assert.equal(initial.account, null);
      assert.equal((await join(guest, 'geral', profile('Visitante'))).me.account, null);
      assert.equal((await emit(guest, 'create-text-channel', { name: 'Texto livre', profileId: 'visitante-visitante-0001' })).success, true);
      assert.equal((await emit(guest, 'text-message', { channelId: 'texto-livre', text: 'Sem cadastro' })).success, true);
      assert.equal((await emit(guest, 'friend-request', { username: 'alice' })).code, 'session-expired');
    });
    await t.test('cadastro copia o perfil atual e cria uma identidade autenticada', async () => {
      await join(alice, 'geral', profile('Alice'));
      a = await emit(alice, 'account-register', { username: 'Alice', password: 'senha-alice-segura', profile: profile('Alice') });
      b = await emit(bob, 'account-register', { username: 'bob', password: 'senha-bob-segura', profile: profile('Bob') });
      assert.equal(a.success, true); assert.equal(b.success, true);
      assert.equal(a.account.username, 'alice');
      assert.match(a.account.id, /^conta-/);
      assert.notEqual(a.account.id, 'visitante-alice-0001');
      assert.equal(a.profile.name, 'Alice');
      assert.equal(a.profile.bio, 'Meu perfil de visitante');
      assert.deepEqual(a.profile.avatarCrop, { x: .2, y: .6, zoom: 2 });
      assert.equal(a.account.hash, undefined); assert.equal(a.account.salt, undefined);
      const channels = await (await fetch(base + '/api/channels')).json();
      const alicePublic = channels.find((c) => c.id === 'geral').users.find((u) => u.id === alice.id);
      assert.equal(alicePublic.profileId, a.account.id);
      assert.deepEqual(alicePublic.account, { username: 'alice' });
      assert.ok(!JSON.stringify(channels).includes(a.token));
      const raw = fs.readFileSync(path.join(dataDir, 'accounts', 'accounts.json'), 'utf8');
      for (const secret of ['senha-alice-segura', 'senha-bob-segura', a.token, b.token]) assert.ok(!raw.includes(secret), 'base não guarda senha nem token em texto puro');
      const db = JSON.parse(raw);
      assert.notEqual(db.accounts[0].salt, db.accounts[1].salt);
      assert.equal(fs.statSync(path.join(dataDir, 'accounts', 'accounts.json')).mode & 0o777, 0o600);
    });
    await t.test('visitante não pode se passar por conta para apagar canal ou mensagem', async () => {
      const created = await emit(alice, 'create-channel', { name: 'Da conta Alice' });
      await emit(guest, 'update-profile', { profileId: a.account.id, name: 'Impostor' });
      await emit(guest, 'leave-channel');
      const claimed = await join(guest, 'geral', { profileId: a.account.id, name: 'Impostor' });
      assert.notEqual(claimed.me.profileId, a.account.id);
      assert.equal(claimed.me.account, null);
      assert.equal((await emit(guest, 'delete-channel', { channelId: created.channelId })).success, false);
      const message = once(guest, 'chat-message');
      alice.emit('chat-message', { text: 'Mensagem da conta' });
      assert.equal((await emit(guest, 'message-edit', { messageId: (await message).id, text: 'forjada' })).success, false);
      const { socket: fresh } = await connect();
      await emit(fresh, 'create-text-channel', { name: 'Falso', profileId: a.account.id });
      assert.equal((await emit(fresh, 'delete-channel', { channelId: created.channelId })).success, false);
    });
    await t.test('pedidos são privados e apenas o destinatário pode aceitar', async () => {
      assert.equal((await emit(alice, 'friend-request', { username: '@ALICE' })).success, false);
      assert.equal((await emit(alice, 'friend-request', { username: '@naoexiste' })).success, false);
      assert.equal((await emit(alice, 'friend-request', { username: '@BOB' })).success, true);
      assert.equal((await emit(alice, 'friend-request', { username: 'bob' })).success, false);
      assert.equal((await emit(alice, 'friend-accept', { userId: b.account.id })).success, false);
      const aState = await emit(alice, 'friends-list');
      const bState = await emit(bob, 'friends-list');
      assert.equal(aState.outgoing[0].id, b.account.id);
      assert.equal(bState.incoming[0].id, a.account.id);
      assert.equal((await emit(guest, 'friends-list', { accountId: a.account.id })).success, false);
      const notified = once(alice, 'friends-state');
      assert.equal((await emit(bob, 'friend-accept', { userId: a.account.id })).success, true);
      assert.equal((await notified).friends[0].online, true);
      assert.equal((await emit(alice, 'friends-list')).friends[0].id, b.account.id);
    });
    let secondAlice;
    await t.test('login em outro dispositivo carrega o perfil salvo e sincroniza edições', async () => {
      const { socket: login } = await connect();
      assert.equal((await emit(login, 'account-login', { username: 'alice', password: 'errada' })).success, false);
      const result = await emit(login, 'account-login', { username: 'ALICE', password: 'senha-alice-segura' });
      assert.equal(result.account.id, a.account.id); assert.equal(result.profile.name, 'Alice');
      secondAlice = { socket: login, token: result.token };
      const updated = once(login, 'account-profile');
      assert.equal((await emit(alice, 'update-profile', { name: 'Alice na conta', bio: 'Salvo no servidor', profileId: b.account.id })).success, true);
      assert.equal((await updated).name, 'Alice na conta');
      const sameToken = await connect({ accountToken: a.token });
      assert.equal(sameToken.state.profile.bio, 'Salvo no servidor');
      assert.equal(sameToken.state.profile.id, a.account.id);
      sameToken.socket.disconnect();
      const profilesDir = path.join(dataDir, 'accounts', 'profiles');
      try {
        fs.chmodSync(profilesDir, 0o500);
        assert.equal((await emit(alice, 'update-profile', { bio: 'Tentar salvar de novo' })).success, false);
      } finally { fs.chmodSync(profilesDir, 0o700); }
      assert.equal((await emit(alice, 'update-profile', { bio: 'Tentar salvar de novo' })).success, true, 'repete gravação mesmo se o perfil já mudou na memória');
      assert.equal(JSON.parse(fs.readFileSync(path.join(profilesDir, `${a.account.id}.json`), 'utf8')).bio, 'Tentar salvar de novo');
    });
    await t.test('online considera todas as sessões; logout revoga a sessão e restaura visitante', async () => {
      const duplicate = await connect({ accountToken: a.token });
      const ended = once(duplicate.socket, 'account-session-ended');
      const result = await emit(alice, 'account-logout', { profile: { ...profile('Alice visitante'), id: 'visitante-alice-0001' } });
      assert.equal(result.account, null); assert.equal(result.profile.id, 'visitante-alice-0001');
      await ended;
      assert.equal((await emit(bob, 'friends-list')).friends[0].online, true, 'outra sessão continua online');
      const invalid = await connect({ accountToken: a.token });
      assert.equal(invalid.state.account, null); assert.equal(invalid.state.sessionExpired, true);
      const offline = once(bob, 'friends-state');
      secondAlice.socket.disconnect();
      assert.equal((await offline).friends[0].online, false);
      assert.equal((await emit(alice, 'text-message', { channelId: 'texto-livre', text: 'Continuo como visitante' })).success, true);
    });
    await t.test('conta, sessão, perfil e amizade sobrevivem ao reinício', async () => {
      clients.forEach((c) => c.disconnect());
      await stop(); await start();
      const returned = await connect({ accountToken: secondAlice.token });
      secondAlice.socket = returned.socket;
      assert.equal(returned.state.account.id, a.account.id);
      assert.equal(returned.state.profile.name, 'Alice na conta');
      const state = await emit(returned.socket, 'friends-list');
      assert.equal(state.friends[0].id, b.account.id); assert.equal(state.friends[0].online, false);
      const bobBack = await connect({ accountToken: b.token });
      assert.equal(bobBack.state.account.id, b.account.id);
      const online = await emit(returned.socket, 'friends-list');
      assert.equal(online.friends[0].online, true);
      assert.equal((await emit(returned.socket, 'friend-remove', { userId: b.account.id })).success, true);
      assert.equal((await emit(bobBack.socket, 'friends-list')).friends.length, 0);
      assert.equal((await emit(returned.socket, 'friend-request', { username: 'bob' })).success, true);
      assert.equal((await emit(returned.socket, 'friend-reject', { userId: b.account.id })).success, false);
      assert.equal((await emit(bobBack.socket, 'friend-reject', { userId: a.account.id })).success, true);
      assert.equal((await emit(bobBack.socket, 'friend-request', { username: 'alice' })).success, true);
      assert.equal((await emit(returned.socket, 'friend-cancel', { userId: b.account.id })).success, false);
      assert.equal((await emit(bobBack.socket, 'friend-cancel', { userId: a.account.id })).success, true);
      assert.equal((await emit(returned.socket, 'friends-list')).incoming.length, 0);
      // Conta não substitui a senha da sala nem dos canais.
      await emit(bobBack.socket, 'admin-login', { key: 'admin-teste-contas' });
      await emit(bobBack.socket, 'admin-set-room-password', { password: 'sala-fechada' });
      const blocked = io(base, { auth: { accountToken: secondAlice.token }, transports: ['websocket'], reconnection: false, autoConnect: false });
      clients.push(blocked);
      const error = once(blocked, 'connect_error'); blocked.connect();
      assert.equal((await error).message, 'room-password');
    });
  } finally { clients.forEach((c) => c.disconnect()); await stop(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});
