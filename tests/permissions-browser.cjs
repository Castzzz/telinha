const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { registerAppScheme, handleAppProtocol, roomUrl } = require('../electron/app-protocol.cjs');
registerAppScheme();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});
const profile = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'teletela-cargos-ui-'));
app.setPath('userData', profile);
process.env.ADMIN_KEY = 'admin-teste-interface';
process.env.TELINHA_DATA_DIR = path.join(profile, 'servidor');
let io;
const errors = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = (win, source) => win.webContents.executeJavaScript(source);
const until = async (win, expression) => {
  for (let i = 0; i < 100; i++) { if (await js(win, expression)) return; await wait(50); }
  throw new Error('O estado não chegou: ' + expression);
};
const click = (win, selector) => js(win, `document.querySelector(${JSON.stringify(selector)}).click();void 0`);
app.whenReady().then(async () => {
  const backend = await import('../server.js'); io = backend.io;
  const server = await backend.startServer(0, '127.0.0.1'); handleAppProtocol();
  async function open(name) {
    const win = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { partition: `cargos-${name}`, offscreen: true, backgroundThrottling: false } });
    handleAppProtocol(win.webContents.session);
    win.webContents.on('console-message', event => { if (event.level === 'error') { errors.push(event.message); console.error('[Interface]', event.sourceId, event.lineNumber, event.message); } });
    await win.loadURL(roomUrl(`http://127.0.0.1:${server.address().port}`));
    await until(win, 'Boolean(window.appState && document.querySelector("#channel-geral"))');
    await js(win, `document.querySelector('#input-profile-name').value=${JSON.stringify(name)};document.querySelector('#form-profile').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));document.querySelectorAll('.modal-backdrop').forEach(el=>el.classList.add('hidden'));void 0`);
    return win;
  }
  const guest = await open('Pessoa permitida'), outsider = await open('Sem acesso'), owner = await open('Dono');
  await js(owner, "document.querySelector('#input-admin-key').value='admin-teste-interface';document.querySelector('#btn-admin-login').click();void 0");
  await until(owner, 'appState.isAdmin && !document.querySelector("#permission-management").classList.contains("hidden")');
  await js(owner, "document.querySelector('#modal-settings').classList.remove('hidden');document.querySelector('[data-settings-tab=admin]').click();document.querySelector('#permission-role-name').value='Moderador';document.querySelector('#permission-role-flags input[value=muteMembers]').checked=true;document.querySelector('#permission-role-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));void 0");
  await until(owner, 'document.querySelector("#permission-role-id").value');
  const roleId = await js(owner, 'document.querySelector("#permission-role-id").value');
  await until(owner, '[...document.querySelector("#permission-member-id").options].some(o=>o.textContent.startsWith("Pessoa permitida"))');
  await js(owner, `const person=[...document.querySelector('#permission-member-id').options].find(o=>o.textContent.startsWith('Pessoa permitida'));document.querySelector('#permission-member-id').value=person.value;document.querySelector('#permission-member-id').dispatchEvent(new Event('change'));document.querySelector('#permission-member-roles input[value="${roleId}"]').checked=true;void 0`);
  await click(owner, '#permission-member-save');
  await until(guest, 'appState.permissions?.includes("muteMembers")');
  await js(owner, `document.querySelectorAll('.modal-backdrop').forEach(el=>el.classList.add('hidden'));document.querySelector('#btn-header-add-channel').click();document.querySelector('#input-channel-name').value='Call reservada';document.querySelector('#new-channel-access-private').click();document.querySelector('#new-channel-access-roles input[value="${roleId}"]').checked=true;document.querySelector('#form-create-channel').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));void 0`);
  await until(owner, 'appState.currentChannelId === "call-reservada"');
  await until(guest, 'Boolean(document.querySelector("#channel-call-reservada"))');
  if (await js(outsider, 'Boolean(document.querySelector("#channel-call-reservada"))')) throw new Error('O canal invisível apareceu para quem não tem acesso');
  await click(guest, '#channel-call-reservada .channel-row');
  await until(guest, 'appState.currentChannelId === "call-reservada"');
  await js(owner, "document.querySelector('#permission-member-roles input').checked=false;document.querySelector('#permission-member-save').click();void 0");
  await until(guest, '!appState.currentChannelId && !document.querySelector("#channel-call-reservada")');
  await js(owner, "document.querySelector('#modal-settings').classList.remove('hidden');document.querySelector('[data-settings-tab=admin]').click();document.querySelector('#permission-channel-id').value='call-reservada';document.querySelector('#permission-channel-id').dispatchEvent(new Event('change'));void 0");
  await until(owner, '!document.querySelector("#permission-channel-save").disabled');
  const guestMemberId = await js(owner, 'document.querySelector("#permission-member-id").value');
  await js(owner, `document.querySelectorAll('#channel-access-roles input').forEach(input=>input.checked=false);document.querySelector('#channel-access-members input[value="${guestMemberId}"]').checked=true;document.querySelector('#permission-channel-save').click();void 0`);
  await until(guest, 'Boolean(document.querySelector("#channel-call-reservada"))');
  await fs.writeFile(path.join(os.tmpdir(), 'teletela-cargos-desktop.png'), (await owner.webContents.capturePage()).toPNG());
  owner.setSize(390, 844); await wait(200);
  if (await js(owner, 'document.documentElement.scrollWidth > innerWidth')) throw new Error('Configuração de cargos transbordou no celular');
  await fs.writeFile(path.join(os.tmpdir(), 'teletela-cargos-mobile.png'), (await owner.webContents.capturePage()).toPNG());
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Interface passou: criar cargo, atribuir sem conta, criar canal invisível, retirar acesso na call, liberar por pessoa e layout móvel.');
  await finish(0);
}).catch(async err => { console.error(err); await finish(1); });
const timeout = setTimeout(() => { console.error('Teste de cargos excedeu 45 segundos.'); finish(1); }, 45000);
async function finish(code) {
  clearTimeout(timeout);
  BrowserWindow.getAllWindows().forEach(win => win.destroy());
  await new Promise(resolve => io ? io.close(resolve) : resolve());
  await fs.rm(profile, { recursive: true, force: true }); app.exit(code);
}
