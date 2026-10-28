import { enhanceOpusStereoSdp } from './audio-manager.js';

const MIXER_ID = 'teletela-music-bot';
const MAX_QUEUE_TRACKS = 150;
const MUSIC_BOT_SVG = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

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
  let analyser = null;
  let freqData = null;
  let vizRaf = null;
  let draggedTrackId = null;

  const stopVisualizer = () => {
    if (vizRaf) {
      cancelAnimationFrame(vizRaf);
      vizRaf = null;
    }
    const canvas = document.querySelector('.music-bot-visualizer');
    if (canvas) {
      const ctx2d = canvas.getContext('2d');
      ctx2d?.clearRect(0, 0, canvas.width, canvas.height);
    }
  };
  const drawVisualizerFrame = () => {
    vizRaf = null;
    const canvas = document.querySelector('.music-bot-visualizer');
    if (!canvas || !analyser || !freqData || state?.phase !== 'playing' || document.hidden) {
      if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    analyser.getByteFrequencyData(freqData);
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    ctx2d.clearRect(0, 0, w, h);

    const bars = 32;
    const innerR = 33;
    const maxBar = 16;
    let energySum = 0;
    for (let i = 0; i < bars; i++) {
      const v = (freqData[i] || 0) / 255;
      energySum += v;
    }
    const avgEnergy = energySum / bars;

    // Anel pulsante suave reagindo aos graves
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, innerR + avgEnergy * 8, 0, Math.PI * 2);
    ctx2d.strokeStyle = `rgba(88, 101, 242, ${(0.18 + avgEnergy * 0.45).toFixed(3)})`;
    ctx2d.lineWidth = 2;
    ctx2d.stroke();

    // Barras radiais ao redor do avatar do bot
    ctx2d.lineCap = 'round';
    ctx2d.lineWidth = 2.6;
    for (let i = 0; i < bars; i++) {
      const bin = Math.min(freqData.length - 1, Math.floor((i / bars) * 28));
      const val = (freqData[bin] || 0) / 255;
      const barLen = Math.max(1.5, Math.pow(val, 1.15) * maxBar);
      const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx2d.beginPath();
      ctx2d.moveTo(cx + cos * innerR, cy + sin * innerR);
      ctx2d.lineTo(cx + cos * (innerR + barLen), cy + sin * (innerR + barLen));
      ctx2d.strokeStyle = val > 0.55 ? 'rgba(87, 242, 135, 0.92)' : 'rgba(88, 101, 242, 0.85)';
      ctx2d.stroke();
    }
    vizRaf = requestAnimationFrame(drawVisualizerFrame);
  };
  const ensureVisualizer = () => {
    if (analyser && state?.phase === 'playing' && !document.hidden && document.querySelector('.music-bot-visualizer')) {
      if (!vizRaf) vizRaf = requestAnimationFrame(drawVisualizerFrame);
    } else {
      stopVisualizer();
    }
  };

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
    stopVisualizer();
    analyser = null;
    freqData = null;
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
    const ctx = appState.mixerManager?.audioContext;
    const entry = appState.mixerManager?.userMixers?.get(MIXER_ID);
    if (ctx && entry?.sourceNode && typeof ctx.createAnalyser === 'function') {
      try {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.78;
        freqData = new Uint8Array(analyser.frequencyBinCount);
        entry.sourceNode.connect(analyser);
      } catch {
        analyser = null;
        freqData = null;
      }
    }
    ensureVisualizer();
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
        if (generation === expected) { retries = 0; attach(stream); }
      }, onClose: () => {
        if (session === listener) {
          session = null;
          generation = null;
          if (state && ['playing', 'paused'].includes(state.phase) && socket.connected && ++retries <= 5) {
            retryTimer = setTimeout(subscribe, 1500);
          }
        }
      } });
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
  const action = async (name, id, mode, toIndex) => {
    try { await request('music-control', { action: name, id, mode, toIndex }); }
    catch (error) { notify(error.message, true); }
  };
  const renderBot = () => {
    document.querySelectorAll('[data-music-bot]').forEach(element => element.remove());
    if (!channelId || !state?.track) {
      stopVisualizer();
      return;
    }
    const canWrite = appState.channels.get(channelId)?.canWrite !== false && !appState.myUser.serverMuted && !appState.myUser.serverDeafened;
    const isPlaying = state.phase === 'playing';
    const isPaused = state.phase === 'paused';
    const statusText = isPaused ? 'Pausada' : state.phase === 'preparing' ? 'Preparando…' : 'Tocando';
    const title = `Música · ${state.track.title}${isPaused ? ' (pausada)' : ''}`;

    // Linha alinhada na barra lateral igual aos participantes da call
    const row = document.createElement('li');
    row.dataset.musicBot = 'true';
    row.className = `channel-user music-bot-row${isPlaying ? ' is-speaking' : ''}`;
    row.title = `${title} · Abrir o bot de música`;
    const rowAvatarWrap = document.createElement('div');
    rowAvatarWrap.className = `user-avatar-wrap${isPlaying ? ' is-speaking' : ''}`;
    const rowAvatar = document.createElement('div');
    rowAvatar.className = 'user-avatar music-bot-avatar';
    rowAvatar.innerHTML = MUSIC_BOT_SVG;
    const rowHalo = document.createElement('span');
    rowHalo.className = 'speaking-halo';
    rowAvatarWrap.append(rowAvatar, rowHalo);
    const rowInfo = document.createElement('span');
    rowInfo.className = 'channel-user-info';
    const rowName = document.createElement('span');
    rowName.className = 'channel-user-name';
    const rowNameText = document.createElement('span');
    rowNameText.className = 'user-name-text';
    rowNameText.textContent = 'Bot de música';
    const rowBadge = document.createElement('span');
    rowBadge.className = 'badge-role';
    rowBadge.textContent = 'BOT';
    rowName.append(rowNameText, rowBadge);
    const rowSub = document.createElement('span');
    rowSub.className = 'music-bot-row-sub';
    rowSub.textContent = `${state.track.title}${isPaused ? ' (pausada)' : ''}`;
    rowInfo.append(rowName, rowSub);
    row.append(rowAvatarWrap, rowInfo);
    row.addEventListener('click', open);
    document.getElementById(`channel-users-${channelId}`)?.append(row);

    // Card no centro da call com visualizador circular em tempo real e mini controles
    const card = document.createElement('div');
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.dataset.musicBot = 'true';
    card.className = 'lounge-user-card music-bot-card';
    card.title = `${state.track.title} · Abrir o bot de música`;
    const avatarWrap = document.createElement('div');
    avatarWrap.className = `user-avatar-wrap music-bot-avatar-wrap${isPlaying ? ' is-speaking' : ''}`;
    const canvas = document.createElement('canvas');
    canvas.className = 'music-bot-visualizer';
    canvas.width = 108;
    canvas.height = 108;
    canvas.setAttribute('aria-hidden', 'true');
    const avatar = document.createElement('div');
    avatar.className = 'user-avatar music-bot-avatar';
    avatar.innerHTML = MUSIC_BOT_SVG;
    const halo = document.createElement('span');
    halo.className = 'speaking-halo';
    avatarWrap.append(canvas, avatar, halo);
    const name = document.createElement('strong');
    name.className = 'lounge-user-name';
    name.textContent = 'Bot de música';
    const description = document.createElement('span');
    description.className = 'music-bot-title';
    description.textContent = state.track.title;
    const status = document.createElement('span');
    status.className = `music-bot-status is-${state.phase || 'idle'}`;
    status.textContent = statusText;
    card.append(avatarWrap, name, description, status);
    if (canWrite) {
      const quickActions = document.createElement('div');
      quickActions.className = 'music-bot-quick-actions';
      const pauseBtn = document.createElement('button');
      pauseBtn.type = 'button';
      pauseBtn.className = 'music-bot-quick-btn';
      pauseBtn.disabled = !['playing', 'paused'].includes(state.phase);
      pauseBtn.title = isPaused ? 'Continuar música' : 'Pausar música';
      pauseBtn.setAttribute('aria-label', pauseBtn.title);
      pauseBtn.textContent = isPaused ? '▶' : '⏸';
      pauseBtn.addEventListener('click', event => {
        event.stopPropagation();
        action(isPaused ? 'resume' : 'pause');
      });
      const skipBtn = document.createElement('button');
      skipBtn.type = 'button';
      skipBtn.className = 'music-bot-quick-btn';
      skipBtn.title = 'Pular música';
      skipBtn.setAttribute('aria-label', 'Pular música');
      skipBtn.textContent = '⏭';
      skipBtn.addEventListener('click', event => {
        event.stopPropagation();
        action('skip');
      });
      quickActions.append(pauseBtn, skipBtn);
      card.append(quickActions);
    }
    card.addEventListener('click', open);
    card.addEventListener('keydown', event => {
      if (event.target === card && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        open();
      }
    });
    $('#lounge-users-grid')?.append(card);
    ensureVisualizer();
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
    $('#music-skip').disabled = !canWrite || (!state?.track && !state?.queue?.length);
    $('#music-stop').disabled = !canWrite || (!state?.track && !state?.queue?.length);
    $('#music-repeat').disabled = !canWrite;
    $('#music-repeat').value = state?.repeat || 'off';
    $('#music-shuffle').disabled = !canWrite || (state?.queue?.length || 0) < 2;
    updateSelection();
    const queue = state?.queue || [];
    $('#music-queue-title').textContent = `Próximas músicas (${queue.length}/${MAX_QUEUE_TRACKS})`;
    $('#music-queue').replaceChildren();
    queue.forEach((track, index) => {
      const row = document.createElement('li');
      row.dataset.trackId = track.id;
      row.dataset.index = String(index);
      const left = document.createElement('div');
      left.className = 'music-queue-item-left';
      if (canWrite && queue.length > 1) {
        row.draggable = true;
        const handle = document.createElement('span');
        handle.className = 'music-queue-handle';
        handle.title = 'Arraste para mudar a ordem';
        handle.setAttribute('aria-hidden', 'true');
        handle.textContent = '⠿';
        left.append(handle);
        row.addEventListener('dragstart', event => {
          draggedTrackId = track.id;
          row.classList.add('is-dragging');
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', track.id);
          }
        });
        row.addEventListener('dragover', event => {
          if (!draggedTrackId || draggedTrackId === track.id) return;
          event.preventDefault();
          row.classList.add('is-drop-target');
        });
        row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
        row.addEventListener('drop', event => {
          event.preventDefault();
          row.classList.remove('is-drop-target');
          const id = draggedTrackId || event.dataTransfer?.getData('text/plain');
          draggedTrackId = null;
          if (id && id !== track.id) action('move', id, undefined, index);
        });
        row.addEventListener('dragend', () => {
          draggedTrackId = null;
          row.classList.remove('is-dragging');
          document.querySelectorAll('#music-queue .is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
        });
      }
      const text = document.createElement('span');
      text.textContent = `${track.title} · pedido por ${track.requestedBy.name}`;
      left.append(text);
      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'music-queue-actions';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn-secondary music-queue-remove';
      remove.textContent = 'Remover';
      remove.disabled = !canWrite;
      remove.addEventListener('click', () => action('remove', track.id));
      actionsWrap.append(remove);
      if (canWrite && queue.length > 1) {
        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'btn-secondary music-queue-move';
        up.textContent = '↑';
        up.title = 'Subir na fila';
        up.setAttribute('aria-label', 'Subir na fila');
        up.disabled = index === 0;
        up.addEventListener('click', () => action('move', track.id, undefined, index - 1));
        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'btn-secondary music-queue-move';
        down.textContent = '↓';
        down.title = 'Descer na fila';
        down.setAttribute('aria-label', 'Descer na fila');
        down.disabled = index === queue.length - 1;
        down.addEventListener('click', () => action('move', track.id, undefined, index + 1));
        actionsWrap.append(up, down);
      }
      row.append(left, actionsWrap);
      $('#music-queue').append(row);
    });
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
  socket.on('permissions-state', render);
  socket.on('server-moderation', render);
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
    const free = Math.max(0, MAX_QUEUE_TRACKS - (state?.queue?.length || 0));
    $('#music-add-playlist').textContent = `Adicionar selecionadas (${selected}${playlist ? ` · ${free} vagas` : ''})`;
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
      const { result } = await request('music-search', { input, refinement: $('#music-refinement').value, offset, limit: MAX_QUEUE_TRACKS }, 65000);
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
  document.addEventListener('visibilitychange', ensureVisualizer);
  $('#music-form').addEventListener('submit', event => { event.preventDefault(); searchMusic(); });
  syncChannel();
  return { syncChannel, renderBot };
}
