import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { startMusicDownload, formatToolError } from './source.mjs';

const binary = fileURLToPath(new URL('../.cache/music-lab/music-publisher', import.meta.url));

export class MusicTransport extends EventEmitter {
  constructor({ sfuUrl = '', iceServers = '[]' } = {}) {
    super();
    Object.assign(this, { sfuUrl, iceServers, closed: false, elapsed: 0, paused: false, children: [] });
  }

  async start(file) {
    const worker = spawn(process.env.MUSIC_PUBLISHER || binary, [], { stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, MUSIC_SFU_URL: this.sfuUrl, MUSIC_ICE_SERVERS: this.iceServers } });
    this.worker = worker;
    this.children.push(worker);
    worker.stdin.on('error', () => {});
    let detail = '';
    worker.stderr.on('data', chunk => { detail = (detail + chunk).slice(-1200); });
    const lines = createInterface({ input: worker.stdout });
    const port = await new Promise((accept, reject) => {
      let ready = false;
      const timer = setTimeout(() => reject(new Error('O bot não conseguiu conectar o áudio a tempo.')), 20000);
      timer.unref();
      const fail = error => {
        clearTimeout(timer);
        if (!ready) reject(error);
        else if (!this.closed) this.emit('failed', error);
      };
      worker.once('error', () => fail(new Error('A ponte WebRTC não iniciou. Rode npm run music:build.')));
      worker.once('close', code => { lines.close(); fail(new Error(detail || `A ponte WebRTC encerrou (${code}).`)); });
      lines.on('line', line => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (message.type === 'ready' && Number.isInteger(message.port) && !ready) {
          if (message.protocol !== 'opus-tcp') return fail(new Error('A ponte de áudio precisa ser atualizada. Rode npm run music:build.'));
          clearTimeout(timer); ready = true; accept(message.port);
        } else if (message.type === 'error') fail(new Error(message.error));
        else if (message.type === 'offer') this.emit('offer', message);
        else if (message.type === 'media-ended' && !this.closed) this.emit('ended');
        else if (message.type === 'progress') {
          this.elapsed = Number(message.position) || 0;
          this.startedAt = Date.now();
          this.buffering = Boolean(message.buffering);
          if (this.mediaReady) { this.mediaReady(); this.mediaReady = null; }
        }
      });
    });
    if (this.closed) throw new Error('Reprodução cancelada.');
    const streamed = typeof file === 'object' && Boolean(file.infoFile);
    const input = typeof file === 'string' ? file : streamed ? 'pipe:0' : file.url;
    const inputOptions = [];
    if (typeof file === 'object' && !streamed) {
      inputOptions.push('-rw_timeout', '15000000', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '2');
      const headers = Object.entries(file.headers || {}).filter(([name, value]) =>
        ['user-agent', 'referer', 'origin', 'accept-language'].includes(name.toLowerCase()) && typeof value === 'string' && !/[\r\n]/.test(value));
      if (headers.length) inputOptions.push('-headers', headers.map(([name, value]) => `${name}: ${value}\r\n`).join(''));
    }
    // A ponte controla o relógio; o encoder só produz dados conforme a conexão aceita.
    const ffmpeg = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...inputOptions,
      '-analyzeduration', '100000', '-probesize', '32768', '-i', input, '-t', '1200', '-vn', '-map_metadata', '-1', '-c:a', 'libopus', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-frame_duration', '20',
      '-f', 'opus', '-page_duration', '20000', '-flush_packets', '1', `tcp://127.0.0.1:${port}`], { stdio: [streamed ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    this.ffmpeg = ffmpeg;
    this.children.push(ffmpeg);
    let audioError = '';
    ffmpeg.stderr.on('data', chunk => { audioError = (audioError + chunk).replace(/https?:\/\/[^\s]+/g, '[endereço da fonte]').slice(-1200); });
    ffmpeg.once('error', () => { if (!this.closed) this.emit('failed', new Error('Não foi possível iniciar o FFmpeg.')); });
    ffmpeg.once('close', code => {
      if (this.closed) return;
      // O encoder pode terminar antes de a ponte tocar os dados já recebidos.
      if (code !== 0) this.emit('failed', new Error(audioError || 'O FFmpeg interrompeu a música.'));
    });
    if (streamed) {
      const download = startMusicDownload(file.infoFile);
      this.download = download;
      this.children.push(download);
      let downloadError = '';
      download.stderr.on('data', chunk => { downloadError = (downloadError + chunk).replace(/https?:\/\/[^\s]+/g, '[endereço da fonte]').slice(-1400); });
      ffmpeg.stdin.on('error', () => {});
      download.stdout.pipe(ffmpeg.stdin);
      download.once('error', () => { if (!this.closed) this.emit('failed', new Error('Não foi possível iniciar a leitura do áudio.')); });
      download.once('close', code => {
        if (code !== 0 && !this.closed) this.emit('failed', new Error(formatToolError(downloadError, 'O YouTube interrompeu a leitura do áudio.')));
      });
    }
    await new Promise((accept, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('A fonte demorou demais para entregar o áudio.')); }, 30000);
      const failed = error => { cleanup(); reject(error); };
      const ended = () => failed(new Error('A fonte não entregou áudio.'));
      const cleanup = () => { clearTimeout(timer); this.off('failed', failed); this.off('ended', ended); this.mediaReady = null; this.mediaReject = null; };
      this.on('failed', failed);
      this.on('ended', ended);
      this.mediaReject = failed;
      this.mediaReady = () => { cleanup(); accept(); };
    });
  }

  signal(message) {
    if (!this.closed && this.worker?.stdin.writable) this.worker.stdin.write(JSON.stringify(message) + '\n');
  }

  position() { return this.elapsed + (!this.paused && !this.buffering && this.startedAt ? Math.min(.5, (Date.now() - this.startedAt) / 1000) : 0); }

  pause(paused) {
    if (!this.worker || this.closed || paused === this.paused) return;
    this.signal({ type: 'pause', paused });
    this.elapsed = this.position();
    this.startedAt = Date.now();
    this.paused = paused;
  }

  async close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.mediaReject?.(new Error('Reprodução cancelada.'));
    this.closePromise = Promise.all(this.children.map(async child => {
      const running = child.exitCode === null && child.signalCode === null;
      const done = running ? once(child, 'exit').catch(() => {}) : Promise.resolve();
      if (running) child.kill('SIGTERM');
      // Um pipe pausado após EPIPE pode impedir "close" mesmo depois de o processo sair.
      child.stdout?.unpipe();
      for (const stream of child.stdio) stream?.destroy?.();
      const timer = running ? setTimeout(() => child.kill('SIGKILL'), 1500) : null;
      timer?.unref();
      await done;
      clearTimeout(timer);
    }));
    return this.closePromise;
  }
}
