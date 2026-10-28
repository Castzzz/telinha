// Confere contas e dados usando a interface real, com perfis isolados e servidor temporário.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerAppScheme, handleAppProtocol, roomUrl } = require('../electron/app-protocol.cjs');
registerAppScheme();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-social-ui-'));
app.setPath('userData', path.join(directory, 'electron'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});
process.env.TELINHA_DATA_DIR = path.join(directory, 'servidor');
process.env.OWNER_KEY = 'dono-local-interface';
process.env.TELINHA_MUSIC = '0';
const windows = [], errors = [];
let backend;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);
const click = (win, selector) => js(win, `document.querySelector(${JSON.stringify(selector)}).click();void 0`);
async function until(win, code) {
  for (let i = 0; i < 120; i++) { if (await js(win, code)) return; await pause(50); }
  throw new Error('A interface não chegou ao estado esperado: ' + code);
}
app.whenReady().then(async () => {
  backend = await import('../server.js');
  await backend.startServer(0, '127.0.0.1');
  const base = `http://127.0.0.1:${backend.server.address().port}`;
  const serverUser = async win => backend.io.sockets.sockets.get(await js(win, 'appState.myId'));
  async function open(name, preset = true) {
    const win = new BrowserWindow({ width: 1280, height: 900, show: false,
      webPreferences: { partition: `social-${name}`, offscreen: true, backgroundThrottling: false } });
    windows.push(win); handleAppProtocol(win.webContents.session);
    win.webContents.on('console-message', event => {
      if (event.level === 'error' && !/WebSocket connection|net::ERR_/.test(event.message)) errors.push(event.message);
    });
    await win.loadURL(roomUrl(base));
    if (preset) {
      await until(win, 'Boolean(window.appState?.myId)');
      await js(win, `localStorage.setItem('telinha_prefs',JSON.stringify({profile:{id:'perfil-${name}',name:${JSON.stringify(name)},color:'#5865F2'},seenWhatsNew:'99'}));void 0`);
      win.reload(); await until(win, `document.querySelector('#dock-user-name')?.textContent === ${JSON.stringify(name)} && Boolean(appState.myId)`);
    }
    return win;
  }
  const first = await open('Aventureiro');
  const firstSocket = await serverUser(first), accessId = firstSocket.data.user.accessId;
  await js(first, `document.querySelector('#input-admin-key').value='dono-local-interface';document.querySelector('#btn-admin-login').click();void 0`);
  await until(first, 'appState.isOwner');
  await click(first, '#btn-home-dice');
  await until(first, 'document.querySelector("#dice-status").textContent === ""');
  await click(first, '#dice-close');
  await click(first, '#btn-open-settings'); await click(first, '[data-settings-tab="conta"]');
  await click(first, '[data-account-mode="register"]');
  await js(first, `document.querySelector('#account-user').value='aventureiro';document.querySelector('#account-password').value='senha-local-123';document.querySelector('#account-confirm').value='senha-local-123';document.querySelector('#account-form').requestSubmit();void 0`);
  await until(first, '!document.querySelector("#account-recovery-result").classList.contains("hidden")');
  if (!(await js(first, 'Boolean(document.querySelector("#account-recovery-code").textContent)'))) throw new Error('O cadastro não entregou código de recuperação.');
  await click(first, '#account-continue');
  await until(first, 'appState.isOwner && document.querySelector("#account-username")?.textContent === "@aventureiro"');
  if ((await serverUser(first)).data.user.accessId !== accessId) throw new Error('O cadastro mudou a identidade do dono.');
  // A segunda máquina começa sem senha da sala e entra pela conta.
  await js(first, `document.querySelector('#input-room-password-new').value='senha-sala-local';document.querySelector('#btn-room-password-save').click();void 0`);
  await pause(100);
  const second = await open('Outro-aparelho', false);
  await until(second, '!document.querySelector("#modal-room-password").classList.contains("hidden")');
  await click(second, '#btn-room-account');
  await until(second, '!document.querySelector("#account-auth").classList.contains("hidden")');
  await js(second, `document.querySelector('#account-user').value='aventureiro';document.querySelector('#account-password').value='senha-local-123';document.querySelector('#account-form').requestSubmit();void 0`);
  await until(second, 'appState.isOwner && document.querySelector("#account-username")?.textContent === "@aventureiro"');
  if ((await serverUser(second)).data.user.accessId !== accessId) throw new Error('O login não preservou os cargos.');
  await click(first, '#user-profile');
  await js(first, `document.querySelector('#input-profile-bio').value='Campanha de RPG';document.querySelector('#form-profile').requestSubmit();void 0`);
  await until(first, 'document.querySelector("#toast-container").textContent.includes("Perfil salvo!")');
  await until(second, 'JSON.parse(localStorage.getItem("telinha_prefs")).accountSessions[Object.keys(JSON.parse(localStorage.getItem("telinha_prefs")).accountSessions)[0]].profile.bio === "Campanha de RPG"');
  for (const win of [first, second]) {
    await js(win, `document.querySelectorAll('.modal-backdrop').forEach(el=>el.classList.add('hidden'));document.querySelector('#channel-geral .channel-row').click();void 0`);
    await until(win, 'appState.currentChannelId === "geral"');
  }
  await click(first, '#stage-controls-bar .dice-trigger');
  await until(first, 'document.querySelector("#dice-status").textContent === ""');
  await click(first, '[data-die="1d20"]');
  await until(first, 'document.querySelectorAll("#dice-history li b").length === 1');
  const result = await js(first, 'document.querySelector("#dice-history li b").textContent');
  await until(first, 'document.querySelector("#dice-result-value").textContent === document.querySelector("#dice-history li b").textContent');
  await js(second, `document.querySelector('#btn-header-add-channel').click();document.querySelector('#input-channel-name').value='Cinema';document.querySelector('#form-create-channel').requestSubmit();void 0`);
  await until(second, 'appState.currentChannelId === "cinema"');
  await click(second, '#stage-controls-bar .dice-trigger');
  await until(second, 'document.querySelectorAll("#dice-history li b").length === 1');
  if (await js(second, 'document.querySelector("#dice-history li b").textContent') !== result) throw new Error('Os aparelhos receberam resultados diferentes.');
  (await serverUser(first)).emit('room-info', { hasPassword: true });
  await until(first, 'document.querySelector("#dice-status").textContent.includes("servidor precisa receber a atualização")');
  if (!await js(first, '[...document.querySelectorAll("[data-die]")].every(b=>b.disabled)')) throw new Error('Servidor antigo deixou dados ativos.');
  (await serverUser(first)).emit('room-info', { diceVersion: 2 });
  await until(first, 'document.querySelector("#dice-status").textContent === ""');
  for (const sides of [4,6,8,10,12,20,100]) {
    await pause(520);
    await click(first, `[data-die="1d${sides}"]`);
    await until(first, `document.querySelector('#dice-result-kind').textContent.endsWith(' · 1d${sides}') && !document.querySelector('#dice-result').classList.contains('is-rolling')`);
    const total = Number(await js(first, 'document.querySelector("#dice-result-value").textContent'));
    if (total < 1 || total > sides) throw new Error('Dado fora dos limites: d'+sides);
  }
  for (const theme of ['escuro', 'preto', 'claro']) {
    await js(first, `document.documentElement.dataset.theme=${JSON.stringify(theme)};void 0`);
    await pause(150);
    await fs.promises.writeFile(path.join('/tmp', `teletela-dados-${theme}.png`), (await first.webContents.capturePage()).toPNG());
  }
  await click(second, '#dice-close');
  second.setSize(390, 844); await pause(100);
  await click(second, '#btn-mobile-dice');
  const fits = await js(second, `(() => {const box=document.querySelector('.dice-modal').getBoundingClientRect();return box.left>=0&&box.right<=innerWidth&&box.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth})()`);
  if (!fits) throw new Error('Os dados ficaram fora da tela no celular.');
  await click(second, '#dice-close');
  await click(second, '#btn-open-settings'); await click(second, '[data-settings-tab="conta"]');
  await fs.promises.writeFile('/tmp/teletela-conta-celular.png', (await second.webContents.capturePage()).toPNG());
  await click(second, '#account-logout');
  await until(second, '!appState.isOwner && document.querySelector("#account-logged").classList.contains("hidden") && !Object.values(JSON.parse(localStorage.getItem("telinha_prefs")).accountSessions).some(s=>s?.token)');
  if ((await serverUser(second))?.data.user.accessId === accessId) throw new Error('Sair da conta manteve poderes do dono.');
  if (errors.length) throw new Error('Erros da interface: ' + errors.join('\n'));
  console.log('Interface passou: cadastro, recuperação entregue, login por conta em sala com senha, cargos, perfil entre aparelhos, dados compartilhados, três temas, celular e logout sem poderes antigos.');
  windows.forEach(win => win.destroy()); await new Promise(resolve => backend.io.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true }); app.quit();
}).catch(error => { console.error(error); windows.forEach(win => win.destroy()); backend?.io.close(); app.exit(1); });
