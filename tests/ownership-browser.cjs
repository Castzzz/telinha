// Reproduz o problema contra o servidor 3.7 real, usando a interface nova.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { io } = require('socket.io-client');
const { registerAppScheme, handleAppProtocol, roomUrl } = require('../electron/app-protocol.cjs');
registerAppScheme();
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-dono-antigo-'));
app.setPath('userData', path.join(directory, 'perfil'));
app.on('window-all-closed', () => {});
process.env.ADMIN_KEY = 'admin-servidor-antigo';
process.env.TELINHA_DATA_DIR = path.join(directory, 'dados');
let backend, admin;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const archive = spawnSync('git', ['archive', '61809d90235521a14b4666fbd339f1b942a099bc', 'server.js', 'permission-store.js', 'public/image-crop.js', 'package.json'], { cwd: root });
  if (archive.status !== 0) throw new Error('Não foi possível obter o servidor 3.7.');
  const unpacked = spawnSync('tar', ['-x', '-C', directory], { input: archive.stdout });
  if (unpacked.status !== 0) throw new Error('Não foi possível preparar o servidor 3.7.');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'));
  backend = await import(path.join(directory, 'server.js'));
  const server = await backend.startServer(0, '127.0.0.1');
  const base = `http://127.0.0.1:${server.address().port}`;
  handleAppProtocol();
  const win = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code);
  const until = async condition => {
    for (let i = 0; i < 100; i++) { if (await js(condition)) return; await pause(40); }
    throw new Error('Estado não chegou: ' + condition);
  };
  await win.loadURL(roomUrl(base));
  await until('Boolean(window.appState?.myId)');
  await js(`localStorage.setItem('telinha_prefs',JSON.stringify({profile:{id:'perfil-teste-dono',name:'Pessoa local',color:'#5865F2'},seenWhatsNew:'99',adminKeys:{[${JSON.stringify(base)}]:'admin-servidor-antigo'}}));void 0`);
  await win.reload();
  await until('Boolean(window.appState?.myId)');
  await pause(150);
  const current = backend.io.sockets.sockets.get(await js('appState.myId'));
  if (current.data.user.isAdmin) throw new Error('Senha antiga salva não deve fazer login automático.');
  admin = io(base, { transports: ['websocket'] });
  await new Promise(resolve => admin.on('connect', resolve));
  const emit = (event, data) => admin.timeout(4000).emitWithAck(event, data);
  await emit('update-profile', { name: 'Admin antigo', profileId: 'perfil-admin-antigo' });
  await emit('admin-login', { key: 'admin-servidor-antigo' });
  await emit('join-channel', { channelId: 'geral' });
  await js("document.querySelectorAll('.modal-backdrop').forEach(el=>el.classList.add('hidden'));document.querySelector('#channel-geral .channel-row').click();void 0");
  await until('[...document.querySelectorAll(".channel-user")].some(el=>el.dataset.username === "Admin antigo")');
  await js("[...document.querySelectorAll('.channel-user')].find(el=>el.dataset.username === 'Admin antigo').click();void 0");
  const badges = await js('document.querySelector("#user-popover-roles").textContent');
  if (badges.includes('Dono do servidor') || !badges.includes('Admin no servidor antigo')) throw new Error('Admin antigo não deve aparecer como dono: ' + badges);
  await js("document.querySelector('#input-admin-key').value='admin-servidor-antigo';document.querySelector('#btn-admin-login').click();void 0");
  await until('appState.legacyAdmin === true');
  if (await js('appState.isOwner')) throw new Error('Login antigo não deve conceder propriedade.');
  if (!await js('document.querySelector("#owner-transfer").classList.contains("hidden")')) throw new Error('Servidor antigo não deve mostrar transferência.');
  fs.writeFileSync('/tmp/teletela-admin-antigo-corrigido.png', (await win.webContents.capturePage()).toPNG());
  console.log('Regressão passou: servidor 3.7 real, senha salva sem promoção automática, admin separado do dono e transferência oculta.');
  await finish(0);
}).catch(async error => { console.error(error); await finish(1); });
const timeout = setTimeout(() => finish(1), 30000);
async function finish(code) {
  clearTimeout(timeout); admin?.disconnect();
  BrowserWindow.getAllWindows().forEach(win => win.destroy());
  await new Promise(resolve => backend ? backend.io.close(resolve) : resolve());
  fs.rmSync(directory, { recursive: true, force: true }); app.exit(code);
}
