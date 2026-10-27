import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseInput, loadPlaylist, spotifyPlaylistTracks, prepareStream } from '../music/source.mjs';

const id = '4cOdK2wGLETKBW3PvgPWqT';
function spotifyHTML() {
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity: {
    title: 'Playlist pública de teste', trackList: [
      { uri: `spotify:track:${id}`, title: 'Primeira', subtitle: 'Artista A', duration: 100000 },
      { uri: 'spotify:episode:aaaaaaaaaaaaaaaaaaaaaa', title: 'Não é música' },
      { uri: `spotify:track:${id}`, title: 'Repetida', subtitle: 'Artista B', duration: 200000 },
      { uri: 'spotify:local:artista:faixa', title: 'Arquivo local indisponível' },
    ],
  } } } } } })}</script>`;
}

test('Spotify público preserva ordem, artista e faixas repetidas sem incluir podcasts/arquivos locais', () => {
  const result = spotifyPlaylistTracks(spotifyHTML());
  assert.equal(result.tracks.length, 2);
  assert.equal(result.tracks[0].query, 'Primeira Artista A');
  assert.equal(result.tracks[1].duration, 200);
  assert.notEqual(result.tracks[0].id, result.tracks[1].id);
  assert.throws(() => spotifyPlaylistTracks('<html>Sem faixas públicas</html>'), /públicas/);
  assert.equal(parseInput(`spotify:playlist:${id}`).kind, 'spotify-playlist');
  assert.equal(parseInput(`https://open.spotify.com/intl-pt/album/${id}`).type, 'album');
  assert.ok(parseInput('https://youtube.com/watch?v=jNQXAC9IVRw&list=PL1234567890').playlistUrl);
});

test('carrega páginas públicas do Spotify e informa que só está lendo a lista pública', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async url => {
    assert.equal(url, `https://open.spotify.com/embed/playlist/${id}`);
    return new Response(spotifyHTML());
  };
  const first = await loadPlaylist(`https://open.spotify.com/playlist/${id}`, { limit: 1 });
  assert.equal(first.playlist.nextOffset, 1);
  assert.equal(first.playlist.tracks[0].title, 'Primeira');
  assert.equal(first.playlist.publicOnly, true);
  const second = await loadPlaylist(`https://open.spotify.com/playlist/${id}`, { offset: 1, limit: 1 });
  assert.equal(second.playlist.tracks[0].title, 'Repetida');
  assert.equal(second.playlist.nextOffset, null);
  globalThis.fetch = async () => new Response('', { status: 403 });
  await assert.rejects(loadPlaylist(`https://open.spotify.com/playlist/${id}`), /HTTP 403/);
});

test('prepara só a URL de áudio, reaproveita o cache e não baixa nem converte arquivos', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teletela-fonte-teste-'));
  const original = process.env.MUSIC_YTDLP;
  t.after(async () => { if (original === undefined) delete process.env.MUSIC_YTDLP; else process.env.MUSIC_YTDLP = original; await rm(directory, { recursive: true, force: true }); });
  const counter = path.join(directory, 'pedidos');
  const script = path.join(directory, 'extrator.cjs');
  await writeFile(script, `#!/usr/bin/env node
require('node:fs').appendFileSync(${JSON.stringify(counter)}, JSON.stringify(process.argv.slice(2))+'\\n');
console.log(JSON.stringify({id:'jNQXAC9IVRw',duration:19,title:'Teste',url:'https://r1.googlevideo.com/audio?teste=rapido',http_headers:{'User-Agent':'Teste'}}));
`, { mode: 0o700 });
  process.env.MUSIC_YTDLP = script;
  const otherDirectory = await mkdtemp(path.join(directory, 'outra-'));
  const controller = new AbortController();
  const cancelled = prepareStream('https://youtube.com/watch?v=jNQXAC9IVRw', directory, controller.signal);
  const waiting = prepareStream('https://youtube.com/watch?v=jNQXAC9IVRw', otherDirectory);
  controller.abort();
  await assert.rejects(cancelled, /cancelada/);
  const first = await waiting;
  const second = await prepareStream('https://youtube.com/watch?v=jNQXAC9IVRw', directory);
  assert.equal(first.url, second.url);
  assert.equal(first.sourceUrl, 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
  const calls = (await readFile(counter, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('--skip-download'));
  assert.ok(!calls[0].includes('-x'), 'Não deve converter para MP3 antes de tocar.');
  await assert.rejects(prepareStream('https://youtube.com/watch?v=jNQXAC9IVRw', directory, AbortSignal.abort()), /cancelada/);
});
