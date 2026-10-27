import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cachedTool = fileURLToPath(new URL('../.cache/music-lab/yt-dlp', import.meta.url));
const videoId = /^[\w-]{11}$/;
const spotifyId = /^[a-zA-Z0-9]{22}$/;
const playlistId = /^[a-zA-Z0-9_-]{10,100}$/;
const streamCache = new Map();
const streamLookups = new Map();

export function parseInput(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) {
    throw new Error('Cole um link ou escreva o nome da música (até 500 caracteres).');
  }
  const input = value.trim();
  const spotifyUri = /^spotify:(track|playlist|album):(.+)$/.exec(input);
  if (spotifyUri) {
    const [, type, id] = spotifyUri;
    if (!spotifyId.test(id)) throw new Error('O identificador da faixa Spotify é inválido.');
    return { kind: type === 'track' ? 'spotify' : 'spotify-playlist', type, id, url: `https://open.spotify.com/${type}/${id}` };
  }
  if (!/^https?:\/\//i.test(input)) {
    if (/^(?:[\w-]+:|(?:www\.)?(?:youtube\.com|youtu\.be|open\.spotify\.com)\/)/i.test(input)) {
      throw new Error('Use o link completo com https:// ou escreva título e artista.');
    }
    return { kind: 'search', query: input };
  }
  const url = new URL(input);
  if (url.username || url.password || url.port) throw new Error('Use um link público da plataforma.');
  if (url.hostname === 'open.spotify.com') {
    const parts = url.pathname.replace(/^\/intl-[\w-]+/, '').split('/').filter(Boolean);
    if (!['track', 'playlist', 'album'].includes(parts[0])) throw new Error('Use uma faixa, playlist pública ou álbum do Spotify.');
    if (!spotifyId.test(parts[1] || '') || parts.length !== 2) throw new Error('O link da faixa Spotify é inválido.');
    return { kind: parts[0] === 'track' ? 'spotify' : 'spotify-playlist', type: parts[0], id: parts[1], url: `https://open.spotify.com/${parts[0]}/${parts[1]}` };
  }
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(url.hostname)) {
    const parts = url.pathname.split('/').filter(Boolean);
    const list = url.searchParams.get('list');
    if (url.pathname === '/playlist') {
      if (!playlistId.test(list || '')) throw new Error('O identificador da playlist do YouTube é inválido.');
      return { kind: 'youtube-playlist', id: list, url: `https://www.youtube.com/playlist?list=${list}` };
    }
    const id = url.hostname === 'youtu.be' ? parts[0]
      : url.pathname === '/watch' ? url.searchParams.get('v')
        : ['shorts', 'live', 'embed'].includes(parts[0]) ? parts[1] : null;
    if (!videoId.test(id || '')) throw new Error('Use o link de um vídeo ou playlist do YouTube.');
    return { kind: 'youtube', url: `https://www.youtube.com/watch?v=${id}`, id,
      ...(playlistId.test(list || '') ? { playlistUrl: `https://www.youtube.com/playlist?list=${list}` } : {}) };
  }
  throw new Error('Este teste aceita links de YouTube, faixas Spotify ou busca por título e artista.');
}

function run(command, args, timeout = 30000, signal) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, signal, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      if (signal?.aborted) return reject(new Error('Preparação cancelada.'));
      if (error.code === 'ENOENT') return reject(new Error(`Ferramenta ausente: ${command}. Rode npm run music:setup e confira Python e FFmpeg.`));
      if (error.killed) return reject(new Error('A plataforma demorou demais para responder. Tente outra faixa.'));
      const detail = stderr.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(-1800);
      reject(new Error(detail || `A ferramenta ${command} falhou.`));
    });
  });
}

function ytdlpCommand(args) {
  // Dentro do Electron, execPath abre outro app, não um processo Node de console.
  const runtime = process.versions.electron ? 'node' : `node:${process.execPath}`;
  const common = ['--ignore-config', '--no-plugin-dirs', '--no-colors', '--no-progress',
    '--socket-timeout', '12', '--retries', '1', '--extractor-retries', '1',
    '--js-runtimes', runtime];
  // Sem shell: links e buscas nunca viram comandos do sistema.
  if (process.env.MUSIC_YTDLP) return [process.env.MUSIC_YTDLP, [...common, ...args]];
  if (existsSync(cachedTool)) return ['python3', [cachedTool, ...common, ...args]];
  return ['yt-dlp', [...common, ...args]];
}

async function ytdlp(args, timeout, signal) {
  const [command, parameters] = ytdlpCommand(args);
  return run(command, parameters, timeout, signal);
}

export function startMusicDownload(infoFile) {
  const [command, args] = ytdlpCommand(['--load-info-json', infoFile, '--no-playlist', '--no-part',
    '-f', 'bestaudio[acodec=opus]/bestaudio/best', '--http-chunk-size', '1M', '-o', '-']);
  return spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

async function metadata(url, kind) {
  const endpoint = kind === 'spotify' ? 'https://open.spotify.com/oembed' : 'https://www.youtube.com/oembed';
  const response = await fetch(`${endpoint}?url=${encodeURIComponent(url)}&format=json`, {
    signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`Não foi possível identificar a faixa: HTTP ${response.status}. Ela pode estar privada, indisponível ou bloqueada.`);
  const data = await response.json();
  if (typeof data.title !== 'string' || !data.title.trim()) throw new Error('A plataforma não informou o título da faixa.');
  return data;
}

export async function resolveMusic(input, refinement = '', options = {}) {
  const source = parseInput(input);
  if (source.kind.endsWith('-playlist')) return loadPlaylist(source.url, options);
  if (typeof refinement !== 'string' || refinement.length > 300) throw new Error('O ajuste da busca deve ter até 300 caracteres.');
  if (source.kind !== 'search') {
    const data = await metadata(source.url, source.kind);
    source.title = data.title;
    if (source.kind === 'youtube') {
      return { source, query: '', notice: 'Este é o vídeo do link. A reprodução ainda precisa ser testada.',
        candidates: [{ id: source.id, url: source.url, title: data.title, author: data.author_name || 'YouTube', duration: null }] };
    }
  } else source.title = source.query;
  const query = refinement.trim() || source.query || source.title;
  const result = { source, query, candidates: [], notice: source.kind === 'spotify'
    ? 'Spotify informou o título, sem artista. Confira a versão e ajuste a busca com o artista, se necessário. O áudio virá do YouTube.'
    : 'Confira a versão encontrada antes de tocar para todos.' };
  try {
    const data = JSON.parse(await ytdlp(['--flat-playlist', '--dump-single-json', '--', `ytsearch5:${query}`], 45000));
    result.candidates = (data.entries || []).filter(entry => videoId.test(entry.id)).slice(0, 5).map(entry => ({
      id: entry.id, title: entry.title, author: entry.uploader || entry.channel || 'YouTube',
      duration: entry.duration, url: `https://www.youtube.com/watch?v=${entry.id}`,
    }));
    if (!result.candidates.length) result.searchError = 'Nenhuma versão encontrada. Tente ajustar título e artista.';
  } catch (error) {
    // Identificar um link não significa que o áudio esteja disponível.
    result.searchError = error.message;
  }
  return result;
}

export async function prepareMusic(url, directory, signal) {
  const source = parseInput(url);
  if (source.kind !== 'youtube') throw new Error('Escolha uma versão do YouTube para testar o áudio.');
  await ytdlp(['--no-playlist', '--max-filesize', '80M', '--match-filters', '!is_live & duration <= 1200',
    '-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '192K',
    '-o', path.join(directory, 'faixa.%(ext)s'), '--', source.url], 120000, signal);
  const file = path.join(directory, 'faixa.mp3');
  let info;
  try { info = await stat(file); } catch { throw new Error('Nenhum áudio foi preparado. O teste aceita vídeos gravados de até 20 minutos e 80 MB.'); }
  if (!info.size) throw new Error('A plataforma retornou um áudio vazio.');
  return file;
}

export async function checkTools() {
  const names = ['yt-dlp', 'FFmpeg'];
  const results = await Promise.allSettled([ytdlp(['--version']), run('ffmpeg', ['-version'])]);
  return results.map((result, index) => ({ name: names[index], ok: result.status === 'fulfilled',
    detail: result.status === 'fulfilled' ? result.value.split('\n')[0] : result.reason.message }));
}

function youtubeTrack(entry) {
  if (!videoId.test(entry?.id || '') || entry.title === '[Deleted video]' || entry.title === '[Private video]') return null;
  return { id: entry.id, url: `https://www.youtube.com/watch?v=${entry.id}`, title: entry.title || 'Vídeo sem título',
    author: entry.uploader || entry.channel || 'YouTube', duration: Number.isFinite(entry.duration) ? entry.duration : null };
}

export function spotifyPlaylistTracks(html) {
  const raw = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!raw) throw new Error('O Spotify não disponibilizou as faixas públicas desta lista.');
  let entity;
  try { entity = JSON.parse(raw).props?.pageProps?.state?.data?.entity; } catch { throw new Error('Não foi possível ler a lista pública do Spotify.'); }
  if (!entity || !Array.isArray(entity.trackList)) throw new Error('O Spotify não disponibilizou as faixas públicas desta lista.');
  const tracks = entity.trackList.flatMap((track, index) => {
    const id = /^spotify:track:([a-zA-Z0-9]{22})$/.exec(track.uri || '')?.[1];
    if (!id || !track.title) return [];
    const author = String(track.subtitle || '');
    return [{ id: `spotify-${index}-${id}`, url: `https://open.spotify.com/track/${id}`, title: String(track.title), author,
      duration: Number.isFinite(track.duration) ? track.duration / 1000 : null, query: `${track.title} ${author}`.trim() }];
  });
  return { title: entity.title || entity.name || 'Playlist do Spotify', tracks };
}

export async function loadPlaylist(input, { offset = 0, limit = 50 } = {}) {
  let source = parseInput(input);
  if (source.playlistUrl) source = parseInput(source.playlistUrl);
  if (!source.kind.endsWith('-playlist')) throw new Error('Cole o link de uma playlist do YouTube ou Spotify.');
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Carregue de 1 a 50 faixas por página.');
  let title, tracks, more;
  if (source.kind === 'youtube-playlist') {
    const data = JSON.parse(await ytdlp(['--flat-playlist', '--ignore-errors', '--dump-single-json',
      '--playlist-start', String(offset + 1), '--playlist-end', String(offset + limit + 1), '--', source.url], 60000));
    const entries = data.entries || [];
    tracks = entries.slice(0, limit).map((entry, index) => {
      const track = youtubeTrack(entry);
      return track ? { ...track, id: `yt-${offset + index}-${track.id}` } : null;
    }).filter(Boolean);
    title = data.title || 'Playlist do YouTube';
    more = entries.length > limit;
  } else {
    const url = `https://open.spotify.com/embed/${source.type}/${source.id}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new Error(`O Spotify não abriu esta lista pública (HTTP ${response.status}).`);
    const reader = response.body.getReader();
    const parts = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) throw new Error('A lista pública do Spotify é grande demais para este teste.');
        parts.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    const list = spotifyPlaylistTracks(Buffer.concat(parts).toString('utf8'));
    title = list.title;
    tracks = list.tracks.slice(offset, offset + limit);
    more = list.tracks.length > offset + limit;
  }
  if (!tracks.length) throw new Error('Nenhuma faixa pública foi encontrada nesta página. A lista pode estar vazia, privada ou indisponível.');
  source.title = title;
  return { source, query: '', candidates: [], playlist: { title, tracks, offset, nextOffset: more ? offset + limit : null, publicOnly: source.kind === 'spotify-playlist' },
    notice: source.kind === 'spotify-playlist'
      ? 'Faixas da lista pública do Spotify. O bot procura cada título e artista no YouTube ao tocar. O Spotify pode disponibilizar só parte de listas grandes.'
      : 'Selecione as faixas para adicionar à fila. Vídeos privados ou apagados são ignorados.' };
}

// Resolve a fonte sem baixar/converter a faixa inteira antes da reprodução.
export async function prepareStream(input, directory, signal, track = {}) {
  if (signal?.aborted) throw new Error('Preparação cancelada.');
  const source = parseInput(input);
  if (!['youtube', 'spotify'].includes(source.kind)) throw new Error('Escolha uma faixa da busca ou da playlist.');
  let query = '';
  if (source.kind === 'spotify') query = track.query || `${track.title || (await metadata(source.url, 'spotify')).title} ${track.author || ''}`.trim();
  const key = `${source.url}|${query}`;
  const cached = streamCache.get(key);
  const withFile = async prepared => {
    const infoFile = path.join(directory, 'fonte.json');
    await writeFile(infoFile, prepared.infoJSON, { mode: 0o600 });
    const { infoJSON, ...result } = prepared;
    return { ...result, infoFile };
  };
  if (cached && cached.expires > Date.now()) return withFile(cached.input);
  let lookup = streamLookups.get(key);
  if (!lookup) {
    lookup = { abort: new AbortController(), users: 0 };
    const current = lookup;
    lookup.job = (async () => {
      const data = JSON.parse(await ytdlp(['--no-playlist', '--skip-download', '--dump-single-json',
        '-f', 'bestaudio[acodec=opus]/bestaudio/best', '--', query ? `ytsearch1:${query}` : source.url], 45000, lookup.abort.signal));
      const entry = data.entries ? data.entries.find(item => item?.url) : data;
      if (!entry || entry.is_live || !Number.isFinite(entry.duration) || entry.duration > 1200) throw new Error('Use uma faixa gravada de até 20 minutos.');
      if (entry.filesize > 80 * 1024 * 1024) throw new Error('O áudio da faixa ultrapassa 80 MB.');
      const url = new URL(entry.url);
      if (url.protocol !== 'https:' || !(url.hostname === 'googlevideo.com' || url.hostname.endsWith('.googlevideo.com'))) throw new Error('O YouTube não retornou uma fonte de áudio compatível.');
      const prepared = { url: entry.url, headers: entry.http_headers || {}, title: entry.title, duration: entry.duration,
        infoJSON: JSON.stringify(entry), availableAt: entry.available_at,
        sourceUrl: videoId.test(entry.id || '') ? `https://www.youtube.com/watch?v=${entry.id}` : source.url };
      streamCache.delete(key);
      streamCache.set(key, { input: prepared, expires: Date.now() + 5 * 60 * 1000 });
      while (streamCache.size > 64) streamCache.delete(streamCache.keys().next().value);
      return prepared;
    })().finally(() => { if (streamLookups.get(key) === current) streamLookups.delete(key); });
    streamLookups.set(key, lookup);
  }
  lookup.users++;
  let abort;
  try {
    const prepared = await new Promise((accept, reject) => {
      abort = () => reject(new Error('Preparação cancelada.'));
      signal?.addEventListener('abort', abort, { once: true });
      lookup.job.then(accept, reject);
      if (signal?.aborted) abort();
    });
    return await withFile(prepared);
  } finally {
    signal?.removeEventListener('abort', abort);
    if (--lookup.users === 0) {
      lookup.abort.abort();
      if (streamLookups.get(key) === lookup) streamLookups.delete(key);
    }
  }
}

export async function warmStream(track, signal) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teletela-musica-busca-'));
  try { await prepareStream(track.url, directory, signal, track); }
  finally { await rm(directory, { recursive: true, force: true, maxRetries: 3 }); }
}

// Apenas a próxima faixa é baixada em segundo plano, no formato original, sem MP3 intermediário.
export async function bufferStream(prepared, directory, signal) {
  await ytdlp(['--load-info-json', prepared.infoFile, '--no-playlist', '--no-part', '--max-filesize', '80M',
    '-f', 'bestaudio[acodec=opus]/bestaudio/best', '-o', path.join(directory, 'proxima.%(ext)s')], 120000, signal);
  const names = await readdir(directory);
  const name = names.find(item => /^proxima\.(?:webm|m4a|opus|ogg|mp3|mp4)$/.test(item));
  if (!name) throw new Error('Não foi possível pré-carregar a próxima faixa.');
  const file = path.join(directory, name);
  if (!(await stat(file)).size) throw new Error('O pré-carregamento retornou um arquivo vazio.');
  return file;
}
