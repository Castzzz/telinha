// Confere a escolha visual entre homônimos e o silêncio ao digitar uma privada temporária.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { io } = require('socket.io-client');
app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-mencoes-ui-'));
app.setPath('userData', path.join(dir, 'electron'));
process.env.TELINHA_DATA_DIR = path.join(dir, 'data'); process.env.TELINHA_MUSIC = '0'; process.env.SFU_SECRET = '';
const pause = ms => new Promise(r => setTimeout(r, ms));
let backend, win; const clients = [];
const deadline = setTimeout(() => { console.error('Tempo esgotado'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  backend = await import('../server.js'); const server = await backend.startServer(0, '127.0.0.1');
  const url = `http://127.0.0.1:${server.address().port}`;
  const emit = (s, event, payload) => s.timeout(2000).emitWithAck(event, payload);
  async function connect(color) {
    const s = io(url, { autoConnect: false, transports: ['websocket'], reconnection: false }); clients.push(s);
    await new Promise(r => { s.once('connect', r); s.connect(); });
    const state = new Promise(r => s.once('channel-state', r));
    s.emit('join-channel', { channelId: 'geral', userName: 'Rafa', profile: { profileId: randomUUID(), name: 'Rafa', color } });
    s.me = (await state).me; return s;
  }
  const b = await connect('#bb4455'), c = await connect('#44bb55');
  win = new BrowserWindow({ width: 1180, height: 900, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code);
  async function until(code) { for (let i=0;i<100;i++) { if (await js(code)) return; await pause(50); } throw new Error(code); }
  await win.loadURL(url); await until('Boolean(window.appState?.myId)');
  await js("document.querySelectorAll('.modal-backdrop').forEach(el=>el.classList.add('hidden'));document.querySelector('#channel-geral .channel-row').click();void 0");
  await until('Boolean(appState.currentChannelId)');
  // Foto real para uma das pessoas, outra usa as iniciais.
  const avatar = await js("(()=>{const c=document.createElement('canvas');c.width=80;c.height=80;const x=c.getContext('2d');x.fillStyle='#44bb55';x.fillRect(0,0,80,80);return c.toDataURL()})()");
  await emit(c, 'update-profile', { avatar, avatarCrop: { x: 0.2, y: 0.8, zoom: 2 } });
  await pause(200);
  let typing = 0; b.on('typing', () => typing++);
  await js("(()=>{const i=document.querySelector('#chat-input');i.value='/t 10 /w @Ra';i.focus();i.setSelectionRange(i.value.length,i.value.length);i.dispatchEvent(new Event('input',{bubbles:true}))})()");
  await until("document.querySelectorAll('#mention-suggest .mention-item').length===2");
  await until("Boolean(document.querySelector('#mention-suggest img')?.naturalWidth)");
  assert.equal(await js("document.querySelectorAll('#mention-suggest small').length"), 2);
  assert.equal(await js("document.querySelector('#mention-suggest img').style.width"), '200%');
  for (const theme of ['escuro', 'preto', 'claro']) {
    await js(`document.documentElement.dataset.theme='${theme}';void 0`); await pause(80);
    fs.writeFileSync(`/tmp/teletela-mencoes-${theme}.png`, (await win.webContents.capturePage()).toPNG());
  }
  assert.equal(typing, 0, 'privada com /t não anuncia digitação');
  await js("document.querySelector('#mention-suggest img').closest('button').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));void 0");
  const value = await js("document.querySelector('#chat-input').value");
  assert.ok(value.includes(`@Rafa#${c.me.memberId.slice(0,8)}`));
  win.setSize(390,844); await pause(150);
  assert(await js('document.documentElement.scrollWidth<=innerWidth'));
  console.log('Marcações: homônimos com foto/iniciais, recorte, escolha por identidade e digitação silenciosa passaram; três temas e largura móvel capturados.');
}).then(()=>finish(0)).catch(e=>{console.error(e);finish(1)});
async function finish(code) { clearTimeout(deadline); clients.forEach(s=>s.disconnect()); win?.destroy(); if(backend) await new Promise(r=>backend.io.close(r)); fs.rmSync(dir,{recursive:true,force:true}); app.exit(code); }
