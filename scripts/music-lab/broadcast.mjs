import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

// Uma única leitura no ritmo da música; ouvintes recebem os mesmos blocos.
export class MusicBroadcast extends EventEmitter {
  constructor() {
    super();
    this.listeners = new Set();
    this.state = { phase: 'idle', generation: null, track: null, startedAt: null, listeners: 0 };
  }

  update(values) {
    Object.assign(this.state, values, { listeners: this.listeners.size });
    this.emit('state', { ...this.state });
  }

  stop() {
    const child = this.child;
    this.child = null;
    // Não matar processo antigo depois de já iniciar a próxima faixa.
    if (child) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 2000);
      timer.unref();
      child.once('close', () => clearTimeout(timer));
    }
    for (const response of this.listeners) response.end();
    this.listeners.clear();
    this.update({ phase: 'idle', generation: null, track: null, startedAt: null, error: null });
  }

  play(file, track) {
    this.stop();
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-re', '-i', file,
      '-vn', '-c:a', 'copy', '-f', 'mp3', '-flush_packets', '1', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    let detail = '';
    child.stderr.on('data', chunk => { detail = (detail + chunk.toString()).slice(-1500); });
    child.stdout.on('data', chunk => {
      if (this.child !== child) return;
      for (const response of this.listeners) {
        // Um ouvinte lento não deve acumular a música inteira nem atrasar os outros.
        if (response.writableLength > 256 * 1024) response.destroy();
        else response.write(chunk);
      }
    });
    child.once('error', error => {
      if (this.child !== child) return;
      this.stop();
      this.update({ phase: 'error', error: `Não foi possível iniciar o FFmpeg: ${error.message}` });
    });
    child.once('close', code => {
      if (this.child !== child) return;
      this.child = null;
      for (const response of this.listeners) response.end();
      this.listeners.clear();
      this.update({ phase: code === 0 ? 'ended' : 'error', generation: null,
        error: code === 0 ? null : detail || 'O FFmpeg interrompeu a transmissão.' });
    });
    this.update({ phase: 'playing', generation: randomUUID(), track, startedAt: Date.now(), error: null });
  }

  listen(response, generation) {
    if (this.state.phase !== 'playing' || generation !== this.state.generation) {
      response.status(409).json({ error: 'Esta transmissão já terminou. Ative a escuta da faixa atual.' });
      return;
    }
    response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.flushHeaders();
    this.listeners.add(response);
    this.update({});
    response.once('close', () => {
      this.listeners.delete(response);
      this.update({});
    });
  }
}
