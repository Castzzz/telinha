// Conferência visual com dados locais e dispositivos de mídia fictícios.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const http = require('node:http');
const { io } = require('socket.io-client');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-seguranca-ui-'));
app.setPath('userData', path.join(directory, 'electron'));
app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
let backend, win, revoker;
const clients = [], wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { console.error('Tempo esgotado na interface de segurança.'); finish(1); }, 30000);
const js = code => win.webContents.executeJavaScript(code, true);
async function until(code) {
  for (let i = 0; i < 160; i++) { if (await js(code)) return; await wait(40); }
  throw new Error('Estado não alcançado: ' + code);
}
const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click();void 0`);
app.whenReady().then(async () => {
  revoker = http.createServer((req, res) => { req.on('end', () => res.writeHead(204).end()); req.resume(); });
  await new Promise(resolve => revoker.listen(0, '127.0.0.1', resolve));
  Object.assign(process.env, { TELINHA_DATA_DIR: path.join(directory, 'data'), TELINHA_MUSIC: '0',
    OWNER_KEY: 'dono-ui-ficticio', ADMIN_KEY: '', SFU_SECRET: 'sfu-ui-ficticio', SFU_INTERNAL_URL: `http://127.0.0.1:${revoker.address().port}` });
  backend = await import('../server.js');
  const server = await backend.startServer(0, '127.0.0.1'), base = `http://127.0.0.1:${server.address().port}`;
  const owner = io(base, { autoConnect: false, reconnection: false, transports: ['websocket'] }); clients.push(owner);
  const connected = new Promise(resolve => owner.once('connect', resolve)); owner.connect(); await connected;
  const emit = (event, payload = {}) => owner.timeout(3000).emitWithAck(event, payload);
  await emit('update-profile', { profileId: 'perfil-dono-ui-seguranca', name: 'Dono' });
  await emit('owner-claim', { key: 'dono-ui-ficticio' });
  await emit('join-channel', { channelId: 'geral' });
  const created = await emit('create-text-channel', { name: 'Teste de seguranca' });
  win = new BrowserWindow({ width: 1180, height: 900, show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
  win.webContents.setAudioMuted(true);
  // O teste verifica a interface; nenhuma mídia é enviada ao SFU nem à sala oficial.
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.url.includes('/sfu/ws') }));
  await win.loadURL(base);
  await until('Boolean(window.appState?.myId && appState.memberId)');
  await js("document.querySelectorAll('.modal-backdrop').forEach(el=>el.classList.add('hidden'));void 0");
  const myId = await js('appState.myId');
  await click(`[data-text-channel-id="${created.channelId}"] .channel-row`);
  await js("document.querySelector('#chat-input').value='Mensagem própria protegida';document.querySelector('#chat-form').requestSubmit();void 0");
  await until("[...document.querySelectorAll('.chat-msg')].some(el=>el.textContent.includes('Mensagem própria protegida') && el.querySelector('[data-act=edit]'))");
  await emit('text-message', { channelId: created.channelId, text: 'Mensagem de outra identidade' });
  await until("[...document.querySelectorAll('.chat-msg')].some(el=>el.textContent.includes('Mensagem de outra identidade'))");
  assert(await js("![...document.querySelectorAll('.chat-msg')].find(el=>el.textContent.includes('Mensagem de outra identidade')).querySelector('[data-act=edit]')"));
  await emit('admin-set-room-password', { password: 'senha-ui-ficticia' });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  assert.equal((await emit('text-image', { channelId: created.channelId, mime: 'image/png', data: png })).success, true);
  await until("Boolean(document.querySelector('.chat-image')?.naturalWidth)");
  const imageUrl = await js("document.querySelector('.chat-image').src");
  assert.equal((await fetch(imageUrl)).status, 200);
  assert.equal((await fetch(imageUrl.split('?')[0])).status, 404);
  await click('#channel-geral .channel-row');
  await until("appState.currentChannelId === 'geral' && appState.sfuVoiceListeners.size === 1");
  await click('#btn-toggle-mic');
  await until('Boolean(appState.sfuVoicePublisher && appState.localMicStream?.getAudioTracks()[0]?.enabled)');
  await emit('admin-mute-user', { userId: myId, on: true });
  await until('appState.myUser.serverMuted && !appState.sfuVoicePublisher && appState.sfuVoiceListeners.size === 1');
  await emit('admin-deafen-user', { userId: myId, on: true });
  await until('appState.myUser.serverDeafened && appState.sfuVoiceListeners.size === 0');
  await emit('admin-deafen-user', { userId: myId, on: false });
  await until('!appState.myUser.serverDeafened && appState.sfuVoiceListeners.size === 1');
  await emit('admin-mute-user', { userId: myId, on: false });
  await until('!appState.myUser.serverMuted && Boolean(appState.sfuVoicePublisher)');
  await click(`[data-text-channel-id="${created.channelId}"] .channel-row`);
  for (const theme of ['escuro', 'preto', 'claro']) {
    await js(`document.documentElement.dataset.theme='${theme}';void 0`); await wait(60);
    fs.writeFileSync(`/tmp/teletela-seguranca-${theme}.png`, (await win.webContents.capturePage()).toPNG());
  }
  win.setSize(390, 844); await wait(150);
  assert(await js('document.documentElement.scrollWidth <= innerWidth'));
  fs.writeFileSync('/tmp/teletela-seguranca-mobile.png', (await win.webContents.capturePage()).toPNG());
  console.log('Interface: autoria, imagem protegida com senha, bloqueio/restauração das sessões de voz, três temas e celular passaram.');
}).then(() => finish(0)).catch(error => { console.error(error); finish(1); });
async function finish(code) {
  clearTimeout(deadline);
  clients.forEach(client => client.disconnect()); win?.destroy();
  if (backend) await new Promise(resolve => backend.io.close(resolve));
  await wait(100);
  if (revoker) await new Promise(resolve => revoker.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true }); app.exit(code);
}
