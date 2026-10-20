/**
 * tests/m4-channels-admin.test.js - Canais salvos, apagar canal e admin
 * Valida: canal criado fica salvo no arquivo e volta depois de reiniciar o servidor,
 * só quem criou (ou admin) apaga, o Geral nunca, senha de admin, e admin tirando alguém da call.
 */

import { io as ioClient } from 'socket.io-client';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_PORT = 19094;
const URL_BASE = `http://127.0.0.1:${TEST_PORT}`;
const ADMIN_KEY = 'senha-teste-123';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-test-'));

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function emit(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

async function connect() {
  const client = ioClient(URL_BASE, { transports: ['websocket'], reconnection: false });
  await once(client, 'connect');
  return client;
}

async function join(client, channelId, profileId) {
  const state = once(client, 'channel-state');
  client.emit('join-channel', { channelId, userName: profileId, profile: { profileId, name: profileId } });
  return state;
}

async function startServer() {
  const proc = spawn('node', ['server.js'], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: String(TEST_PORT), ADMIN_KEY, TELINHA_DATA_DIR: DATA_DIR, SFU_SECRET: 'sfu-teste' },
    stdio: 'ignore'
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${URL_BASE}/api/health`)).ok) return proc;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('servidor não subiu');
}

async function stopServer(proc) {
  const exited = once(proc, 'exit');
  proc.kill('SIGTERM');
  await exited;
}

async function channelsList() {
  return (await fetch(`${URL_BASE}/api/channels`)).json();
}

async function runTests() {
  console.log('\n--- Canais salvos, apagar canal e admin ---');
  let proc = await startServer();
  const clients = [];
  try {
    // 1. Só o Geral é fixo; canal criado vai pro arquivo
    assert.deepEqual((await channelsList()).map((c) => c.id), ['geral']);
    const alice = await connect();
    clients.push(alice);
    const created = await emit(alice, 'create-channel', { name: 'Resenha', profileId: 'alice-profile-0001' });
    assert.equal(created.channelId, 'resenha');
    const saved = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'channels.json'), 'utf8'));
    assert.deepEqual(saved.channels.map((c) => [c.id, c.name, c.createdBy]), [['resenha', 'Resenha', 'alice-profile-0001']]);
    console.log('  ✓ Canal criado é salvo com quem criou');

    // 2. Reiniciou o servidor: o canal volta, vazio
    alice.disconnect();
    await stopServer(proc);
    proc = await startServer();
    const afterRestart = await channelsList();
    const resenha = afterRestart.find((c) => c.id === 'resenha');
    assert.ok(resenha, 'canal salvo volta depois de reiniciar');
    assert.equal(resenha.userCount, 0);
    assert.equal(resenha.createdBy, 'alice-profile-0001');
    console.log('  ✓ Canal salvo sobrevive a reinício');

    // 3. Outra pessoa não apaga; quem criou apaga e quem estava dentro sai da call
    const alice2 = await connect();
    const bob = await connect();
    clients.push(alice2, bob);
    await join(alice2, 'geral', 'alice-profile-0001');
    await join(bob, 'resenha', 'bob-profile-00002');
    const denied = await emit(bob, 'delete-channel', { channelId: 'resenha' });
    assert.equal(denied.success, false);
    assert.equal((await emit(bob, 'delete-channel', { channelId: 'geral' })).success, false, 'Geral nunca é apagado');

    const bobNotified = once(bob, 'channel-deleted');
    const deleted = await emit(alice2, 'delete-channel', { channelId: 'resenha' });
    assert.equal(deleted.success, true);
    assert.equal((await bobNotified).channelId, 'resenha');
    assert.ok(!(await channelsList()).some((c) => c.id === 'resenha'));
    const savedAfter = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'channels.json'), 'utf8'));
    assert.equal(savedAfter.channels.length, 0, 'apagado sai do arquivo também');
    console.log('  ✓ Só quem criou apaga; quem estava dentro é avisado; Geral não apaga');

    // 4. Admin: senha errada não vale; certa vale e aparece pros outros
    const wrong = await emit(bob, 'admin-login', { key: 'chute' });
    assert.equal(wrong.success, false);
    const carol = await connect();
    clients.push(carol);
    await join(carol, 'geral', 'carol-profile-0003');
    await join(bob, 'geral', 'bob-profile-00002');
    const crownSeen = once(carol, 'user-profile-updated');
    assert.equal((await emit(bob, 'admin-login', { key: ADMIN_KEY })).success, true);
    const update = await crownSeen;
    assert.equal(update.userId, bob.id);
    assert.equal(update.user.isAdmin, true);
    console.log('  ✓ Senha de admin confere e a coroa aparece pros outros');

    // 5. Admin apaga canal dos outros
    const other = await emit(carol, 'create-channel', { name: 'Da Carol', profileId: 'carol-profile-0003' });
    assert.equal((await emit(bob, 'delete-channel', { channelId: other.channelId })).success, true);
    console.log('  ✓ Admin apaga canal de qualquer um');

    // 6. Só admin tira da call; quem foi tirado fica fora do canal
    assert.equal((await emit(carol, 'kick-user', { userId: bob.id })).success, false);
    const kicked = once(carol, 'kicked');
    assert.equal((await emit(bob, 'kick-user', { userId: carol.id })).success, true);
    assert.ok((await kicked).by);
    const geral = (await channelsList()).find((c) => c.id === 'geral');
    assert.ok(!geral.users.some((u) => u.id === carol.id), 'quem foi tirado não está mais no canal');
    assert.equal((await emit(bob, 'kick-user', { userId: bob.id })).success, false, 'não tira a si mesmo');
    console.log('  ✓ Admin tira alguém da call; quem não é admin não consegue');

    // 7. Cor do nome e foto GIF (até 1 MB, maior que o limite de 200 KB da foto parada)
    const colorSeen = once(alice2, 'user-profile-updated');
    bob.emit('update-profile', { nameColor: '#FF5C5C' });
    assert.equal((await colorSeen).user.nameColor, '#FF5C5C');
    const gif = Buffer.alloc(500 * 1024, 1);
    gif.write('GIF89a');
    const gifSeen = once(alice2, 'user-profile-updated');
    bob.emit('update-profile', { avatar: `data:image/gif;base64,${gif.toString('base64')}` });
    const gifUpdate = await gifSeen;
    const avatarRes = await fetch(`${URL_BASE}/api/avatar/${bob.id}?v=${gifUpdate.user.avatarV}`);
    assert.equal(avatarRes.headers.get('content-type'), 'image/gif');
    assert.equal(Buffer.from(await avatarRes.arrayBuffer()).length, gif.length);
    const tooBig = Buffer.alloc(1100 * 1024, 1);
    bob.emit('update-profile', { avatar: `data:image/gif;base64,${tooBig.toString('base64')}`, bio: 'mudou' });
    await once(alice2, 'user-profile-updated');
    const stillOld = await fetch(`${URL_BASE}/api/avatar/${bob.id}`);
    assert.equal(Buffer.from(await stillOld.arrayBuffer()).length, gif.length, 'GIF acima de 1 MB é recusado');
    console.log('  ✓ Cor do nome chega pros outros; GIF até 1 MB aceito, acima recusado');

    // 8. Várias telas: extras 2 e 3 chegam pros outros (lixo é ignorado) e cada uma tem sala no SFU
    const screensSeen = new Promise((resolve) => {
      alice2.on('user-state-changed', (st) => { if (st.userId === bob.id && st.extraScreens?.length) resolve(st); });
    });
    bob.emit('user-state-changed', { isSharing: true, extraScreens: [3, 2, 2, 7, 'x', 1] });
    assert.deepEqual((await screensSeen).extraScreens, [2, 3]);
    const geralNow = (await channelsList()).find((c) => c.id === 'geral');
    assert.deepEqual(geralNow.users.find((u) => u.id === bob.id).extraScreens, [2, 3]);
    const hostToken = await emit(bob, 'sfu-token', { ownerId: bob.id, role: 'host', kind: 'screen2' });
    assert.equal(hostToken.sala, `geral__${bob.id}__s2`);
    const viewerToken = await emit(alice2, 'sfu-token', { ownerId: bob.id, role: 'viewer', kind: 'screen3' });
    assert.equal(viewerToken.sala, `geral__${bob.id}__s3`);
    const firstScreen = await emit(alice2, 'sfu-token', { ownerId: bob.id, role: 'viewer', kind: 'screen' });
    assert.equal(firstScreen.sala, `geral__${bob.id}`, 'tela 1 continua com a sala de sempre');
    console.log('  ✓ Várias telas: estado chega pros outros e cada tela tem a sua sala no SFU');

    // 9. Imagem no chat: vai pro disco, chega pra todos com o link e só aceita imagem de verdade
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const imageMsg = new Promise((resolve) => alice2.on('chat-message', (m) => { if (m.image) resolve(m); }));
    const sent = await emit(bob, 'chat-image', { data: png, mime: 'image/png', width: 1, height: 1, text: 'olha https://example.com' });
    assert.equal(sent.success, true);
    const msg = await imageMsg;
    assert.equal(msg.text, 'olha https://example.com');
    assert.match(msg.image.url, /^\/api\/chat-image\/[a-f0-9-]+\.png$/);
    const imgRes = await fetch(`${URL_BASE}${msg.image.url}`);
    assert.equal(imgRes.status, 200);
    assert.equal(imgRes.headers.get('content-type'), 'image/png');
    assert.ok(Buffer.from(await imgRes.arrayBuffer()).equals(png));
    assert.ok(fs.readdirSync(path.join(DATA_DIR, 'chat-images')).length === 1, 'imagem fica no disco, não na memória');
    await new Promise((r) => setTimeout(r, 2100)); // uma imagem a cada 2 s
    const fake = await emit(bob, 'chat-image', { data: Buffer.from('<script>alert(1)</script>'), mime: 'image/png' });
    assert.equal(fake.success, false, 'texto disfarçado de PNG é recusado');
    const huge = await emit(bob, 'chat-image', { data: Buffer.concat([png, Buffer.alloc(9 * 1024 * 1024)]), mime: 'image/png' });
    assert.equal(huge.success, false, 'acima de 8 MB é recusado');
    assert.equal((await fetch(`${URL_BASE}/api/chat-image/..%2Fchannels.json`)).status, 404);
    console.log('  ✓ Imagem no chat: salva em disco, chega pra todos; arquivo falso, gigante e caminho estranho recusados');

    console.log('\n✅ TODOS OS TESTES DE CANAIS E ADMIN PASSARAM\n');
  } finally {
    clients.forEach((c) => c.disconnect());
    await stopServer(proc);
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error('❌ Falhou:', err);
  process.exit(1);
});
