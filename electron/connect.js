const api = window.telinhaLauncher;
const prefsApi = window.electronAPI;
const $ = id => document.getElementById(id);
const themes = ['escuro', 'preto', 'claro'];
const labels = { escuro: 'Escuro', preto: 'Preto', claro: 'Claro' };
let serverRoomUrl, timer, previewRun = 0;
const defaultRoomIcon = $('server-room-icon').innerHTML;

function applyTheme(theme) {
  const next = themes.includes(theme) ? theme : 'escuro';
  document.documentElement.dataset.theme = next;
  $('theme-label').textContent = labels[next];
  try { localStorage.setItem('telinha_theme', next); } catch { /* Preferência do app continua disponível. */ }
}
try { applyTheme(localStorage.getItem('telinha_theme')); } catch { applyTheme('escuro'); }
Promise.resolve(prefsApi?.getPrefs?.()).then(prefs => { if (prefs?.theme) applyTheme(prefs.theme); }).catch(() => {});
$('btn-theme').addEventListener('click', () => {
  const next = themes[(themes.indexOf(document.documentElement.dataset.theme) + 1) % themes.length];
  applyTheme(next);
  Promise.resolve(prefsApi?.setPrefs?.({ theme: next })).catch(() => {});
});
function message(text = '', error = false) { $('msg').textContent = text; $('msg').classList.toggle('error', error); }
async function join(url, button) {
  if (!api?.join) return message('Abra pelo aplicativo para entrar.', true);
  button.disabled = true;
  message('Entrando…');
  try {
    const result = await api.join(url);
    if (!result?.ok) message(result?.error || 'Não consegui abrir a sala.', true);
  } catch { message('Não consegui abrir a sala. Tente novamente.', true); }
  finally { button.disabled = false; }
}
$('btn-server-room').addEventListener('click', () => join(serverRoomUrl, $('btn-server-room')));
$('form-other-room').addEventListener('submit', event => {
  event.preventDefault();
  const url = $('server-url').value.trim();
  if (!url) return message('Cole o link da sala.', true);
  join(url, $('btn-join'));
});

function renderPreview(state = {}) {
  $('server-room-name').textContent = state.server?.name || 'Colheita Fartus';
  const icon = $('server-room-icon'); icon.innerHTML = defaultRoomIcon;
  if (/^data:image\/png;base64,/.test(state.server?.icon || '')) {
    const image = document.createElement('img'); image.src = state.server.icon; image.alt = '';
    image.addEventListener('error', () => { icon.innerHTML = defaultRoomIcon; }, { once: true });
    icon.replaceChildren(image);
  }
  const available = ['ready', 'guest', 'expired', 'unsupported'].includes(state.status);
  $('server-status').dataset.available = String(available);
  $('server-status-text').textContent = available ? 'Pronta pra entrar' : 'Não consegui consultar a sala';
  if (state.name) $('launcher-greeting').textContent = `OI, ${state.name}`;
  const friends = state.status === 'ready' && Array.isArray(state.friends) ? state.friends : [];
  $('online-count').textContent = state.status === 'ready' ? String(state.onlineCount ?? friends.length) : '';
  const list = $('launcher-friends');
  list.replaceChildren();
  for (const friend of friends) {
    const row = document.createElement('li');
    const button = document.createElement('button'); button.type = 'button'; button.className = 'friend-button';
    button.setAttribute('aria-label', `Abrir a sala com ${friend.name}`);
    const avatar = document.createElement('span'); avatar.className = 'friend-avatar'; avatar.dataset.presence = friend.presence || 'online'; avatar.setAttribute('aria-hidden', 'true');
    avatar.style.backgroundColor = /^#[0-9a-f]{6}$/i.test(friend.color) ? friend.color : '#5865f2';
    avatar.textContent = friend.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    if (/^data:image\/png;base64,/.test(friend.avatar || '')) {
      const photo = document.createElement('img'); photo.src = friend.avatar; photo.alt = '';
      avatar.replaceChildren(photo);
    }
    const name = document.createElement('strong'); name.className = 'friend-name'; name.textContent = friend.name;
    button.append(avatar, name); button.addEventListener('click', () => join(serverRoomUrl, button));
    row.append(button); list.append(row);
  }
  list.hidden = !friends.length;
  $('friends-empty').hidden = Boolean(friends.length);
  $('friends-footnote').hidden = !friends.length;
  const remaining = Math.max(0, (state.onlineCount || 0) - friends.length);
  $('friends-footnote').textContent = remaining ? `Mais ${remaining} amigos online. Entre para ver todos.` : 'Escolha alguém para abrir a sala.';
  const empty = {
    ready: 'Ninguém online agora. Que tal chegar primeiro?',
    guest: 'Entre na sua conta na sala para encontrar seus amigos aqui.',
    expired: 'Entre na conta de novo na sala para ver seus amigos.',
    unsupported: 'A prévia dos amigos chega com a próxima atualização do servidor.',
    offline: 'Os amigos aparecem aqui quando a conexão voltar.'
  };
  $('friends-empty-text').textContent = empty[state.status] || 'Não consegui consultar seus amigos agora.';
  document.querySelector('.friends-panel').setAttribute('aria-busy', 'false');
}
async function refreshPreview() {
  clearTimeout(timer);
  if (document.hidden) return;
  const run = ++previewRun;
  $('btn-refresh-friends').disabled = true;
  try {
    const state = await api?.getPreview?.();
    if (run === previewRun) renderPreview(state);
  } catch { if (run === previewRun) renderPreview({ status: 'offline' }); }
  finally {
    if (run === previewRun) {
      $('btn-refresh-friends').disabled = false;
      timer = setTimeout(refreshPreview, 30000);
    }
  }
}
$('btn-refresh-friends').addEventListener('click', refreshPreview);
document.addEventListener('visibilitychange', () => {
  clearTimeout(timer);
  if (!document.hidden) refreshPreview();
  else ++previewRun;
});
window.addEventListener('pagehide', () => { clearTimeout(timer); ++previewRun; });
(async () => {
  try {
    const state = await api?.getState?.();
    if (state?.serverRoomUrl) {
      serverRoomUrl = state.serverRoomUrl;
      $('btn-server-room').disabled = false;
    }
    if (state?.lastServerUrl && state.lastServerUrl !== serverRoomUrl) $('server-url').value = state.lastServerUrl;
    if (state?.error) message(state.error, true);
    await refreshPreview();
  } catch { message('Não consegui preparar a entrada. Tente reabrir o app.', true); }
})();
