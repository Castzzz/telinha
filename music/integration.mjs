import { createHmac } from 'node:crypto';
import { MusicManager } from './manager.mjs';
import { MusicTransport } from './transport.mjs';
import { resolveMusic } from './source.mjs';

export function installMusic({ io, channels, permissions, sfuSecret = '', sfuInternalUrl = 'http://127.0.0.1:8081',
  resolve = resolveMusic, prepare, createTransport } = {}) {
  const iceServers = process.env.MUSIC_ICE_SERVERS || '[{"urls":"stun:stun.l.google.com:19302"}]';
  const manager = new MusicManager({ prepare, mode: sfuSecret ? 'sfu' : 'direct', createTransport: createTransport || (channelId => {
    let sfuUrl = '';
    if (sfuSecret) {
      const sala = `${channelId}__musica`;
      const exp = String(Math.floor(Date.now() / 1000) + 60);
      const token = createHmac('sha256', sfuSecret).update(`${sala}|host|${exp}`).digest('hex');
      sfuUrl = `${sfuInternalUrl.replace(/^http/, 'ws')}/ws?${new URLSearchParams({ sala, role: 'host', exp, token })}`;
    }
    return new MusicTransport({ sfuUrl, iceServers });
  }) });
  manager.resolve = resolve;
  manager.on('state', state => io.to(state.channelId).emit('music-state', state));
  manager.on('offer', ({ id, channelId, generation, sdp }) => {
    const socket = io.sockets.sockets.get(id);
    if (socket?.data.user?.channelId === channelId && permissions.visible(socket.data.user, channels.get(channelId))) {
      socket.emit('music-offer', { channelId, generation, sdp });
    } else manager.unsubscribe(channelId, id);
  });

  const context = (socket, write = false) => {
    const user = socket.data.user;
    const channel = channels.get(user?.channelId);
    if (!channel || !channel.users.has(socket.id) || !permissions.visible(user, channel)) throw new Error('Entre no canal de voz para usar a música.');
    if (write && (!permissions.canWrite(user, channel) || user.serverMuted || user.serverDeafened)) throw new Error('Você não tem permissão para controlar a música neste canal.');
    return { user, channel };
  };
  io.on('connection', socket => {
    let searching = false;
    let lastSearch = 0;
    let choices = new Map();
    let choicesChannel = null;
    let playlist = null;
    let subscribed = null;
    let warm = null;
    const handle = (event, action, write = false) => socket.on(event, (raw, callback) => {
      const reply = typeof callback === 'function' ? callback : () => {};
      Promise.resolve().then(() => {
        const current = context(socket, write);
        const payload = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        return action(payload, current);
      }).then(result => reply({ success: true, ...result }), error => reply({ success: false, error: error.message }));
    });
    handle('music-get', (_payload, { channel }) => ({ state: manager.state(channel.id) }));
    handle('music-search', async (payload, { channel }) => {
      if (searching || Date.now() - lastSearch < 2000) throw new Error('Aguarde um instante antes de buscar outra música.');
      searching = true;
      lastSearch = Date.now();
      choices.clear();
      warm?.abort();
      playlist = null;
      try {
        const result = await manager.resolve(payload.input, payload.refinement, { offset: payload.offset ?? 0, limit: payload.limit ?? 50 });
        if (context(socket, true).channel.id !== channel.id) throw new Error('O canal mudou durante a busca. Busque novamente.');
        playlist = result.playlist || null;
        choices = new Map([...(result.candidates || []), ...(playlist?.tracks || [])].map(track => [track.id, track]));
        choicesChannel = channel.id;
        if (result.candidates?.[0]) warm = manager.warm(result.candidates[0]);
        return { result };
      } finally { searching = false; }
    }, true);
    handle('music-enqueue', (payload, { channel, user }) => {
      const track = choices.get(payload.id);
      if (!track || choicesChannel !== channel.id) throw new Error('Faça a busca neste canal e escolha uma versão da lista.');
      return { state: manager.enqueue(channel.id, track, user) };
    }, true);
    handle('music-control', (payload, { channel }) => {
      let state;
      if (payload.action === 'stop') state = manager.stop(channel.id);
      else if (payload.action === 'skip') state = manager.stop(channel.id, { keepQueue: true });
      else if (payload.action === 'pause' || payload.action === 'resume') state = manager.pause(channel.id, payload.action === 'pause');
      else if (payload.action === 'remove' && typeof payload.id === 'string') state = manager.remove(channel.id, payload.id);
      else if (payload.action === 'shuffle') state = manager.shuffle(channel.id);
      else if (payload.action === 'repeat') state = manager.repeat(channel.id, payload.mode);
      else throw new Error('Esse controle de música não existe.');
      return { state };
    }, true);
    handle('music-subscribe', (payload, { channel }) => {
      if (sfuSecret) throw new Error('Esta sala recebe a música pelo SFU.');
      manager.signal(channel.id, payload.generation, { type: 'subscribe', id: socket.id });
      subscribed = payload.generation;
      return {};
    });
    handle('music-enqueue-playlist', (payload, { channel, user }) => {
      if (!playlist || choicesChannel !== channel.id) throw new Error('Carregue a playlist neste canal antes de adicionar.');
      const ids = payload.ids;
      if (!Array.isArray(ids) || !ids.length || ids.length > 50 || new Set(ids).size !== ids.length) throw new Error('Selecione de 1 a 50 faixas da playlist.');
      const tracks = ids.map(id => choices.get(id));
      if (tracks.some(track => !track)) throw new Error('Uma faixa não está na página carregada. Carregue a playlist novamente.');
      return { state: manager.enqueueMany(channel.id, tracks, user, { shuffle: payload.shuffle === true }), added: tracks.length };
    }, true);
    handle('music-signal', (payload, { channel }) => {
      if (sfuSecret || subscribed !== payload.generation) throw new Error('Conexão de música indisponível.');
      if (payload.sdp?.type === 'answer' && typeof payload.sdp.sdp === 'string' && payload.sdp.sdp.length < 64000) {
        manager.signal(channel.id, payload.generation, { type: 'answer', id: socket.id, sdp: payload.sdp });
      } else if (payload.candidate && typeof payload.candidate.candidate === 'string' && payload.candidate.candidate.length < 2048) {
        manager.signal(channel.id, payload.generation, { type: 'candidate', id: socket.id, candidate: payload.candidate });
      } else throw new Error('Sinalização de música inválida.');
      return {};
    });
    socket.on('music-unsubscribe', () => {
      if (socket.data.user?.channelId) manager.unsubscribe(socket.data.user.channelId, socket.id);
      subscribed = null;
    });
    socket.on('disconnect', () => { choices.clear(); warm?.abort(); });
  });
  manager.leave = (channelId, id) => {
    manager.unsubscribe(channelId, id);
    if (!channels.get(channelId)?.users.size) manager.stop(channelId);
  };
  return manager;
}
