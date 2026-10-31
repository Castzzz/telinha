const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { registerAppScheme, handleAppProtocol, roomUrl } = require('../electron/app-protocol.cjs');
registerAppScheme(); app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-controles-amigos-ui-'));
app.setPath('userData', path.join(dir, 'electron'));
process.env.TELINHA_DATA_DIR = path.join(dir, 'data'); process.env.TELINHA_MUSIC = '0'; process.env.SFU_SECRET = '';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = (win, code) => win.webContents.executeJavaScript(code, true);
const click = (win, selector) => js(win, `document.querySelector(${JSON.stringify(selector)}).click();void 0`);
async function until(win, code) { for (let i = 0; i < 160; i++) { if (await js(win, code)) return; await pause(50); } throw new Error('Estado esperado: ' + code); }
const windows = [], prefs = new Map(); let backend, failPrefs = false;
const timeout = setTimeout(() => { console.error('Tempo esgotado'); app.exit(1); }, 120000);
app.whenReady().then(async () => {
  ipcMain.handle('prefs-get', event => prefs.get(event.sender.id) || {});
  ipcMain.handle('prefs-set', (event, patch) => { if (failPrefs) return false; prefs.set(event.sender.id, { ...prefs.get(event.sender.id), ...patch }); return true; });
  ipcMain.handle('get-game-activity', () => ({ activity: null })); ipcMain.handle('set-global-hotkeys', () => ({}));
  ipcMain.handle('autostart-get', () => ({ supported: false })); ipcMain.handle('system-idle-seconds', () => 0);
  backend = await import('../server.js'); const server = await backend.startServer(0, '127.0.0.1');
  const url = `http://127.0.0.1:${server.address().port}`;
  async function open(name) {
    const win = new BrowserWindow({ width: 1180, height: 900, show: false, webPreferences: { partition: 'amigos-' + name, preload: path.join(__dirname, '../electron/preload.cjs'), offscreen: true, backgroundThrottling: false } });
    windows.push(win); prefs.set(win.webContents.id, { profile: { id: 'amigos-ui-' + name, name, color: '#5865F2' }, seenWhatsNew: '99', micOn: false });
    handleAppProtocol(win.webContents.session); await win.loadURL(roomUrl(url)); await until(win, 'Boolean(window.appState?.myId)');
    await js(win, "document.querySelectorAll('.modal-backdrop').forEach(el=>el.classList.add('hidden'));void 0"); return win;
  }
  async function account(win, username) {
    await click(win, '#btn-open-settings'); await click(win, '[data-settings-tab=conta]'); await click(win, '[data-account-mode=register]');
    await js(win, `document.querySelector('#account-user').value=${JSON.stringify(username)};document.querySelector('#account-password').value='senha-dos-testes';document.querySelector('#account-confirm').value='senha-dos-testes';document.querySelector('#account-form').requestSubmit();void 0`);
    await until(win, "!document.querySelector('#account-recovery-result').classList.contains('hidden')");
    assert.match(await js(win, "document.querySelector('#account-recovery-code').textContent"), /^[a-f0-9-]{53}$/);
    await until(win, "document.querySelector('#account-status').textContent.includes('vinculado')");
    const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve)); await click(win, '#account-continue'); await loaded;
    await until(win, 'Boolean(window.appState?.myId)');
    await click(win, '#btn-open-settings'); await click(win, '[data-settings-tab=amigos]');
    await until(win, "!document.querySelector('#friends-content').classList.contains('hidden')");
  }
  const a = await open('Cast'), b = await open('Amigo'); await account(a, 'cast_teste'); await account(b, 'amigo_teste');
  await js(a, "document.querySelector('#friend-username').value='@amigo_teste';document.querySelector('#friends-form').requestSubmit();void 0");
  await until(b, 'Boolean(document.querySelector("#friends-incoming button"))');
  await click(b, '#friends-incoming button'); await until(a, "document.querySelector('#friends-list').textContent.includes('Online')");
  for (const theme of ['escuro', 'preto', 'claro']) {
    await js(a, `document.documentElement.dataset.theme='${theme}';void 0`); await pause(100);
    fs.writeFileSync(`/tmp/teletela-amigos-${theme}.png`, (await a.webContents.capturePage()).toPNG());
  }
  b.setSize(390, 844); await pause(200);
  assert(await js(b, 'document.documentElement.scrollWidth <= innerWidth'));
  fs.writeFileSync('/tmp/teletela-amigos-celular.png', (await b.webContents.capturePage()).toPNG());
  await click(a, '[data-settings-tab=conta]'); failPrefs = true; await click(a, '#account-logout');
  await until(a, "document.querySelector('#account-feedback').textContent.includes('Não foi possível salvar')"); failPrefs = false;
  assert(prefs.get(a.webContents.id).accountSessions[url]?.token);
  await click(a, '[data-settings-tab=amigos]');
  await click(a, '#friends-list button'); await until(b, "document.querySelector('#friends-list').textContent.includes('Nenhum amigo')");
  // Reabrir preserva conta e perfil, sem publicar o visitante salvo no aparelho.
  await a.webContents.reload(); await until(a, 'Boolean(window.appState?.myId)');
  await click(a, '#btn-open-settings'); await click(a, '[data-settings-tab=conta]'); await until(a, "document.querySelector('#account-username').textContent === '@cast_teste'");
  await click(a, '#account-logout'); await until(a, "document.querySelector('#account-status').textContent.includes('sem conta')");
  await js(a, "document.querySelectorAll('.modal-backdrop').forEach(el=>el.classList.add('hidden'));document.querySelector('#channel-geral .channel-row').click();void 0");
  await until(a, 'Boolean(appState.currentChannelId)');
  await js(a, `(async()=>{
    const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#18243c';ctx.fillRect(0,0,960,540);
    ctx.fillStyle='#b3c9ff';ctx.font='36px sans-serif';ctx.fillText('Transmissão de teste',100,260);
    window.fixtureStream=canvas.captureStream(5);
    const tile=document.createElement('div');tile.className='video-tile';tile.id='video-tile-controles';
    const video=document.createElement('video');video.muted=true;video.autoplay=true;video.srcObject=fixtureStream;tile.append(video);
    document.querySelector('#videos-grid').append(tile);document.querySelector('#videos-grid').classList.remove('hidden');document.querySelector('#voice-lounge').classList.add('hidden');
    appState.activeStreams.set('controles',{stream:fixtureStream,userName:'Teste',isLocal:true});appState.focusedStreamUserId='controles';await video.play();
  })()`);
  async function hideAndReveal() {
    await js(a, 'document.activeElement?.blur();void 0');
    a.webContents.sendInputEvent({ type: 'mouseMove', x: 350, y: 200 });
    await until(a, "document.body.classList.contains('stage-controls-idle')"); await pause(250);
    assert.equal(await js(a, "getComputedStyle(document.querySelector('#stage-controls-bar')).opacity"), '0');
    fs.writeFileSync('/tmp/teletela-controles-ocultos.png', (await a.webContents.capturePage()).toPNG());
    a.webContents.sendInputEvent({ type: 'mouseMove', x: 360, y: 210 });
    await until(a, "!document.body.classList.contains('stage-controls-idle')");
    await js(a, "document.querySelector('#btn-stage-fullscreen').focus();void 0");
    a.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' }); a.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    assert(await js(a, "!document.body.classList.contains('stage-controls-idle')"));
    await js(a, "document.activeElement?.blur();document.querySelector('#stage-controls-bar').dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));void 0");
    await pause(3250); assert(await js(a, "!document.body.classList.contains('stage-controls-idle')"));
    await js(a, "document.querySelector('#stage-controls-bar').dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}));void 0");
  }
  for (const selector of ['#videos-grid', '#video-tile-controles']) {
    await js(a, `document.querySelector('${selector}').requestFullscreen()`);
    await hideAndReveal(); await js(a, 'document.exitFullscreen()');
    await until(a, "!document.fullscreenElement && !document.body.classList.contains('stage-controls-idle')");
  }
  await js(a, "document.body.classList.add('stage-fullscreen');void 0"); await hideAndReveal();
  await js(a, "document.body.classList.remove('stage-fullscreen');void 0");
  await until(a, "!document.body.classList.contains('stage-controls-idle')");
  console.log('Contas: cadastro, recuperação exibida, sessão ao reabrir, falha ao salvar logout e saída. Amigos: pedido, aceite, sincronização, remoção e três temas/celular. Tela cheia: vídeo, mosaico, alternativa CSS, inatividade, mouse, teclado e interação nos controles passaram.');
}).then(() => finish(0)).catch(error => { console.error(error); finish(1); });
async function finish(code) { clearTimeout(timeout); windows.forEach(win => win.destroy()); if (backend) await new Promise(resolve => backend.io.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); app.exit(code); }
