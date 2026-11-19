import { messageLinks } from './chat-links.js';
import { attachLinkPreview } from './link-previews.js';

export function setupDirectMessages({ socket, getAccount, serverUrl }) {
  const $ = id => document.getElementById(id);
  const dialog = $('dm-dialog'), log = $('dm-log'), input = $('dm-input');
  const unread = new Set();
  let friends = [], peer = null, generation = 0, before = null, owner = null;
  const messages = new Map(), latest = new Map(), seen = new Map();
  let membership = null;

  function markRead(id, number) {
    if (number <= (seen.get(id) || 0)) return;
    seen.set(id, number);
    try { localStorage.setItem(JSON.stringify(['dm', serverUrl, owner, id]), String(number)); } catch {}
    if (number >= (latest.get(id)?.id || 0)) unread.delete(id);
  }

  function noteActivity(id, message) {
    if ((latest.get(id)?.id || 0) > message.id) return;
    latest.set(id, { id: message.id, timestamp: message.timestamp });
    if (!seen.has(id)) {
      let value = 0;
      try { value = Number(localStorage.getItem(JSON.stringify(['dm', serverUrl, owner, id]))) || 0; } catch {}
      seen.set(id, value);
    }
    if (message.from === owner || message.id <= seen.get(id)) unread.delete(id);
    else unread.add(id);
  }

  async function refreshInbox(key) {
    try {
      const result = await socket.timeout(10000).emitWithAck('dm-inbox', {});
      if (membership !== key || !result?.success) return;
      for (const item of result.latest) noteActivity(item.peer, item);
      renderFriends();
    } catch { /* As conversas abertas continuam recebendo mensagens ao vivo. */ }
  }

  function renderFriends() {
    const list = $('dm-friends');
    list.replaceChildren();
    for (const person of [...friends].sort((a, b) => (latest.get(b.id)?.timestamp || 0) - (latest.get(a.id)?.timestamp || 0))) {
      const button = document.createElement('button');
      button.className = 'dm-person'; button.type = 'button';
      const name = document.createElement('strong'), detail = document.createElement('small');
      name.textContent = person.name || person.username;
      detail.textContent = '@' + person.username + (unread.has(person.id) ? ' · Nova mensagem' : '');
      button.append(name, detail);
      button.onclick = () => open(person.id);
      list.append(button);
    }
    if (!friends.length) list.textContent = 'Adicione um amigo em Configurações → Amigos para começar.';
    $('dm-badge').textContent = String(unread.size);
    $('dm-badge').hidden = !unread.size;
  }

  function reset() {
    generation++;
    peer = before = null;
    $('dm-latest').hidden = true;
    messages.clear(); log.replaceChildren(); input.value = '';
    $('dm-status').textContent = '';
    $('dm-title').textContent = 'Conversas';
    $('dm-back').hidden = $('dm-thread').hidden = true;
    $('dm-friends').hidden = false;
  }

  function renderMessages() {
    // Inserir só as mensagens novas mantém o clipe tocando, inclusive ao carregar o histórico.
    let proxima = log.firstElementChild;
    if (!proxima) log.textContent = messages.size ? '' : 'Envie a primeira mensagem.';
    const person = friends.find(friend => friend.id === peer);
    for (const msg of [...messages.values()].sort((a, b) => a.id - b.id)) {
      if (Number(proxima?.dataset.id) === msg.id) {
        proxima = proxima.nextElementSibling;
        continue;
      }
      const row = document.createElement('article');
      const own = msg.from === owner;
      row.dataset.id = msg.id;
      row.className = 'dm-message' + (own ? ' dm-own' : '');
      const by = document.createElement('strong'), time = document.createElement('time'), body = document.createElement('p');
      by.textContent = own ? 'Você' : person?.name || person?.username;
      time.dateTime = new Date(msg.timestamp).toISOString();
      time.textContent = new Date(msg.timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      let last = 0;
      for (const { index, label, url } of messageLinks(msg.text)) {
        const link = document.createElement('a');
        link.href = url.href; link.textContent = label;
        link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'chat-link';
        body.append(msg.text.slice(last, index), link);
        last = index + label.length;
      }
      body.append(msg.text.slice(last));
      row.append(by, time, body);
      attachLinkPreview(body);
      log.insertBefore(row, proxima);
    }
  }

  async function loadHistory(older = false) {
    const turn = generation;
    $('dm-older').disabled = true;
    try {
      const height = log.scrollHeight, top = log.scrollTop, at = seen.get(peer) || 0;
      let first;
      do {
        const result = await socket.timeout(10000).emitWithAck('dm-history', { accountId: peer, ...(before ? { before } : {}) });
        if (turn !== generation) return;
        if (!result?.success) throw new Error(result?.error || 'Conversa indisponível.');
        for (const msg of result.messages) messages.set(msg.id, msg);
        first = result.messages[0]?.id;
        before = result.before;
      } while (!older && before && first > at && unread.has(peer));
      $('dm-older').hidden = !before;
      renderMessages();
      const next = !older && [...log.children].find(row => Number(row.dataset.id) > at);
      if (next) next.scrollIntoView({ block: 'start' });
      else log.scrollTop = older ? top + log.scrollHeight - height : log.scrollHeight;
      recordVisible();
      $('dm-status').textContent = '';
    } catch (err) {
      if (turn === generation) $('dm-status').textContent = err.message === 'operation has timed out' ? 'A sala demorou para responder. Abra a conversa de novo.' : err.message;
    } finally { if (turn === generation) $('dm-older').disabled = false; }
  }

  function open(id) {
    if (!owner || !socket.connected) return;
    reset(); renderFriends();
    if (!dialog.open) dialog.showModal();
    const person = friends.find(friend => friend.id === id);
    if (!person) return;
    peer = id;

    $('dm-title').textContent = person.name || person.username;
    $('dm-thread').hidden = $('dm-back').hidden = false;
    $('dm-friends').hidden = $('dm-older').hidden = true;
    $('dm-compose').querySelector('button').disabled = false;
    $('dm-status').textContent = 'Carregando conversa…';
    loadHistory(); input.focus();
  }

  function sync(list) {
    const id = getAccount()?.id || null;
    if (id !== owner || !socket.connected) {
      if (dialog.open) dialog.close();
      reset(); unread.clear(); latest.clear(); seen.clear(); membership = null;
    }
    owner = socket.connected ? id : null;
    friends = owner ? list : [];
    $('dm-open').classList.toggle('hidden', !owner);
    const ids = new Set(friends.map(person => person.id));
    const key = JSON.stringify([owner, ...[...ids].sort()]);
    if (membership !== key) {
      membership = key;
      if (ids.size) refreshInbox(key);
    }
    for (const id of unread) if (!ids.has(id)) unread.delete(id);
    if (peer && !ids.has(peer)) reset();
    renderFriends();
  }

  function recordVisible() {
    if (!dialog.open || !peer || !log.clientHeight || document.hidden) return;
    const bounds = log.getBoundingClientRect();
    for (let i = log.children.length - 1; i >= 0; i--) {
      const row = log.children[i], box = row.getBoundingClientRect();
      if (box.top >= bounds.bottom || box.bottom <= bounds.top) continue;
      markRead(peer, Number(row.dataset.id));
      break;
    }
    $('dm-latest').hidden = log.scrollHeight - log.clientHeight - log.scrollTop < 4;
    renderFriends();
  }
  log.addEventListener('scroll', recordVisible);
  $('dm-latest').onclick = () => { log.scrollTop = log.scrollHeight; recordVisible(); };
  $('dm-open').onclick = () => open();
  $('dm-back').onclick = () => open();
  $('dm-close').onclick = () => dialog.close();
  dialog.addEventListener('close', reset);
  $('dm-older').onclick = () => loadHistory(true);
  $('dm-compose').onsubmit = async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    const draft = input.value, text = draft.trim(), turn = generation;
    if (!peer || !socket.connected || button.disabled || !text) return;
    button.disabled = true;
    try {
      const result = await socket.timeout(10000).emitWithAck('dm-send', { accountId: peer, text });
      if (turn !== generation) return;
      if (!result?.success) throw new Error(result?.error || 'Mensagem não enviada.');
      if (input.value === draft) input.value = '';
      $('dm-status').textContent = ''; input.focus();
    } catch (err) {
      if (turn === generation) $('dm-status').textContent = err.message === 'operation has timed out' ? 'Envio sem confirmação. Confira a conversa.' : err.message;
    } finally { if (turn === generation) button.disabled = false; }
  };
  socket.on('dm-message', msg => {
    const other = msg.from === owner ? msg.to : msg.from;
    if (!owner || !friends.some(friend => friend.id === other)) return;
    noteActivity(other, msg);
    if (dialog.open && peer === other) {

      const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      messages.set(msg.id, msg); renderMessages();
      if (atEnd || msg.from === owner) log.scrollTop = log.scrollHeight;
      recordVisible();
    }
    renderFriends();
  });
  return { open, sync };
}
