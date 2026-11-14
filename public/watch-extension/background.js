const KEY = 'watchConnection';
let syncing = false;
let current = null, loading = null;
const load = async () => {
  loading ||= chrome.storage.session.get(KEY).then(data => { current = data[KEY] || null; });
  await loading; return current;
};
const save = connection => { current = connection; return chrome.storage.session.set({ [KEY]: connection }); };
const supported = raw => {
  try { const url = new URL(raw); return url.protocol === 'https:' && ['www.youtube.com', 'www.netflix.com'].includes(url.hostname); }
  catch { return false; }
};
function serverOrigin(raw) {
  const url = new URL(raw);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Endereço de servidor inválido.');
  return url.origin;
}
async function api(connection, path, body = {}) {
  const start = Date.now();
  const response = await fetch(`${connection.server}/api/watch-together/${path}`, {
    method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000)
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('O servidor ainda não tem Assistir juntos.'); }
  if (!response.ok) {
    const error = new Error(data.error || 'O servidor não respondeu.'); error.unauthorized = response.status === 401; throw error;
  }
  return { ...data, roundTrip: Date.now() - start };
}
async function handle(message, sender) {
  const fromPopup = sender.url === chrome.runtime.getURL('popup.html') && !sender.tab;
  let connection = await load();
  if (message?.type === 'watch:sync') {
    if (!connection?.token || sender.tab?.id !== connection.tabId || !supported(sender.url)) return { inactive: true };
    if (syncing) return { skipped: true };
    syncing = true;
    try {
      const data = await api(connection, 'sync', { report: message.report || null });
      // Nunca regrava uma conexão que o popup já substituiu ou desconectou.
      const latest = await load();
      if (latest?.token !== connection.token || latest.tabId !== sender.tab.id) return { inactive: true };
      connection.session = data.session; connection.error = ''; await save(connection);
      return data;
    } catch (error) {
      if ((await load())?.token === connection.token) {
        connection.error = error.message;
        if (error.unauthorized) { connection.token = null; connection.tabId = null; }
        await save(connection);
      }
      return { error: error.message };
    } finally { syncing = false; }
  }
  if (!fromPopup) throw new Error('Abra a extensão para conectar.');
  if (message?.type === 'watch:status') {
    if (connection?.token) {
      try {
        const data = await api(connection, 'status'); connection.session = data.session; connection.error = '';
      } catch (error) {
        connection.error = error.message;
        if (error.unauthorized) { connection.token = null; connection.tabId = null; }
      }
      if ((await load())?.token === connection.token) await save(connection);
    }
    return { connection: connection ? { ...connection, token: undefined } : null };
  }
  if (message?.type === 'watch:connect') {
    const server = serverOrigin(message.server);
    if (!/^[\w-]{43}$/.test(message.code || '')) throw new Error('Código inválido. Gere outro no Teletela.');
    const url = new URL(server);
    if (!await chrome.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] })) throw new Error('Permita a conexão com o servidor.');
    const data = await api({ server }, 'pair', { code: message.code });
    // O servidor revoga o token anterior quando o código é trocado.
    if (connection?.token) await api(connection, 'disconnect').catch(() => {});
    connection = { server, token: data.token, userId: data.userId, session: data.session, tabId: null, error: '' };
    await save(connection); return { success: true };
  }
  if (message?.type === 'watch:disconnect') {
    current = null;
    await chrome.storage.session.remove(KEY);
    if (connection?.token) await api(connection, 'disconnect').catch(() => {});
    return { success: true };
  }
  if (message?.type === 'watch:open') {
    if (!connection?.token) throw new Error('Conecte com seu código primeiro.');
    const data = await api(connection, 'status');
    if ((await load())?.token !== connection.token) throw new Error('A conexão mudou. Abra a extensão de novo.');
    connection.session = data.session;
    const url = connection.session?.url;
    if (!/^https:\/\/www\.(youtube\.com\/watch\?v=[\w-]{11}|netflix\.com\/watch\/\d{1,20})$/.test(url || '')) throw new Error('Aguarde quem guia escolher o vídeo.');
    // Continua no service worker mesmo quando a abertura da aba fecha o popup.
    const tab = await chrome.tabs.create({ url });
    const oldTabId = connection.tabId;
    connection.tabId = tab.id; connection.error = ''; await save(connection);
    if (oldTabId && oldTabId !== tab.id) chrome.tabs.sendMessage(oldTabId, { type: 'watch:detach' }).catch(() => {});
    chrome.tabs.sendMessage(tab.id, { type: 'watch:attach' }).catch(() => {});
    return { success: true };
  }
  if (message?.type === 'watch:bind') {
    if (!connection?.token) throw new Error('Conecte com seu código primeiro.');
    const tab = await chrome.tabs.get(message.tabId);
    if (!supported(tab.pendingUrl || tab.url)) throw new Error('Abra o YouTube ou a Netflix nesta aba.');
    const oldTabId = connection.tabId;
    connection.tabId = tab.id; connection.error = ''; await save(connection);
    if (oldTabId && oldTabId !== tab.id) chrome.tabs.sendMessage(oldTabId, { type: 'watch:detach' }).catch(() => {});
    try { await chrome.tabs.sendMessage(tab.id, { type: 'watch:attach' }); }
    catch { throw new Error('Aba selecionada. Recarregue a página para ativar a extensão.'); }
    return { success: true };
  }
  throw new Error('Ação desconhecida.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(respond, error => respond({ error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(async tabId => {
  const connection = await load();
  if (connection?.tabId === tabId) { connection.tabId = null; await save(connection); }
});
