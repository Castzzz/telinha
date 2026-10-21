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

    // 7b. Perfil 3.0: gradiente, moldura, banner (GIF até 2 MB) e som de entrada
    const fancySeen = once(alice2, 'user-profile-updated');
    const bannerGif = Buffer.alloc(1500 * 1024, 1);
    bannerGif.write('GIF89a');
    const sound = Buffer.alloc(20 * 1024, 2);
    bob.emit('update-profile', {
      nameColor2: '#00A8FC', frame: 'arco-iris', frameColor: '#123456', bannerColor: '#7C3AED',
      banner: `data:image/gif;base64,${bannerGif.toString('base64')}`,
      joinSound: `data:audio/ogg;base64,${sound.toString('base64')}`
    });
    const fancy = (await fancySeen).user;
    assert.equal(fancy.nameColor2, '#00A8FC');
    assert.equal(fancy.frame, 'arco-iris');
    assert.equal(fancy.bannerColor, '#7C3AED');
    assert.ok(fancy.bannerV && fancy.joinSoundV);
    const bannerRes = await fetch(`${URL_BASE}/api/banner/${bob.id}`);
    assert.equal(bannerRes.headers.get('content-type'), 'image/gif');
    const soundRes = await fetch(`${URL_BASE}/api/join-sound/${bob.id}`);
    assert.equal(soundRes.headers.get('content-type'), 'audio/ogg');
    assert.equal(soundRes.headers.get('access-control-allow-origin'), '*', 'o app (telinha://app) precisa conseguir baixar o som');
    // Lixo é ignorado: moldura inventada, áudio que não é áudio, som grande demais
    bob.emit('update-profile', {
      frame: 'hack', joinSound: `data:text/html;base64,${Buffer.from('<script>').toString('base64')}`, bio: 'mudou de novo'
    });
    const junk = (await once(alice2, 'user-profile-updated')).user;
    assert.equal(junk.frame, 'arco-iris');
    assert.equal(junk.joinSoundV, fancy.joinSoundV);
    bob.emit('update-profile', { joinSound: `data:audio/ogg;base64,${Buffer.alloc(400 * 1024).toString('base64')}`, bio: 'som grande' });
    assert.equal((await once(alice2, 'user-profile-updated')).user.joinSoundV, fancy.joinSoundV, 'som acima de 300 KB é recusado');
    console.log('  ✓ Nome em gradiente, moldura, banner GIF e som de entrada; lixo e arquivo grande recusados');

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

    // 10. Canal de texto: histórico salvo em disco, volta depois de reiniciar, paginação e apagar
    const textList = new Promise((resolve) => alice2.on('text-channels', (list) => { if (list.some((c) => c.id === 'memes')) resolve(list); }));
    const createdText = await emit(bob, 'create-text-channel', { name: 'Memes', profileId: 'bob-profile-00002' });
    assert.equal(createdText.channelId, 'memes');
    await textList;
    const got = new Promise((resolve) => alice2.on('text-message', (m) => { if (m.text === 'msg 0') resolve(m); }));
    for (let i = 0; i < 60; i++) {
      const r = await emit(bob, 'text-message', { channelId: 'memes', text: `msg ${i}` });
      if (!r.success) { await new Promise((ok) => setTimeout(ok, 3100)); i--; }
    }
    assert.equal((await got).channelId, 'memes', 'quem não está em call nenhuma também recebe');
    await new Promise((r) => setTimeout(r, 3100));
    assert.equal((await emit(bob, 'text-image', { channelId: 'memes', data: png, mime: 'image/png', width: 1, height: 1 })).success, true);
    assert.equal((await emit(alice2, 'text-message', { channelId: 'nao-existe', text: 'oi' })).success, false);

    // Reinicia: canal e mensagens continuam
    clients.forEach((c) => c.disconnect());
    clients.length = 0;
    await stopServer(proc);
    proc = await startServer();
    const reader = await connect();
    clients.push(reader);
    const page1 = await emit(reader, 'text-history', { channelId: 'memes' });
    assert.equal(page1.messages.length, 50);
    assert.equal(page1.hasMore, true);
    assert.ok(page1.messages.at(-1).image, 'a última é a imagem');
    const imgAfter = await fetch(`${URL_BASE}${page1.messages.at(-1).image.url}`);
    assert.equal(imgAfter.status, 200, 'imagem do canal de texto sobrevive ao reinício');
    const page2 = await emit(reader, 'text-history', { channelId: 'memes', before: page1.messages[0].id });
    assert.equal(page2.messages.length, 11);
    assert.equal(page2.messages[0].text, 'msg 0');
    assert.equal(page2.hasMore, false);

    // Só quem criou (ou admin) apaga; apagar some com o arquivo
    await join(reader, 'geral', 'carol-profile-0003');
    assert.equal((await emit(reader, 'delete-text-channel', { channelId: 'memes' })).success, false);
    assert.equal((await emit(reader, 'admin-login', { key: ADMIN_KEY })).success, true);
    assert.equal((await emit(reader, 'delete-text-channel', { channelId: 'memes' })).success, true);
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(!fs.existsSync(path.join(DATA_DIR, 'text', 'memes.jsonl')), 'histórico apagado junto');
    assert.equal(fs.readdirSync(path.join(DATA_DIR, 'text', 'images')).length, 0, 'imagens apagadas junto');
    console.log('  ✓ Canal de texto: histórico e imagens salvos, voltam depois de reiniciar, paginação e apagar');

    // 11. Admin: mutar pra todos (não dá pra se desmutar, nem reconectando), ensurdecer e mover de call
    const dave = await connect();
    clients.push(dave);
    await join(dave, 'geral', 'dave-profile-0004');
    dave.emit('user-state-changed', { isMicOn: true });
    const modSeen = once(dave, 'server-moderation');
    assert.equal((await emit(dave, 'admin-mute-user', { userId: reader.id, on: true })).success, false, 'quem não é admin não muta');
    assert.equal((await emit(reader, 'admin-mute-user', { userId: dave.id, on: true })).success, true);
    assert.equal((await modSeen).serverMuted, true);
    dave.emit('user-state-changed', { isMicOn: true });
    await new Promise((r) => setTimeout(r, 100));
    let daveNow = (await channelsList()).find((c) => c.id === 'geral').users.find((u) => u.id === dave.id);
    assert.equal(daveNow.isMicOn, false, 'mutado pelo admin não abre o mic');
    assert.equal(daveNow.serverMuted, true);
    // Reconecta com o mesmo perfil: continua mutado
    dave.disconnect();
    const dave2 = await connect();
    clients.push(dave2);
    const daveState = await new Promise((resolve) => {
      dave2.once('channel-state', resolve);
      dave2.emit('join-channel', { channelId: 'geral', userName: 'dave', isMicOn: true, profile: { profileId: 'dave-profile-0004', name: 'dave' } });
    });
    assert.equal(daveState.me.serverMuted, true);
    assert.equal(daveState.me.isMicOn, false);
    // Ensurdecer e desfazer
    assert.equal((await emit(reader, 'admin-deafen-user', { userId: dave2.id, on: true })).success, true);
    daveNow = (await channelsList()).find((c) => c.id === 'geral').users.find((u) => u.id === dave2.id);
    assert.equal(daveNow.isDeafened, true);
    dave2.emit('user-state-changed', { isDeafened: false });
    await new Promise((r) => setTimeout(r, 100));
    daveNow = (await channelsList()).find((c) => c.id === 'geral').users.find((u) => u.id === dave2.id);
    assert.equal(daveNow.isDeafened, true, 'ensurdecido pelo admin não se desensurdece');
    assert.equal((await emit(reader, 'admin-deafen-user', { userId: dave2.id, on: false })).success, true);
    assert.equal((await emit(reader, 'admin-mute-user', { userId: dave2.id, on: false })).success, true);
    dave2.emit('user-state-changed', { isMicOn: true });
    await new Promise((r) => setTimeout(r, 100));
    daveNow = (await channelsList()).find((c) => c.id === 'geral').users.find((u) => u.id === dave2.id);
    assert.equal(daveNow.isMicOn, true, 'liberado, volta a abrir o mic');
    assert.equal(daveNow.isDeafened, false);
    // Mover de call
    await emit(reader, 'create-channel', { name: 'Sala Dois' });
    const moved = once(dave2, 'moved-by-admin');
    assert.equal((await emit(dave2, 'admin-move-user', { userId: reader.id, channelId: 'sala-dois' })).success, false);
    assert.equal((await emit(reader, 'admin-move-user', { userId: dave2.id, channelId: 'sala-dois' })).success, true);
    assert.equal((await moved).channelId, 'sala-dois');
    console.log('  ✓ Admin: mutar/ensurdecer pra todos (vale reconectando) e mover de call; quem não é admin não consegue');

    // 12. Chat: responder, editar, apagar e reagir (canal de texto salvo e chat da call)
    const eve = await connect();
    const fred = await connect();
    clients.push(eve, fred);
    await join(eve, 'geral', 'eve-profile-00005');
    await join(fred, 'geral', 'fred-profile-0006');
    await emit(eve, 'create-text-channel', { name: 'Papo', profileId: 'eve-profile-00005' });
    const firstMsg = new Promise((resolve) => fred.on('text-message', (m) => { if (m.text === 'primeira') resolve(m); }));
    await emit(eve, 'text-message', { channelId: 'papo', text: 'primeira' });
    const first = await firstMsg;
    const replyMsg = new Promise((resolve) => eve.on('text-message', (m) => { if (m.text === 'respondendo') resolve(m); }));
    await emit(fred, 'text-message', { channelId: 'papo', text: 'respondendo', replyTo: first.id });
    const reply = await replyMsg;
    assert.deepEqual(reply.replyTo, { id: first.id, userName: 'eve-profile-00005', text: 'primeira', image: false });
    // Editar: só a própria
    assert.equal((await emit(fred, 'message-edit', { scope: 'text', channelId: 'papo', messageId: first.id, text: 'hack' })).success, false);
    const edited = new Promise((resolve) => fred.once('text-message-updated', resolve));
    assert.equal((await emit(eve, 'message-edit', { scope: 'text', channelId: 'papo', messageId: first.id, text: 'primeira (editada)' })).success, true);
    const editedEvt = await edited;
    assert.equal(editedEvt.message.text, 'primeira (editada)');
    assert.ok(editedEvt.message.editedAt);
    // Reagir: liga e desliga, pelo perfil
    assert.equal((await emit(fred, 'message-react', { scope: 'text', channelId: 'papo', messageId: first.id, emoji: '😂' })).success, true);
    assert.equal((await emit(eve, 'message-react', { scope: 'text', channelId: 'papo', messageId: first.id, emoji: '😂' })).success, true);
    assert.equal((await emit(eve, 'message-react', { scope: 'text', channelId: 'papo', messageId: first.id, emoji: '🔥' })).success, true);
    assert.equal((await emit(eve, 'message-react', { scope: 'text', channelId: 'papo', messageId: first.id, emoji: '🔥' })).success, true);
    assert.equal((await emit(eve, 'message-react', { scope: 'text', channelId: 'papo', messageId: first.id, emoji: '<b>' })).success, false);
    // Apagar: só a própria (ou admin)
    assert.equal((await emit(eve, 'message-delete', { scope: 'text', channelId: 'papo', messageId: reply.id })).success, false);
    const textDeleted = new Promise((resolve) => eve.once('text-message-deleted', resolve));
    assert.equal((await emit(fred, 'message-delete', { scope: 'text', channelId: 'papo', messageId: reply.id })).success, true);
    assert.equal((await textDeleted).messageId, reply.id);
    // Chat da call também
    const callMsgP = new Promise((resolve) => fred.on('chat-message', (m) => { if (m.text === 'na call') resolve(m); }));
    eve.emit('chat-message', { text: 'na call' });
    const callMsg = await callMsgP;
    assert.equal(callMsg.profileId, 'eve-profile-00005');
    const callReplyP = new Promise((resolve) => eve.on('chat-message', (m) => { if (m.text === 'resposta na call') resolve(m); }));
    fred.emit('chat-message', { text: 'resposta na call', replyTo: callMsg.id });
    assert.equal((await callReplyP).replyTo.text, 'na call');
    const callEdited = new Promise((resolve) => fred.once('chat-message-updated', resolve));
    assert.equal((await emit(eve, 'message-edit', { messageId: callMsg.id, text: 'na call!' })).success, true);
    assert.equal((await callEdited).message.text, 'na call!');
    const callDeleted = new Promise((resolve) => fred.once('chat-message-deleted', resolve));
    assert.equal((await emit(eve, 'message-delete', { messageId: callMsg.id })).success, true);
    assert.equal((await callDeleted).messageId, callMsg.id);

    // 13. Soundboard: cada um sobe os seus sons (máximo 8, até 400 KB), todo mundo da call ouve
    const soundData = `data:audio/ogg;base64,${Buffer.alloc(10 * 1024, 3).toString('base64')}`;
    const listed = new Promise((resolve) => fred.on('soundboard-list', (list) => { if (list.some((x) => x.name === 'risada')) resolve(list); }));
    const added = await emit(eve, 'soundboard-add', { name: 'risada', emoji: '😂', data: soundData });
    assert.equal(added.success, true);
    assert.equal((await listed).find((x) => x.name === 'risada').profileId, 'eve-profile-00005');
    assert.equal((await emit(eve, 'soundboard-add', { name: 'grande', data: `data:audio/ogg;base64,${Buffer.alloc(500 * 1024).toString('base64')}` })).success, false);
    assert.equal((await emit(eve, 'soundboard-add', { name: 'falso', data: 'data:text/html;base64,PHNjcmlwdD4=' })).success, false);
    const soundRes2 = await fetch(`${URL_BASE}/api/soundboard/${added.id}`);
    assert.equal(soundRes2.headers.get('content-type'), 'audio/ogg');
    assert.equal(soundRes2.headers.get('access-control-allow-origin'), '*');
    const played = new Promise((resolve) => fred.once('soundboard-played', resolve));
    assert.equal((await emit(eve, 'soundboard-play', { id: added.id })).success, true);
    assert.equal((await played).userName, 'eve-profile-00005');
    assert.equal((await emit(eve, 'soundboard-play', { id: 'amigo-3' })).success, false, 'um som de cada vez');
    assert.equal((await emit(fred, 'soundboard-play', { id: 'amigo-3' })).success, true, 'áudios do app também tocam');
    assert.equal((await emit(fred, 'soundboard-delete', { id: added.id })).success, false, 'só quem colocou apaga');

    // Reinicia: edição, reação, apagada e soundboard continuam
    clients.forEach((c) => c.disconnect());
    clients.length = 0;
    await stopServer(proc);
    proc = await startServer();
    const reader2 = await connect();
    clients.push(reader2);
    const papo = await emit(reader2, 'text-history', { channelId: 'papo' });
    assert.equal(papo.messages.length, 1, 'a apagada não volta');
    assert.equal(papo.messages[0].text, 'primeira (editada)');
    assert.deepEqual(Object.keys(papo.messages[0].reactions), ['😂']);
    assert.equal(papo.messages[0].reactions['😂'].length, 2);
    const sbAfter = await new Promise((resolve) => {
      const c = ioClient(URL_BASE, { transports: ['websocket'], reconnection: false });
      clients.push(c);
      c.once('soundboard-list', resolve);
    });
    assert.ok(sbAfter.some((x) => x.id === added.id), 'som continua depois de reiniciar');
    console.log('  ✓ Chat: responder, editar, apagar e reagir (salvo no canal de texto); soundboard com sons de cada um');

    // 14. Fixar mensagem (salvo) e "digitando…"
    const pinner = await connect();
    const watcher = await connect();
    clients.push(pinner, watcher);
    await join(pinner, 'geral', 'gabi-profile-0007');
    await join(watcher, 'geral', 'hugo-profile-0008');
    const pinTarget = papo.messages[0].id;
    const pinSeen = new Promise((resolve) => watcher.once('text-message-updated', resolve));
    assert.equal((await emit(pinner, 'message-pin', { channelId: 'papo', messageId: pinTarget, pinned: true })).success, true);
    assert.equal((await pinSeen).message.pinned.by, 'gabi-profile-0007');
    const pins = await emit(watcher, 'text-pins', { channelId: 'papo' });
    assert.deepEqual(pins.messages.map((m) => m.id), [pinTarget]);
    const typingText = new Promise((resolve) => watcher.once('typing', resolve));
    pinner.emit('typing', { scope: 'text', channelId: 'papo' });
    assert.deepEqual(await typingText, { userId: pinner.id, name: 'gabi-profile-0007', scope: 'text', channelId: 'papo' });

    // 15. Senha da sala: só admin define; sem ela não conecta (a senha de admin também entra)
    const tryConnect = (auth) => new Promise((resolve) => {
      const c = ioClient(URL_BASE, { transports: ['websocket'], reconnection: false, auth });
      clients.push(c);
      c.once('connect', () => resolve({ ok: true }));
      c.once('connect_error', (err) => resolve({ ok: false, message: err.message, data: err.data }));
    });
    // Quem já entrou uma vez ganha a chave de membro (o app guarda e não precisa da senha)
    const memberKeyMsg = await new Promise((resolve) => {
      const c = ioClient(URL_BASE, { transports: ['websocket'], reconnection: false, auth: { profileId: 'ivan-profile-0009' } });
      clients.push(c);
      c.once('member-key', resolve);
    });
    assert.equal(memberKeyMsg.profileId, 'ivan-profile-0009');
    assert.equal(memberKeyMsg.key.length, 64);
    clients.at(-1).disconnect();
    assert.equal((await emit(pinner, 'admin-set-room-password', { password: 'pipoca' })).success, false, 'só admin');
    assert.equal((await emit(pinner, 'admin-login', { key: ADMIN_KEY })).success, true);
    const told = new Promise((resolve) => watcher.once('room-password-changed', resolve));
    assert.equal((await emit(pinner, 'admin-set-room-password', { password: 'pipoca' })).success, true);
    assert.equal((await told).password, 'pipoca', 'quem já está dentro recebe a senha nova');
    const noPass = await tryConnect({});
    assert.equal(noPass.ok, false);
    assert.equal(noPass.message, 'room-password');
    assert.equal(noPass.data.reason, 'required');
    assert.equal((await tryConnect({ roomPassword: 'errada' })).data.reason, 'wrong');
    assert.equal((await tryConnect({ roomPassword: 'pipoca' })).ok, true);
    assert.equal((await tryConnect({ adminKey: ADMIN_KEY })).ok, true);
    assert.equal((await tryConnect({ profileId: 'ivan-profile-0009', memberKey: memberKeyMsg.key })).ok, true, 'quem já tinha entrado não precisa da senha');
    assert.equal((await tryConnect({ profileId: 'outro-profile-01', memberKey: memberKeyMsg.key })).ok, false, 'a chave é de um perfil só');
    assert.equal((await fetch(`${URL_BASE}/api/channels`)).status, 401);
    assert.ok(!fs.readFileSync(path.join(DATA_DIR, 'room.json'), 'utf8').includes('pipoca'), 'guarda só o hash');
    // Continua depois de reiniciar
    clients.forEach((c) => c.disconnect());
    clients.length = 0;
    await stopServer(proc);
    proc = await startServer();
    assert.equal((await tryConnect({})).ok, false);
    assert.equal((await tryConnect({ profileId: 'ivan-profile-0009', memberKey: memberKeyMsg.key })).ok, true, 'chave vale reiniciando');
    const roomAdmin = await tryConnect({ roomPassword: 'pipoca' });
    assert.equal(roomAdmin.ok, true);
    const adminSock = clients.at(-1);
    assert.equal((await emit(adminSock, 'admin-login', { key: ADMIN_KEY })).success, true);
    assert.equal((await emit(adminSock, 'admin-reset-members', {})).success, true);
    assert.equal((await tryConnect({ profileId: 'ivan-profile-0009', memberKey: memberKeyMsg.key })).ok, false, 'admin esqueceu as chaves: precisa da senha');
    assert.equal((await emit(adminSock, 'admin-set-room-password', { password: '' })).success, true);
    assert.equal((await tryConnect({})).ok, true, 'sem senha, sala aberta de novo');
    console.log('  ✓ Fixar mensagem e "digitando…"; senha da sala (hash, chave de membro pra quem já entrou, vale reiniciando)');

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
