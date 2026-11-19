export function voiceWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const tag = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  tag(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  // Conserva a dinâmica quando a soma de várias vozes ultrapassa o limite do WAV.
  let peak = 1;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const scale = 32767 / peak;
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(samples[i] * scale), true);
  return buffer;
}

export function setupVoiceClips({ appState, socket, showToast }) {
  const ctx = appState.audioContext;
  const dialog = document.querySelector('#voice-clip-dialog');
  const form = dialog.querySelector('form');
  const { duration, channel } = form.elements;
  const submit = form.querySelector('[type="submit"]');
  let session, moduleReady, snapshot, markedAt, pending = false, destination = '', preferredSeconds = 30;

  const preview = dialog.querySelector('audio');
  const rate = Math.min(ctx?.sampleRate || 48000, 48000);
  let previewUrl, prepared, preparedSeconds;
  // O volume geral e a saída são os mesmos da call.
  const players = new WeakMap();
  document.addEventListener('play', event => {
    const player = event.target;
    const output = appState.mixerManager?.outputGain;
    if (!output || !player.matches?.('#voice-clip-preview, .chat-voice-clip, #sound-trim audio')) return;
    if (!players.has(player)) {
      const source = ctx.createMediaElementSource(player);
      players.set(player, source);
      player.addEventListener('pause', () => source.disconnect());
    }
    players.get(player).connect(output);
    ctx.resume().catch(() => {});
  }, true);

  function clearPreview() {
    preview.pause();
    preview.removeAttribute('src');
    preview.load();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = prepared = null;
  }
  function updatePreview() {
    clearPreview();
    if (!snapshot || !duration.validity.valid) return;
    preparedSeconds = Number(duration.value);
    prepared = voiceWav(snapshot.subarray(-preparedSeconds * rate), rate);
    previewUrl = URL.createObjectURL(new Blob([prepared], { type: 'audio/wav' }));
    preview.src = previewUrl;
  }
  duration.addEventListener('input', updatePreview);

  function setMic() {
    if (!session?.bus) return;
    session.mic?.disconnect();
    session.mic = null;
    const stream = appState.localMicStream;
    if (appState.myUser.isMicOn && stream?.getAudioTracks().some(t => t.readyState === 'live')) {
      session.mic = ctx.createMediaStreamSource(stream);
      session.mic.connect(session.bus);
    }
  }

  function stop() {
    if (dialog.open) dialog.close();
    snapshot = null;
    pending = false;
    if (!session) return;
    for (const gain of session.sources.values()) {
      try { gain.disconnect(session.bus); } catch {} // O mixer pode já ter removido a faixa.
    }
    session.mic?.disconnect();
    session.bus?.disconnect();
    if (session.node) {
      session.node.port.postMessage('parar');
      session.node.port.close();
      session.node.disconnect();
    }
    session = null;
  }

  function attach(id, gain) {
    if (!session?.bus || !gain || !appState.channels.get(session.id)?.users.has(id)) return;
    gain.connect(session.bus);
    session.sources.set(id, gain);
  }

  async function start(id) {
    if (session?.id === id) return;
    stop();
    const current = session = { id, sources: new Map() };
    try {
      moduleReady ??= ctx.audioWorklet.addModule(new URL('./voice-clip-worklet.js', import.meta.url));
      await moduleReady;
      if (session !== current) return;
      current.node = new AudioWorkletNode(ctx, 'vozes-da-call', { channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1] });
      current.bus = ctx.createGain();
      current.bus.gain.value = appState.myUser.isDeafened ? 0 : 1;
      current.bus.connect(current.node).connect(ctx.destination);
      for (const el of document.querySelectorAll('#voice-streams-container audio')) {
        const uid = el.id.slice('voice-audio-'.length);
        if (appState.channels.get(id)?.users.has(uid)) attach(uid, appState.mixerManager.userMixers.get(uid)?.gainNode);
      }
      setMic();
      ctx.resume().catch(() => {});
    } catch {
      if (session === current) { stop(); moduleReady = null; }
    }
  }

  function open() {
    document.querySelector('#mobile-call-options')?.close();
    if (pending || dialog.open) return;
    if (!session?.node || ctx.state !== 'running') {
      ctx?.resume().catch(() => {});
      return showToast('O áudio da call ainda não está pronto para clipar.', 'error');
    }
    const channels = [...appState.textChannels.values()].filter(ch => ch.canWrite !== false);

    channel.replaceChildren(...channels.map(ch => new Option('#' + ch.name, ch.id)));
    if (channels.some(ch => ch.id === destination)) channel.value = destination;
    const current = session;
    pending = true;
    markedAt = new Date();
    current.node.port.onmessage = async ({ data }) => {
      if (session !== current) return;
      if (ctx.sampleRate > rate && data.length) {
        // Só aparelhos acima de 48 kHz precisam do filtro de reamostragem do navegador.
        try {
          const offline = new OfflineAudioContext(1, Math.max(1, Math.round(data.length * rate / ctx.sampleRate)), rate);
          const source = offline.createBufferSource();
          source.buffer = offline.createBuffer(1, data.length, ctx.sampleRate);
          source.buffer.copyToChannel(data, 0);
          source.connect(offline.destination); source.start();
          data = (await offline.startRendering()).getChannelData(0);
        } catch {
          if (current === session) { pending = false; showToast('Não deu para preparar o áudio do clipe.', 'error'); }
          return;
        }
        if (current !== session) return;
      }
      pending = false;
      const seconds = Math.floor(data.length / rate);
      if (seconds < 10) return showToast('Aguarde pelo menos 10 segundos na call para clipar.');
      snapshot = data;
      duration.max = seconds;
      duration.value = Math.min(seconds, preferredSeconds);
      form.elements.clipTitle.value = markedAt.toLocaleString('pt-BR');
      updatePreview();
      submit.disabled = !channel.value;
      dialog.showModal();
    };
    current.node.port.postMessage('clipar');
  }

  // Após suspender o áudio, um clipe novo começa com amostras desta sessão ativa.
  ctx?.addEventListener('statechange', () => {
    if (ctx.state !== 'running') session?.node?.port.postMessage('limpar');
  });
  document.querySelector('#btn-dock-clip').onclick = open;
  document.querySelector('#btn-voice-clip').onclick = open;
  document.querySelector('#mobile-voice-clip').onclick = open;
  dialog.querySelector('.modal-close-btn').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { snapshot = null; clearPreview(); });
  form.onsubmit = async event => {
    event.preventDefault();
    if (!snapshot || submit.disabled || !socket.connected) return;
    const seconds = Number(duration.value);
    const clip = snapshot;
    if (!prepared || preparedSeconds !== seconds) updatePreview();
    const data = prepared;
    const stamp = markedAt.toLocaleString('pt-BR');
    preferredSeconds = seconds;
    destination = channel.value;
    submit.disabled = true;
    try {
      const response = await socket.timeout(20000).emitWithAck('text-file', {
        channelId: destination, mime: 'audio/wav', name: 'clipe-de-voz.wav', data, clippedAt: markedAt.getTime(),
        text: form.elements.clipTitle.value.trim() || stamp
      });
      if (!response?.success) throw new Error(response?.error || 'Falha ao enviar o clipe.');
      if (snapshot === clip) dialog.close();
      showToast('Clipe enviado!', 'success');
    } catch (err) {
      showToast(err.message === 'operation has timed out' ? 'Envio sem confirmação. Confira o chat.' : err.message, 'error');
    } finally { if (snapshot === clip) submit.disabled = false; }
  };
  return { start, stop, attach, setMic, detach(id) { session?.sources.delete(id); },
    deafen(value) { if (session?.bus) session.bus.gain.value = value ? 0 : 1; } };
}
