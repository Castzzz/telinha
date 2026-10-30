// Teste local com duas janelas, WebRTC real e autostart em diretório temporário.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { registerAppScheme, handleAppProtocol, roomUrl } = require('../electron/app-protocol.cjs');
registerAppScheme();
app.disableHardwareAcceleration();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-tools-ui-'));
app.setPath('userData', path.join(directory, 'electron'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.on('window-all-closed', () => {});
process.env.TELINHA_DATA_DIR = path.join(directory, 'data'); process.env.SFU_SECRET = ''; process.env.TELINHA_MUSIC = '0';
fs.mkdirSync(path.join(process.env.TELINHA_DATA_DIR, 'text'), { recursive: true });
fs.writeFileSync(path.join(process.env.TELINHA_DATA_DIR, 'channels.json'), JSON.stringify({ channels: [], textChannels: [{ id: 'arquivo', name: 'Arquivo' }] }));
const messages = Array.from({ length: 300 }, (_, i) => ({ id: 'antiga-' + i, channelId: 'arquivo', userName: 'João', text: 'Café da turma ' + i, timestamp: Date.now() - (300 - i) * 1000 }));
fs.writeFileSync(path.join(process.env.TELINHA_DATA_DIR, 'text', 'arquivo.jsonl'), messages.map(m => JSON.stringify(m)).join('\n') + '\n');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = async (win, code) => { try { return await win.webContents.executeJavaScript(code); } catch (error) { console.error('Falha no trecho de teste:', code); throw error; } };
async function until(win, condition) { for (let i = 0; i < 160; i++) { if (await js(win, condition)) return; await pause(75); } throw new Error('Estado não chegou: ' + condition); }
const click = (win, selector) => js(win, `document.querySelector(${JSON.stringify(selector)}).click();void 0`);
let failPrefs = false;
let backend; const windows = [], errors = [];
const timeout = setTimeout(() => { console.error('Tempo esgotado'); app.exit(1); }, 65000);
app.whenReady().then(async () => {
  fs.mkdirSync(path.join(directory, 'config/hypr'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'config/hypr/hyprland.conf'), 'exec-once = waybar\n');
  const autostart = require('../electron/autostart.cjs').createAutostart({ app, env: { XDG_CONFIG_HOME: path.join(directory, 'config'), XDG_CURRENT_DESKTOP: 'Hyprland' } });
  ipcMain.handle('autostart-get', () => autostart.get()); ipcMain.handle('autostart-set', (_event, enabled) => autostart.set(enabled));
  const preferences = new Map();
  ipcMain.handle('prefs-get', event => preferences.get(event.sender.id) || {});
  ipcMain.handle('prefs-set', (event, patch) => { if (failPrefs) return false; preferences.set(event.sender.id, { ...preferences.get(event.sender.id), ...patch }); return true; });
  ipcMain.handle('get-game-activity', () => ({ activity: null })); ipcMain.handle('set-global-hotkeys', () => ({}));
  backend = await import('../server.js'); const server = await backend.startServer(0, '127.0.0.1');
  async function open(name) {
    const win = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { partition: 'tools-' + name, preload: path.join(__dirname, '../electron/preload.cjs'), offscreen: true, backgroundThrottling: false } });
    windows.push(win); preferences.set(win.webContents.id, { profile: { id: 'tools-profile-' + name, name, color: '#5865f2' }, seenWhatsNew: '99', micOn: false });
    win.webContents.on('console-message', event => { if (event.level === 'error' && !event.message.includes('Autofill')) { errors.push(event.message); console.error('[Interface]', event.message); } });
    handleAppProtocol(win.webContents.session); await win.loadURL(roomUrl('http://127.0.0.1:' + server.address().port));
    await until(win, 'Boolean(window.appState?.myId && document.querySelector("#channel-geral"))');
    await js(win, "document.querySelectorAll('.modal-backdrop').forEach(el=>el.classList.add('hidden'));void 0");
    return win;
  }
  const first = await open('Cast'), second = await open('Amigo');
  await click(first, '#btn-open-settings'); await until(first, '!document.querySelector("#autostart-setting").classList.contains("hidden")');
  await click(first, '#check-autostart'); await until(first, '!document.querySelector("#check-autostart").disabled && document.querySelector("#check-autostart").checked');
  assert(autostart.get().enabled); assert(fs.existsSync(path.join(directory, 'config/autostart/telinha.desktop')));
  await new Promise(resolve => { first.webContents.once('did-finish-load', resolve); first.webContents.reload(); }); await until(first, 'Boolean(window.appState?.myId && document.querySelector("#channel-geral"))');
  await click(first, '#btn-open-settings'); await until(first, 'document.querySelector("#check-autostart").checked');
  await until(first, '!document.querySelector("#modal-settings").classList.contains("hidden")'); await pause(200);
  await fs.promises.writeFile('/tmp/teletela-inicializacao.png', (await first.webContents.capturePage()).toPNG());
  await click(first, '#check-autostart'); await until(first, '!document.querySelector("#check-autostart").disabled && !document.querySelector("#check-autostart").checked'); assert(!autostart.get().enabled);
  assert.equal(fs.readFileSync(path.join(directory,'config/hypr/hyprland.conf'),'utf8'),'exec-once = waybar\n');

  if (process.env.TEST_PERSONALIZATION === '1') {
    await click(first, '[data-personal-accent="#047857"]');
    await until(first, 'document.documentElement.style.getPropertyValue("--accent-brand") === "#047857"');
    await js(first, `(async()=>{
      const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=600;
      const ctx=canvas.getContext('2d'), gradient=ctx.createLinearGradient(0,0,1000,600);
      gradient.addColorStop(0,'#8b5cf6');gradient.addColorStop(.5,'#06b6d4');gradient.addColorStop(1,'#f59e0b');ctx.fillStyle=gradient;ctx.fillRect(0,0,1000,600);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      const transfer=new DataTransfer();transfer.items.add(new File([blob],'fundo.png',{type:'image/png'}));
      const input=document.querySelector('#personal-wallpaper-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await until(first, 'document.documentElement.classList.contains("has-personal-wallpaper") && document.querySelector("#personal-status").textContent.includes("salva")');
    await js(first, 'document.querySelector("#personal-wallpaper-intensity").value=30;document.querySelector("#personal-wallpaper-intensity").dispatchEvent(new Event("input"));document.querySelector("#personal-wallpaper-intensity").dispatchEvent(new Event("change"));void 0');
    await until(first, 'document.querySelector("#personal-wallpaper-value").textContent==="30%"');
    await pause(150); await fs.promises.writeFile('/tmp/teletela-personalizacao-config.png', (await first.webContents.capturePage()).toPNG());
    assert(preferences.get(first.webContents.id).appearanceExperiment.wallpaper.startsWith('data:image/webp;base64,'));
    assert.equal(preferences.get(first.webContents.id).appearanceExperiment.intensity,30);
    await new Promise(resolve => { first.webContents.once('did-finish-load', resolve); first.webContents.reload(); });
    await until(first, 'Boolean(window.appState?.myId && document.documentElement.classList.contains("has-personal-wallpaper"))');
    assert(await js(first, 'document.documentElement.style.getPropertyValue("--accent-brand")==="#047857"'));
    await js(first, "document.querySelectorAll('.modal-backdrop').forEach(el=>el.classList.add('hidden'));void 0");
    for(const theme of ['escuro','preto','claro']) {
      await js(first, `document.documentElement.dataset.theme='${theme}';void 0`);await pause(150);
      await fs.promises.writeFile(`/tmp/teletela-personalizacao-${theme}.png`, (await first.webContents.capturePage()).toPNG());
    }
    await click(first,'#btn-open-settings');await until(first,'!document.querySelector("#modal-settings").classList.contains("hidden")');
    failPrefs=true;await click(first,'[data-personal-accent="#be123c"]');
    await until(first,'document.querySelector("#personal-status").textContent.includes("anterior foi restaurada")');
    assert(await js(first,'document.documentElement.style.getPropertyValue("--accent-brand")==="#047857"'));failPrefs=false;
    await click(first,'#personal-remove-wallpaper');await until(first,'!document.documentElement.classList.contains("has-personal-wallpaper")');
    await click(first,'#personal-reset');await until(first,'!document.documentElement.style.getPropertyValue("--accent-brand")');
    assert.equal(preferences.get(first.webContents.id).profile.name,'Cast');
    assert(await js(first,'document.documentElement.dataset.theme==="claro"'));
    console.log('Personalização: cor, contraste, imagem local, intensidade, persistência após reabrir, falha de gravação, remoção e restauração passaram; perfil e tema preservados.');
  }

  await js(first, "document.querySelectorAll('.modal-backdrop').forEach(el=>el.classList.add('hidden'));document.querySelector('[data-text-channel-id=arquivo]').click();void 0");
  await click(first, '#btn-chat-search');
  await js(first, "document.querySelector('#message-search-query').value='cafe da turma 0';document.querySelector('#message-search-form').requestSubmit();void 0");
  await until(first, 'document.querySelectorAll("#message-search-results > article").length === 1');
  assert(await js(first, 'document.querySelector("#message-search-results").textContent.includes("Café da turma 0")'));
  await pause(720); await click(first, '#message-search-results button'); await until(first, 'Boolean(document.querySelector(".search-context"))');
  for (const theme of ['escuro', 'preto', 'claro']) {
    await js(first, `document.documentElement.dataset.theme='${theme}';void 0`); await pause(100);
    await fs.promises.writeFile(`/tmp/teletela-busca-${theme}.png`, (await first.webContents.capturePage()).toPNG());
  }
  first.setSize(390, 844); await pause(200);
  assert(await js(first, 'document.querySelector("#modal-message-search .modal-card").getBoundingClientRect().width <= innerWidth'));
  await fs.promises.writeFile('/tmp/teletela-busca-mobile.png', (await first.webContents.capturePage()).toPNG());
  first.setSize(1280, 900);
  for (const win of windows) {
    await js(win, "document.querySelectorAll('.modal-backdrop').forEach(el=>el.classList.add('hidden'));document.querySelector('#channel-geral .channel-row').click();void 0");
    await until(win, "appState.currentChannelId === 'geral'");
  }
  await click(first, '#btn-share-camera'); await until(first, 'appState.myUser.isCameraOn');
  const key = await js(first, 'appState.myId + "__cam"');
  await until(second, `Boolean(document.querySelector('[data-stream-key="${key}"]'))`); await click(second, `[data-stream-key="${key}"]`);
  await until(second, `Boolean(appState.activeStreams.get('${key}')?.stream)`);
  await click(second, '#btn-stage-diagnostics');
  await until(second, 'document.querySelector("#transmission-diagnostics-results").textContent.includes("VP8")');
  await pause(2300);
  assert(await js(second, 'document.querySelector("#transmission-diagnostics-results").textContent.includes("kb/s")'));
  await fs.promises.writeFile('/tmp/teletela-diagnostico.png', (await second.webContents.capturePage()).toPNG());
  await click(second, '[data-close-modal=modal-transmission-diagnostics]');
  await click(first, '#btn-settings-diagnostics'); await until(first, 'document.querySelector("#transmission-diagnostics-results").textContent.includes("Enviando")');
  assert(await js(first, 'appState.myUser.isCameraOn'), 'Medir não para a câmera');
  assert(!errors.length, errors.join('\n'));
  console.log('Interface: autostart persistido e removido em pasta temporária, busca fora do cache com contexto, três temas/celular, diagnóstico de envio e recepção WebRTC reais passaram.');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  clearTimeout(timeout); windows.forEach(win => { if (!win.isDestroyed()) win.destroy(); });
  if (backend) await new Promise(resolve => backend.io.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true }); app.exit(process.exitCode || 0);
});
