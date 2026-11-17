// Exercita o botão, a gravação e a leitura do anexo no Electron com microfone fictício.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { io } = require('socket.io-client');
const { registerAppScheme, handleAppProtocol, roomUrl } = require('../electron/app-protocol.cjs');
registerAppScheme();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-clipes-'));
app.setPath('userData', path.join(dir, 'electron'));
Object.assign(process.env, { TELINHA_DATA_DIR: dir, TELINHA_MUSIC: '0', SFU_SECRET: '' });
for (const flag of ['use-fake-ui-for-media-stream', 'use-fake-device-for-media-stream']) app.commandLine.appendSwitch(flag);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.disableHardwareAcceleration();
let backend, client, win, peer;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = code => win.webContents.executeJavaScript(code, true);
async function until(code) {
  for (let i = 0; i < 120; i++) { if (await js(code)) return; await wait(50); }
  throw new Error(code);
}
const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click();void 0`);
app.whenReady().then(async () => {
  backend = await import('../server.js');
  const server = await backend.startServer(0, '127.0.0.1');
  const url = 'http://127.0.0.1:' + server.address().port;
  client = io(url, { autoConnect: false });
  await new Promise(resolve => { client.once('connect', resolve); client.connect(); });
  const channel = await client.timeout(3000).emitWithAck('create-text-channel', { name: 'Clipes' });
  assert.ok(channel.success);
  win = new BrowserWindow({ width: 1100, height: 800, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.setAudioMuted(true);
  handleAppProtocol();
  await win.loadURL(roomUrl(url));
  await until('Boolean(window.appState?.myId)');
  await js("document.querySelectorAll('.modal-backdrop').forEach(el=>el.classList.add('hidden'));void 0");
  await click('#channel-geral .channel-row');
  await until("appState.currentChannelId === 'geral'");
  if (!await js('appState.myUser.isMicOn')) await click('#btn-toggle-mic');
  await until('Boolean(appState.localMicStream?.active)');
  // Uma voz chega por WebRTC. Outro tom entra pelo mixer da transmissão.
  peer = new BrowserWindow({ show: false, webPreferences: { partition: 'clip-peer', backgroundThrottling: false } });
  peer.webContents.setAudioMuted(true);
  await peer.loadURL(url);
  const peerJs = code => peer.webContents.executeJavaScript(code, true);
  await peerJs(`localStorage.setItem('telinha_prefs', JSON.stringify({noiseSuppression:'off'}));void 0`);
  await peer.loadURL(url);
  await peerJs(`(async () => {
    while (!window.appState?.myId) await new Promise(r=>setTimeout(r,50));
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = appState.audioContext, tone = ctx.createOscillator(), dest = ctx.createMediaStreamDestination();
      tone.frequency.value = 420; tone.connect(dest); tone.start(); return dest.stream;
    };
    document.querySelector('#channel-geral .channel-row').click();
    while (!appState.currentChannelId) await new Promise(r=>setTimeout(r,50));
    if (!appState.myUser.isMicOn) document.querySelector('#btn-toggle-mic').click();
  })()`);
  await until("Boolean(document.querySelector('#voice-streams-container audio')?.srcObject)");
  await js(`(() => {
    const ctx=appState.audioContext, tone=ctx.createOscillator(), dest=ctx.createMediaStreamDestination();
    tone.frequency.value=2100; tone.connect(dest); tone.start();
    appState.mixerManager.attachScreenStream('tela-de-teste',dest.stream);
  })()`);
  await wait(11500);
  await click('#btn-voice-clip');
  await until("document.querySelector('#voice-clip-dialog').open");
  if (process.env.CLIP_SCREENSHOT) fs.writeFileSync(process.env.CLIP_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
  await js(`const clipForm=document.querySelector('#voice-clip-dialog form');clipForm.elements.duration.value=10;clipForm.elements.channel.value=${JSON.stringify(channel.channelId)};clipForm.requestSubmit();void 0`);
  await until("!document.querySelector('#voice-clip-dialog').open");
  await click(`[data-text-channel-id="${channel.channelId}"] .channel-row`);
  await until("Boolean(document.querySelector('audio.chat-voice-clip'))");
  const result = await js(`(async () => {
    const player=document.querySelector('audio.chat-voice-clip');
    await player.play();
    const buffer=await (await fetch(player.src)).arrayBuffer();
    const decoded=await appState.audioContext.decodeAudioData(buffer);
    const samples = decoded.getChannelData(0), count = Math.floor(decoded.sampleRate / 5);
    function amplitude(frequency) {
      let best = 0;
      for (let offset = count; offset + count < samples.length; offset += count) {
        let x = 0, y = 0;
        for (let i = 0; i < count; i++) {
          const angle = 2 * Math.PI * frequency * i / decoded.sampleRate;
          x += samples[offset+i] * Math.cos(angle); y += samples[offset+i] * Math.sin(angle);
        }
        best = Math.max(best, Math.hypot(x,y)/count);
      }
      return best;
    }
    return { remote: amplitude(420), screen: amplitude(2100), seconds: decoded.duration, audible: decoded.getChannelData(0).some(s=>Math.abs(s)>0.001), text:player.closest('.chat-msg').textContent };
  })()`);
  assert.equal(result.seconds, 10);
  assert.ok(result.audible);
  assert.ok(result.remote > 0.01, JSON.stringify(result));
  assert.ok(result.screen < result.remote / 8, JSON.stringify(result));
  assert.match(result.text, /10 s · \d{2}\/\d{2}\/\d{4}.*\d{2}:\d{2}/);
  win.setSize(390,844);
  await js("document.querySelector('#mobile-call-options').showModal();void 0");
  await click('#mobile-voice-clip');
  await until("document.querySelector('#voice-clip-dialog').open");
  assert.ok(await js("document.querySelector('#voice-clip-dialog').getBoundingClientRect().width<=innerWidth"));
  await click('#voice-clip-dialog .modal-close-btn');
  await click('#btn-dock-leave');
  await click('#channel-geral .channel-row');
  await until("appState.currentChannelId === 'geral'");
  await click('#btn-voice-clip');
  await wait(100);
  assert.equal(await js("document.querySelector('#voice-clip-dialog').open"), false);
  console.log('Clipe de 10 segundos com voz, data, player, destino e descarte ao sair conferidos.');
}).catch(err => { console.error(err); process.exitCode = 1; }).finally(async () => {
  client?.disconnect(); peer?.destroy(); win?.destroy();
  if (backend) await new Promise(resolve => backend.io.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
  app.exit(process.exitCode || 0);
});
