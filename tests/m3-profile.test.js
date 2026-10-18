/**
 * tests/m3-profile.test.js - Perfil (nome, cor, bio, foto) via Socket.IO
 * Valida: perfil enviado no join-channel, update-profile avisando todo mundo,
 * foto servida por /api/avatar/:id, e campos inválidos sendo ignorados.
 */

import { io as ioClient } from 'socket.io-client';
import { server } from '../server.js';
import assert from 'node:assert/strict';

const TEST_PORT = 19093;
// PNG 1×1 transparente
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

async function connect(url) {
  const client = ioClient(url, { transports: ['websocket'] });
  await once(client, 'connect');
  return client;
}

async function runProfileTests() {
  console.log('\n--- Perfil: Socket.IO + /api/avatar ---');
  await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${TEST_PORT}`;

  try {
    // 1. Perfil vai junto no join-channel
    const alice = await connect(url);
    const aliceState = once(alice, 'channel-state');
    alice.emit('join-channel', {
      channelId: 'geral',
      userName: 'Alice',
      profile: { profileId: 'alice-profile-0001', name: 'Alice', color: '#EB459E', bio: 'oi 👋', avatar: PNG_1PX }
    });
    const state = await aliceState;
    assert.equal(state.me.name, 'Alice');
    assert.equal(state.me.color, '#EB459E');
    assert.equal(state.me.bio, 'oi 👋');
    assert.equal(state.me.profileId, 'alice-profile-0001');
    assert.ok(state.me.avatarV > 0);
    assert.equal(state.me.avatar, undefined, 'a foto não pode ir junto do estado');
    console.log('  ✓ join-channel aplica o perfil e não manda a foto no estado');

    // 2. Foto servida pelo HTTP com o tipo certo
    const avatarRes = await fetch(`${url}/api/avatar/${alice.id}?v=${state.me.avatarV}`);
    assert.equal(avatarRes.status, 200);
    assert.equal(avatarRes.headers.get('content-type'), 'image/png');
    assert.equal(avatarRes.headers.get('x-content-type-options'), 'nosniff');
    const bytes = Buffer.from(await avatarRes.arrayBuffer());
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal((await fetch(`${url}/api/avatar/nao-existe`)).status, 404);
    console.log('  ✓ /api/avatar serve a foto (e 404 pra quem não tem)');

    // 3. Bob entra e vê o perfil da Alice na lista
    const bob = await connect(url);
    const bobState = once(bob, 'channel-state');
    bob.emit('join-channel', { channelId: 'geral', userName: 'Bob', profile: { profileId: 'bob-profile-0001' } });
    const seen = (await bobState).users.find((u) => u.id === alice.id);
    assert.equal(seen.bio, 'oi 👋');
    assert.equal(seen.profileId, 'alice-profile-0001');
    console.log('  ✓ Quem entra depois recebe o perfil dos outros');

    // 4. update-profile avisa todo mundo; campos inválidos são ignorados
    const bobSees = once(bob, 'user-profile-updated');
    alice.emit('update-profile', {
      name: 'Alice Nova',
      color: 'red; background: url(x)',
      bio: 'x'.repeat(500),
      profileId: '../../etc',
      avatar: 'data:text/html;base64,PHNjcmlwdD4='
    });
    const update = await bobSees;
    assert.equal(update.userId, alice.id);
    assert.equal(update.user.name, 'Alice Nova');
    assert.equal(update.user.color, '#EB459E', 'cor inválida mantém a anterior');
    assert.equal(update.user.bio.length, 140);
    assert.equal(update.user.profileId, 'alice-profile-0001', 'profileId inválido mantém o anterior');
    assert.equal(update.user.avatarV, state.me.avatarV, 'foto que não é imagem é ignorada');
    console.log('  ✓ update-profile avisa a sala e ignora cor/id/foto inválidos');

    // 5. Foto grande demais é recusada; foto vazia remove
    const big = `data:image/png;base64,${Buffer.alloc(300 * 1024).toString('base64')}`;
    alice.emit('update-profile', { avatar: big, bio: 'grande' });
    const afterBig = (await once(bob, 'user-profile-updated')).user;
    assert.equal(afterBig.avatarV, state.me.avatarV);
    alice.emit('update-profile', { avatar: '' });
    const removed = (await once(bob, 'user-profile-updated')).user;
    assert.equal(removed.avatarV, 0);
    assert.equal((await fetch(`${url}/api/avatar/${alice.id}`)).status, 404);
    console.log('  ✓ Foto acima de 200 KB recusada; avatar vazio remove a foto');

    // 6. Mensagem do chat leva a versão da foto
    alice.emit('update-profile', { avatar: PNG_1PX });
    const withPhoto = (await once(bob, 'user-profile-updated')).user;
    const msgPromise = once(bob, 'chat-message');
    alice.emit('chat-message', { text: 'olha minha foto' });
    const msg = await msgPromise;
    assert.equal(msg.userAvatarV, withPhoto.avatarV);
    console.log('  ✓ Chat leva a versão da foto de quem mandou');

    alice.disconnect();
    bob.disconnect();
    console.log('\n✅ TODOS OS TESTES DE PERFIL PASSARAM\n');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

runProfileTests().catch((err) => {
  console.error('❌ Falha no teste de perfil:', err);
  process.exit(1);
});
