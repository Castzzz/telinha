import { enhanceOpusStereoSdp } from './audio-manager.js';

const MIXER_ID = 'teletela-music-bot';

export function setupMusic({ socket, appState, prefs, savePrefs, showToast, createSfuSession }) {
  const $ = selector => document.querySelector(selector);
  let channelId = null;
  let state = null;
  let session = null;
  let peer = null;
  let generation = null;
  let revision = 0;
  let channelRevision = 0;
  let searchBusy = false;
  let playlist = null;
  let playlistInput = '';
  let playlistAdding = false;
  let retries = 0;
  let retryTimer = null;
  let volume = Number(prefs.musicVolume ?? 50);
  volume = Number.isFinite(volume) ? Math.max(0, Math.min(200, volume)) : 50;
  let audio = null;

  const request = async (event, payload = {}, timeout = 8000) => {
    const result = await socket.timeout(timeout).emitWithAck(event, payload);
    if (!result?.success) throw new Error(result?.error || 'Não foi possível usar o bot de música.');
    return result;
  };
  const notify = (text, error = false) => {
    $('#music-search-status').textContent = text;
    $('#music-search-status').classList.toggle('music-error', error);
  };
  const closeAudio = () => {
    clearTimeout(retryTimer);
    retryTimer = null;
    session?.close();
    session = null;
    peer?.close();
    peer = null;
    appState.mixerManager?.detachUserStream(MIXER_ID);
    if (audio) { audio.srcObject = null; audio.remove(); audio = null; }
    generation = null;
  };
  const attach = stream => {
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = 'music-remote-audio';
      audio.autoplay = true;
      audio.muted = true;
      audio.className = 'visually-hidden';
      document.body.append(audio);
    }
    audio.srcObject = stream;
    audio.play().catch(() => {});
    appState.mixerManager.attachUserStream(MIXER_ID, stream, 'Bot de música');
    appState.mixerManager.setUserVolume(MIXER_ID, volume);
  };
  const subscribe = () => {
    const active = state && ['playing', 'paused'].includes(state.phase);
    if (!active || !socket.connected) { closeAudio(); return; }
    if (generation === state.generation) return;
    closeAudio();
    generation = state.generation;
    const expected = generation;
    if (state.mode === 'sfu') {
      const listener = createSfuSession({ ownerId: MIXER_ID, role: 'viewer', kind: 'music', onStream: stream => {
        if (generation === expected) attach(stream);
      }, onClose: () => { if (session === listener) { session = null; generation = null; } } });
      session = listener;
      session.start();
    } else request('music-subscribe', { generation }).catch(error => {
      if (generation === expected) { closeAudio(); notify(error.message, true); }
    });
  };
  const open = () => {
    if (!appState.musicEnabled || !appState.currentChannelId) return;
    $('#mobile-call-options')?.close();
    $('#modal-music').classList.remove('hidden');
    appState.mixerManager?.ensureAudioContext();
    subscribe();
    $('#music-input').focus();
    render();
  };
  const action = async (name, id, mode) => {
    try { await request('music-control', { action: name, id, mode }); }
    catch (error) { notify(error.message, true); }
  };
  const renderBot = () => {
    document.querySelectorAll('[data-music-bot]').forEach(element => element.remove());
    if (!channelId || !state?.track) return;
    const title = `Música · ${state.track.title}${state.phase === 'paused' ? ' (pausada)' : ''}`;
    const row = document.createElement('li');
    row.dataset.musicBot = 'true';
    row.className = 'music-bot-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = title;
    button.title = 'Abrir o bot de música';
    button.addEventListener('click', open);
    row.append(button);
    document.getElementById(`channel-users-${channelId}`)?.append(row);
    const card = document.createElement('button');
    card.type = 'button';
    card.dataset.musicBot = 'true';
    card.className = 'lounge-user-card music-bot-card';
    const name = document.createElement('strong');
    name.textContent = 'Bot de música';
    const description = document.createElement('span');
    description.textContent = state.track.title;
    card.append(name, description);
    card.addEventListener('click', open);
    $('#lounge-users-grid')?.append(card);
  };
  const render = () => {
    $('#music-now').textContent = state?.track?.title || 'Nenhuma música tocando';
    const phases = { idle: 'Adicione uma música para começar.', preparing: 'Preparando a próxima faixa…', playing: 'Tocando para o canal', paused: 'Música pausada para todos', error: 'A faixa não pôde tocar.' };
    const waitingForSource = state?.phase === 'preparing' && state?.track?.availableAt * 1000 > Date.now();
    $('#music-phase').textContent = state?.error || (waitingForSource ? 'Aguardando a liberação da faixa no YouTube…' : phases[state?.phase || 'idle']);
    $('#music-phase').classList.toggle('music-error', Boolean(state?.error));
    const canWrite = appState.channels.get(channelId)?.canWrite !== false && !appState.myUser.serverMuted && !appState.myUser.serverDeafened;
    $('#music-search-button').disabled = !canWrite || searchBusy;
    $('#music-pause').disabled = !canWrite || !['playing', 'paused'].includes(state?.phase);
    $('#music-pause').textContent = state?.phase === 'paused' ? 'Continuar' : 'Pausar';
    $('#music-skip').disabled = !canWrite || !state?.track;
    $('#music-stop').disabled = !canWrite || (!state?.track && !state?.queue?.length);
    $('#music-repeat').disabled = !canWrite;
    $('#music-repeat').value = state?.repeat || 'off';
    $('#music-shuffle').disabled = !canWrite || (state?.queue?.length || 0) < 2;
    updateSelection();
    $('#music-queue-title').textContent = `Próximas músicas (${state?.queue?.length || 0})`;
    $('#music-queue').replaceChildren();
    for (const track of state?.queue || []) {
      const row = document.createElement('li');
      const text = document.createElement('span');
      text.textContent = `${track.title} · pedido por ${track.requestedBy.name}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn-secondary';
      remove.textContent = 'Remover';
      remove.disabled = !canWrite;
      remove.addEventListener('click', () => action('remove', track.id));
      row.append(text, remove);
      $('#music-queue').append(row);
    }
    renderBot();
  };
  const receive = next => {
    if (!channelId || next.channelId !== channelId) return;
    if (next.error && next.error !== state?.error) showToast(next.error, 'error');
    revision++;
    state = next;
    subscribe();
    render();
  };
  const syncChannel = (refresh = false) => {
    const next = appState.musicEnabled && socket.connected ? appState.currentChannelId : null;
    for (const id of ['btn-music', 'btn-mobile-music']) document.getElementById(id)?.classList.toggle('hidden', !next);
    if (next === channelId && !refresh) { renderBot(); return; }
    revision++;
    channelRevision++;
    searchBusy = false;
    playlist = null;
    retries = 0;
    closeAudio();
    channelId = next;
    state = null;
    $('#modal-music').classList.add('hidden');
    $('#music-results').replaceChildren();
    $('#music-playlist-tools').classList.add('hidden');
    notify('Cole uma música ou playlist do YouTube/Spotify, ou escreva título e artista.');
    render();
    if (next) {
      const expectedRevision = revision;
      request('music-get').then(result => { if (revision === expectedRevision) receive(result.state); }).catch(() => {});
    }
  };
  socket.on('music-state', receive);
  socket.on('channel-state', () => syncChannel(true));
  socket.on('disconnect', () => { syncChannel(); });
  socket.on('music-offer', async message => {
    if (message.channelId !== channelId || message.generation !== generation) return;
    const expected = generation;
    const pc = new RTCPeerConnection({ iceServers: [] });
    peer?.close();
    peer = pc;
    pc.onconnectionstatechange = () => {
      if (peer !== pc) return;
      if (pc.connectionState === 'connected') retries = 0;
      if (pc.connectionState === 'failed') {
        closeAudio();
        if (++retries <= 5) retryTimer = setTimeout(subscribe, 1500);
        else notify('A música perdeu a conexão. Abra este painel para tentar novamente.', true);
      }
    };
    pc.ontrack = event => {
      if (peer === pc && generation === expected) attach(event.streams[0] || new MediaStream([event.track]));
    };
    pc.onicecandidate = event => {
      if (event.candidate && peer === pc) request('music-signal', { generation: expected, candidate: event.candidate.toJSON() }).catch(() => {});
    };
    try {
      await pc.setRemoteDescription(message.sdp);
      const answer = await pc.createAnswer();
      answer.sdp = enhanceOpusStereoSdp(answer.sdp, 160000);
      await pc.setLocalDescription(answer);
      if (generation !== expected || peer !== pc) return pc.close();
      await request('music-signal', { generation: expected, sdp: pc.localDescription });
    } catch (error) { if (peer === pc) { closeAudio(); notify(`Não consegui ouvir a música: ${error.message}`, true); } }
  });

  $('#btn-music').addEventListener('click', open);
  $('#btn-mobile-music').addEventListener('click', open);
  $('#music-pause').addEventListener('click', () => action(state?.phase === 'paused' ? 'resume' : 'pause'));
  $('#music-skip').addEventListener('click', () => action('skip'));
  $('#music-stop').addEventListener('click', () => action('stop'));
  $('#music-shuffle').addEventListener('click', () => action('shuffle'));
  $('#music-repeat').addEventListener('change', event => action('repeat', undefined, event.target.value));
  $('#music-volume').value = volume;
  $('#music-volume-value').textContent = `${volume}%`;
  $('#music-volume').addEventListener('input', event => {
    volume = Number(event.target.value);
    appState.mixerManager?.setUserVolume(MIXER_ID, volume);
    $('#music-volume-value').textContent = `${volume}%`;
  });
  $('#music-volume').addEventListener('change', () => savePrefs({ musicVolume: volume }));
  function updateSelection() {
    const selected = document.querySelectorAll('#music-results [data-music-track]:checked').length;
    const total = document.querySelectorAll('#music-results [data-music-track]').length;
    $('#music-add-playlist').textContent = `Adicionar selecionadas (${selected})`;
    $('#music-add-playlist').disabled = !selected || playlistAdding || appState.channels.get(channelId)?.canWrite === false || appState.myUser.serverMuted || appState.myUser.serverDeafened;
    $('#music-select-all').checked = selected > 0 && selected === total;
    $('#music-select-all').indeterminate = selected > 0 && selected < total;
  }
  $('#music-select-all').addEventListener('change', event => {
    document.querySelectorAll('#music-results [data-music-track]').forEach(input => { input.checked = event.target.checked; });
    updateSelection();
  });
  $('#music-add-playlist').addEventListener('click', async () => {
    const ids = [...document.querySelectorAll('#music-results [data-music-track]:checked')].map(input => input.value);
    playlistAdding = true;
    updateSelection();
    try {
      const result = await request('music-enqueue-playlist', { ids, shuffle: $('#music-playlist-shuffle').checked });
      showToast(`${result.added} músicas adicionadas à fila.`);
    } catch (error) { notify(error.message, true); }
    finally { playlistAdding = false; updateSelection(); }
  });
  $('#music-next-page').addEventListener('click', () => { if (playlist?.nextOffset != null) searchMusic(playlist.nextOffset, playlistInput); });
  async function searchMusic(offset = 0, override = '') {
    const expectedChannel = channelId;
    const expectedRevision = channelRevision;
    searchBusy = true;
    $('#music-search-button').disabled = true;
    $('#music-results').replaceChildren();
    $('#music-playlist-tools').classList.add('hidden');
    playlist = null;
    const input = override || $('#music-input').value;
    notify('Procurando músicas…');
    try {
      const { result } = await request('music-search', { input, refinement: $('#music-refinement').value, offset }, 65000);
      if (channelId !== expectedChannel || channelRevision !== expectedRevision) return;
      notify(`${result.source.title}. ${result.notice}${result.searchError ? ` ${result.searchError}` : ''}`, Boolean(result.searchError));
      playlist = result.playlist || null;
      if (playlist) {
        playlistInput = result.source.url;
        $('#music-playlist-tools').classList.remove('hidden');
        $('#music-playlist-name').textContent = `${playlist.title} · ${playlist.tracks.length} faixas nesta página`;
        $('#music-next-page').classList.toggle('hidden', playlist.nextOffset == null);
      }
      for (const track of playlist?.tracks || result.candidates) {
        const row = document.createElement('article');
        row.className = 'music-result';
        const info = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = track.title;
        const description = document.createElement('small');
        description.textContent = `${track.url.includes('spotify.com') ? 'Spotify → YouTube' : 'YouTube'} · ${track.author}`;
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'btn-primary';
        add.textContent = 'Adicionar à fila';
        add.addEventListener('click', async () => {
          add.disabled = true;
          try { await request('music-enqueue', { id: track.id }); showToast('Música adicionada à fila.'); }
          catch (error) { notify(error.message, true); }
          finally { add.disabled = false; }
        });
        info.append(title, description);
        if (playlist) {
          const label = document.createElement('label');
          label.className = 'music-playlist-track';
          const select = document.createElement('input');
          select.type = 'checkbox';
          select.checked = true;
          select.value = track.id;
          select.dataset.musicTrack = 'true';
          select.addEventListener('change', updateSelection);
          label.append(select, info);
          row.append(label, add);
        } else row.append(info, add);
        $('#music-results').append(row);
      }
      if (result.source.playlistUrl) {
        const load = document.createElement('button');
        load.type = 'button';
        load.className = 'btn-secondary';
        load.textContent = 'Carregar a playlist deste vídeo';
        load.addEventListener('click', () => { $('#music-input').value = result.source.playlistUrl; searchMusic(0, result.source.playlistUrl); });
        $('#music-results').append(load);
      }
    } catch (error) { if (channelId === expectedChannel && channelRevision === expectedRevision) notify(error.message, true); }
    finally { if (channelRevision === expectedRevision) { searchBusy = false; render(); } }
  }
  $('#music-form').addEventListener('submit', event => { event.preventDefault(); searchMusic(); });
  syncChannel();
  return { syncChannel };
}
