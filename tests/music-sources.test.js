import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { parseInput, loadPlaylist, spotifyPlaylistTracks, prepareStream, startMusicDownload, formatToolError } from '../music/source.mjs';

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

test('repassa MUSIC_PROXY ao yt-dlp e traduz bloqueios de IP do YouTube em mensagem amigável', async t => {
  assert.match(formatToolError("WARNING: teste\nERROR: [youtube] id: Sign in to confirm you’re not a bot. Use --cookies-from-browser", 'Falha.'), /bloqueou temporariamente/);
  assert.match(formatToolError('ERROR: [youtube] id: Video unavailable. This video is not available', 'Falha.'), /indisponível ou privado/);
  assert.match(formatToolError('ERROR: [youtube] id: Private video', 'Falha.'), /privado/);

  const directory = await mkdtemp(path.join(os.tmpdir(), 'teletela-proxy-teste-'));
  const oldYtdlp = process.env.MUSIC_YTDLP;
  const oldProxy = process.env.MUSIC_PROXY;
  t.after(async () => {
    if (oldYtdlp === undefined) delete process.env.MUSIC_YTDLP; else process.env.MUSIC_YTDLP = oldYtdlp;
    if (oldProxy === undefined) delete process.env.MUSIC_PROXY; else process.env.MUSIC_PROXY = oldProxy;
    await rm(directory, { recursive: true, force: true });
  });
  const counter = path.join(directory, 'pedidos');
  const script = path.join(directory, 'extrator-proxy.cjs');
  await writeFile(script, `#!/usr/bin/env node
require('node:fs').appendFileSync(${JSON.stringify(counter)}, JSON.stringify(process.argv.slice(2))+'\\n');
console.log(JSON.stringify({id:'dQw4w9WgXcQ',duration:25,filesize_approx:1024,title:'Proxy Teste',url:'https://r1.googlevideo.com/audio?proxy=ok'}));
`, { mode: 0o700 });
  process.env.MUSIC_YTDLP = script;
  process.env.MUSIC_PROXY = 'socks5://127.0.0.1:40000';
  const result = await prepareStream('https://youtube.com/watch?v=dQw4w9WgXcQ', directory);
  assert.equal(result.url, 'https://r1.googlevideo.com/audio?proxy=ok');
  const calls = (await readFile(counter, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(calls.length, 1);
  const proxyIdx = calls[0].indexOf('--proxy');
  assert.notEqual(proxyIdx, -1, 'Deve passar --proxy quando MUSIC_PROXY estiver configurado.');
  assert.equal(calls[0][proxyIdx + 1], 'socks5://127.0.0.1:40000');
});

test('sessão do bot usa cookies privados temporários na preparação e no download, sem compartilhar cache entre sessões', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teletela-cookies-teste-'));
  const oldYtdlp = process.env.MUSIC_YTDLP;
  const oldCookies = process.env.MUSIC_COOKIES_BASE64;
  t.after(async () => {
    if (oldYtdlp === undefined) delete process.env.MUSIC_YTDLP; else process.env.MUSIC_YTDLP = oldYtdlp;
    if (oldCookies === undefined) delete process.env.MUSIC_COOKIES_BASE64; else process.env.MUSIC_COOKIES_BASE64 = oldCookies;
    await rm(directory, { recursive: true, force: true });
  });
  const counter = path.join(directory, 'pedidos');
  const script = path.join(directory, 'extrator-conta.cjs');
  await writeFile(script, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const cookie = args[args.indexOf('--cookies') + 1];
const data = fs.readFileSync(cookie, 'utf8');
fs.appendFileSync(${JSON.stringify(counter)}, JSON.stringify({args, cookie,
  mode:fs.statSync(cookie).mode & 0o777, directoryMode:fs.statSync(path.dirname(cookie)).mode & 0o777,
  session:data.includes('segunda-sessao') ? 2 : 1})+'\\n');
if(data.includes('sessao-falha')) { process.stderr.write('ERROR: falha de teste'); process.exit(1); }
if(args.includes('--load-info-json')) process.stdout.write('audio de teste');
else console.log(JSON.stringify({id:'aaaaaaaaaaa',duration:19,title:'Teste autenticado',url:'https://r1.googlevideo.com/audio?conta=teste'}));
`, { mode: 0o700 });
  process.env.MUSIC_YTDLP = script;
  const setSession = value => { process.env.MUSIC_COOKIES_BASE64 = Buffer.from(`# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2000000000\tSID\t${value}\n`).toString('base64'); };
  const url = 'https://youtube.com/watch?v=aaaaaaaaaaa';
  setSession('primeira-sessao');
  await prepareStream(url, directory);
  setSession('segunda-sessao');
  const prepared = await prepareStream(url, directory);
  const child = startMusicDownload(prepared.infoFile);
  let audio = '';
  child.stdout.on('data', chunk => { audio += chunk; });
  const [code] = await once(child, 'close');
  assert.equal(code, 0);
  assert.equal(audio, 'audio de teste');
  const calls = (await readFile(counter, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(calls.map(call => call.session), [1, 2, 2]);
  assert.equal(new Set(calls.map(call => call.cookie)).size, 3);
  for (const call of calls) {
    assert.equal(call.mode, 0o600);
    assert.equal(call.directoryMode, 0o700);
    assert.ok(!call.args.some(arg => arg.includes('primeira-sessao') || arg.includes('segunda-sessao')));
    await assert.rejects(stat(path.dirname(call.cookie)), { code: 'ENOENT' });
  }
  setSession('sessao-falha');
  await assert.rejects(prepareStream(url, directory), /falha de teste/);
  const failedCall = JSON.parse((await readFile(counter, 'utf8')).trim().split('\n').at(-1));
  await assert.rejects(stat(path.dirname(failedCall.cookie)), { code: 'ENOENT' });
  setSession('terceira-sessao');
  process.env.MUSIC_YTDLP = path.join(directory, 'extrator-ausente');
  await assert.rejects(prepareStream(url, directory), /Ferramenta ausente/);
  process.env.MUSIC_COOKIES_BASE64 = Buffer.from('segredo-invalido').toString('base64');
  await assert.rejects(prepareStream(url, directory), error => /sessão do bot está inválida/.test(error.message) && !error.message.includes('segredo-invalido'));
});
