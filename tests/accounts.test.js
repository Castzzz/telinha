import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { AccountStore, createAccountLimiter, accountClientAddress } from '../account-store.js';
import { PermissionStore } from '../permission-store.js';
import { installAccountHandlers, installAccountHttp } from '../accounts-protocol.js';
import { accountSession, initialAccountProfile, accountProfileSnapshot } from '../public/accounts.js';

const profile = id => ({ id: id || randomUUID(), name: 'Apelido dos amigos', color: '#5865F2', bio: 'Meu perfil' });
const fixture = t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-contas-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, store: new AccountStore(directory) };
};

test('conta preserva perfil, cargos e dono em outro aparelho e após reiniciar', async t => {
  const { directory, store } = fixture(t);
  const permissions = new PermissionStore(directory), identity = permissions.identity();
  const role = permissions.saveRole({ name: 'Mestre', position: 20, permissions: ['manageChannels'] });
  permissions.assign(identity.id, [role.id]); permissions.setOwner(identity.id);
  const savedProfile = profile();
  const registered = await store.register('  @Mestre_RPG ', 'senha-privada-teste', { accessId: identity.id, profile: savedProfile });
  assert.equal(registered.account.username, 'mestre_rpg');
  assert.equal(registered.account.profileId, savedProfile.id);
  assert.match(registered.recoveryCode, /^(?:[a-f0-9]{8}-){5}[a-f0-9]{8}$/);
  const copy = store.resolveSession(registered.token);
  copy.profile.name = 'Não deve mudar';
  assert.equal(store.resolveSession(registered.token).profile.name, savedProfile.name);
  const restarted = new AccountStore(directory);
  assert.equal(restarted.resolveSession(registered.token).account.accessId, identity.id);
  const login = await restarted.login('MESTRE_RPG', 'senha-privada-teste');
  assert.equal(login.account.accessId, identity.id);
  assert.deepEqual(login.profile, registered.profile);
  assert.equal(permissions.isOwner({ accessId: login.account.accessId }), true);
  assert.deepEqual(permissions.roles({ accessId: login.account.accessId }).map(item => item.id), [role.id]);
  assert.ok(restarted.referencedAccessIds().has(identity.id));
  assert.equal(restarted.accountForAccessId(identity.id).id, login.account.id);
  assert.equal(restarted.accountForProfileId(savedProfile.id).id, login.account.id);
  assert.equal(restarted.resolveSessionMeta(login.token).profile, undefined);
  const disk = fs.readFileSync(path.join(directory, 'accounts.json'), 'utf8');
  for (const privateValue of [registered.token, login.token, registered.recoveryCode, 'senha-privada-teste']) assert.ok(!disk.includes(privateValue));
  assert.equal(fs.statSync(path.join(directory, 'accounts.json')).mode & 0o777, 0o600);
});

test('usuário e vínculo não duplicam; colisão de ID público não bloqueia cadastro legítimo', async t => {
  const { store } = fixture(t), firstProfile = profile(), accessId = randomUUID();
  const outcomes = await Promise.allSettled([
    store.register('mesmo_nome', 'senha-valida-teste', { accessId, profile: firstProfile }),
    store.register('mesmo_nome', 'senha-valida-teste', { accessId: randomUUID(), profile: profile() })
  ]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  const winner = outcomes.find(item => item.status === 'fulfilled').value;
  await assert.rejects(store.register('outro_nome', 'senha-valida-teste', { accessId: winner.account.accessId, profile: profile() }), /já está vinculado/);
  const copiedId = randomUUID();
  const collision = await store.register('terceiro_nome', 'senha-valida-teste', { accessId: copiedId, profile: { ...profile(), id: winner.profile.id } });
  assert.notEqual(collision.profile.id, winner.profile.id);
  assert.equal(collision.account.accessId, copiedId);
  await assert.rejects(store.login('mesmo_nome', 'senha-errada'), /Usuário ou senha incorretos/);
  await assert.rejects(store.login('nome_inexistente', 'senha-errada'), /Usuário ou senha incorretos/);
  await assert.rejects(store.register('sem espaço', 'senha-valida-teste', { accessId, profile: firstProfile }), /3 a 24/);
  await assert.rejects(store.register('curta', 'abc', { accessId, profile: firstProfile }), /8 a 128/);
  assert.equal(store.resolveSession('valor-forjado'), null);
  assert.equal(store.resolveSession('a'.repeat(64)), null);
});

test('recuperação revoga todas as sessões e o código antigo; logout só revoga a própria', async t => {
  const { directory, store } = fixture(t);
  const registered = await store.register('jogador', 'primeira-senha', { accessId: randomUUID(), profile: profile() });
  const login = await store.login('jogador', 'primeira-senha');
  await store.logout(login.token);
  assert.equal(store.resolveSession(login.token), null);
  assert.ok(store.resolveSession(registered.token));
  await assert.rejects(store.recover('jogador', 'a'.repeat(48), 'segunda-senha'), /Usuário ou código/);
  await assert.rejects(store.recover('inexistente', registered.recoveryCode, 'segunda-senha'), /Usuário ou código/);
  const recovered = await store.recover('JOGADOR', registered.recoveryCode.toUpperCase(), 'segunda-senha');
  assert.equal(recovered.account.id, registered.account.id);
  assert.equal(store.resolveSession(registered.token), null);
  assert.notEqual(recovered.recoveryCode, registered.recoveryCode);
  assert.ok(store.resolveSession(recovered.token));
  await assert.rejects(store.recover('jogador', registered.recoveryCode, 'terceira-senha'), /Usuário ou código/);
  await assert.rejects(store.login('jogador', 'primeira-senha'), /Usuário ou senha/);
  const restarted = new AccountStore(directory);
  assert.equal(restarted.resolveSession(registered.token), null);
  const valid = await restarted.login('jogador', 'segunda-senha');
  assert.equal(valid.account.id, registered.account.id);
});

test('perfil da conta muda mantendo id; expiração e limite de sessões são aplicados', async t => {
  const { directory } = fixture(t);
  let now = Date.now();
  const store = new AccountStore(directory, { now: () => now });
  const registered = await store.register('sessao', 'senha-da-sessao', { accessId: randomUUID(), profile: profile() });
  const updated = { ...registered.profile, name: 'Outro apelido' };
  await store.saveProfile(registered.account.id, updated);
  assert.equal(store.resolveSession(registered.token).profile.name, updated.name);
  await assert.rejects(store.saveProfile(registered.account.id, profile()), /identificação original/);
  for (let index = 0; index < 8; index++) { now++; await store.login('sessao', 'senha-da-sessao'); }
  assert.equal(store.data.sessions.length, 8);
  assert.equal(store.resolveSession(registered.token), null);
  const latest = await store.login('sessao', 'senha-da-sessao');
  now += 31 * 86400000;
  assert.equal(store.resolveSession(latest.token), null);
});

test('falha de gravação não confirma conta nem sessão; corrupção não é substituída', async t => {
  const { directory, store } = fixture(t);
  const registered = await store.register('salvo', 'senha-de-gravacao', { accessId: randomUUID(), profile: profile() });
  const oldFile = store.file;
  store.file = path.join(directory, 'inexistente', 'accounts.json');
  await assert.rejects(store.login('salvo', 'senha-de-gravacao'));
  assert.equal(store.data.sessions.length, 1);
  assert.ok(store.resolveSession(registered.token));
  store.file = oldFile;
  fs.writeFileSync(oldFile, '{incompleto');
  assert.throws(() => new AccountStore(directory), /Restaure accounts.json/);
  assert.equal(fs.readFileSync(oldFile, 'utf8'), '{incompleto');
  assert.equal(new AccountStore('').available, false);
});

test('limites sobrevivem à reconexão e proxy só informa IP se for local', () => {
  let now = 1;
  const limit = createAccountLimiter(() => now);
  assert.equal(limit('endereco', 2), false);
  assert.equal(limit('endereco', 2), false);
  assert.equal(limit('endereco', 2), true);
  now += 60000;
  assert.equal(limit('endereco', 2), false);
  assert.equal(accountClientAddress('127.0.0.1', '198.51.100.1, 203.0.113.2'), '203.0.113.2');
  assert.equal(accountClientAddress('198.51.100.7', '203.0.113.2'), '198.51.100.7');
  assert.equal(accountClientAddress('127.0.0.1', 'inválido'), '127.0.0.1');
});

function mockSocket(auth = {}) {
  const events = new Map(), sent = [];
  return { id: randomUUID(), events, sent, handshake: { auth, address: '198.51.100.1', headers: {} },
    on: (event, handler) => events.set(event, handler), emit: (event, payload) => sent.push({ event, payload }),
    request: (event, payload) => new Promise(resolve => events.get(event)(payload, resolve)) };
}

test('protocolo cadastra o perfil confirmado pelo servidor e não aceita token inválido', async t => {
  const { store } = fixture(t), serverProfile = profile(), accessId = randomUUID(), socket = mockSocket(), revoked = [];
  installAccountHandlers({ socket, store, user: { accessId }, getProfile: () => serverProfile, limit: () => false, onRevoke: data => revoked.push(data) });
  assert.equal(socket.sent[0].event, 'account-state');
  assert.equal(socket.sent[0].payload.supported, true);
  const result = await socket.request('account-register', { username: 'mestre', password: 'senha-teste-protocolo', profile: profile(), accessId: randomUUID() });
  assert.equal(result.success, true);
  assert.equal(result.account.accessId, accessId);
  assert.equal(result.profile.id, serverProfile.id);
  assert.equal(revoked[0].kind, 'register');
  const invalid = mockSocket({ accountToken: 'f'.repeat(64) });
  installAccountHandlers({ socket: invalid, store, user: { accessId: randomUUID() }, getProfile: profile, limit: () => false });
  assert.equal(invalid.sent[0].payload.sessionExpired, true);
  const login = await invalid.request('account-login', { username: 'mestre', password: 'senha-teste-protocolo' });
  assert.equal(login.success, false);
  assert.equal(login.code, 'session-expired');
  const logged = mockSocket({ accountToken: result.token });
  installAccountHandlers({ socket: logged, store, user: { accessId }, getProfile: () => serverProfile, limit: () => false });
  assert.equal(logged.sent[0].payload.profile.id, serverProfile.id);
  assert.equal((await logged.request('account-logout', {})).success, true);
  assert.equal(store.resolveSession(result.token), null);
});

test('snapshot inicial da conta evita publicar perfil de visitante', () => {
  const guest = profile(), accountProfile = profile(), url = 'https://sala.test';
  const prefs = { profile: guest, accountSessions: { [url]: { token: 'a'.repeat(64), profile: accountProfile } } };
  assert.equal(initialAccountProfile(prefs, url), accountProfile);
  assert.equal(initialAccountProfile(prefs, 'https://outra.test'), guest);
  prefs.accountSessions[url].token = 'inválido';
  assert.equal(accountSession(prefs, url), null);
  assert.equal(initialAccountProfile(prefs, url), guest);
  const large = { ...accountProfile, avatar: 'foto', banner: 'banner', joinSound: 'som', avatarCrop: { x: 0.2, y: 0.3, zoom: 2 } };
  const snapshot = accountProfileSnapshot(large);
  assert.equal(snapshot.id, large.id);
  assert.deepEqual(snapshot.avatarCrop, large.avatarCrop);
  assert.equal('avatar' in snapshot, false);
  assert.equal('banner' in snapshot, false);
  assert.equal('joinSound' in snapshot, false);
  assert.equal(large.avatar, 'foto');
});

test('login HTTP funciona antes da senha da sala, valida entradas e recuperação revoga sessões', async t => {
  const { store } = fixture(t);
  const registered = await store.register('celular', 'senha-do-celular', { accessId: randomUUID(), profile: profile() });
  const app = express(), revoked = [];
  installAccountHttp({ app, store, limit: () => false, onRevoke: data => revoked.push(data) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/account`;
  const request = (endpoint, payload) => fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const info = await fetch(base);
  assert.deepEqual(await info.json(), { supported: true });
  assert.equal(info.headers.get('access-control-allow-origin'), '*');
  assert.equal(info.headers.get('cache-control'), 'no-store');
  const options = await fetch(base + '/login', { method: 'OPTIONS', headers: { Origin: 'https://appassets.androidplatform.net' } });
  assert.equal(options.status, 204);
  const login = await (await request('/login', { username: 'celular', password: 'senha-do-celular' })).json();
  assert.equal(login.success, true);
  assert.equal(login.account.accessId, registered.account.accessId);
  assert.equal(login.profile.id, registered.profile.id);
  assert.equal((await request('/login', { username: 'celular', password: 'senha-do-celular', profile: profile() })).status, 400);
  assert.equal((await request('/login', { username: [], password: 'abc' })).status, 400);
  assert.equal((await request('/login', { username: 'celular', password: 'a'.repeat(9000) })).status, 413);
  const invalid = await (await request('/login', { username: 'inexistente', password: 'senha-errada' })).json();
  assert.equal(invalid.error, 'Usuário ou senha incorretos.');
  const recovered = await (await request('/recover', { username: 'celular', password: 'nova-senha-celular', recoveryCode: registered.recoveryCode })).json();
  assert.equal(recovered.success, true);
  assert.equal(store.resolveSession(login.token), null);
  assert.equal(revoked.at(-1).kind, 'recover');
  assert.equal((await (await request('/logout', { token: recovered.token })).json()).success, true);
  assert.equal(store.resolveSession(recovered.token), null);
});

test('limite HTTP e Socket.IO compartilha os mesmos buckets por endereço', async t => {
  const { store } = fixture(t), limit = createAccountLimiter();
  const app = express();
  installAccountHttp({ app, store, limit });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  // Simula as tentativas de um socket que reconectou antes do pedido HTTP.
  for (let index = 0; index < 12; index++) assert.equal(limit('address:127.0.0.1', 12), false);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/account/login`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'alguem', password: 'senha-errada' }) });
  assert.equal(response.status, 429);
  assert.match((await response.json()).error, /Muitas tentativas/);
});
