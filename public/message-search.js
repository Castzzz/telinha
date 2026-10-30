export function setupMessageSearch({ socket, appState, showToast, mountStageOverlay }) {
  const $ = id => document.getElementById(id);
  const modal = $('modal-message-search'), channel = $('message-search-channel'), results = $('message-search-results');
  const status = $('message-search-status'), more = $('message-search-more'), submit = $('message-search-submit');
  let generation = 0, request = null, cursor = null;
  const allowed = target => target && (target.scope === 'text' ? appState.textChannels.has(target.channelId) : appState.currentChannelId === target.channelId);
  const clear = () => { generation++; results.replaceChildren(); more.classList.add('hidden'); submit.disabled = false; more.disabled = false; request = null; cursor = null; };
  function options() {
    const previous = channel.value;
    channel.replaceChildren();
    if (appState.currentChannelId) channel.add(new Option('Chat da call atual', 'call:' + appState.currentChannelId));
    for (const [id, ch] of appState.textChannels) channel.add(new Option('#' + ch.name, 'text:' + id));
    if ([...channel.options].some(o => o.value === previous)) channel.value = previous;
  }
  $('btn-chat-search').addEventListener('click', () => {
    clear(); options(); status.textContent = 'Busque no histórico salvo dos canais de texto. Na call, só as últimas 50 mensagens ficam disponíveis.';
    const selected = appState.textView ? 'text:' + appState.textView : 'call:' + appState.currentChannelId;
    if ([...channel.options].some(o => o.value === selected)) channel.value = selected;
    mountStageOverlay(modal); modal.classList.remove('hidden'); $('message-search-query').focus();
  });
  const text = msg => msg.text || msg.attachment?.name || (msg.image ? '[Imagem]' : '[Anexo]');
  function item(msg) {
    const node = document.createElement('article'); node.className = 'search-result';
    const author = document.createElement('strong'); author.textContent = msg.userName || msg.senderName || 'Pessoa';
    const time = document.createElement('time'); time.textContent = new Date(msg.timestamp).toLocaleString('pt-BR');
    const content = document.createElement('p'); content.textContent = text(msg);
    node.append(author, time, content); return node;
  }
  function append(msg) {
    const node = item(msg), button = document.createElement('button');
    button.type = 'button'; button.className = 'btn-secondary'; button.textContent = 'Ver contexto';
    button.addEventListener('click', async () => {
      const target = request, version = generation;
      if (!allowed(target)) return clear();
      button.disabled = true;
      try {
        const res = await socket.timeout(6000).emitWithAck('message-context', { ...target, messageId: msg.id });
        if (version !== generation || !allowed(target) || modal.classList.contains('hidden')) return;
        if (!res?.success) { showToast(res?.error || 'Não consegui carregar o contexto.', 'error'); return; }
        node.querySelector('.search-context')?.remove();
        const context = document.createElement('div'); context.className = 'search-context';
        for (const message of res.messages) { const row = item(message); if (message.id === msg.id) row.classList.add('search-match'); context.append(row); }
        node.append(context);
      } catch { showToast('Sem resposta do servidor. Tente novamente.', 'error'); }
      finally { button.disabled = false; }
    });
    node.append(button); results.append(node);
  }
  async function search(next = false) {
    if (!next) {
      clear();
      const [scope, ...parts] = channel.value.split(':');
      request = { scope, channelId: parts.join(':'), query: $('message-search-query').value.trim(), author: $('message-search-author').value.trim(), since: $('message-search-since').value };
    }
    if (!allowed(request)) { clear(); status.textContent = 'Escolha um canal disponível.'; return; }
    if (!request.query && !request.author) { status.textContent = 'Digite um texto ou o nome de uma pessoa.'; return; }
    const version = generation, target = request;
    submit.disabled = more.disabled = true; status.textContent = 'Buscando…';
    try {
      const res = await socket.timeout(8000).emitWithAck('message-search', { ...target, ...(next ? { before: cursor } : {}) });
      if (version !== generation || !allowed(target) || modal.classList.contains('hidden')) return;
      if (!res?.success) { status.textContent = res?.error || 'O servidor ainda não oferece busca.'; return; }
      res.messages.forEach(append); cursor = res.messages.at(-1)?.id;
      more.classList.toggle('hidden', !res.hasMore);
      status.textContent = results.children.length ? `${results.children.length} mensagem(ns) encontrada(s), mais recentes primeiro.` : 'Nenhuma mensagem encontrada.';
    } catch { if (version === generation) status.textContent = 'Sem resposta do servidor. Tente novamente.'; }
    finally { if (version === generation) submit.disabled = more.disabled = false; }
  }
  $('message-search-form').addEventListener('submit', event => { event.preventDefault(); search(); });
  more.addEventListener('click', () => search(true));
  channel.addEventListener('change', () => { clear(); status.textContent = 'Digite os filtros e clique em Buscar.'; });
  modal.querySelector('[data-close-modal]').addEventListener('click', clear);
  modal.addEventListener('keydown', event => { if (event.key === 'Escape') { modal.classList.add('hidden'); clear(); $('btn-chat-search').focus(); } });
  socket.on('text-channels', () => { if (request && !allowed(request)) { clear(); options(); status.textContent = 'O acesso a esse canal mudou.'; } });
  const resetCall = () => { if (request?.scope === 'call') { clear(); options(); status.textContent = 'A call mudou. Faça a busca novamente.'; } };
  for (const event of ['channel-state', 'kicked', 'channel-deleted', 'moved-by-admin']) socket.on(event, resetCall);
  window.addEventListener('teletela-call-left', resetCall);
  socket.on('disconnect', () => { clear(); status.textContent = 'A conexão caiu. Faça a busca novamente ao reconectar.'; });
  for (const event of ['text-message-deleted', 'text-message-updated', 'chat-message-deleted', 'chat-message-updated']) socket.on(event, () => { if (request) { clear(); status.textContent = 'O histórico mudou. Faça a busca novamente.'; } });
}
