import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startMusicLab } from '../scripts/music-lab/server.mjs';
import { parseInput } from '../scripts/music-lab/resolver.mjs';

const exec = promisify(execFile);
const video = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let count = 0; count < 100; count++) {
    if (check()) return;
    await pause(30);
  }
  throw new Error('A condição esperada não chegou.');
}
async function post(lab, route, body) {
  return fetch(lab.url + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
}
async function readAudio(response, size = 4096) {
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (length < size) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    length += value.length;
  }
  await reader.cancel();
  assert.ok(length >= size, 'O ouvinte deve receber áudio, não apenas cabeçalhos HTTP.');
  return Buffer.concat(chunks).subarray(0, size);
}

test('links são normalizados sem carregar parâmetros ou endereços arbitrários', () => {
  assert.equal(parseInput('https://youtu.be/jNQXAC9IVRw?si=segredo').url, video);
  assert.equal(parseInput('https://music.youtube.com/watch?v=jNQXAC9IVRw&list=123').url, video);
  assert.equal(parseInput('https://open.spotify.com/intl-pt/track/4cOdK2wGLETKBW3PvgPWqT?si=123').url,
    'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
  assert.equal(parseInput('spotify:track:4cOdK2wGLETKBW3PvgPWqT').kind, 'spotify');
  assert.equal(parseInput('Tim Maia Gostava Tanto de Você').kind, 'search');
  for (const input of ['http://127.0.0.1/segredo', 'https://youtube.com.evil.test/watch?v=jNQXAC9IVRw',
    'https://youtube.com:444/watch?v=jNQXAC9IVRw', 'https://usuario:senha@youtube.com/watch?v=jNQXAC9IVRw',
    'file:///etc/passwd', '', null]) assert.throws(() => parseInput(input));
});

test('playlists são identificadas separadamente de faixas', () => {
  assert.equal(parseInput('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M').kind, 'spotify-playlist');
  assert.equal(parseInput('https://youtube.com/playlist?list=PL1234567890').kind, 'youtube-playlist');
  assert.throws(() => parseInput('https://youtube.com/playlist?list=123'), /inválido/);
});

test('laboratório mantém busca e comandos na origem local', async t => {
  const lab = await startMusicLab({ port: 0, check: async () => [], resolve: async input => ({ source: { title: input }, candidates: [] }) });
  t.after(() => lab.close());
  assert.equal(lab.server.address().address, '127.0.0.1');
  const external = await fetch(lab.url + '/api/stop', { method: 'POST', headers: { Origin: 'https://outro-site.test' } });
  assert.equal(external.status, 403);
  const page = await fetch(lab.url);
  assert.match(await page.text(), /Uma música. Todo mundo ouvindo/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const result = await post(lab, '/api/resolve', { input: 'faixa de teste' });
  assert.equal((await result.json()).source.title, 'faixa de teste');
  assert.equal((await post(lab, '/api/play', { url: 'http://127.0.0.1/segredo' })).status, 400);
});

test('dois ouvintes e uma entrada tardia recebem uma única reprodução central', { timeout: 15000 }, async t => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'teletela-music-test-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const tone = path.join(fixture, 'tom.mp3');
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-y', tone]);
  let preparations = 0;
  const lab = await startMusicLab({ port: 0, prepare: async (_url, folder) => {
    preparations++;
    const file = path.join(folder, 'faixa.mp3');
    await copyFile(tone, file);
    return file;
  } });
  t.after(() => lab.close());
  const played = await post(lab, '/api/play', { url: video, title: 'Tom de teste' });
  assert.equal(played.status, 200);
  const { generation, startedAt } = (await played.json()).state;
  const pid = lab.broadcast.child.pid;
  const stream = `${lab.url}/api/live?generation=${generation}`;
  const [first, second] = await Promise.all([fetch(stream), fetch(stream)]);
  assert.equal(first.headers.get('content-type'), 'audio/mpeg');
  await until(() => lab.broadcast.state.listeners === 2);
  const [audioA, audioB] = await Promise.all([readAudio(first), readAudio(second)]);
  assert.deepEqual(audioA, audioB, 'Os dois ouvintes devem receber os mesmos blocos MP3.');
  await pause(500);
  const late = await fetch(stream);
  await readAudio(late);
  assert.equal(preparations, 1, 'Conectar um ouvinte não deve buscar a música outra vez.');
  assert.equal(lab.broadcast.child.pid, pid, 'A entrada tardia não deve iniciar outro FFmpeg.');
  assert.equal(lab.broadcast.state.startedAt, startedAt);
  await post(lab, '/api/stop');
  assert.equal(lab.broadcast.state.phase, 'idle');
  assert.equal((await fetch(stream)).status, 409, 'O endereço antigo não deve repetir a música do começo.');
});

test('parar cancela preparação em andamento e impede publicação tardia', async t => {
  let entered = false;
  const lab = await startMusicLab({ port: 0, prepare: async (_url, _folder, signal) => {
    entered = true;
    return new Promise((_accept, reject) => signal.addEventListener('abort', () => reject(new Error('Cancelada.')), { once: true }));
  } });
  t.after(() => lab.close());
  const preparing = post(lab, '/api/play', { url: video });
  await until(() => entered);
  assert.equal((await post(lab, '/api/play', { url: video })).status, 409);
  await post(lab, '/api/stop');
  assert.equal((await preparing).status, 400);
  assert.equal(lab.broadcast.state.phase, 'idle');
  assert.equal(lab.broadcast.child, null);
});
