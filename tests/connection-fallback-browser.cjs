// Exercita a interface instalada com WebSocket liberado e bloqueado pela rede.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerAppScheme, handleAppProtocol, roomUrl } = require('../electron/app-protocol.cjs');

registerAppScheme();
app.disableHardwareAcceleration();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-conexao-'));
app.setPath('userData', path.join(directory, 'electron'));
app.on('window-all-closed', () => {});
process.env.TELINHA_DATA_DIR = path.join(directory, 'data');
process.env.SFU_SECRET = '';
process.env.TELINHA_MUSIC = '0';
const windows = [], preferences = new Map();
let backend;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error('Teste de conexão excedeu o tempo.'); app.exit(1); }, 45000);

app.whenReady().then(async () => {
  ipcMain.handle('prefs-get', event => preferences.get(event.sender.id) || {});
  ipcMain.handle('prefs-set', (event, patch) => {
    preferences.set(event.sender.id, { ...preferences.get(event.sender.id), ...patch });
    return true;
  });
  ipcMain.handle('get-game-activity', () => ({ activity: null }));
  ipcMain.handle('set-global-hotkeys', () => ({}));
  ipcMain.handle('system-idle-seconds', () => 0);
  ipcMain.handle('autostart-get', () => ({ supported: false, enabled: false }));
  backend = await import('../server.js');
  const server = await backend.startServer(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${server.address().port}`;

  for (const blocked of [false, true]) {
    const win = new BrowserWindow({ width: 1280, height: 900, show: false,
      webPreferences: { partition: `conexao-${blocked}`, preload: path.join(__dirname, '../electron/preload.cjs'),
        offscreen: true, backgroundThrottling: false } });
    windows.push(win);
    preferences.set(win.webContents.id, { profile: { id: `conexao-${blocked}`, name: 'Teste de conexão', color: '#5865f2' },
      seenWhatsNew: '4.3.2', shareGameActivity: false, micOn: false });
    handleAppProtocol(win.webContents.session);
    let blockedRequests = 0;
    if (blocked) win.webContents.session.webRequest.onBeforeRequest({ urls: ['ws://*/*', 'wss://*/*'] }, (_details, callback) => {
      blockedRequests++;
      callback({ cancel: true });
    });
    const js = code => win.webContents.executeJavaScript(code);
    async function connected(previousId) {
      for (let i = 0; i < 160; i++) {
        const id = await js('window.appState?.myId');
        const client = id && backend.io.sockets.sockets.get(id);
        if (client && id !== previousId && await js('Boolean(document.querySelector("#channel-geral"))')) return client;
        await pause(50);
      }
      throw new Error(`A interface não conectou (WebSocket bloqueado: ${blocked}).`);
    }
    await win.loadURL(roomUrl(origin));
    const client = await connected();
    assert.equal(client.conn.transport.name, blocked ? 'polling' : 'websocket');
    console.log(`Interface conectada via ${client.conn.transport.name}.`);
    if (blocked) {
      assert(blockedRequests > 0, 'O teste precisa bloquear uma tentativa real de WebSocket.');
      await js('document.querySelectorAll(".modal-backdrop").forEach(el => el.classList.add("hidden")); document.querySelector("#channel-geral .channel-row").click(); void 0');
      for (let i = 0; i < 100 && client.data.user.channelId !== 'geral'; i++) await pause(50);
      assert.equal(client.data.user.channelId, 'geral', 'Deve permitir entrar no canal pela conexão alternativa.');
      // Queda do transporte deve retomar a conexão e o perfil via HTTP.
      client.conn.close();
      const reconnected = await connected(client.id);
      assert.equal(reconnected.conn.transport.name, 'polling');
      for (let i = 0; i < 100 && reconnected.data.user.channelId !== 'geral'; i++) await pause(50);
      assert.equal(reconnected.data.user.channelId, 'geral', 'Deve retomar o canal após reconectar.');
      console.log('Interface reconectou via polling depois da queda.');
      await fs.promises.writeFile('/tmp/teletela-conexao-fallback.png', (await win.webContents.capturePage()).toPNG());
    }
    win.destroy();
  }
  console.log('Conexão normal, alternativa HTTP com WebSocket bloqueado e reconexão passaram na interface instalada.');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  clearTimeout(timeout);
  windows.forEach(win => { if (!win.isDestroyed()) win.destroy(); });
  if (backend) await new Promise(resolve => backend.io.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true });
  app.exit(process.exitCode || 0);
});
