import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { io } from 'socket.io-client';

test('segurança: identidade, privadas, arquivos e moderação com servidor local', { timeout: 30000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-seguranca-'));
  const clients = [], revocations = [];
  const revoker = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer sfu-seguranca-ficticio');
    let body = ''; for await (const chunk of req) body += chunk;
    revocations.push(JSON.parse(body).id);
    res.writeHead(204).end();
  });
  await new Promise(resolve => revoker.listen(0, '127.0.0.1', resolve));
  Object.assign(process.env, { TELINHA_DATA_DIR: directory, OWNER_KEY: 'dono-seguranca-ficticio', ADMIN_KEY: '',
    SFU_SECRET: 'sfu-seguranca-ficticio', TELINHA_MUSIC: '0', SFU_INTERNAL_URL: `http://127.0.0.1:${revoker.address().port}` });
  const backend = await import('../server.js');
  const server = await backend.startServer(0, '127.0.0.1');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    clients.forEach(c => c.socket.disconnect());
    await new Promise(resolve => backend.io.close(resolve));
    await new Promise(resolve => revoker.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const emit = (c, event, payload = {}) => c.socket.timeout(3000).emitWithAck(event, payload);
  const waitFor = async predicate => {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 10)); }
    assert.ok(predicate(), 'O estado esperado deve chegar.');
  };
  async function connect(name, profileId, auth = {}) {
    const socket = io(base, { autoConnect: false, reconnection: false, transports: ['websocket'], auth });
    const c = { socket, events: [] }; clients.push(c);
    socket.onAny((event, data) => {
      c.events.push([event, data]);
      if (event === 'permission-identity') c.token = data.token;
      if (event === 'permissions-state') c.permissions = data;
      if (event === 'room-info' && data.assetKey) c.assetKey = data.assetKey;
    });
    const connected = new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    socket.connect(); await connected;
    assert.equal((await emit(c, 'update-profile', { name, profileId })).success, true);
    await waitFor(() => c.token && c.assetKey && c.permissions);
    return c;
  }
  const owner = await connect('Dono', 'perfil-dono-seguranca');
  const alice = await connect('Alice', 'perfil-alice-seguranca');
  const bob = await connect('Bob', 'perfil-bob-seguranca');
  assert.equal((await emit(owner, 'owner-claim', { key: 'dono-seguranca-ficticio' })).success, true);
  const { channelId } = await emit(owner, 'create-text-channel', { name: 'Seguranca' });

  await t.test('copiar ID público não autoriza editar/apagar; identidade comprovada funciona em outro aparelho', async () => {
    await emit(alice, 'text-message', { channelId, text: 'Autoria protegida', authorMemberId: bob.permissions.memberId });
    const history = await emit(bob, 'text-history', { channelId });
    const msg = history.messages.at(-1);
    assert.equal(msg.authorMemberId, alice.permissions.memberId);
    await emit(bob, 'update-profile', { profileId: msg.profileId });
    for (const event of ['message-edit', 'message-delete']) {
      assert.equal((await emit(bob, event, { scope: 'text', channelId, messageId: msg.id, text: 'Forjada' })).success, false);
    }
    const restored = await connect('Alice', msg.profileId, { permissionToken: alice.token });
    assert.equal((await emit(restored, 'message-edit', { scope: 'text', channelId, messageId: msg.id, text: 'Edição legítima' })).success, true);
    assert.equal((await emit(restored, 'message-delete', { scope: 'text', channelId, messageId: msg.id })).success, true);
    // Conteúdo legado sem identidade autenticada não pode ser reivindicado por ID público.
    await emit(alice, 'join-channel', { channelId: 'geral' });
    const legacy = { id: 'legado-sem-prova', profileId: msg.profileId, userId: 'socket-antigo', text: 'Legado' };
    backend.channels.get('geral').messages.push(legacy);
    assert.equal((await emit(alice, 'message-edit', { messageId: legacy.id, text: 'Reivindicada' })).success, false);
    assert.equal((await emit(alice, 'message-delete', { messageId: legacy.id })).success, false);
  });

  await t.test('sussurros protegem histórico e eventos mesmo com cópia dos IDs de autor/destinatário', async () => {
    await emit(bob, 'update-profile', { profileId: 'perfil-alice-seguranca' });
    const received = once(owner.socket, 'text-message');
    assert.equal((await emit(alice, 'text-message', { channelId, text: '/w @Dono segredo-protegido' })).success, true);
    const [msg] = await received;
    const leaked = () => bob.events.some(([, data]) => JSON.stringify(data).includes('segredo-protegido'));
    assert.equal(leaked(), false);
    for (const profileId of ['perfil-alice-seguranca', 'perfil-dono-seguranca']) {
      await emit(bob, 'update-profile', { profileId });
      assert.equal((await emit(bob, 'text-history', { channelId })).messages.some(m => m.id === msg.id), false);
      assert.equal((await emit(bob, 'message-edit', { scope: 'text', channelId, messageId: msg.id, text: 'Forjada' })).success, false);
      assert.equal((await emit(bob, 'message-react', { scope: 'text', channelId, messageId: msg.id, emoji: '👍' })).success, false);
    }
    assert.equal((await emit(alice, 'message-edit', { scope: 'text', channelId, messageId: msg.id, text: 'segredo-protegido editado' })).success, true);
    assert.equal((await emit(owner, 'text-history', { channelId })).messages.some(m => m.id === msg.id), true);
    assert.equal(leaked(), false);
    assert.ok(!fs.existsSync(path.join(directory, 'text', `${channelId}.jsonl`))
      || !fs.readFileSync(path.join(directory, 'text', `${channelId}.jsonl`), 'utf8').includes('segredo-protegido'));
    await emit(bob, 'update-profile', { profileId: 'perfil-bob-seguranca' });
  });

  await t.test('cópia do perfil não permite apagar canais/sons nem retirar a reação alheia', async () => {
    const channel = await emit(alice, 'create-channel', { name: 'Canal da Alice' });
    const text = await emit(alice, 'create-text-channel', { name: 'Texto da Alice' });
    const sound = await emit(alice, 'soundboard-add', { name: 'Som fictício', data: 'data:audio/ogg;base64,T2dnUw==' });
    assert.ok(channel.success && text.success && sound.success);
    await emit(alice, 'text-message', { channelId: text.channelId, text: 'Reações isoladas' });
    const msg = (await emit(alice, 'text-history', { channelId: text.channelId })).messages.at(-1);
    await emit(alice, 'message-react', { scope: 'text', channelId: text.channelId, messageId: msg.id, emoji: '👍' });
    await emit(bob, 'update-profile', { profileId: 'perfil-alice-seguranca' });
    assert.equal((await emit(bob, 'delete-channel', { channelId: channel.channelId })).success, false);
    assert.equal((await emit(bob, 'delete-text-channel', { channelId: text.channelId })).success, false);
    assert.equal((await emit(bob, 'soundboard-delete', { id: sound.id })).success, false);
    assert.equal((await emit(bob, 'message-react', { scope: 'text', channelId: text.channelId, messageId: msg.id, emoji: '👍' })).success, true);
    const reactions = (await emit(alice, 'text-history', { channelId: text.channelId })).messages.at(-1).reactions['👍'];
    assert.equal(reactions.length, 2);
    assert.deepEqual(new Set(reactions.map(r => r.m)), new Set([alice.permissions.memberId, bob.permissions.memberId]));
    assert.equal((await emit(alice, 'soundboard-delete', { id: sound.id })).success, true);
    assert.equal((await emit(alice, 'delete-text-channel', { channelId: text.channelId })).success, true);
    assert.equal((await emit(alice, 'delete-channel', { channelId: channel.channelId })).success, true);
    await emit(bob, 'update-profile', { profileId: 'perfil-bob-seguranca' });
  });

  await t.test('sala com senha protege arquivo/imagem e chave expira ao desconectar', async () => {
    const media = await connect('Arquivos', 'perfil-arquivos-seguranca');
    await emit(media, 'text-file', { channelId, name: 'ficticio.txt', data: Buffer.from('conteudo-ficticio') });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
    await emit(media, 'text-image', { channelId, mime: 'image/png', data: png });
    const messages = (await emit(media, 'text-history', { channelId })).messages;
    const urls = messages.flatMap(m => [m.image?.url, m.attachment?.url].filter(Boolean));
    assert.equal(urls.length, 2);
    assert.equal((await emit(owner, 'admin-set-room-password', { password: 'senha-ficticia-seguranca' })).success, true);
    for (const url of urls) {
      assert.equal((await fetch(base + url)).status, 404);
      assert.equal((await fetch(base + url + '?access=' + '0'.repeat(64))).status, 404);
      const allowed = await fetch(base + url + '?access=' + media.assetKey);
      assert.equal(allowed.status, 200);
      assert.equal(allowed.headers.get('cache-control'), 'private, no-store');
    }
    media.socket.disconnect();
    await waitFor(() => !backend.io.sockets.sockets.has(media.socket.id) && ![...backend.io.sockets.sockets.values()].some(s => s.data.user.assetKey === media.assetKey));
    for (const url of urls) assert.equal((await fetch(base + url + '?access=' + media.assetKey)).status, 404);
    const locked = await emit(owner, 'create-channel', { name: 'Call protegida', password: 'senha-call-ficticia' });
    assert.equal(locked.success, true);
    await emit(owner, 'join-channel', { channelId: locked.channelId, password: 'senha-call-ficticia' });
    assert.equal((await emit(owner, 'chat-file', { name: 'call.txt', data: Buffer.from('arquivo-da-call') })).success, true);
    const callUrl = backend.channels.get(locked.channelId).messages.at(-1).attachment.url;
    assert.equal((await fetch(base + callUrl + '?access=' + owner.assetKey)).status, 200);
    assert.equal((await fetch(base + callUrl + '?access=' + bob.assetKey)).status, 404);
    await emit(owner, 'leave-channel');
    assert.equal((await fetch(base + callUrl + '?access=' + owner.assetKey)).status, 404);
    await emit(owner, 'admin-set-room-password', { password: '' });
  });

  await t.test('moderação bloqueia tokens, revoga voz anterior e preserva tela; copiar perfil não remove bloqueio', async () => {
    await emit(owner, 'join-channel', { channelId: 'geral' });
    const token = (c, role, kind = 'voice') => emit(c, 'sfu-token', { ownerId: role === 'host' ? c.socket.id : owner.socket.id, role, kind });
    const host = await token(alice, 'host'), viewer = await token(alice, 'viewer'), screen = await token(alice, 'host', 'screen');
    assert.ok(host.ok && viewer.ok && screen.ok);
    const id = auth => auth.token.split('.')[0];
    await emit(owner, 'admin-mute-user', { userId: alice.socket.id, on: true });
    await waitFor(() => revocations.includes(id(host)));
    assert.equal(revocations.includes(id(screen)), false);
    assert.equal(revocations.includes(id(viewer)), false);
    assert.equal((await token(alice, 'host')).ok, false);
    assert.equal((await token(alice, 'viewer')).ok, true);
    await emit(alice, 'update-profile', { profileId: 'perfil-trocado-seguranca' });
    assert.equal((await token(alice, 'host')).ok, false);
    const twin = await connect('Alice', 'perfil-alice-seguranca', { permissionToken: alice.token });
    await emit(twin, 'join-channel', { channelId: 'geral' });
    assert.equal((await token(twin, 'host')).ok, false);
    await emit(owner, 'admin-deafen-user', { userId: alice.socket.id, on: true });
    await waitFor(() => revocations.includes(id(viewer)));
    for (const c of [alice, twin]) {
      assert.equal((await token(c, 'host')).ok, false);
      assert.equal((await token(c, 'viewer')).ok, false);
      assert.equal((await token(c, 'host', 'screen')).ok, true);
    }
    await emit(owner, 'admin-deafen-user', { userId: alice.socket.id, on: false });
    const newViewer = await token(alice, 'viewer');
    assert.equal(newViewer.ok, true); assert.notEqual(id(newViewer), id(viewer));
    await emit(owner, 'admin-mute-user', { userId: alice.socket.id, on: false });
    const newHost = await token(alice, 'host');
    assert.equal(newHost.ok, true); assert.notEqual(id(newHost), id(host));
    for (const c of [alice, twin]) await emit(c, 'leave-channel');
    await waitFor(() => revocations.includes(id(newHost)) && revocations.includes(id(newViewer)) && revocations.includes(id(screen)));
  });

  await t.test('API de contas rejeita corpo comprimido e continua saudável', async () => {
    const response = await fetch(base + '/api/account/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
      body: gzipSync(JSON.stringify({ username: 'ficticio', password: 'senha-ficticia' })) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).success, false);
    assert.equal((await fetch(base + '/api/health')).status, 200);
  });
});
