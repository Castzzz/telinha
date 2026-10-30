const { app, BrowserWindow, Menu, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, net, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { pathToFileURL } = require('url');
const { execSync, execFileSync, spawn } = require('child_process');
const { registerAppScheme, handleAppProtocol, roomUrl, serverFromUrl } = require('./app-protocol.cjs');
const { createActivityTracker } = require('./game-activity.cjs');
const gameActivity = createActivityTracker();
let gameActivityPrefs = null;

registerAppScheme();
// O app virou Teletela, mas os dados (perfil, preferências, volumes) continuam na pasta
// antiga: sem isso o Electron usaria uma pasta "Teletela" nova e todo mundo perderia tudo
app.setPath('userData', path.join(app.getPath('appData'), 'Telinha'));
// No Wayland o portal só aceita atalho global de app com .desktop: sem isso, rodando
// com "npm run app", o Chromium se registra como "electron" e o portal recusa
app.setDesktopName('telinha.desktop');

// Habilita suporte nativo a PipeWire e loopback de áudio de tela no Linux/Wayland/X11
// GlobalShortcutsPortal: atalhos globais (mutar com o app em segundo plano) no Wayland
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer,PulseaudioLoopbackForScreenShare,GlobalShortcutsPortal');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow = null;
let selectedDesktopSourceId = null;
let tunnelProcess = null;
let publicUrl = null;
let launcherError = null;
const PORT = Number(process.env.PORT) || 8080;
const CONNECT_PAGE = path.join(__dirname, 'connect.html');
// Sala fixa na VM da Oracle (sempre ligada, transmissão pelo repassador)
const SERVER_ROOM_URL = 'https://colheitafartus.duckdns.org';

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(patch) {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify({ ...loadConfig(), ...patch }, null, 2));
  } catch (err) {
    console.warn('[Electron] Não foi possível salvar config:', err.message);
  }
}

// Preferências da interface (perfil, volumes, atalhos). Ficam aqui e não no localStorage
// porque o localStorage depende do link da sala, que muda toda vez que alguém hospeda.
const { createPreferences } = require('./preferences.cjs');
const preferences = createPreferences(app.getPath('userData'));
const loadPrefs = preferences.load;
const savePrefs = preferences.save;
const autostart = require('./autostart.cjs').createAutostart({ app });

// Atalhos que funcionam mesmo com o Telinha em segundo plano (ex: mutar no meio do jogo)
// Teclas sozinhas que o globalShortcut não aceita (Ctrl da direita, Shift, Alt...): quem
// escuta é o uiohook, que só observa o teclado (a tecla continua indo pro jogo).
const SOLO_KEYS = {
  LeftCtrl: 'Ctrl', RightCtrl: 'CtrlRight', LeftShift: 'Shift', RightShift: 'ShiftRight',
  LeftAlt: 'Alt', RightAlt: 'AltRight', LeftSuper: 'Meta', RightSuper: 'MetaRight'
};
let uiohook = null;
let uiohookFailed = false;
let soloHotkeys = new Map(); // keycode -> ação
let soloSender = null;

function loadUiohook() {
  if (uiohook || uiohookFailed) return uiohook;
  try {
    const { uIOhook, UiohookKey } = require('uiohook-napi');
    uIOhook.on('keydown', (e) => {
      const action = soloHotkeys.get(e.keycode);
      if (action && soloSender && !soloSender.isDestroyed()) soloSender.send('global-hotkey', action);
    });
    uiohook = { hook: uIOhook, keys: UiohookKey, running: false };
  } catch (err) {
    uiohookFailed = true;
    console.warn('[Electron] uiohook indisponível (teclas sozinhas só com a janela na frente):', err.message);
  }
  return uiohook;
}

function setSoloHotkeys(sender, solo) {
  soloSender = sender;
  soloHotkeys = new Map();
  const registered = {};
  const hook = solo.length ? loadUiohook() : uiohook;
  for (const [action, name] of solo) {
    const code = hook?.keys[SOLO_KEYS[name]];
    registered[action] = Boolean(code);
    if (code) soloHotkeys.set(code, action);
  }
  if (!hook) return registered;
  try {
    if (soloHotkeys.size && !hook.running) {
      hook.hook.start();
      hook.running = true;
    } else if (!soloHotkeys.size && hook.running) {
      hook.hook.stop();
      hook.running = false;
    }
  } catch (err) {
    console.warn('[Electron] uiohook não iniciou:', err.message);
    for (const [action] of solo) registered[action] = false;
  }
  return registered;
}

function setGlobalHotkeys(sender, hotkeys) {
  globalShortcut.unregisterAll();
  const registered = {};
  const solo = [];
  for (const [action, accelerator] of Object.entries(hotkeys || {})) {
    if (typeof accelerator !== 'string' || !accelerator) continue;
    if (SOLO_KEYS[accelerator]) {
      solo.push([action, accelerator]);
      continue;
    }
    try {
      registered[action] = globalShortcut.register(accelerator, () => {
        if (!sender.isDestroyed()) sender.send('global-hotkey', action);
      });
    } catch {
      registered[action] = false;
    }
  }
  return { ...registered, ...setSoloHotkeys(sender, solo) };
}

// No Wayland o atalho global de verdade é do compositor (o portal do Electron dá o mesmo
// id pra todos os atalhos e o Hyprland nem liga a tecla sozinho). O compositor chama:
//   curl -s --unix-socket "$XDG_RUNTIME_DIR/telinha.sock" http://telinha/mute   (ou /deafen)
let hotkeySocketServer = null;

function hotkeySocketPath() {
  return process.env.XDG_RUNTIME_DIR ? path.join(process.env.XDG_RUNTIME_DIR, 'telinha.sock') : null;
}

function startHotkeySocket() {
  const sock = hotkeySocketPath();
  if (process.platform !== 'linux' || !sock) return;
  try { fs.unlinkSync(sock); } catch {}
  hotkeySocketServer = http.createServer((req, res) => {
    const action = (req.url || '').replace(/^\/+/, '');
    const ok = ['mute', 'deafen'].includes(action) && mainWindow && !mainWindow.isDestroyed();
    if (ok) mainWindow.webContents.send('global-hotkey', action);
    res.writeHead(ok ? 200 : 404).end(ok ? 'ok\n' : 'ação desconhecida (use /mute ou /deafen)\n');
  });
  hotkeySocketServer.on('error', (err) => console.warn('[Electron] Socket de atalhos:', err.message));
  hotkeySocketServer.listen(sock);
}

function stopHotkeySocket() {
  if (!hotkeySocketServer) return;
  hotkeySocketServer.close();
  hotkeySocketServer = null;
  try { fs.unlinkSync(hotkeySocketPath()); } catch {}
}

function ensureLinuxSystemAudioSource() {
  if (process.platform !== 'linux') return;
  try {
    const sources = execSync('pactl list short sources', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    if (!sources.includes('som_do_pc')) {
      const sink = execSync('pactl get-default-sink', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      if (sink) {
        execSync(
          `pactl load-module module-remap-source master="${sink}.monitor" source_name=som_do_pc source_properties=device.description="Som_do_PC_Jogos_e_Videos"`,
          { stdio: 'ignore' }
        );
      }
    }
  } catch {
    // Ignora caso pactl não esteja disponível
  }
}

// --- Som de um app só (Linux) ------------------------------------------------
// Cria uma saída virtual "Telinha_Transmissao"; os apps escolhidos tocam nela.
// - um loopback devolve esse som pro seu fone (você continua ouvindo o jogo);
// - um remap-source vira o microfone virtual "Telinha_Jogo_Loopback", que vai na transmissão
//   (o Chrome esconde fontes "Monitor of …", por isso o remap).
const APP_SINK = 'telinha_transmissao';
const APP_SOURCE = 'telinha_jogo';
let appAudioModules = [];
let appAudioRoute = null; // { key, timer }

function pactl(args) {
  return execFileSync('pactl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function listSinkInputs() {
  try {
    return JSON.parse(pactl(['-f', 'json', 'list', 'sink-inputs']));
  } catch {
    return [];
  }
}

function appKey(props) {
  return props['application.process.binary'] || props['application.name'] || '';
}

function ownPids() {
  return new Set(app.getAppMetrics().map((m) => String(m.pid)));
}

function listAudioApps() {
  if (process.platform !== 'linux') return [];
  const own = ownPids();
  const apps = new Map();
  for (const input of listSinkInputs()) {
    const props = input.properties || {};
    // Ignora o próprio Telinha (vozes dos amigos) e os loopbacks/módulos
    if (input.owner_module != null || own.has(props['application.process.id'])) continue;
    const key = appKey(props);
    if (!key) continue;
    const prev = apps.get(key);
    apps.set(key, {
      key,
      name: props['application.name'] || key,
      binary: props['application.process.binary'] || '',
      playing: Boolean(prev?.playing) || !input.corked
    });
  }
  return [...apps.values()].sort((a, b) => Number(b.playing) - Number(a.playing));
}

function ensureAppAudioSink() {
  const sinks = pactl(['list', 'short', 'sinks']);
  if (sinks.includes(APP_SINK)) return;
  const defaultSink = pactl(['get-default-sink']).trim();
  const load = (...args) => {
    const id = pactl(['load-module', ...args]).trim();
    if (id) appAudioModules.push(id);
  };
  load('module-null-sink', `sink_name=${APP_SINK}`, 'sink_properties=device.description=Telinha_Transmissao');
  load(
    'module-loopback',
    `source=${APP_SINK}.monitor`,
    `sink=${defaultSink}`,
    'latency_msec=30',
    'source_dont_move=true'
  );
  load(
    'module-remap-source',
    `master=${APP_SINK}.monitor`,
    `source_name=${APP_SOURCE}`,
    'source_properties=device.description=Telinha_Jogo_Loopback'
  );
}

function moveAppStreams() {
  if (!appAudioRoute) return;
  const own = ownPids();
  for (const input of listSinkInputs()) {
    const props = input.properties || {};
    if (input.owner_module != null || own.has(props['application.process.id'])) continue;
    if (appKey(props) !== appAudioRoute.key) continue;
    try {
      pactl(['move-sink-input', String(input.index), APP_SINK]);
    } catch {
      // stream pode ter acabado no meio do caminho
    }
  }
}

function routeAppAudio(key) {
  if (process.platform !== 'linux' || !key) return { ok: false };
  unrouteAppAudio();
  try {
    ensureAppAudioSink();
  } catch (err) {
    return { ok: false, error: err.message };
  }
  appAudioRoute = { key, timer: null };
  moveAppStreams();
  // Jogos abrem streams novos (troca de fase, menu…): continua movendo enquanto transmite
  appAudioRoute.timer = setInterval(moveAppStreams, 1500);
  return { ok: true };
}

function unrouteAppAudio() {
  if (appAudioRoute) {
    clearInterval(appAudioRoute.timer);
    appAudioRoute = null;
  }
  if (!appAudioModules.length) return;
  // Devolve os apps pra saída padrão (senão o PipeWire lembra da saída virtual)
  let sinkIndex = null;
  try {
    const line = pactl(['list', 'short', 'sinks']).split('\n').find((l) => l.split('\t')[1] === APP_SINK);
    if (line) sinkIndex = Number(line.split('\t')[0]);
  } catch {}
  for (const input of listSinkInputs()) {
    if (input.owner_module != null || input.sink !== sinkIndex) continue;
    try {
      pactl(['move-sink-input', String(input.index), '@DEFAULT_SINK@']);
    } catch {}
  }
  for (const id of appAudioModules.reverse()) {
    try {
      pactl(['unload-module', id]);
    } catch {}
  }
  appAudioModules = [];
}

// --- Som de um app só (Windows) ----------------------------------------------
// O telinha-audio.exe usa a captura por processo do Windows 10 2004+/11 e manda
// PCM 16-bit 48 kHz estéreo pelo stdout; aqui só repassamos os pedaços pra página.
// - janela escolhida: som só do app daquela janela;
// - tela inteira: som do PC menos o próprio Telinha (sem eco das vozes).
const WIN_AUDIO_EXE = path.join(__dirname, 'bin', 'telinha-audio.exe');
let winAudioProc = null;

function stopWinAudio() {
  if (!winAudioProc) return;
  try {
    winAudioProc.kill();
  } catch {}
  winAudioProc = null;
}

function startWinAudio(sender, sourceId) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, error: 'só no Windows' });
  if (!fs.existsSync(WIN_AUDIO_EXE)) return Promise.resolve({ ok: false, error: 'telinha-audio.exe não encontrado' });
  stopWinAudio();
  const [kind, hwnd] = String(sourceId || '').split(':');
  const args = kind === 'window' && hwnd ? ['--include-hwnd', hwnd] : ['--exclude-pid', String(process.pid)];

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let proc;
    try {
      proc = spawn(WIN_AUDIO_EXE, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      return finish({ ok: false, error: err.message });
    }
    winAudioProc = proc;
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (/^ready$/m.test(stderr)) finish({ ok: true });
      const error = stderr.match(/^error: (.*)$/m);
      if (error) finish({ ok: false, error: error[1] });
    });
    proc.stdout.on('data', (chunk) => {
      if (winAudioProc === proc && !sender.isDestroyed()) sender.send('win-audio-data', chunk);
    });
    proc.on('error', (err) => finish({ ok: false, error: err.message }));
    proc.on('exit', (code) => {
      if (winAudioProc === proc) winAudioProc = null;
      finish({ ok: false, error: `telinha-audio.exe saiu (código ${code})` });
    });
    const timer = setTimeout(() => {
      stopWinAudio();
      finish({ ok: false, error: 'telinha-audio.exe demorou demais pra começar' });
    }, 4000);
  });
}

// --- Atualização automática (GitHub Releases) ---------------------------------
// Baixa a versão nova em segundo plano e instala ao fechar o app (ou na hora, se pedir).
// Só o instalador do Windows (Setup) e o AppImage do Linux sabem se atualizar sozinhos.
let updateNotified = false;

function canAutoUpdate() {
  if (!app.isPackaged) return false;
  if (process.platform === 'win32') return !process.env.PORTABLE_EXECUTABLE_DIR;
  if (process.platform === 'linux') return Boolean(process.env.APPIMAGE);
  return false;
}

function setupAutoUpdater() {
  if (!canAutoUpdate()) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.warn('[Update] electron-updater indisponível:', err.message);
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (err) => console.warn('[Update] Falhou:', err?.message || err));
  autoUpdater.on('update-downloaded', async (info) => {
    if (updateNotified || !mainWindow) return;
    updateNotified = true;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Reiniciar agora', 'Depois'],
      defaultId: 0,
      cancelId: 1,
      title: 'Atualização do Teletela',
      message: `A versão ${info.version} do Teletela foi baixada.`,
      detail: 'Ela é instalada quando você fechar o app. Quer reiniciar agora?'
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 4 * 60 * 60 * 1000);
}

function checkServerRunning(port) {
  return new Promise((resolve) => {
    // Confere o cliente do socket.io: um servidor antigo/alheio na porta não serve
    const req = http.get(`http://127.0.0.1:${port}/socket.io/socket.io.js`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureLocalServer() {
  const isRunning = await checkServerRunning(PORT);
  if (isRunning) return `http://localhost:${PORT}`;

  try {
    // Sala hospedada no PC: os canais criados ficam salvos na pasta do app
    process.env.TELINHA_DATA_DIR ||= path.join(app.getPath('userData'), 'sala');
    const serverModule = await import(pathToFileURL(path.join(__dirname, '..', 'server.js')).href);
    if (serverModule && typeof serverModule.startServer === 'function') {
      await serverModule.startServer(PORT);
    } else if (serverModule && serverModule.server && !serverModule.server.listening) {
      await new Promise((resolve) => serverModule.server.listen(PORT, '0.0.0.0', resolve));
    }
  } catch (err) {
    console.warn('[Electron] Aviso ao iniciar servidor embutido:', err.message);
  }
  if (!(await checkServerRunning(PORT))) {
    throw new Error(
      `A porta ${PORT} está ocupada por outro programa (ou um servidor antigo do Teletela). Feche-o e tente de novo.`
    );
  }
  return `http://localhost:${PORT}`;
}

function getLanUrls() {
  const urls = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) urls.push(`http://${iface.address}:${PORT}`);
    }
  }
  return urls;
}

// Cria um link público HTTPS temporário via cloudflared (quick tunnel)
function startTunnel() {
  if (publicUrl && tunnelProcess) return Promise.resolve(publicUrl);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, url) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(url);
    };
    let proc;
    try {
      proc = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (err) {
      return finish(err);
    }
    tunnelProcess = proc;
    // O link aparece antes do túnel ficar pronto; só libera após registrar a conexão
    let foundUrl = null;
    let registered = false;
    const onData = (chunk) => {
      const text = chunk.toString();
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) foundUrl = match[0];
      if (/Registered tunnel connection/i.test(text)) registered = true;
      if (foundUrl && registered) {
        publicUrl = foundUrl;
        finish(null, publicUrl);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => {
      tunnelProcess = null;
      finish(err.code === 'ENOENT' ? new Error('cloudflared não está instalado.') : err);
    });
    proc.on('exit', () => {
      tunnelProcess = null;
      publicUrl = null;
      finish(new Error('cloudflared encerrou antes de gerar o link.'));
    });
    const timer = setTimeout(() => finish(new Error('cloudflared demorou demais para gerar o link.')), 60000);
  });
}

function stopTunnel() {
  if (tunnelProcess) {
    tunnelProcess.kill();
    tunnelProcess = null;
  }
}

function normalizeServerUrl(raw) {
  let text = String(raw || '').trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    return url.origin;
  } catch {
    return null;
  }
}

async function isTelinhaServer(origin) {
  try {
    const res = await net.fetch(`${origin}/socket.io/socket.io.js`, { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

function showLauncher(error) {
  launcherError = error || null;
  if (mainWindow) mainWindow.loadFile(CONNECT_PAGE);
}

function fromLauncher(event) {
  return Boolean(event.senderFrame && event.senderFrame.url.startsWith('file:'));
}

function setupLauncherIpc() {
  ipcMain.handle('launcher-state', (event) => {
    if (!fromLauncher(event)) return {};
    const state = { lastServerUrl: loadConfig().lastServerUrl || '', serverRoomUrl: SERVER_ROOM_URL, error: launcherError };
    launcherError = null;
    return state;
  });

  ipcMain.handle('launcher-host', async (event) => {
    if (!fromLauncher(event)) return { ok: false, error: 'negado' };
    let localUrl;
    try {
      localUrl = await ensureLocalServer();
    } catch (err) {
      return { ok: false, error: err.message };
    }
    try {
      const url = await startTunnel();
      return { ok: true, localUrl, publicUrl: url, lanUrls: getLanUrls() };
    } catch (err) {
      return { ok: true, localUrl, publicUrl: null, tunnelError: err.message, lanUrls: getLanUrls() };
    }
  });

  ipcMain.handle('launcher-join', async (event, raw) => {
    if (!fromLauncher(event)) return { ok: false, error: 'negado' };
    const origin = normalizeServerUrl(raw);
    if (!origin) return { ok: false, error: 'Link inválido.' };
    if (!(await isTelinhaServer(origin))) {
      if (origin === SERVER_ROOM_URL) return { ok: false, error: 'A sala do servidor não respondeu. Tente de novo daqui a pouco.' };
      return { ok: false, error: 'Não encontrei uma sala do Teletela nesse link. Confira se seu amigo está hospedando.' };
    }
    saveConfig({ lastServerUrl: origin });
    await mainWindow.loadURL(roomUrl(origin));
    return { ok: true };
  });

  ipcMain.handle('launcher-open', async (event, url) => {
    if (!fromLauncher(event)) return { ok: false };
    if (!/^http:\/\/localhost:\d+$/.test(String(url))) return { ok: false };
    await mainWindow.loadURL(roomUrl(url));
    return { ok: true };
  });

  ipcMain.handle('launcher-copy', (event, text) => {
    if (!fromLauncher(event)) return false;
    clipboard.writeText(String(text || ''));
    return true;
  });
}

function setupMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Teletela',
      submenu: [
        { label: 'Voltar ao início', accelerator: 'CmdOrCtrl+Shift+H', click: () => showLauncher() },
        {
          label: 'Copiar link da sala',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => {
            const server = mainWindow && serverFromUrl(mainWindow.webContents.getURL());
            const isLocal = server && server.startsWith('http://localhost');
            const link = isLocal ? publicUrl : server;
            if (link) clipboard.writeText(link);
          }
        },
        { type: 'separator' },
        // Sem barra do sistema o menu não aparece: os atalhos continuam valendo
        { role: 'reload', label: 'Recarregar', accelerator: 'CmdOrCtrl+R' },
        { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor', accelerator: 'CmdOrCtrl+Shift+I' },
        { role: 'togglefullscreen', label: 'Tela cheia', accelerator: 'F11' },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

function setupPermissionsAndCapture() {
  const ses = session.defaultSession;

  // Permite automaticamente captura de tela, áudio e tela cheia sem popups bloqueantes
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = [
      'media',
      'display-capture',
      'screen',
      'audioCapture',
      'videoCapture',
      'fullscreen',
      'clipboard-sanitized-write'
    ];
    callback(allowed.includes(permission));
  });

  // Handler moderno para navigator.mediaDevices.getDisplayMedia no Electron
  if (typeof ses.setDisplayMediaRequestHandler === 'function') {
    ses.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
        if (!sources || sources.length === 0) {
          return callback({});
        }
        const chosen =
          (selectedDesktopSourceId && sources.find((s) => s.id === selectedDesktopSourceId)) ||
          sources[0];
        selectedDesktopSourceId = null;
        // Windows/macOS: loopback pega o som do PC inteiro.
        // Linux: o som vem do "som_do_pc" (PipeWire/PulseAudio), anexado pela interface.
        if (process.platform === 'linux' || !request.audioRequested) callback({ video: chosen });
        else callback({ video: chosen, audio: 'loopback' });
      } catch (err) {
        console.error('[Electron] Erro no setDisplayMediaRequestHandler:', err);
        callback({});
      }
    });
  }

  ipcMain.handle('get-desktop-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 360, height: 202 },
        fetchWindowIcons: true
      });
      return sources.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.id.startsWith('screen:') ? 'screen' : 'window',
        thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : '',
        appIcon: s.appIcon ? s.appIcon.toDataURL() : null
      }));
    } catch (err) {
      console.error('[Electron] Erro ao listar fontes de tela:', err);
      return [];
    }
  });

  ipcMain.handle('list-audio-apps', () => listAudioApps());
  ipcMain.handle('route-app-audio', (_event, key) => routeAppAudio(String(key || '')));
  ipcMain.handle('unroute-app-audio', () => {
    unrouteAppAudio();
    return { ok: true };
  });

  ipcMain.handle('start-win-audio', (event, sourceId) => startWinAudio(event.sender, sourceId));
  ipcMain.handle('stop-win-audio', () => {
    stopWinAudio();
    return { ok: true };
  });

  const localSettings = event => event.senderFrame && event.senderFrame === event.sender.mainFrame
    && (event.senderFrame.url.startsWith('telinha://app/') || event.senderFrame.url === pathToFileURL(CONNECT_PAGE).href);
  ipcMain.handle('autostart-get', event => localSettings(event) ? autostart.get() : { supported: false, enabled: false });
  ipcMain.handle('autostart-set', (event, enabled) => localSettings(event) ? autostart.set(enabled) : { supported: false, enabled: false });
  ipcMain.handle('prefs-get', () => loadPrefs());
  ipcMain.handle('get-game-activity', async () => {
    // Evita reler e decodificar fotos/GIFs do prefs.json a cada consulta de jogo.
    if (!gameActivityPrefs) {
      const { shareGameActivity, customGames } = loadPrefs();
      gameActivityPrefs = { shareGameActivity, customGames };
    }
    const prefs = gameActivityPrefs;
    if (prefs.shareGameActivity === false) { gameActivity.reset(); return { activity: null }; }
    try {
      return { activity: await gameActivity.sample(prefs.customGames) };
    } catch {
      gameActivity.reset();
      return { activity: null, error: 'Não consegui detectar os jogos neste PC.' };
    }
  });
  ipcMain.handle('prefs-set', (_event, patch) => {
    const saved = savePrefs(patch);
    if (saved && gameActivityPrefs) {
      for (const key of ['shareGameActivity', 'customGames']) {
        if (Object.hasOwn(patch, key)) gameActivityPrefs[key] = patch[key];
      }
    }
    if (saved && (patch?.shareGameActivity === false || patch?.customGames)) gameActivity.reset();
    if (saved && typeof patch?.theme === 'string') applyThemeToWindow(patch.theme);
    return saved;
  });
  ipcMain.handle('set-global-hotkeys', (event, hotkeys) => setGlobalHotkeys(event.sender, hotkeys));

  ipcMain.handle('select-desktop-source', (_event, sourceId) => {
    selectedDesktopSourceId = sourceId || null;
    return { ok: true, sourceId: selectedDesktopSourceId };
  });
}

// Botões de minimizar/maximizar/fechar com a cor da barra de cima de cada tema (--bg-tertiary)
const THEME_TITLEBAR = {
  escuro: { color: '#1e1f22', symbolColor: '#dbdee1' },
  preto: { color: '#000000', symbolColor: '#dbdee1' },
  claro: { color: '#e3e5e8', symbolColor: '#313338' }
};

function titleBarColors(theme) {
  return THEME_TITLEBAR[theme] || THEME_TITLEBAR.escuro;
}

function applyThemeToWindow(theme) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const colors = titleBarColors(theme);
  mainWindow.setBackgroundColor(colors.color);
  if (process.platform === 'darwin') return;
  try {
    mainWindow.setTitleBarOverlay({ ...colors, height: 52 });
  } catch (err) {
    console.warn('[Electron] Não deu pra mudar a cor da barra:', err.message);
  }
}

async function createWindow() {
  const initialColors = titleBarColors(loadPrefs().theme);

  ensureLinuxSystemAudioSource();

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 840,
    minWidth: 940,
    minHeight: 600,
    title: 'Teletela',
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
    backgroundColor: initialColors.color,
    autoHideMenuBar: true,
    // Sem a barra do sistema: minimizar/maximizar/fechar são desenhados por cima do canto
    // direito da barra do app (alguns ambientes Linux, como os tiling, não mostram botão nenhum)
    ...(process.platform === 'darwin'
      ? {}
      : { titleBarStyle: 'hidden', titleBarOverlay: { ...initialColors, height: 52 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  // Links do chat (target=_blank) abrem no navegador, nunca numa janela do app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  // Se a sala cair (servidor do amigo desligou, sem internet), volta para a tela inicial
  mainWindow.webContents.on('did-fail-load', (_e, _code, desc, url, isMainFrame) => {
    if (isMainFrame && !url.startsWith('file:') && !url.startsWith('telinha:')) {
      showLauncher(`Não foi possível abrir a sala (${desc}).`);
    }
  });

  await mainWindow.loadFile(CONNECT_PAGE);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  handleAppProtocol();
  setupPermissionsAndCapture();
  setupLauncherIpc();
  setupMenu();
  setupAutoUpdater();
  startHotkeySocket();
  return createWindow();
});

app.on('will-quit', () => {
  stopTunnel();
  unrouteAppAudio();
  stopWinAudio();
  globalShortcut.unregisterAll();
  if (uiohook?.running) {
    try { uiohook.hook.stop(); } catch {}
  }
  stopHotkeySocket();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
