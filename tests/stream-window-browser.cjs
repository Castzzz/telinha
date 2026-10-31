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
  const { startMusicCall } = await import('../scripts/music-call.mjs');
  call = await startMusicCall({ port: 0 });
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
  const key = await js(sender, 'appState.myId + "__cam"');
  await until(viewer, `Boolean(document.querySelector('[data-stream-key="${key}"]'))`);
  await click(viewer, `[data-stream-key="${key}"]`);
  await until(viewer, `Boolean(appState.activeStreams.get('${key}')?.stream)`);
  await js(viewer, `window.originalStream=appState.activeStreams.get('${key}').stream;void 0`);
  const created = new Promise(resolve => viewer.webContents.once('did-create-window', resolve));
  await click(viewer, '#btn-stage-pip');
  const player = await created;
  await until(player, 'Boolean(document.querySelector("video")?.videoWidth)');
  assert(player.isResizable() && player.isMaximizable() && player.isFullScreenable(), 'Janela precisa permitir tamanho e tela cheia');
  assert(await js(player, 'document.querySelector("video").muted'), 'Player deve manter o áudio no mixer original');
  assert(await js(viewer, `appState.activeStreams.get('${key}').stream === originalStream`), 'Abrir janela não pode substituir o stream recebido');
  assert.equal(await js(player, 'typeof window.electronAPI'), 'undefined', 'Player não precisa da ponte privilegiada');
  player.setSize(1200, 800);
  await click(player, '#fullscreen');
  await until(player, 'Boolean(document.fullscreenElement)');
  await pause(400);
  assert(player.isFullScreen(), 'Tela cheia deve ocupar a janela nativa');
  await js(player, 'document.querySelector("#fullscreen").focus();void 0');
  const buttonPoint = await js(player, '(()=>{const r=document.querySelector("#fullscreen").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
  player.webContents.sendInputEvent({ type: 'mouseMove', ...buttonPoint });
  await until(player, 'document.querySelector("#stream-player").classList.contains("controls-idle")');
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
  const reopened = new Promise(resolve => viewer.webContents.once('did-create-window', resolve));
  await click(viewer, '#btn-stage-pip');
  const secondPlayer = await reopened;
  await until(secondPlayer, 'Boolean(document.querySelector("video")?.videoWidth)');
  await click(viewer, '#btn-stage-pip');
  await pause(200);
  assert(secondPlayer.isDestroyed(), 'Segundo clique fecha o player');
  const thirdCreated = new Promise(resolve => viewer.webContents.once('did-create-window', resolve));
  await click(viewer, '#btn-stage-pip');
  const thirdPlayer = await thirdCreated;
  await until(thirdPlayer, 'Boolean(document.querySelector("video")?.videoWidth)');
  await click(viewer, '#btn-stage-stop-watching');
  await pause(300);
  assert(thirdPlayer.isDestroyed(), 'Parar de assistir precisa fechar o player');
  assert(await js(sender, 'appState.myUser.isCameraOn'), 'Parar de assistir não pode encerrar o envio');
  console.log('Janela de transmissão: WebRTC real, vídeo, áudio sem duplicação, tamanho, tela cheia, temas, fechar/reabrir e parar de assistir passaram.');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  clearTimeout(timeout);
  BrowserWindow.getAllWindows().forEach(win => win.destroy());
  if (call) await call.close();
  fs.rmSync(directory, { recursive: true, force: true });
  app.exit(process.exitCode || 0);
});
