const { app, BrowserWindow, shell, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { registerAppScheme, handleAppProtocol, roomUrl } = require('../electron/app-protocol.cjs');
const { setupStreamWindow } = require('../electron/stream-window.cjs');
registerAppScheme();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-stream-window-'));
app.setPath('userData', directory);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.on('window-all-closed', () => {});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = (win, code) => win.webContents.executeJavaScript(code, true);
const click = (win, selector) => js(win, `document.querySelector(${JSON.stringify(selector)}).click();void 0`);
async function until(win, code) {
  for (let i = 0; i < 160; i++) {
    if (await js(win, code)) return;
    await pause(75);
  }
  throw new Error('Estado esperado: ' + code);
}
const timeout = setTimeout(() => { console.error('Tempo esgotado'); app.exit(1); }, 90000);
let call;
app.whenReady().then(async () => {
  handleAppProtocol();
  const preferences = new Map();
  ipcMain.handle('prefs-get', event => preferences.get(event.sender.id) || {});
  ipcMain.handle('prefs-set', (event, patch) => {
    preferences.set(event.sender.id, { ...preferences.get(event.sender.id), ...patch });
    return true;
  });
  ipcMain.handle('set-global-hotkeys', () => ({}));
  ipcMain.handle('get-game-activity', () => ({ activity: null }));
  ipcMain.handle('autostart-get', () => ({ supported: false, enabled: false }));
  ipcMain.handle('system-idle-seconds', () => null);
  ipcMain.handle('list-audio-apps', () => []);
  ipcMain.handle('get-desktop-sources', () => []);
  const { startMusicCall } = await import('../scripts/music-call.mjs');
  call = await startMusicCall({ port: 0, sfu: process.env.TEST_SFU === '1' });
  async function open(name) {
    const win = new BrowserWindow({ width: 1100, height: 780, show: true, webPreferences: {
      preload: path.join(__dirname, '../electron/preload.cjs'), contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: false, partition: name
    } });
    handleAppProtocol(win.webContents.session);
    setupStreamWindow(win, shell);
    await win.loadURL(roomUrl(call.url));
    await until(win, 'Boolean(window.appState?.myId)');
    await js(win, `electronAPI.setPrefs({profile:{id:'perfil-${name}',name:'${name}',color:'#5865f2'},seenWhatsNew:'99'});void 0`);
    win.reload();
    await until(win, `document.querySelector('#dock-user-name').textContent==='${name}'&&Boolean(appState.myId)`);
    await js(win, "document.querySelectorAll('.modal-backdrop').forEach(e=>e.classList.add('hidden'));document.querySelector('#channel-geral .channel-row').click();void 0");
    await until(win, "appState.currentChannelId==='geral'");
    return win;
  }
  const sender = await open('Emissor');
  const viewer = await open('Espectador');
  await click(sender, '#btn-share-camera');
  await until(sender, 'appState.myUser.isCameraOn');
  await until(sender, `Boolean(appState.sfuCameraPublisher?.pc?.localDescription || appState.screenPeersOut.size || !appState.sfuEnabled)`);
  const key = await js(sender, 'appState.myId + "__cam"');
  await until(viewer, `Boolean(document.querySelector('[data-stream-key="${key}"]'))`);
  await click(viewer, `[data-stream-key="${key}"]`);
  await until(viewer, `Boolean(appState.activeStreams.get('${key}')?.stream)`);
  assert(await js(sender, `(()=>{const pc=appState.sfuCameraPublisher?.pc || [...appState.screenPeersOut.values()][0];return pc?.localDescription.sdp.includes('x-google-start-bitrate=600')})()`), 'Chromium precisa aceitar a indicação de partida da câmera, sem usar a oferta alternativa');
  await js(viewer, `window.originalStream=appState.activeStreams.get('${key}').stream;void 0`);
  await js(viewer, `
    window.popupAudioContext = new AudioContext();
    window.popupTone = popupAudioContext.createOscillator();
    const output = popupAudioContext.createMediaStreamDestination();
    popupTone.connect(output);
    popupTone.start();
    originalStream.addTrack(output.stream.getAudioTracks()[0]);
    appState.mixerManager.attachScreenStream('${key}', originalStream);
    window.originalMixer = appState.mixerManager.streamMixers.get('${key}');
    document.getElementById('video-el-${key}').dataset.mixerOutput = '1';
    document.getElementById('video-el-${key}').muted = true;
    void 0;
  `);
  await until(viewer, `document.getElementById('input-stream-volume').value === '100'`);
  assert(await js(viewer, `getComputedStyle(document.getElementById('tile-volume-control-${key}')).display === 'none'`), 'Palco individual não deve duplicar o volume sobre o vídeo');
  await js(viewer, `const slider=document.getElementById('input-stream-volume');slider.value='175';slider.dispatchEvent(new Event('input',{bubbles:true}));void 0`);
  await until(viewer, `originalMixer.volumePercent === 175 && document.getElementById('tile-volume-${key}').value === '175'`);
  assert(await js(viewer, `document.getElementById('stream-volume-control').classList.contains('is-boosted')`), 'Reforço acima de 100% deve ficar destacado');
  await click(viewer, '#stream-volume-icon');
  await until(viewer, `originalMixer.volumePercent === 0 && document.getElementById('stream-volume-icon').getAttribute('aria-pressed') === 'true'`);
  await click(viewer, '#stream-volume-icon');
  await until(viewer, 'originalMixer.volumePercent === 175');
  await click(viewer, '#stream-volume-text');
  await until(viewer, `originalMixer.volumePercent === 100 && document.getElementById('tile-volume-${key}').value === '100'`);
  const created = new Promise(resolve => viewer.webContents.once('did-create-window', resolve));
  await click(viewer, '#btn-stage-pip');
  const player = await created;
  await until(player, 'Boolean(document.querySelector("video")?.videoWidth)');
  assert(player.isResizable() && player.isMaximizable() && player.isFullScreenable(), 'Janela precisa permitir tamanho e tela cheia');
  assert(await js(player, 'document.querySelector("video").muted'), 'Player deve manter o áudio no mixer original');
  assert(await js(viewer, `appState.activeStreams.get('${key}').stream === originalStream`), 'Abrir janela não pode substituir o stream recebido');
  assert(await js(viewer, `!document.getElementById('video-el-${key}').srcObject?.getVideoTracks().length && document.getElementById('video-tile-${key}').classList.contains('stream-in-popup')`), 'Vídeo deve tocar só no popup');
  assert(await js(viewer, `document.getElementById('video-el-${key}').srcObject.getAudioTracks()[0] === originalStream.getAudioTracks()[0] && appState.mixerManager.streamMixers.get('${key}') === originalMixer && originalMixer.audible !== false`), 'Popup deve preservar o áudio no mixer e no elemento da sala');
  await js(viewer, "document.body.dataset.mobileView='sala';void 0");
  await pause(100);
  fs.writeFileSync('/tmp/teletela-stream-na-sala.png', (await viewer.webContents.capturePage()).toPNG());
  assert.equal(await js(player, 'typeof window.electronAPI'), 'undefined', 'Player não precisa da ponte privilegiada');
  player.setSize(1200, 800);
  await click(player, '#fullscreen');
  await until(player, 'Boolean(document.fullscreenElement)');
  await pause(400);
  assert(player.isFullScreen(), 'Tela cheia deve ocupar a janela nativa');
  await js(player, 'document.querySelector("#fullscreen").focus();void 0');
  const buttonPoint = await js(player, '(()=>{const r=document.querySelector("#fullscreen").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
  player.webContents.sendInputEvent({ type: 'mouseMove', ...buttonPoint });
  await js(player, `window.idleTestEvents=[];['pointermove','pointerdown','focusin','focusout'].forEach(type=>document.getElementById('stream-player').addEventListener(type,event=>{idleTestEvents.push({type,time:Math.round(performance.now()),x:event.clientX,y:event.clientY});if(idleTestEvents.length>30)idleTestEvents.shift()}));void 0`);
  try {
    await until(player, 'document.querySelector("#stream-player").classList.contains("controls-idle")');
  } catch (error) {
    console.error('Eventos durante a espera dos controles:', await js(player, 'idleTestEvents'));
    throw error;
  }
  await until(player, 'getComputedStyle(document.querySelector("#player-controls")).opacity === "0"');
  assert(await js(player, 'document.activeElement.id === "fullscreen"'), 'O foco não deve impedir a ocultação da barra');
  await js(player, 'window.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab"}));void 0');
  assert(await js(player, '!document.querySelector("#stream-player").classList.contains("controls-idle")'), 'Usar o teclado deve revelar os controles');
  fs.writeFileSync('/tmp/teletela-stream-fullscreen.png', (await player.webContents.capturePage()).toPNG());
  await js(player, 'document.exitFullscreen();void 0');
  await until(player, '!document.fullscreenElement');
  for (const theme of ['escuro', 'preto', 'claro']) {
    await js(viewer, `document.documentElement.dataset.theme='${theme}';void 0`);
    await until(player, `document.documentElement.dataset.theme==='${theme}'`);
    await js(player, 'document.querySelector("#stream-player").dispatchEvent(new Event("pointermove"));void 0');
    await pause(150);
    fs.writeFileSync(`/tmp/teletela-stream-${theme}.png`, (await player.webContents.capturePage()).toPNG());
    await js(viewer, "document.body.dataset.mobileView='sala';void 0");
    fs.writeFileSync(`/tmp/teletela-volume-${theme}.png`, (await viewer.webContents.capturePage()).toPNG());
  }
  player.webContents.setZoomFactor(2);
  await until(player, 'innerWidth <= 540');
  await js(player, 'document.querySelector("#stream-name").textContent="Um nome muito comprido para testar a transmissão em janela pequena";document.querySelector("#stream-player").dispatchEvent(new Event("pointermove"));void 0');
  assert(await js(player, 'getComputedStyle(document.querySelector("#fullscreen span")).display === "none"'), 'Janela compacta deve mostrar botões só com ícones');
  assert(await js(player, '(()=>{const r=document.querySelector("#player-controls").getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && document.documentElement.scrollWidth<=innerWidth})()'), 'Controles não podem transbordar em janela compacta');
  fs.writeFileSync('/tmp/teletela-stream-compacto.png', (await player.webContents.capturePage()).toPNG());
  player.webContents.setZoomFactor(1);
  player.close();
  await pause(250);
  assert(await js(viewer, `appState.activeStreams.get('${key}').stream === originalStream && originalStream.getVideoTracks()[0].readyState === 'live'`), 'Fechar player deve manter a transmissão');
  await until(viewer, `document.getElementById('video-el-${key}').srcObject === originalStream && !document.getElementById('video-el-${key}').paused && !document.getElementById('video-tile-${key}').classList.contains('stream-in-popup')`);
  fs.writeFileSync('/tmp/teletela-stream-de-volta.png', (await viewer.webContents.capturePage()).toPNG());
  const reopened = new Promise(resolve => viewer.webContents.once('did-create-window', resolve));
  await click(viewer, '#btn-stage-pip');
  const secondPlayer = await reopened;
  await until(secondPlayer, 'Boolean(document.querySelector("video")?.videoWidth)');
  await click(viewer, '#btn-stage-pip');
  await pause(200);
  assert(secondPlayer.isDestroyed(), 'Segundo clique fecha o player');
  await until(viewer, `document.getElementById('video-el-${key}').srcObject === originalStream && !document.getElementById('video-el-${key}').paused`);
  const thirdCreated = new Promise(resolve => viewer.webContents.once('did-create-window', resolve));
  await click(viewer, '#btn-stage-pip');
  const thirdPlayer = await thirdCreated;
  await until(thirdPlayer, 'Boolean(document.querySelector("video")?.videoWidth)');
  await click(viewer, '#btn-share-camera');
  await until(viewer, 'appState.myUser.isCameraOn');
  const ownKey = await js(viewer, 'appState.myId + "__cam"');
  await until(viewer, `Boolean(document.getElementById('video-el-${ownKey}'))`);
  await js(viewer, `document.querySelectorAll('.stream-tab-chip').forEach(tab => { if (tab.textContent.includes('Espectador')) tab.click(); });void 0`);
  assert(await js(viewer, `originalMixer.audible === true`), 'Focar outra transmissão deve manter o som do popup');
  await click(viewer, '#btn-stage-pip');
  await until(thirdPlayer, 'document.querySelector("#stream-name").textContent.includes("Espectador")');
  await until(viewer, `document.getElementById('video-el-${key}').srcObject === originalStream && !document.getElementById('video-el-${key}').paused && !document.getElementById('video-el-${ownKey}').srcObject?.getVideoTracks().length`);
  await js(viewer, `document.querySelectorAll('.stream-tab-chip').forEach(tab => { if (tab.textContent.includes('Emissor')) tab.click(); });void 0`);
  await click(viewer, '#btn-stage-pip');
  await until(thirdPlayer, 'document.querySelector("#stream-name").textContent.includes("Emissor")');
  await until(viewer, `document.getElementById('video-el-${ownKey}').srcObject?.getVideoTracks().length > 0`);
  await click(viewer, '#btn-stage-stop-watching');
  await pause(300);
  assert(thirdPlayer.isDestroyed(), 'Parar de assistir precisa fechar o player');
  assert(await js(sender, 'appState.myUser.isCameraOn'), 'Parar de assistir não pode encerrar o envio');
  await click(sender, '#btn-share-camera');
  await click(viewer, '#btn-share-camera');
  await js(sender, `
    appState.myUser.streamQuality='1080p60';
    window.startCanvas=document.createElement('canvas');
    startCanvas.width=1920;startCanvas.height=1080;
    const paint=startCanvas.getContext('2d');
    let frame=0;
    window.startPaintTimer=setInterval(()=>{
      paint.fillStyle='#313338';paint.fillRect(0,0,1920,1080);
      paint.fillStyle='#5865f2';paint.fillRect((frame++*12)%1600,240,320,320);
      paint.fillStyle='#ffffff';paint.font='48px sans-serif';paint.fillText('Transmissão sintética 1080p60',80,100);
    },16);
    const stream=startCanvas.captureStream(60);
    window.startAudio=new AudioContext();
    const tone=startAudio.createOscillator();const output=startAudio.createMediaStreamDestination();
    tone.connect(output);tone.start();stream.addTrack(output.stream.getAudioTracks()[0]);
    navigator.mediaDevices.getDisplayMedia=async()=>stream;
    void 0;
  `);
  await click(sender, '#btn-share-screen');
  await until(sender, `!document.getElementById('modal-audio-picker').classList.contains('hidden')`);
  await js(sender, `Array.from(document.querySelectorAll('#audio-picker-list button')).find(button=>button.textContent.includes('Som do PC inteiro')).click();void 0`);
  await until(sender, 'Boolean(appState.localScreenStream)');
  const screenKey = await js(sender, 'appState.myId');
  await until(viewer, `Boolean(document.querySelector('[data-stream-key="${screenKey}"]'))`);
  const watchStarted = Date.now();
  await click(viewer, `[data-stream-key="${screenKey}"]`);
  await until(viewer, `document.getElementById('video-el-${screenKey}')?.videoWidth > 0`);
  const firstFrameMs = Date.now() - watchStarted;
  assert(await js(sender, `(()=>{const pc=appState.sfuPublisher?.pc || appState.screenPeersOut.get('${await js(viewer, 'appState.myId')}');return pc?.localDescription.sdp.includes('x-google-start-bitrate=2000')})()`), 'Chromium precisa aceitar a indicação inicial de 2 Mbps da tela');
  await pause(2500);
  const received = await js(viewer, `(()=>{const video=document.getElementById('video-el-${screenKey}');return {width:video.videoWidth,height:video.videoHeight}})()`);
  assert(await js(sender, `appState.localScreenStream.getVideoTracks()[0].getSettings().width === 1920`), 'A fonte de teste precisa ser 1080p');
  await until(viewer, `Boolean(appState.mixerManager.streamMixers.get('${screenKey}')?.sourceNode)`);
  await js(viewer, `
    const mixer=appState.mixerManager;
    window.volumeAnalyser=mixer.audioContext.createAnalyser();
    volumeAnalyser.fftSize=4096;
    mixer.outputGain.connect(volumeAnalyser);
    window.measureStreamVolume=async()=>{
      await new Promise(resolve=>setTimeout(resolve,180));
      const samples=new Float32Array(volumeAnalyser.fftSize);
      let energy=0;
      for(let n=0;n<8;n++){
        volumeAnalyser.getFloatTimeDomainData(samples);
        energy+=samples.reduce((sum,x)=>sum+x*x,0)/samples.length;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      return Math.sqrt(energy/8);
    };
    void 0;
  `);
  const adjust = async (selector, percent) => js(viewer, `(()=>{const slider=document.querySelector('${selector}');slider.value='${percent}';slider.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await adjust('#input-stream-volume', 100);
  await adjust('#input-master-volume', 100);
  const baseVolume = await js(viewer, 'measureStreamVolume()');
  assert(baseVolume > .005, 'A transmissão WebRTC deve entregar som ao mixer');
  for (const percent of [50, 100, 150, 200, 250, 300]) {
    await adjust('#input-stream-volume', percent);
    const ratio = await js(viewer, 'measureStreamVolume()') / baseVolume;
    assert(Math.abs(ratio - percent/100) < .12, `Transmissão em ${percent}%: amplitude relativa ${ratio.toFixed(2)}`);
  }
  await adjust('#input-stream-volume', 100);
  for (const percent of [50, 0, 100, 200]) {
    await adjust('#input-master-volume', percent);
    const ratio = await js(viewer, 'measureStreamVolume()') / baseVolume;
    assert(Math.abs(ratio - percent/100) < .12, `Volume geral em ${percent}%: amplitude relativa ${ratio.toFixed(2)}`);
  }
  await adjust('#input-master-volume', 100);
  assert(await js(viewer, `document.getElementById('video-el-${screenKey}').muted && document.getElementById('video-el-${screenKey}').dataset.mixerOutput === '1'`), 'O vídeo deve ficar mudo para não tocar som fora do volume geral');
  console.log('Amplitude real da transmissão: 50–300%; volume geral: 0/50/100/200%.');
  await click(sender, '#btn-stage-diagnostics');
  await until(sender, `document.getElementById('transmission-diagnostics-results').textContent.includes('Resolução da captura')`);
  assert(await js(sender, `document.getElementById('transmission-diagnostics-results').textContent.includes('1920 × 1080')`), 'Diagnóstico precisa identificar a captura real');
  fs.writeFileSync('/tmp/teletela-diagnostico-envio.png', (await sender.webContents.capturePage()).toPNG());
  await click(viewer, '#btn-stage-diagnostics');
  await until(viewer, `document.getElementById('transmission-diagnostics-results').textContent.includes('Resolução recebida')`);
  fs.writeFileSync('/tmp/teletela-diagnostico-recepcao.png', (await viewer.webContents.capturePage()).toPNG());
  await js(sender, 'clearInterval(startPaintTimer);void 0');
  console.log(`Tela sintética 1080p60 (${process.env.TEST_SFU === '1' ? 'SFU' : 'P2P'}): primeiro quadro em ${firstFrameMs} ms; recebendo ${received.width} × ${received.height} após 2,5 s. Não simula a rede dos amigos.`);
  console.log('Janela de transmissão: WebRTC real, indicação de bitrate aceita, volume/mute/restauração, vídeo só no popup, retorno automático, áudio preservado, troca de transmissão, tamanho, tela cheia, temas e parar de assistir passaram.');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  clearTimeout(timeout);
  BrowserWindow.getAllWindows().forEach(win => win.destroy());
  if (call) await call.close();
  fs.rmSync(directory, { recursive: true, force: true });
  app.exit(process.exitCode || 0);
});
