import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { io } from 'socket.io-client';
import { DiceStore, parseDice } from '../dice-store.js';
import { PermissionStore } from '../permission-store.js';

test('dados personalizados, limites, resultados e histórico persistente de 30 rolagens', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-dados-'));
  try {
    assert.deepEqual(parseDice('2D15+3'), { count: 2, sides: 15, modifier: 3, notation: '2d15+3' });
    for (const invalid of ['0d6', '101d6', '1d1', '1d10001', '1d6+10001', {}, '1d6<script>']) assert.throws(() => parseDice(invalid));
    const store = new DiceStore(dir);
    for (let i = 0; i < 35; i++) {
      const roll = store.roll('3d15-2', { name: 'Aventureiro' });
      assert.ok(roll.values.every(v => v >= 1 && v <= 15));
      assert.equal(roll.total, roll.values.reduce((a, b) => a + b, -2));
    }
    const restored = new DiceStore(dir);
    assert.equal(restored.history().length, 30);
    assert.equal(restored.history()[0].userName, 'Aventureiro');
    const copy = restored.history(); copy[0].total = -999;
    assert.notEqual(restored.history()[0].total, -999);
    fs.mkdirSync(path.join(dir, 'dice.json.tmp'));
    assert.throws(() => restored.roll('1d20', { name: 'Outro' }), /guardar/);
    assert.deepEqual(restored.history(), store.history());
    fs.rmdirSync(path.join(dir, 'dice.json.tmp'));
    assert.equal(new DiceStore(dir).history().length, 30);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('migração preserva o arquivo antigo sem publicar rolagens de canais privados', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-dados-legado-'));
  try {
    const file = path.join(dir, 'dice.json');
    const legacy = JSON.stringify({ version: 1, histories: [['text:privado', [{ userName: 'Privado', total: 10 }]]] });
    fs.writeFileSync(file, legacy, { mode: 0o600 });
    const migrated = new DiceStore(dir);
    assert.deepEqual(migrated.history(), []);
    assert.equal(fs.readFileSync(file + '.por-canal-v1', 'utf8'), legacy);
    migrated.roll('1d6', { name: 'Nome público' });
    assert.equal(new DiceStore(dir).history()[0].userName, 'Nome público');
    assert.ok(!fs.readFileSync(file, 'utf8').includes('Privado'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('propriedade e nomes iguais não contornam regras privadas', () => {
  const permissions = new PermissionStore();
  const owner = permissions.identity('', 'a'.repeat(64)), legacy = permissions.identity(), friend = permissions.identity();
  permissions.setOwner(owner.id); permissions.remember(owner.id, 'Mesmo nome'); permissions.remember(legacy.id, 'Mesmo nome');
  const privateChannel = { access: { private: true, roles: [], members: [legacy.id, friend.id] } };
  const actor = { accessId: owner.id };
  assert.equal(permissions.visible(actor, privateChannel), false);
  assert.equal(permissions.canWrite(actor, privateChannel), false);
  assert.equal(permissions.has(actor, 'manageChannels'), true);
  permissions.cleanMembers({ referencedIds: new Set([legacy.id]), onMerge() { assert.fail('Não pode mesclar por nome.'); } });
  assert.ok(permissions.data.members[legacy.id]);
  const role = permissions.saveRole({ name: 'RPG', position: 10, permissions: [] });
  privateChannel.access.roles = [role.id];
  assert.throws(() => permissions.checkAssignment(actor, owner.id, [role.id], [privateChannel]), /privado/);
  assert.throws(() => permissions.checkAssignment(actor, friend.id, [role.id], [{ access: { ...privateChannel.access, members: [] } }]), /privado/);
  privateChannel.access.members.push(owner.id);
  assert.doesNotThrow(() => permissions.checkAssignment(actor, owner.id, [role.id], [privateChannel]));
});

test('servidor protege canais privados e compartilha rolagens no histórico geral sem expor o canal', { timeout: 20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-privacidade-'));
  const launch = () => spawn(process.execPath, ['server.js'], { cwd: path.resolve(import.meta.dirname, '..'), stdio: 'ignore',
    env: { ...process.env, PORT: '19226', TELINHA_DATA_DIR: dir, OWNER_KEY: 'dono-local', TELINHA_MUSIC: '0', SFU_SECRET: 'sfu-local' } });
  let backend = launch();
  const base = 'http://127.0.0.1:19226', clients = [];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const emit = (client, event, data = {}) => client.socket.timeout(3000).emitWithAck(event, data);
  async function connect(name) {
    const socket = io(base, { transports: ['websocket'], reconnection: false, autoConnect: false });
    clients.push(socket);
    const client = { socket, events: [] }; socket.onAny((event, data) => client.events.push([event, data]));
    socket.on('room-info', data => { client.assetKey = data.assetKey; });
    const identity = once(socket, 'permission-identity'); socket.connect();
    client.memberId = (await identity)[0].token.split('.')[0];
    await emit(client, 'update-profile', { name, profileId: `perfil-${name.toLowerCase()}` });
    return client;
  }
  try {
    let started = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + '/api/health')).ok) { started = true; break; } } catch {}
      await wait(40);
    }
    assert.ok(started);
    const owner = await connect('Proprietario'), alice = await connect('Aventureira');
    assert.equal((await emit(owner, 'owner-claim', { key: 'dono-local' })).success, true);
    const role = (await emit(owner, 'role-save', { name: 'Gerente', position: 20, permissions: ['manageChannels'] })).role;
    assert.equal((await emit(owner, 'member-roles', { memberId: alice.memberId, roles: [role.id] })).success, true);
    owner.events.length = 0;
    const access = { private: true, roles: [role.id], members: [] };
    const id = (await emit(alice, 'create-text-channel', { name: 'RPG privado', access })).channelId;
    assert.ok(id);
    assert.equal((await emit(alice, 'text-message', { channelId: id, text: 'Segredo do mestre' })).success, true);
    const rolled = await emit(alice, 'dice-roll', { notation: '1d15', userName: 'Nome falsificado', total: 9999 });
    assert.equal(rolled.success, true);
    assert.equal(rolled.roll.userName, 'Aventureira');
    assert.ok(rolled.roll.total >= 1 && rolled.roll.total <= 15);
    assert.equal(rolled.scope, 'server');
    assert.ok(!JSON.stringify(rolled).includes(id));
    const history = await emit(alice, 'dice-history', { type: 'text', channelId: id });
    assert.equal(history.rolls.length, 1); assert.equal(history.rolls[0].id, rolled.roll.id);
    const file = await emit(alice, 'text-file', { channelId: id, name: 'segredo.txt', data: Buffer.from('Segredo') });
    assert.equal(file.success, true);
    const messages = (await emit(alice, 'text-history', { channelId: id })).messages;
    const attachment = messages.at(-1).attachment.url;
    assert.equal((await fetch(`${base}${attachment}?access=${owner.assetKey}`)).status, 404);
    assert.equal((await fetch(`${base}${attachment}?access=${alice.assetKey}`)).status, 200);
    for (const event of ['text-history', 'text-pins', 'get-channel-settings', 'delete-text-channel']) {
      assert.equal((await emit(owner, event, { type: 'text', channelId: id, notation: '1d20' })).success, false, event);
    }
    assert.equal((await emit(owner, 'member-roles', { memberId: owner.memberId, roles: [role.id] })).success, false);
    assert.equal((await emit(owner, 'channel-settings', { type: 'text', channelId: id, name: 'Invadido', description: '', access: { private: false, roles: [], members: [] }, writeAccess: { private: false, roles: [], members: [] } })).success, false);
    assert.ok(!JSON.stringify(owner.events).includes('Segredo do mestre'));
    assert.ok(JSON.stringify(owner.events).includes(rolled.roll.id));
    assert.equal((await emit(owner, 'dice-history')).rolls[0].id, rolled.roll.id);
    const voice = (await emit(alice, 'create-channel', { name: 'Call RPG', access })).channelId;
    assert.equal((await emit(owner, 'join-channel', { channelId: voice })).code, 'channel-unavailable');
    assert.equal((await emit(owner, 'sfu-token', { ownerId: alice.socket.id, role: 'viewer' })).ok, false);
    assert.equal((await emit(alice, 'join-channel', { channelId: voice })).success, true);
    assert.equal((await emit(alice, 'dice-history')).rolls.length, 1);
    assert.equal((await emit(alice, 'dice-roll', { type: 'voice', channelId: voice, notation: '1d20' })).success, false, 'limite vale entre canais');
    await wait(510);
    assert.equal((await emit(alice, 'dice-roll', { type: 'voice', channelId: voice, notation: '2d6+2' })).success, true);
    assert.equal((await emit(owner, 'dice-history')).rolls.length, 2);
    // A pessoa autorizada concede acesso ao dono explicitamente, e pode revogar depois.
    const publicWrite = { private: false, roles: [], members: [] };
    assert.equal((await emit(alice, 'channel-settings', { type: 'text', channelId: id, name: 'RPG privado', description: '', access: { ...access, members: [owner.memberId] }, writeAccess: publicWrite })).success, true);
    assert.equal((await emit(owner, 'text-history', { channelId: id })).success, true);
    assert.equal((await emit(owner, 'dice-history')).rolls.length, 2);
    assert.equal((await emit(alice, 'channel-settings', { type: 'text', channelId: id, name: 'RPG privado', description: '', access, writeAccess: publicWrite })).success, true);
    assert.equal((await emit(owner, 'text-history', { channelId: id })).success, false);
    assert.equal((await fetch(`${base}${attachment}?access=${owner.assetKey}`)).status, 404);
    assert.equal((await emit(alice, 'delete-text-channel', { channelId: id })).success, true);
    assert.equal((await emit(owner, 'dice-history')).rolls.length, 2);
    clients.forEach(socket => socket.disconnect());
    const ended = once(backend, 'exit'); backend.kill(); await ended;
    backend = launch();
    let restored = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + '/api/health')).ok) { restored = true; break; } } catch {}
      await wait(40);
    }
    assert.ok(restored, 'Servidor precisa reiniciar com o histórico geral.');
    const reader = await connect('Leitor');
    const saved = await emit(reader, 'dice-history');
    assert.equal(saved.scope, 'server');
    assert.equal(saved.rolls.length, 2);
    assert.equal(saved.rolls[0].id, rolled.roll.id);
  } finally {
    clients.forEach(socket => socket.disconnect());
    if (backend.exitCode === null) { const exit = once(backend, 'exit'); backend.kill(); await exit; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
