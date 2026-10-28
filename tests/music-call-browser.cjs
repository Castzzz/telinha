// Testa o bot nas calls reais: um encoder Opus, dois ouvintes e isolamento entre canais.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
const profile = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'teletela-musica-call-ui-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.on('window-all-closed', () => {});
let call;
const windows = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sfu = process.env.MUSIC_TEST_SFU === '1';
const real = process.env.MUSIC_LAB_REAL === '1';
const suffix = sfu ? 'sfu' : 'direto';
async function until(check, message, seconds = 15) {
  for (let index = 0; index < seconds * 5; index++) { if (await check()) return; await pause(200); }
  throw new Error(message);
}
const evaluate = (win, code) => win.webContents.executeJavaScript(code);
async function hasAudio(win, deafen = false) {
  return evaluate(win, `(async () => {
    const node = ${deafen ? 'appState.mixerManager.masterDeafenGain' : "appState.mixerManager.userMixers.get('teletela-music-bot')?.gainNode"};
    if (!node) return false;
    if (window.musicTestNode !== node) {
      try { musicTestNode.disconnect(musicTestAnalyser); } catch {}
      window.musicTestAnalyser = appState.audioContext.createAnalyser();
      window.musicTestNode = node;
      node.connect(musicTestAnalyser);
    }
    let peak = 0;
    for (let index = 0; index < 4; index++) {
      const samples = new Float32Array(musicTestAnalyser.fftSize);
      musicTestAnalyser.getFloatTimeDomainData(samples);
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    return peak > .001;
  })()`);
}

async function musicStats(win) {
  return evaluate(win, `(async () => {
    for (const pc of window.musicTestPeers || []) {
      if (pc.connectionState !== 'connected') continue;
      for (const report of (await pc.getStats()).values()) {
        if (report.type === 'inbound-rtp' && report.kind === 'audio' && report.packetsReceived > 0) return {
          packets: report.packetsReceived, samples: report.totalSamplesReceived || 0,
          inserted: report.insertedSamplesForDeceleration || 0, removed: report.removedSamplesForAcceleration || 0,
          time: performance.now()
        };
      }
    }
    throw new Error('Sem estatísticas da música.');
  })()`);
}

app.whenReady().then(async () => {
  const { startMusicCall } = await import('../scripts/music-call.mjs');
  call = await startMusicCall({ port: 0, sfu });
  const { io } = await import('socket.io-client');
  const fixtureClient = io(call.url, { autoConnect: false, transports: ['websocket'], reconnection: false });
  const connected = new Promise(resolve => fixtureClient.once('connect', resolve));
  fixtureClient.connect();
  await connected;
  const created = await fixtureClient.timeout(3000).emitWithAck('create-channel', { name: 'Cinema', profileId: 'teste-musica-cinema' });
  fixtureClient.disconnect();
  if (!created.success) throw new Error('Não foi possível criar o segundo canal de teste.');
  let preparations = 0;
  if (!real) {
    const tone = path.join(profile, 'tom.mp3');
    await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=40', '-y', tone]);
    call.backend.music.prepare = async (_url, folder) => {
      preparations++;
      const file = path.join(folder, 'faixa.mp3');
      await fs.copyFile(tone, file);
      return file;
    };
    const candidate = { id: 'jNQXAC9IVRw', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', title: 'Tom de teste 440 Hz', author: 'Teste local', duration: 40 };
    call.backend.music.resolve = async input => input.includes('/playlist?')
      ? { source: { title: 'Playlist de teste', url: input }, notice: 'Playlist local para conferir seleção e fila.', candidates: [],
        playlist: { title: 'Playlist de teste', tracks: [0, 1, 2].map(index => ({ ...candidate, id: `playlist-${index}`, title: `Tom ${index + 1}` })), nextOffset: null } }
      : { source: { title: 'Tom de teste' }, notice: 'Fonte local para verificar o áudio nas calls.', candidates: [candidate] };
  }
  const open = async (channel = 'geral') => {
    const win = new BrowserWindow({ width: 1180, height: 950, show: false, webPreferences: { partition: `musica-${windows.length}`, offscreen: true, backgroundThrottling: false } });
    windows.push(win);
    win.webContents.setAudioMuted(true);
    win.webContents.on('console-message', event => { if (event.level === 'error') console.error('[Interface]', event.message); });
    await win.loadURL(call.url);
    await until(() => evaluate(win, 'Boolean(window.appState?.musicEnabled && appState.channels.has("geral"))'), 'A interface não conectou ao servidor de música.');
    await evaluate(win, `(() => {
      const saved=JSON.parse(localStorage.getItem('telinha_prefs')||'{}');
      const canvas=document.createElement('canvas');canvas.width=80;canvas.height=80;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#42376c';ctx.fillRect(0,0,80,80);
      ctx.fillStyle='#dca977';ctx.beginPath();ctx.arc(40,32,16,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#b7b5ee';ctx.beginPath();ctx.ellipse(40,81,29,28,0,0,Math.PI*2);ctx.fill();
      Object.assign(saved.profile,{name:${JSON.stringify(windows.length === 1 ? 'Cast' : 'Bia')},avatar:canvas.toDataURL()});
      saved.seenWhatsNew='99';localStorage.setItem('telinha_prefs',JSON.stringify(saved));
    })()`);
    win.reload();
    await until(() => evaluate(win, 'Boolean(window.appState?.musicEnabled && appState.channels.has("geral"))'), 'O perfil de teste não carregou.');
    await evaluate(win, `
      window.musicTestPeers = [];
      const NativePeer = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends NativePeer { constructor(options) { super(options); musicTestPeers.push(this); } };
      void 0;
    `);
    await evaluate(win, `document.querySelectorAll('.modal-backdrop').forEach(element => element.classList.add('hidden')); document.querySelector('#channel-${channel} .channel-row').click(); appState.audioContext.resume();`);
    await until(() => evaluate(win, `appState.currentChannelId === '${channel}'`), 'O cliente não entrou na call.');
    return win;
  };
  console.log(`Conferindo bot nas calls (${suffix}, fonte ${real ? 'real' : 'local'}).`);
  const first = await open();
  await evaluate(first, `document.querySelector('#btn-music').click(); document.querySelector('#music-input').value = ${JSON.stringify(real ? 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT' : 'Tom de teste')}; document.querySelector('#music-form').requestSubmit();`);
  await until(() => evaluate(first, "Boolean(document.querySelector('#music-results button'))"), 'A busca não mostrou versões.', 70);
  const started = Date.now();
  await evaluate(first, "document.querySelector('#music-results button').click()");
  await until(() => {
    const state = call.backend.music.state('geral');
    if (state.phase === 'error') throw new Error(state.error);
    return state.phase === 'playing';
  }, 'A música não começou.', 150);
  await until(() => hasAudio(first), 'O primeiro ouvinte não recebeu áudio.');
  const startupMs = Date.now() - started;
  console.log(`Áudio começou em ${startupMs} ms após adicionar a faixa.`);
  const original = call.backend.music.state('geral').generation;
  const encoder = call.backend.music.sessions.get('geral').transport.ffmpeg.pid;
  const second = await open();
  await until(() => hasAudio(second), 'O segundo ouvinte não recebeu áudio.');
  if (call.backend.music.sessions.get('geral').transport.ffmpeg.pid !== encoder) throw new Error('A entrada do segundo ouvinte criou outro encoder.');
  if (!real && preparations !== 1) throw new Error('A música foi preparada de novo para o segundo ouvinte.');
  console.log('Dois ouvintes receberam áudio do mesmo encoder.');
  const cadenceStart = await musicStats(second);
  await pause(4000);
  const cadenceEnd = await musicStats(second);
  const seconds = (cadenceEnd.time - cadenceStart.time) / 1000;
  const packetsPerSecond = (cadenceEnd.packets - cadenceStart.packets) / seconds;
  const samples = cadenceEnd.samples - cadenceStart.samples;
  const adjusted = cadenceEnd.inserted - cadenceStart.inserted + cadenceEnd.removed - cadenceStart.removed;
  if (packetsPerSecond < 46 || packetsPerSecond > 54 || (samples > 0 && adjusted / samples > .03)) throw new Error('Cadência instável: ' + JSON.stringify({ packetsPerSecond, samples, adjusted }));
  console.log('Cadência recebida:', JSON.stringify({ packetsPerSecond, samples, adjusted }));
  const previousId = await evaluate(first, 'appState.myId');
  call.backend.io.sockets.sockets.get(previousId).conn.close();
  await until(() => evaluate(first, `appState.myId !== ${JSON.stringify(previousId)} && appState.currentChannelId === 'geral'`), 'Reconectar não retomou a call.', 20);
  await until(() => hasAudio(first), 'Reconectar não recuperou a música.');
  if (call.backend.music.sessions.get('geral').transport.ffmpeg.pid !== encoder) throw new Error('Reconectar reiniciou o encoder.');
  console.log('Reconexão recuperou a mesma música.');
  await evaluate(first, "document.querySelector('#btn-music').click(); document.querySelector('#music-form').requestSubmit()");
  await until(() => evaluate(first, "Boolean(document.querySelector('#music-results button'))"), 'A busca depois de reconectar não mostrou versões.', 70);

  await evaluate(first, "document.querySelector('#music-volume').value = 0; document.querySelector('#music-volume').dispatchEvent(new Event('input'))");
  await pause(350);
  if (await hasAudio(first)) throw new Error('Seu volume zero não silenciou a música.');
  if (!await hasAudio(second)) throw new Error('O volume local silenciou o outro ouvinte.');
  await evaluate(first, "document.querySelector('#music-volume').value = 50; document.querySelector('#music-volume').dispatchEvent(new Event('input'))");
  await evaluate(first, "document.querySelector('#btn-toggle-deafen').click()");
  await pause(350);
  if (await hasAudio(first, true)) throw new Error('Ensurdecer não silenciou o bot.');
  await evaluate(first, "document.querySelector('#btn-toggle-deafen').click()");
  await until(() => hasAudio(first, true), 'Restaurar áudio não recuperou a música.');

  await evaluate(first, "document.querySelector('#music-pause').click()");
  await until(() => call.backend.music.state('geral').phase === 'paused', 'A pausa não chegou ao servidor.');
  const pausedStats = await musicStats(second);
  const position = call.backend.music.state('geral').position;
  await pause(900);
  if (Math.abs(call.backend.music.state('geral').position - position) > .1) throw new Error('A posição continuou avançando durante a pausa.');
  if (await hasAudio(second)) throw new Error('A pausa não silenciou o outro ouvinte.');
  if ((await musicStats(second)).packets - pausedStats.packets < 30) throw new Error('A pausa interrompeu o relógio RTP em vez de enviar silêncio.');
  await evaluate(first, "document.querySelector('#music-pause').click()");
  await until(() => call.backend.music.state('geral').phase === 'playing', 'A música não retomou.');
  await until(() => hasAudio(second), 'O outro ouvinte não voltou a receber áudio.');
  console.log('Volume individual, ensurdecer e pausa conferidos.');

  // Vídeo local de teste: confere os controles do palco sem uma segunda captura de tela.
  await evaluate(first, `(async () => {
    document.querySelectorAll('.modal-backdrop').forEach(el => el.classList.add('hidden'));
    const canvas = document.createElement('canvas'); canvas.width=960; canvas.height=540;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='#18243c';ctx.fillRect(0,0,960,540);
    ctx.fillStyle='#b3c9ff';ctx.font='36px sans-serif';ctx.fillText('Mesa de RPG · Transmissão de teste',90,260);
    window.stageFixtureStream=canvas.captureStream(5);
    const tile=document.createElement('div');tile.className='video-tile';tile.id='video-tile-stage-fixture';
    const video=document.createElement('video');video.muted=true;video.autoplay=true;video.srcObject=stageFixtureStream;tile.append(video);
    document.querySelector('#videos-grid').append(tile);document.querySelector('#videos-grid').classList.remove('hidden');document.querySelector('#voice-lounge').classList.add('hidden');
    appState.activeStreams.set('stage-fixture',{stream:stageFixtureStream,userName:'Mesa de RPG',isLocal:true});
    appState.focusedStreamUserId='stage-fixture';appState.channels.get('geral').users.get(appState.myId).isSharing=true;await video.play();
    document.documentElement.classList.remove('pause-in-background', 'light-mode');
    document.dispatchEvent(new Event('fullscreenchange'));
  })()`);
  await until(() => evaluate(first, `Boolean(document.querySelector('#music-stage-miniplayer') && document.querySelectorAll('.stage-cinema-participant').length >= 3)`), 'Miniplayer ou participantes não apareceram no palco.');
  await until(() => evaluate(first, `Boolean(document.querySelector('.music-mini-bar').style.getPropertyValue('--music-mini-level'))`), 'As barras não receberam o nível real do áudio.');
  await evaluate(first, `document.querySelector('.music-mini-pause').click()`);
  await until(() => call.backend.music.state('geral').phase === 'paused', 'Miniplayer não pausou.');
  await until(() => evaluate(first, `document.querySelector('.music-mini-pause').getAttribute('aria-label') === 'Continuar música'`), 'Miniplayer não refletiu a pausa.');
  await evaluate(first, `document.querySelector('.music-mini-pause').click()`);
  await until(() => call.backend.music.state('geral').phase === 'playing', 'Miniplayer não retomou.');
  await evaluate(first, `document.querySelector('#stage-cinema-toggle').click()`);
  if (!await evaluate(first, `document.querySelector('#stage-cinema-toggle').getAttribute('aria-expanded') === 'false'`)) throw new Error('Faixa não recolheu.');
  await evaluate(first, `document.querySelector('#stage-cinema-toggle').click();document.querySelector('#quick-reactions button').click()`);
  await until(() => evaluate(first, `document.querySelectorAll('#stage-cinema-reactions > *').length > 0`), 'Reação não apareceu no cinema.');
  await evaluate(first, `window.designUsers=appState.channels.get('geral').users;appState.channels.get('geral').users=new Map([[appState.myId,designUsers.get(appState.myId)]]);document.dispatchEvent(new Event('fullscreenchange'));`);
  await pause(150);
  if (await evaluate(first, `document.querySelector('#stage-cinema-count').textContent`) !== '1') throw new Error('Bot entrou na contagem de pessoas.');
  await fs.writeFile('/tmp/teletela-cinema-sozinho.png',(await first.webContents.capturePage()).toPNG());
  await evaluate(first, `appState.channels.get('geral').users=designUsers;document.dispatchEvent(new Event('fullscreenchange'));`);
  for (const theme of ['escuro','preto','claro']) {
    await evaluate(first, `document.documentElement.dataset.theme='${theme}'`);
    await pause(150);
    await fs.writeFile(`/tmp/teletela-cinema-${theme}.png`, (await first.webContents.capturePage()).toPNG());
  }
  const badgesOverlap = await evaluate(first, `(() => {
    const card=document.querySelector('.stage-cinema-participant.is-me');
    const a=card.querySelector('.stage-cinema-avatar').getBoundingClientRect(),b=card.querySelector('.stage-cinema-badges').getBoundingClientRect();
    return b.width>0 && a.left<b.right && b.left<a.right && a.top<b.bottom && b.top<a.bottom;
  })()`);
  if (badgesOverlap) throw new Error('Os indicadores invadiram a foto no cinema.');
  await evaluate(first, `document.querySelector('.music-mini-title-btn').click()`);
  for (const theme of ['escuro','preto','claro']) {
    await evaluate(first, `document.documentElement.dataset.theme='${theme}'`); await pause(150);
    await fs.writeFile(`/tmp/teletela-painel-musica-${theme}.png`, (await first.webContents.capturePage()).toPNG());
  }
  await evaluate(first, `document.querySelector('[data-close-modal=modal-music]').click()`);
  await first.webContents.executeJavaScript(`document.querySelector('#videos-grid').requestFullscreen()`, true);
  await until(() => evaluate(first, `document.fullscreenElement?.contains(document.querySelector('#music-stage-miniplayer')) && document.fullscreenElement?.contains(document.querySelector('#stage-cinema-bar'))`), 'Controles não acompanharam a tela cheia nativa.');
  await evaluate(first, `document.querySelector('.stage-cinema-participant[data-user-id]').click()`);
  if (!await evaluate(first, `document.fullscreenElement.contains(document.querySelector('#user-popover')) && !document.querySelector('#user-popover').classList.contains('hidden')`)) throw new Error('Perfil ficou fora da tela cheia.');
  await evaluate(first, `document.querySelector('#user-popover-avatar').click()`);
  if (!await evaluate(first, `document.fullscreenElement.contains(document.querySelector('#modal-user-profile')) && !document.querySelector('#modal-user-profile').classList.contains('hidden')`)) throw new Error('Perfil grande ficou fora da tela cheia.');
  await evaluate(first, `document.querySelector('[data-close-modal=modal-user-profile]').click()`);
  await evaluate(first, `document.querySelector('.music-mini-title-btn').click()`);
  if (!await evaluate(first, `document.fullscreenElement.contains(document.querySelector('#modal-music'))`)) throw new Error('Fila completa ficou fora da tela cheia.');
  await evaluate(first, `document.querySelector('[data-close-modal=modal-music]').click();document.exitFullscreen()`);
  await until(() => evaluate(first, `!document.fullscreenElement`), 'Não saiu da tela cheia.');
  console.log('Cinema e miniplayer: participantes, recolher, reações, pausa/continuar, três temas e tela cheia nativa conferidos.');


  await evaluate(first, `document.querySelector('.music-mini-title-btn').click()`);
  const outside = await open('cinema');
  if (await evaluate(outside, "Boolean(document.querySelector('#music-remote-audio'))")) throw new Error('Outro canal recebeu a música do Geral.');
  if (!real) {
    await evaluate(first, "document.querySelector('#music-input').value = 'https://www.youtube.com/playlist?list=PLteste123456'; document.querySelector('#music-form').requestSubmit()");
    await until(() => evaluate(first, "document.querySelectorAll('[data-music-track]').length === 3"), 'A playlist não mostrou as faixas.');
    await evaluate(first, "document.querySelectorAll('[data-music-track]')[2].click(); document.querySelector('#music-playlist-shuffle').checked = true; document.querySelector('#music-add-playlist').click()");
    await until(() => call.backend.music.state('geral').queue.length === 2, 'A seleção da playlist não entrou na fila.');
    await evaluate(first, "document.querySelector('#music-repeat').value = 'all'; document.querySelector('#music-repeat').dispatchEvent(new Event('change'))");
    await until(() => call.backend.music.state('geral').repeat === 'all', 'Repetir fila não foi aplicado.');
    await evaluate(first, "document.querySelector('#music-shuffle').click(); document.querySelector('#music-repeat').value = 'off'; document.querySelector('#music-repeat').dispatchEvent(new Event('change'))");
    await evaluate(first, "document.querySelector('#music-queue button').click()");
    await until(() => call.backend.music.state('geral').queue.length === 1, 'Remover não alterou a fila.');
    await evaluate(first, "document.querySelector('.music-mini-skip').click()");
    await until(() => call.backend.music.state('geral').phase === 'playing' && call.backend.music.state('geral').generation !== original, 'Pular não iniciou a próxima faixa.', 30);
    await until(() => hasAudio(first), 'O áudio não voltou depois de pular.');
    await until(() => hasAudio(second), 'O segundo ouvinte não acompanhou a próxima música.');
  } else {
    await evaluate(first, "document.querySelector('#music-results button').click()");
    await until(() => call.backend.music.sessions.get('geral').prefetch?.buffered, 'A próxima faixa não foi pré-carregada.', 40);
    const nextStarted = Date.now();
    await evaluate(first, "document.querySelector('.music-mini-skip').click()");
    await until(() => {
      const state = call.backend.music.state('geral');
      if (state.phase === 'error') throw new Error(state.error);
      return state.phase === 'playing' && state.generation !== original;
    }, 'A faixa pré-carregada não começou.', 20);
    await until(() => hasAudio(first), 'A faixa pré-carregada não chegou ao ouvinte.');
    console.log(`Faixa real pré-carregada começou em ${Date.now() - nextStarted} ms.`);
  }
  for (const theme of ['escuro', 'preto', 'claro']) {
    await evaluate(first, `document.documentElement.dataset.theme = '${theme}'`);
    await pause(150);
    await fs.writeFile(`/tmp/teletela-musica-call-${suffix}-${theme}.png`, (await first.webContents.capturePage()).toPNG());
  }
  await evaluate(first, `document.querySelector('[data-close-modal=modal-music]').click()`);
  first.setSize(390, 844);
  await pause(200);
  await evaluate(first, `document.querySelector('#mobile-return-call').click()`);
  await pause(200);
  const cinemaFits = await evaluate(first, `(() => {const b=document.querySelector('#stage-cinema-bar').getBoundingClientRect(),m=document.querySelector('#music-stage-miniplayer').getBoundingClientRect();return b.width>0&&m.width>0&&b.left>=0&&b.right<=innerWidth&&m.left>=0&&m.right<=innerWidth})()`);
  if (!cinemaFits) throw new Error('Controles do cinema não cabem no celular.');
  await fs.writeFile('/tmp/teletela-cinema-celular.png',(await first.webContents.capturePage()).toPNG());
  await evaluate(first, `document.querySelector('.music-mini-title-btn').click()`);
  await pause(200);
  if (await evaluate(first, 'document.documentElement.scrollWidth > innerWidth')) throw new Error('O modal transborda na tela estreita.');
  await fs.writeFile(`/tmp/teletela-musica-call-${suffix}-celular.png`, (await first.webContents.capturePage()).toPNG());
  await evaluate(first, "document.querySelector('[data-close-modal=modal-music]').click(); document.querySelector('#channel-cinema .channel-row').click()");
  await until(() => evaluate(first, "appState.currentChannelId === 'cinema' && !document.querySelector('#music-remote-audio')"), 'Trocar de canal não encerrou a escuta anterior.');
  if (!await hasAudio(second)) throw new Error('Trocar de canal interrompeu a música de quem ficou.');
  await evaluate(second, "document.querySelector('#btn-dock-leave').click()");
  await until(() => call.backend.music.state('geral').phase === 'idle', 'Canal vazio não parou a música.');
  console.log(JSON.stringify({ ok: true, modo: suffix, fonteReal: real, inicioMs: startupMs, pacotesPorSegundo: packetsPerSecond, doisOuvintes: true, encoderUnico: true, entradaTardia: true, volumeIndividual: true,
    ensurdecer: true, pausa: true, reconexao: true, fila: !real, trocaDeCanal: true, canalVazio: true, temas: 3, celular: true }));
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const win of windows) if (!win.isDestroyed()) win.destroy();
  if (call) await call.close();
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  app.exit(process.exitCode || 0);
});
