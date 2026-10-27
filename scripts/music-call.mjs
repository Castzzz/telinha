import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createSocket } from 'node:dgram';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort(udp = false) {
  const server = udp ? createSocket('udp4') : createServer();
  await new Promise(resolve => udp ? server.bind(0, '127.0.0.1', resolve) : server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

export async function startMusicCall({ port = 3999, sfu = false } = {}) {
  await access(path.join(root, '.cache/music-lab/music-publisher')).catch(() => { throw new Error('Rode npm run music:build antes de iniciar a call de teste.'); });
  const data = await mkdtemp(path.join(os.tmpdir(), 'teletela-musica-sala-'));
  let worker = null;
  let backend = null;
  let closing = null;
  const close = () => closing ||= (async () => {
    if (backend) {
      await backend.music?.close();
      await new Promise(resolve => backend.io.close(resolve));
    }
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      const done = once(worker, 'close');
      worker.kill('SIGTERM');
      await done;
    }
    await rm(data, { recursive: true, force: true, maxRetries: 3 });
  })();
  try {
    // Dados, portas e senha só desta instância; a sala oficial não é consultada.
    process.env.TELINHA_MUSIC = '1';
    process.env.TELINHA_DATA_DIR = data;
    process.env.OWNER_KEY = randomBytes(24).toString('hex');
    process.env.ADMIN_KEY = '';
    process.env.MUSIC_ICE_SERVERS ||= '[]';
    process.env.SFU_SECRET = '';
    if (sfu) {
      const sfuPort = await freePort();
      const secret = randomBytes(32).toString('hex');
      worker = spawn(path.join(root, '.cache/music-lab/music-sfu'), [], { stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, PORT: String(sfuPort), MEDIA_PORT: String(await freePort(true)), SFU_HOST: '127.0.0.1', SFU_SECRET: secret, ICE_SERVERS: '[]', PUBLIC_IP: '' } });
      let failure = '';
      worker.on('error', error => { failure = error.message; });
      worker.stderr.on('data', chunk => { failure = (failure + chunk).slice(-1500); });
      const base = `http://127.0.0.1:${sfuPort}`;
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (worker.exitCode !== null) throw new Error(failure || 'Não foi possível iniciar o SFU de teste.');
        try { if ((await fetch(base + '/health', { signal: AbortSignal.timeout(300) })).ok) { ready = true; break; } } catch {}
        await pause(30);
      }
      if (!ready) throw new Error(failure || 'O SFU de teste demorou demais para iniciar.');
      process.env.SFU_SECRET = secret;
      process.env.SFU_INTERNAL_URL = base;
      process.env.SFU_PATH = base.replace(/^http/, 'ws') + '/ws';
    }
    backend = await import('../server.js');
    await backend.startServer(port, '127.0.0.1');
    return { backend, url: `http://127.0.0.1:${backend.server.address().port}`, close };
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const call = await startMusicCall({ port: Number(process.env.MUSIC_CALL_PORT || 3999), sfu: process.argv.includes('--sfu') });
    console.log(`Música nas calls de teste: ${call.url}`);
    console.log('Entre em um canal e abra o botão de fone de ouvido. Ctrl+C encerra e apaga os dados de teste.');
    const close = async () => { await call.close(); };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
