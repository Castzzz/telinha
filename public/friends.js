export function setupFriends({ socket, tabs, body, getAccount, selectSettingsTab }) {
  const tab = document.createElement('button');
  tab.type = 'button'; tab.className = 'settings-tab'; tab.dataset.settingsTab = 'amigos';
  tab.innerHTML = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="4"/><path d="M1 21v-2a8 8 0 0 1 16 0v2M17 4a4 4 0 0 1 0 8M23 21v-2a7 7 0 0 0-4-6"/></svg><span>Amigos</span>';
  tabs.append(tab);
  const section = document.createElement('section');
  section.className = 'settings-section hidden'; section.dataset.settingsSection = 'amigos';
  section.innerHTML = `<h4 class="settings-section-title">Seus amigos</h4>
    <p class="account-intro">Adicione pelo @usuário da conta nesta sala. A presença mostra quem está com o Teletela conectado.</p>
    <p id="friends-status" class="account-status" role="status"></p>
    <button type="button" id="friends-open-account" class="btn-secondary hidden">Entrar ou criar conta</button>
    <div id="friends-content" class="hidden">
      <form id="friends-form" class="account-form">
        <label for="friend-username">Adicionar amigo</label>
        <input id="friend-username" autocomplete="off" autocapitalize="none" spellcheck="false" required maxlength="25" placeholder="@usuario" />
        <button type="submit" class="btn-primary">Enviar pedido</button>
      </form>
      <h5>Amigos</h5><ul id="friends-list" class="friends-list"></ul>
      <h5>Pedidos recebidos</h5><ul id="friends-incoming" class="friends-list"></ul>
      <h5>Pedidos enviados</h5><ul id="friends-outgoing" class="friends-list"></ul>
    </div>
    <p id="friends-feedback" class="account-feedback" role="status" aria-live="polite"></p>`;
  body.append(section);
  const $ = selector => section.querySelector(selector);
  let supported = false, busy = false, state = { friends: [], incoming: [], outgoing: [] };
  const feedback = (message = '', error = false) => {
    $('#friends-feedback').textContent = message;
    $('#friends-feedback').dataset.error = String(error);
  };
  const labels = { accept: 'Aceitar', reject: 'Recusar', cancel: 'Cancelar pedido', remove: 'Remover amigo' };
  function renderList(selector, list, kind) {
    const root = $(selector); root.replaceChildren();
    if (!list.length) {
      const empty = document.createElement('li'); empty.className = 'account-help';
      empty.textContent = kind === 'friends' ? 'Nenhum amigo ainda.' : 'Nenhum pedido pendente.';
      root.append(empty); return;
    }
    for (const person of list) {
      const row = document.createElement('li'); row.className = 'friend-row';
      const info = document.createElement('div'), name = document.createElement('strong'), detail = document.createElement('span');
      name.textContent = person.name || person.username;
      detail.textContent = `@${person.username}${kind === 'friends' ? ` · ${!socket.connected ? 'Sem conexão' : person.online ? 'Online' : 'Offline'}` : ''}`;
      info.append(name, detail); row.append(info);
      const actions = document.createElement('div'); actions.className = 'friend-actions';
      for (const action of kind === 'incoming' ? ['accept', 'reject'] : kind === 'outgoing' ? ['cancel'] : ['remove']) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'btn-secondary';
        button.textContent = labels[action]; button.disabled = busy || !socket.connected;
        button.setAttribute('aria-label', `${labels[action]}: @${person.username}`);
        button.addEventListener('click', () => request(action, { accountId: person.id })); actions.append(button);
      }
      row.append(actions); root.append(row);
    }
  }
  function render() {
    const account = getAccount();
    $('#friends-status').textContent = !account ? 'Use uma conta para salvar seus amigos entre o PC e o celular.'
      : !socket.connected ? 'Sem conexão. Os pedidos voltam a funcionar quando a sala reconectar.'
      : !supported ? 'Esta sala ainda não oferece amigos. Atualize o servidor para usar esse recurso.'
      : `Seu usuário: @${account.username}`;
    $('#friends-open-account').classList.toggle('hidden', Boolean(account));
    $('#friends-content').classList.toggle('hidden', !account || !supported);
    $('#friends-form button').disabled = busy || !socket.connected;
    renderList('#friends-list', state.friends, 'friends');
    renderList('#friends-incoming', state.incoming, 'incoming');
    renderList('#friends-outgoing', state.outgoing, 'outgoing');
    tab.querySelector('span').textContent = state.incoming.length && account ? `Amigos (${state.incoming.length})` : 'Amigos';
  }
  async function request(action, payload) {
    if (busy || !socket.connected || !getAccount()) return;
    busy = true; feedback(); render();
    try {
      const result = await socket.timeout(10000).emitWithAck(`friend-${action}`, payload);
      if (!result?.success) throw new Error(result?.error || 'Não deu para concluir.');
      state = result;
      if (action === 'request') $('#friend-username').value = '';
      feedback(action === 'request' ? 'Pedido enviado.' : action === 'accept' ? 'Amizade aceita.' : 'Lista atualizada.');
    } catch (error) { feedback(error.message === 'operation has timed out' ? 'A sala demorou para responder. Confira a lista antes de tentar de novo.' : error.message, true); }
    finally { busy = false; render(); }
  }
  tab.addEventListener('click', () => { selectSettingsTab('amigos'); render(); });
  $('#friends-open-account').addEventListener('click', () => selectSettingsTab('conta'));
  $('#friends-form').addEventListener('submit', event => { event.preventDefault(); request('request', { username: $('#friend-username').value.trim() }); });
  socket.on('friends-state', next => { supported = next?.supported === true; state = { friends: next?.friends || [], incoming: next?.incoming || [], outgoing: next?.outgoing || [] }; render(); });
  socket.on('account-state', () => { if (!getAccount()) state = { friends: [], incoming: [], outgoing: [] }; render(); });
  socket.on('connect', () => { supported = false; state = { friends: [], incoming: [], outgoing: [] }; render(); });
  socket.on('disconnect', render);
  render();
}
