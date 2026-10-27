import { EventEmitter } from 'node:events';
import { randomUUID, randomInt } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareStream, parseInput, bufferStream, warmStream } from './source.mjs';
import { MusicTransport } from './transport.mjs';

export class MusicManager extends EventEmitter {
  constructor({ prepare = prepareStream, buffer = bufferStream, createTransport = () => new MusicTransport(), mode = 'direct', prefetch = true } = {}) {
    super();
    Object.assign(this, { prepare, buffer, createTransport, mode, prefetchEnabled: prefetch, sessions: new Map(), cleanup: new Set(), warmups: new Set(), closed: false });
  }

  session(channelId) {
    if (!this.sessions.has(channelId)) this.sessions.set(channelId, { channelId, phase: 'idle', queue: [], track: null, generation: null, error: null, repeat: 'off', prefetch: null });
    return this.sessions.get(channelId);
  }

  state(channelId) {
    const session = this.session(channelId);
    return { channelId, phase: session.phase, track: session.track, generation: session.generation,
      queue: session.queue.map(track => ({ ...track })), error: session.error,
      position: session.transport?.position() || 0, mode: this.mode, repeat: session.repeat };
  }

  publish(session) { this.emit('state', this.state(session.channelId)); }

  enqueue(channelId, track, requester) {
    return this.enqueueMany(channelId, [track], requester);
  }

  enqueueMany(channelId, tracks, requester, { shuffle = false } = {}) {
    if (this.closed) throw new Error('O bot está encerrando.');
    const session = this.session(channelId);
    if (!Array.isArray(tracks) || !tracks.length || tracks.length > 50) throw new Error('Selecione de 1 a 50 músicas.');
    if (session.queue.length + tracks.length > 50) throw new Error(`A fila tem espaço para ${Math.max(0, 50 - session.queue.length)} músicas. Selecione menos faixas.`);
    if ([...this.sessions.values()].filter(item => item.operation).length >= 4 && !session.operation) throw new Error('O teste permite música em até quatro canais ao mesmo tempo.');
    const additions = tracks.map(track => {
      const source = parseInput(track.url);
      if (!['youtube', 'spotify'].includes(source.kind)) throw new Error('Escolha uma faixa da busca ou da playlist.');
      return { id: randomUUID(), url: source.url, title: String(track.title).slice(0, 300),
        query: typeof track.query === 'string' ? track.query.slice(0, 500) : undefined,
        author: String(track.author || '').slice(0, 120), duration: Number.isFinite(track.duration) ? track.duration : null,
        requestedBy: { id: requester.id, name: requester.name } };
    });
    if (shuffle) this.mix(additions);
    session.queue.push(...additions);
    session.error = null;
    this.publish(session);
    this.advance(session);
    this.prefetch(session);
    return this.state(channelId);
  }

  advance(session) {
    if (session.operation || session.draining || !session.queue.length || this.closed) return;
    if ([...this.sessions.values()].filter(item => item.operation).length >= 4) return;
    const operation = { abort: new AbortController(), transport: null, folder: null };
    session.operation = operation;
    Object.assign(session, { phase: 'preparing', track: session.queue.shift(), generation: randomUUID(), error: null });
    this.publish(session);
    const track = session.track;
    const prefetched = session.prefetch?.id === track.id ? session.prefetch : null;
    if (prefetched) session.prefetch = null;
    else this.cancelPrefetch(session);
    operation.job = (async () => {
      try {
        let file;
        if (prefetched) {
          const abort = () => prefetched.abort.abort();
          operation.abort.signal.addEventListener('abort', abort, { once: true });
          await prefetched.prepared.catch(() => {});
          // Pular não deve esperar terminar um download de pré-carregamento.
          if (!prefetched.buffered && prefetched.stream) prefetched.abort.abort();
          await prefetched.job;
          operation.abort.signal.removeEventListener('abort', abort);
          operation.folder = prefetched.folder;
          file = prefetched.buffered ? prefetched.result : prefetched.stream;
        } else operation.folder = await mkdtemp(path.join(os.tmpdir(), 'teletela-musica-call-'));
        if (operation.abort.signal.aborted) return;
        if (!file) file = await this.prepare(track.url, operation.folder, operation.abort.signal, track);
        if (session.operation !== operation || operation.abort.signal.aborted) return;
        if (typeof file === 'object' && file.availableAt) {
          session.track.availableAt = file.availableAt;
          this.publish(session);
        }
        const transport = this.createTransport(session.channelId);
        operation.transport = session.transport = transport;
        transport.on('offer', offer => {
          if (session.operation === operation) this.emit('offer', { ...offer, channelId: session.channelId, generation: session.generation });
        });
        transport.once('ended', () => this.finish(session, operation, null, true));
        transport.once('failed', error => this.finish(session, operation, error));
        await transport.start(file);
        if (session.operation !== operation || operation.abort.signal.aborted) return;
        session.phase = 'playing';
        const metadata = typeof file === 'object' ? file : prefetched?.stream;
        if (metadata && typeof metadata === 'object') Object.assign(session.track, { resolvedTitle: metadata.title, resolvedUrl: metadata.sourceUrl });
        this.publish(session);
        this.prefetch(session);
      } catch (error) {
        if (session.operation === operation && !operation.abort.signal.aborted) this.finish(session, operation, error);
      }
    })();
  }

  prefetch(session) {
    if (!this.prefetchEnabled || this.closed || !['playing', 'paused'].includes(session.phase)) return;
    const next = session.queue[0];
    if (session.prefetch?.id === next?.id) return;
    this.cancelPrefetch(session);
    if (!next) return;
    const item = { id: next.id, abort: new AbortController(), folder: null };
    session.prefetch = item;
    item.prepared = (async () => {
      item.folder = await mkdtemp(path.join(os.tmpdir(), 'teletela-musica-proxima-'));
      if (item.abort.signal.aborted) return;
      item.stream = await this.prepare(next.url, item.folder, item.abort.signal, next);
      return item.stream;
    })();
    item.job = (async () => {
      item.result = await item.prepared;
      if (item.result?.infoFile && !item.abort.signal.aborted) {
        item.result = await this.buffer(item.result, item.folder, item.abort.signal);
      }
      item.buffered = true;
    })().catch(error => { item.error = error; });
  }

  warm(track) {
    if (this.prepare !== prepareStream || this.closed) return null;
    const controller = new AbortController();
    this.warmups.add(controller);
    const job = warmStream(track, controller.signal).catch(() => {}).finally(() => this.warmups.delete(controller));
    this.cleanup.add(job);
    job.finally(() => this.cleanup.delete(job));
    return controller;
  }

  cancelPrefetch(session) {
    const item = session.prefetch;
    session.prefetch = null;
    if (!item) return;
    item.abort.abort();
    const cleanup = item.job.then(async () => { if (item.folder) await rm(item.folder, { recursive: true, force: true, maxRetries: 3 }); })
      .catch(error => console.error('[Música] Não consegui limpar o pré-carregamento:', error.message));
    this.cleanup.add(cleanup);
    cleanup.finally(() => this.cleanup.delete(cleanup));
  }

  mix(tracks) {
    for (let index = tracks.length - 1; index > 0; index--) {
      const other = randomInt(index + 1);
      [tracks[index], tracks[other]] = [tracks[other], tracks[index]];
    }
  }

  shuffle(channelId) {
    const session = this.session(channelId);
    this.mix(session.queue);
    this.prefetch(session);
    this.publish(session);
    return this.state(channelId);
  }

  repeat(channelId, mode) {
    if (!['off', 'one', 'all'].includes(mode)) throw new Error('Escolha repetir faixa, repetir fila ou desligado.');
    const session = this.session(channelId);
    session.repeat = mode;
    this.publish(session);
    return this.state(channelId);
  }

  dispose(operation) {
    if (operation.disposal) return operation.disposal;
    operation.disposal = (async () => {
      await operation.transport?.close();
      await operation.job;
      if (operation.folder) await rm(operation.folder, { recursive: true, force: true, maxRetries: 3 });
    })().catch(error => console.error('[Música] Não consegui limpar a faixa:', error.message));
    this.cleanup.add(operation.disposal);
    operation.disposal.finally(() => this.cleanup.delete(operation.disposal));
    return operation.disposal;
  }

  finish(session, operation, error = null, completed = false) {
    if (session.operation !== operation) return;
    if (completed && session.track && session.repeat !== 'off') {
      const replay = { ...session.track, id: randomUUID() };
      if (session.repeat === 'one') session.queue.unshift(replay);
      else session.queue.push(replay);
    }
    operation.abort.abort();
    session.operation = null;
    Object.assign(session, { transport: null, phase: error ? 'error' : 'idle', track: null, generation: null,
      error: error ? `Não deu para tocar: ${error.message}` : session.error });
    this.publish(session);
    const draining = this.dispose(operation);
    session.draining = draining;
    draining.then(() => {
      if (session.draining === draining) session.draining = null;
      this.advance(session);
      for (const waiting of this.sessions.values()) this.advance(waiting);
    });
  }

  stop(channelId, { keepQueue = false } = {}) {
    const session = this.session(channelId);
    session.error = null;
    if (!keepQueue) { session.queue = []; this.cancelPrefetch(session); }
    const operation = session.operation;
    if (operation) this.finish(session, operation);
    else {
      Object.assign(session, { phase: 'idle', track: null, generation: null, error: null });
      this.publish(session);
      this.advance(session);
    }
    return this.state(channelId);
  }

  pause(channelId, paused) {
    const session = this.session(channelId);
    if (!['playing', 'paused'].includes(session.phase) || !session.transport) throw new Error('Não há música tocando para pausar.');
    session.transport.pause(paused);
    session.phase = paused ? 'paused' : 'playing';
    this.publish(session);
    return this.state(channelId);
  }

  remove(channelId, id) {
    const session = this.session(channelId);
    const index = session.queue.findIndex(track => track.id === id);
    if (index < 0) throw new Error('Essa faixa não está mais na fila.');
    session.queue.splice(index, 1);
    this.prefetch(session);
    this.publish(session);
    return this.state(channelId);
  }

  signal(channelId, generation, message) {
    const session = this.sessions.get(channelId);
    if (session?.generation !== generation || !['playing', 'paused'].includes(session.phase)) throw new Error('Essa reprodução já terminou.');
    session.transport?.signal(message);
  }

  unsubscribe(channelId, id) {
    this.sessions.get(channelId)?.transport?.signal({ type: 'unsubscribe', id });
  }

  async close() {
    this.closed = true;
    for (const controller of this.warmups) controller.abort();
    const jobs = [...this.sessions.values()].map(session => session.operation?.job).filter(Boolean);
    for (const session of this.sessions.values()) this.stop(session.channelId);
    await Promise.allSettled(jobs);
    await Promise.allSettled([...this.cleanup]);
    this.sessions.clear();
  }
}
