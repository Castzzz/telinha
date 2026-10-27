import express from 'express';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MusicBroadcast } from './broadcast.mjs';
import { checkTools, parseInput, prepareMusic, resolveMusic } from './resolver.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));

export async function startMusicLab({ port = 3998, resolve = resolveMusic, prepare = prepareMusic, check = checkTools } = {}) {
  const app = express();
  const server = http.createServer(app);
  const broadcast = new MusicBroadcast();
  const events = new Set();
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'teletela-music-lab-'));
  let pending = null;
  let pendingDone = Promise.resolve();
  let resolving = false;
  let closing = false;

  app.disable('x-powered-by');
  app.use((request, response, next) => {
    const hosts = [`127.0.0.1:${server.address()?.port}`, `localhost:${server.address()?.port}`];
    if (!hosts.includes(request.get('host')) || (request.get('origin') && !hosts.map(host => `http://${host}`).includes(request.get('origin')))) {
      return response.status(403).json({ error: 'O laboratório só aceita acesso local pela própria página.' });
    }
    response.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'" });
    next();
  });
  app.use(express.json({ limit: '4kb' }));
  for (const [route, name] of [['/', 'index.html'], ['/app.js', 'app.js'], ['/style.css', 'style.css']]) {
    app.get(route, (_request, response) => response.sendFile(path.join(directory, name)));
  }
  app.get('/api/health', async (_request, response) => {
    try { response.json({ tools: await check(), mode: 'local', transport: 'transmissão MP3 central' }); }
    catch (error) { response.status(500).json({ error: error.message }); }
  });
  app.get('/api/events', (request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
    response.write(`data: ${JSON.stringify(broadcast.state)}\n\n`);
    events.add(response);
    const timer = setInterval(() => response.write(': conectado\n\n'), 15000);
    request.once('close', () => { clearInterval(timer); events.delete(response); });
  });
  broadcast.on('state', state => {
    for (const response of events) response.write(`data: ${JSON.stringify(state)}\n\n`);
  });
  app.get('/api/live', (request, response) => broadcast.listen(response, request.query.generation));
  app.post('/api/resolve', async (request, response) => {
    if (resolving) return response.status(409).json({ error: 'Há uma busca em andamento. Aguarde terminar.' });
    resolving = true;
    try { response.json(await resolve(request.body?.input, request.body?.refinement)); }
    catch (error) { response.status(400).json({ error: error.message }); }
    finally { resolving = false; }
  });
  app.post('/api/play', async (request, response) => {
    if (pending) return response.status(409).json({ error: 'Uma faixa já está sendo preparada. Aguarde ou clique em Parar para todos.' });
    let job;
    let folder;
    let finishJob;
    try {
      const source = parseInput(request.body?.url);
      if (source.kind !== 'youtube') throw new Error('Escolha uma versão do YouTube na lista.');
      const track = { url: source.url, title: String(request.body?.title || 'Faixa de teste').slice(0, 300) };
      job = new AbortController();
      pending = job;
      pendingDone = new Promise(accept => { finishJob = accept; });
      broadcast.stop();
      broadcast.update({ phase: 'preparing', track });
      folder = await mkdtemp(path.join(temporary, 'faixa-'));
      const file = await prepare(source.url, folder, job.signal);
      if (job.signal.aborted || closing) throw new Error('Preparação cancelada.');
      broadcast.play(file, track);
      broadcast.child.once('close', () => {
        rm(folder, { recursive: true, force: true, maxRetries: 3 }).catch(error => console.error('Não foi possível limpar o áudio temporário:', error.message));
      });
      response.json({ ok: true, state: broadcast.state });
    } catch (error) {
      if (job && pending === job && !job.signal.aborted) broadcast.update({ phase: 'error', error: error.message });
      response.status(400).json({ error: error.message });
    } finally {
      if (pending === job) pending = null;
      // Na reprodução normal, o fechamento do FFmpeg limpa a faixa.
      if (folder && (job?.signal.aborted || broadcast.state.phase !== 'playing')) await rm(folder, { recursive: true, force: true }).catch(() => {});
      finishJob?.();
    }
  });
  app.post('/api/stop', (_request, response) => {
    pending?.abort();
    broadcast.stop();
    response.json({ ok: true });
  });
  app.use((error, _request, response, _next) => response.status(400).json({ error: error.type === 'entity.too.large'
    ? 'A solicitação é grande demais.' : 'Solicitação inválida.' }));

  try {
    await new Promise((accept, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', accept);
    });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return { server, broadcast, url: `http://127.0.0.1:${server.address().port}`, async close() {
    closing = true;
    pending?.abort();
    await pendingDone;
    broadcast.stop();
    for (const response of events) response.end();
    events.clear();
    await new Promise(accept => { server.close(accept); server.closeAllConnections(); });
    await rm(temporary, { recursive: true, force: true, maxRetries: 3 });
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const port = Number(process.env.MUSIC_LAB_PORT || 3998);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MUSIC_LAB_PORT deve ser uma porta entre 1 e 65535.');
    const lab = await startMusicLab({ port });
    console.log(`Laboratório de música: ${lab.url}`);
    console.log('Abra esse endereço em duas janelas para ouvir a mesma transmissão. Ctrl+C encerra e limpa os áudios temporários.');
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await lab.close();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
