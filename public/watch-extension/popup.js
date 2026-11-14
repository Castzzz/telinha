const $ = selector => document.querySelector(selector);
const send = async message => {
  const result = await chrome.runtime.sendMessage(message);
  if (result?.error) throw new Error(result.error);
  return result;
};
let current = null;
async function refresh() {
  current = (await send({ type: 'watch:status' })).connection;
  $('#connect').hidden = Boolean(current?.userId && !current.error);
  $('#session').hidden = !current?.userId;
  const host = current?.session?.hostId === current?.userId;
  $('#description').textContent = current ? `${host ? 'Você guia esta sessão' : `${current.session?.hostName || 'Um amigo'} guia a sessão`}. ${current.tabId ? 'Aba escolhida.' : 'Escolha a aba do vídeo abaixo.'}` : '';
  $('#open').disabled = !current?.session?.url;
  $('#status').textContent = current?.error || '';
}
async function run(task) {
  for (const button of document.querySelectorAll('button')) button.disabled = true;
  try { await task(); await refresh(); }
  catch (error) { $('#status').textContent = error.message; }
  finally { for (const button of document.querySelectorAll('button')) button.disabled = false; $('#open').disabled = !current?.session?.url; }
}
$('#connect').addEventListener('submit', event => {
  event.preventDefault();
  // A permissão é pedida no gesto do usuário e somente para o servidor colado.
  let payload, origin;
  try {
    const text = $('#code').value.trim();
    if (!/^teletela-wt1\.[A-Za-z0-9_-]{20,3000}$/.test(text)) throw new Error();
    payload = JSON.parse(atob(text.slice(13).replace(/-/g, '+').replace(/_/g, '/')));
    const url = new URL(payload.server);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error();
    origin = `${url.protocol}//${url.hostname}/*`;
  } catch { $('#status').textContent = 'Código inválido. Copie o código completo no Teletela.'; return; }
  const permission = chrome.permissions.request({ origins: [origin] });
  run(async () => {
    if (!await permission) throw new Error('Permita a conexão com o servidor para assistir junto.');
    await send({ type: 'watch:connect', ...payload }); $('#code').value = '';
  });
});
$('#bind').addEventListener('click', () => run(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await send({ type: 'watch:bind', tabId: tab.id });
}));
$('#open').addEventListener('click', () => run(() => send({ type: 'watch:open' })));
$('#disconnect').addEventListener('click', () => run(() => send({ type: 'watch:disconnect' })));
refresh().catch(error => { $('#status').textContent = error.message; });
