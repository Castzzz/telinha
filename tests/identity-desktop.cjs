const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const directory = process.env.TELETELA_IDENTITY_TEST_DIR;
const stage = Number(process.env.TELETELA_IDENTITY_STAGE);
if (!directory?.startsWith('/tmp/')) throw new Error('Use uma pasta temporária isolada.');
app.setPath('appData', directory);
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.on('browser-window-created', (_event, win) => { win.hide(); win.on('show', () => win.hide()); });
app.on('window-all-closed', () => {});
const preferencesFile = path.join(directory, 'Telinha/prefs.json');
const reportFile = path.join(directory, 'resultado.json');
if (stage === 0) {
  fs.mkdirSync(path.dirname(preferencesFile), { recursive: true });
  fs.writeFileSync(preferencesFile, JSON.stringify({ profile: { id: 'perfil-atualizacao-real', name: 'Perfil da versão antiga', color: '#5865F2' },
    shareGameActivity: false, hotkeysGlobal: false, seenWhatsNew: '99.0', padding: 'x'.repeat(12 * 1024 * 1024) }));
} else if (stage === 3) fs.writeFileSync(preferencesFile, '{gravação antiga interrompida');
const installedRoot = stage === 0 ? process.env.TELETELA_IDENTITY_OLD_ROOT : root;
require(path.join(installedRoot, 'electron/main.cjs'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error('Teste da identidade desktop excedeu o tempo.'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  const backend = await import(path.join(root, 'server.js'));
  const port = stage < 2 ? 19118 : 19119;
  await backend.startServer(port, '127.0.0.1');
  await pause(300);
  const win = BrowserWindow.getAllWindows()[0];
  await win.loadURL(require(path.join(installedRoot, 'electron/app-protocol.cjs')).roomUrl(`http://127.0.0.1:${port}`));
  const js = code => win.webContents.executeJavaScript(code);
  async function until(condition) {
    for (let i = 0; i < 150; i++) { if (await js(condition)) return; await pause(30); }
    throw new Error('Estado não chegou: ' + condition);
  }
  await until('Boolean(window.appState && window.electronAPI?.getPrefs && appState.myId)');
  await until('document.querySelector("#permission-device").textContent.length > 0');
  const record = [...backend.io.sockets.sockets.values()].find(client => client.data.user?.id === appStateId());
  function appStateId() { return [...backend.io.sockets.sockets.values()].find(client => client.data.user?.name === 'Perfil da versão antiga')?.id; }
  let accessId;
  if (stage === 0) {
    if (!record) throw new Error('Perfil antigo não chegou ao servidor.');
    accessId = record.data.user.accessId;
    const { io } = await import('socket.io-client');
    const admin = io(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
    await new Promise(resolve => admin.on('connect', resolve));
    const emit = (event, payload) => admin.timeout(4000).emitWithAck(event, payload);
    if (!(await emit('owner-claim', { key: 'propriedade-identidade-teste' })).success) throw new Error('Não assumiu o servidor de teste.');
    const { role } = await emit('role-save', { name: 'Cargo preservado', position: 10, permissions: ['muteMembers'] });
    await emit('member-roles', { memberId: accessId, roles: [role.id] });
    await emit('admin-set-room-password', { password: 'senha-da-sala-de-teste' });
    await emit('owner-transfer', { memberId: accessId });
    fs.writeFileSync(reportFile, JSON.stringify({ accessId, roleId: role.id }));
    admin.disconnect();
    // Espera a credencial emitida pela versão 3.7 chegar ao prefs.json real.
    for (let i = 0; i < 100; i++) {
      const prefs = JSON.parse(fs.readFileSync(preferencesFile));
      if (prefs.roomAccess?.[`http://127.0.0.1:${port}`]?.permissionToken?.startsWith(accessId + '.')) break;
      await pause(25);
    }
  } else {
    const expected = JSON.parse(fs.readFileSync(reportFile));
    await until('appState.isAdmin && appState.permissionRoles.some(r=>r.name === "Cargo preservado")');
    const current = backend.io.sockets.sockets.get(await js('appState.myId')).data.user;
    accessId = current.accessId;
    if (accessId !== expected.accessId) throw new Error('O ID mudou na atualização.');
    const prefs = JSON.parse(fs.readFileSync(preferencesFile));
    if (prefs.profile.id !== 'perfil-atualizacao-real') throw new Error('O ID público do perfil mudou.');
    if (!/^[a-f0-9]{64}$/.test(prefs.profileCredentials[prefs.profile.id])) throw new Error('Chave privada não foi salva.');
  }
  console.log(`Identidade desktop: etapa ${stage} passou (ID, cargo e propriedade preservados).`);
  clearTimeout(timeout);
  await new Promise(resolve => backend.io.close(resolve));
  app.exit(0);
}).catch(err => { console.error(err); clearTimeout(timeout); app.exit(1); });
