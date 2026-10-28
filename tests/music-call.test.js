import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { MusicManager } from '../music/manager.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const track = { id: 'jNQXAC9IVRw', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', title: 'Faixa de teste', author: 'Teste' };
const requester = { id: 'pessoa', name: 'Pessoa de teste' };
async function until(check) {
  for (let index = 0; index < 100; index++) { if (await check()) return; await pause(10); }
  throw new Error('A transição de música não aconteceu.');
}
class FakeTransport extends EventEmitter {
  async start(file) { await access(file); this.file = file; }
  position() { return 3; }
  pause(paused) { this.paused = paused; }
  async close() { this.closed = true; }
  signal(message) { this.lastSignal = message; }
}
async function prepare(_url, folder) {
  const file = path.join(folder, 'faixa.mp3');
  await writeFile(file, 'áudio de teste');
  return file;
}

test('fila toca em ordem, remove pedidos e isola canais', async t => {
  const transports = [];
  const manager = new MusicManager({ prepare, createTransport: () => { const transport = new FakeTransport(); transports.push(transport); return transport; } });
  t.after(() => manager.close());
  manager.enqueue('geral', track, requester);
  await until(() => manager.state('geral').phase === 'playing');
  const original = manager.state('geral').generation;
  manager.enqueue('geral', { ...track, title: 'Segunda' }, requester);
  manager.enqueue('geral', { ...track, title: 'Remover' }, requester);
  manager.remove('geral', manager.state('geral').queue[1].id);
  assert.equal(manager.state('geral').queue.length, 1);
  assert.equal(manager.state('cinema').phase, 'idle');
  manager.pause('geral', true);
  assert.equal(manager.state('geral').phase, 'paused');
  assert.equal(transports[0].paused, true);
  manager.pause('geral', false);
  manager.stop('geral', { keepQueue: true });
  await until(() => manager.state('geral').track?.title === 'Segunda' && manager.state('geral').phase === 'playing');
  assert.notEqual(manager.state('geral').generation, original);
  assert.equal(transports[0].closed, true);
  await assert.rejects(access(transports[0].file));
  transports[1].emit('ended');
  await until(() => manager.state('geral').phase === 'idle');
});

test('cancelamento durante preparação não publica áudio atrasado e limpa a pasta', async t => {
  let release;
  let folder;
  let started = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const manager = new MusicManager({ prepare: async (url, directory) => { folder = directory; await gate; return prepare(url, directory); },
    createTransport: () => { started++; return new FakeTransport(); } });
  t.after(() => manager.close());
  manager.enqueue('geral', track, requester);
  await until(() => folder);
  manager.stop('geral');
  release();
  await until(() => manager.cleanup.size === 0);
  await assert.rejects(access(folder));
  assert.equal(started, 0);
  assert.equal(manager.state('geral').phase, 'idle');
  assert.equal(manager.state('geral').queue.length, 0);
});

test('falha de reprodução não trava a próxima faixa nem permite sinais antigos', async t => {
  const transports = [];
  const manager = new MusicManager({ prepare, createTransport: () => { const transport = new FakeTransport(); transports.push(transport); return transport; } });
  t.after(() => manager.close());
  manager.enqueue('geral', track, requester);
  await until(() => manager.state('geral').phase === 'playing');
  const old = manager.state('geral').generation;
  manager.enqueue('geral', { ...track, title: 'Próxima' }, requester);
  transports[0].emit('failed', new Error('Fonte indisponível'));
  await until(() => manager.state('geral').phase === 'playing' && manager.state('geral').track.title === 'Próxima');
  assert.throws(() => manager.signal('geral', old, { type: 'subscribe' }), /terminou/);
  manager.signal('geral', manager.state('geral').generation, { type: 'subscribe', id: 'ouvinte' });
  assert.equal(transports[1].lastSignal.id, 'ouvinte');
});

test('playlist entra inteira ou não entra; repetição só ocorre no fim natural', async t => {
  const transports = [];
  const manager = new MusicManager({ prepare, createTransport: () => { const transport = new FakeTransport(); transports.push(transport); return transport; } });
  t.after(() => manager.close());
  manager.enqueueMany('geral', [track, { ...track, title: 'Segunda' }, { ...track, title: 'Terceira' }], requester);
  await until(() => manager.state('geral').phase === 'playing');
  const before = manager.state('geral').queue.length;
  assert.throws(() => manager.enqueueMany('geral', Array(150).fill(track), requester), /espaço/);
  assert.equal(manager.state('geral').queue.length, before);
  manager.repeat('geral', 'one');
  transports[0].emit('ended');
  await until(() => transports.length === 2 && manager.state('geral').phase === 'playing');
  assert.equal(manager.state('geral').track.title, track.title);
  manager.stop('geral', { keepQueue: true });
  await until(() => manager.state('geral').track?.title === 'Segunda' && manager.state('geral').phase === 'playing');
  manager.repeat('geral', 'all');
  transports[2].emit('ended');
  await until(() => manager.state('geral').track?.title === 'Terceira' && manager.state('geral').phase === 'playing');
  assert.equal(manager.state('geral').queue[0].title, 'Segunda');
  const titles = manager.state('geral').queue.map(item => item.title).sort();
  manager.shuffle('geral');
  assert.deepEqual(manager.state('geral').queue.map(item => item.title).sort(), titles);
});

test('pré-carrega a próxima faixa e não prepara outra vez ao avançar', async t => {
  let preparations = 0;
  const transports = [];
  const manager = new MusicManager({ prepare: async (...args) => { preparations++; await pause(60); return prepare(...args); },
    createTransport: () => { const transport = new FakeTransport(); transports.push(transport); return transport; } });
  t.after(() => manager.close());
  manager.enqueueMany('geral', [track, { ...track, title: 'Próxima' }], requester);
  await until(() => manager.sessions.get('geral').prefetch?.result);
  assert.equal(preparations, 2);
  const started = Date.now();
  transports[0].emit('ended');
  await until(() => manager.state('geral').track?.title === 'Próxima' && manager.state('geral').phase === 'playing');
  assert.ok(Date.now() - started < 60, 'Avançar não deve repetir a preparação de 60 ms.');
  assert.equal(preparations, 2);
});

test('pular não fica esperando o download de pré-carregamento terminar', async t => {
  let buffering = false;
  let cancelled = false;
  const manager = new MusicManager({ prepare: async (_url, folder) => {
    const infoFile = path.join(folder, 'fonte.json');
    await writeFile(infoFile, '{}');
    return { infoFile, url: 'https://r1.googlevideo.com/audio' };
  }, buffer: async (_input, _folder, signal) => {
    buffering = true;
    await new Promise((_accept, reject) => signal.addEventListener('abort', () => { cancelled = true; reject(new Error('Cancelado.')); }, { once: true }));
  }, createTransport: () => {
    const transport = new FakeTransport();
    transport.start = async input => { await access(input.infoFile); };
    return transport;
  } });
  t.after(() => manager.close());
  manager.enqueueMany('geral', [track, { ...track, title: 'Próxima' }], requester);
  await until(() => buffering);
  manager.stop('geral', { keepQueue: true });
  await until(() => manager.state('geral').track?.title === 'Próxima' && manager.state('geral').phase === 'playing');
  assert.equal(cancelled, true);
});

test('interrompe a fila após 3 falhas seguidas em vez de falhar em cascata nas 50 faixas', async t => {
  let attempts = 0;
  const manager = new MusicManager({
    prepare: async () => {
      attempts++;
      throw new Error('O YouTube bloqueou a extração deste áudio no servidor.');
    },
    createTransport: () => new FakeTransport(),
  });
  t.after(() => manager.close());
  const many = Array.from({ length: 10 }, (_, idx) => ({ ...track, id: `jNQXAC9IVR${idx}`, title: `Faixa ${idx + 1}` }));
  manager.enqueueMany('geral', many, requester);
  await until(() => manager.state('geral').phase === 'error' && manager.sessions.get('geral').failures === 3 && !manager.sessions.get('geral').draining);
  assert.equal(manager.state('geral').queue.length, 7, 'Preserva o restante da fila sem tentar as próximas faixas em cascata.');
  assert.match(manager.state('geral').error, /Fila interrompida após 3 falhas seguidas/);
  assert.equal(attempts, 3, `Esperava parar logo após 3 falhas, mas tentou ${attempts} vezes.`);
});

test('eventos reais exigem presença, respeitam acesso e encerram canal vazio', { timeout: 15000 }, async t => {
  process.env.TELINHA_MUSIC = '1';
  process.env.SFU_SECRET = '';
  process.env.OWNER_KEY = 'dono-musica-teste';
  process.env.TELINHA_DATA_DIR = '';
  const backend = await import('../server.js');
  const { io } = await import('socket.io-client');
  await backend.startServer(0, '127.0.0.1');
  const transports = [];
  backend.music.prepare = prepare;
  backend.music.createTransport = () => { const transport = new FakeTransport(); transports.push(transport); return transport; };
  backend.music.resolve = async () => ({ source: { title: 'Teste' }, candidates: [track] });
  const sockets = [];
  t.after(async () => {
    sockets.forEach(socket => socket.disconnect());
    await backend.music.close();
    await new Promise(resolve => backend.io.close(resolve));
  });
  const connect = async () => {
    const socket = io(`http://127.0.0.1:${backend.server.address().port}`, { autoConnect: false, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    const ready = once(socket, 'me'); socket.connect(); await ready; return socket;
  };
  const emit = (socket, event, payload = {}) => socket.timeout(3000).emitWithAck(event, payload);
  const owner = await connect(), friend = await connect(), outside = await connect();
  assert.equal((await emit(outside, 'music-get')).success, false);
  await emit(owner, 'owner-claim', { key: 'dono-musica-teste' });
  const created = await emit(owner, 'create-channel', { name: 'Música privada', password: 'senha-musica', access: { private: true, roles: [], members: [] } });
  assert.equal(created.success, true);
  await emit(owner, 'join-channel', { channelId: created.channelId, password: 'senha-musica' });
  await emit(friend, 'join-channel', { channelId: 'geral' });
  await emit(owner, 'music-search', { input: 'Teste' });
  assert.equal((await emit(owner, 'music-enqueue', { id: track.id })).success, true);
  await until(() => backend.music.state(created.channelId).phase === 'playing');
  assert.equal((await emit(friend, 'music-get', { channelId: created.channelId })).state.track, null, 'O cliente não escolhe outro canal no payload.');
  const generation = backend.music.state(created.channelId).generation;
  assert.equal((await emit(friend, 'music-subscribe', { generation })).success, false);
  assert.equal((await emit(friend, 'music-enqueue', { id: track.id })).success, false, 'Não aceitar faixa forjada sem busca.');
  const list = [{ ...track, id: 'lista-1' }, { ...track, id: 'lista-2', title: 'Segunda' }];
  backend.music.resolve = async () => ({ source: { title: 'Playlist de teste' }, candidates: [], playlist: { title: 'Lista', tracks: list } });
  await emit(friend, 'music-search', { input: 'playlist pública' });
  assert.equal((await emit(outside, 'music-enqueue-playlist', { ids: ['lista-1'] })).success, false);
  assert.equal((await emit(friend, 'music-enqueue-playlist', { ids: ['lista-1', 'forjada'] })).success, false);
  assert.equal(backend.music.state('geral').queue.length, 0, 'Um pedido inválido não adiciona só metade da playlist.');
  const added = await emit(friend, 'music-enqueue-playlist', { ids: ['lista-1', 'lista-2'], shuffle: true });
  assert.equal(added.added, 2);
  await until(() => backend.music.state('geral').phase === 'playing');
  await emit(friend, 'music-enqueue-playlist', { ids: ['lista-1', 'lista-2'], shuffle: false });
  const beforeMove = backend.music.state('geral').queue.map(item => item.id);
  assert.ok(beforeMove.length >= 2);
  const movedState = await emit(friend, 'music-control', { action: 'move', id: beforeMove[1], toIndex: 0 });
  assert.equal(movedState.success, true);
  assert.equal(movedState.state.queue[0].id, beforeMove[1]);
  assert.equal((await emit(friend, 'music-control', { action: 'repeat', mode: 'all' })).state.repeat, 'all');
  assert.equal((await emit(friend, 'music-control', { action: 'repeat', mode: 'inexistente' })).success, false);
  await emit(owner, 'leave-channel');
  await until(() => backend.music.state(created.channelId).phase === 'idle');
  assert.equal(transports[0].closed, true);
});
