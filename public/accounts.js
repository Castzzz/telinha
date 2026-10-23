// Conta e amigos são opcionais; abrir a sala continua levando direto ao uso como visitante.
export function setupAccounts({ socket, saveSession, getProfile, getGuestProfile, onIdentity, onReady, showToast, editProfile, escapeHtml }) {
  const $ = (selector) => document.querySelector(selector);
  const modal = $('#modal-account');
  let account = null;
  let supported = false;
  let connected = socket.connected;
  let busy = false;
  let mode = 'login';
  let returnFocus = null;
  let friends = { friends: [], incoming: [], outgoing: [] };

  function feedback(message = '', error = false) {
    $('#account-feedback').textContent = message;
    $('#account-feedback').dataset.error = String(error);
    $('#account-feedback').classList.toggle('hidden', !message);
  }

  function selectTab(tab) {
    for (const button of modal.querySelectorAll('[data-account-tab]')) {
      const active = button.dataset.accountTab === tab;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      $(`#account-panel-${button.dataset.accountTab}`).classList.toggle('hidden', !active);
    }
    feedback();
  }

  function setMode(next) {
    mode = next;
    const register = mode === 'register';
    $('#account-confirm-field').classList.toggle('hidden', !register);
    $('#input-account-confirm').disabled = !register;
    $('#input-account-confirm').required = register;
    $('#input-account-password').minLength = register ? 8 : 1;
    $('#input-account-password').autocomplete = register ? 'new-password' : 'current-password';
    $('#input-account-password').value = '';
    $('#input-account-confirm').value = '';
    $('#btn-account-submit').textContent = register ? 'Criar conta' : 'Entrar';
    $('#account-auth-help').textContent = register
      ? 'Use uma senha de 8 a 128 caracteres. Seu perfil atual será copiado para a conta. Por enquanto, não há recuperação de senha por e-mail.'
      : 'Entre na conta que você criou nesta sala.';
    for (const button of modal.querySelectorAll('[data-account-mode]')) button.setAttribute('aria-pressed', String(button.dataset.accountMode === mode));
    feedback();
  }

  function close() {
    modal.classList.add('hidden');
    $('#input-account-password').value = '';
    $('#input-account-confirm').value = '';
    returnFocus?.focus();
  }

  function open(tab = 'account', nextMode) {
    returnFocus = document.activeElement;
    selectTab(tab);
    if (nextMode) setMode(nextMode);
    modal.classList.remove('hidden');
    render();
    (account || tab === 'friends' ? $(`#account-tab-${tab}`) : $('#input-account-username')).focus();
  }

  function renderList(selector, list, kind) {
    const empty = kind === 'friends' ? 'Nenhum amigo ainda. Envie um pedido pelo @usuário acima.' : kind === 'incoming' ? 'Nenhum pedido recebido.' : 'Nenhum pedido pendente.';
    $(selector).innerHTML = list.length ? list.map((friend) => {
      const button = (action, label, primary = false) => `<button type="button" class="${primary ? 'btn-primary' : 'btn-secondary'}" data-friend-action="${action}" data-friend-id="${escapeHtml(friend.id)}" aria-label="${escapeHtml(label)} ${escapeHtml(friend.username)}" ${busy || !connected ? 'disabled' : ''}>${label}</button>`;
      const actions = kind === 'incoming' ? button('accept', 'Aceitar', true) + button('reject', 'Recusar') : kind === 'outgoing' ? button('cancel', 'Cancelar') : button('remove', 'Remover');
      const initials = (friend.name || friend.username).trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join('').toUpperCase();
      return `<li class="friend-row"><span class="friend-initials" aria-hidden="true">${escapeHtml(initials)}</span><span class="friend-info"><strong>${escapeHtml(friend.name)}</strong><small>@${escapeHtml(friend.username)}${kind === 'friends' ? ` · <span class="${friend.online && connected ? 'friend-online' : ''}">${!connected ? 'Reconectando…' : friend.online ? 'Online' : 'Offline'}</span>` : ''}</small></span><span class="friend-actions">${actions}</span></li>`;
    }).join('') : `<li class="friends-empty">${empty}</li>`;
  }

  function render() {
    $('#account-button-label').textContent = account ? `@${account.username}` : 'Conta';
    $('#btn-open-account').title = account ? 'Sua conta' : 'Entrar ou criar uma conta (opcional)';
    $('#account-guest').classList.toggle('hidden', Boolean(account) || !supported);
    $('#account-logged').classList.toggle('hidden', !account);
    $('#account-unavailable').classList.toggle('hidden', supported);
    $('#friends-guest').classList.toggle('hidden', Boolean(account));
    $('#friends-logged').classList.toggle('hidden', !account);
    $('#account-username').textContent = account ? `@${account.username}` : '';
    $('#friends-request-count').textContent = String(friends.incoming.length);
    $('#friends-request-count').classList.toggle('hidden', !account || !friends.incoming.length);
    $('#btn-open-friends').setAttribute('aria-label', account && friends.incoming.length ? `Amigos, ${friends.incoming.length} pedidos recebidos` : 'Amigos');
    for (const [id, count] of [['account-friends-total', friends.friends.length], ['friends-total', friends.friends.length], ['friends-incoming-count', friends.incoming.length], ['friends-outgoing-count', friends.outgoing.length]]) $(`#${id}`).textContent = String(count);
    for (const button of modal.querySelectorAll('button[type="submit"], #btn-account-logout')) button.disabled = busy || !connected || !supported;
    renderList('#friends-list', friends.friends, 'friends');
    renderList('#friends-incoming', friends.incoming, 'incoming');
    renderList('#friends-outgoing', friends.outgoing, 'outgoing');
  }

  async function request(event, payload) {
    if (!connected) throw new Error('Espere a conexão voltar e tente de novo.');
    return new Promise((resolve, reject) => {
      socket.timeout(15000).emit(event, payload, (err, result) => {
        if (err) return reject(new Error('O servidor demorou para responder. Tente de novo.'));
        if (!result?.success) return reject(new Error(result?.error || 'Não deu para concluir. Tente de novo.'));
        resolve(result);
      });
    });
  }

  async function perform(action) {
    if (busy) return;
    busy = true; feedback(); render();
    try { await action(); }
    catch (err) { feedback(err.message, true); }
    finally { busy = false; render(); }
  }

  function applyIdentity(next, profile) {
    account = next;
    if (!account) friends = { friends: [], incoming: [], outgoing: [] };
    onIdentity(profile || getGuestProfile(), account);
    render();
  }

  socket.on('account-state', async (state) => {
    supported = state.supported === true;
    if (state.sessionExpired) {
      await saveSession('');
      showToast('Sua sessão terminou. Você pode entrar de novo ou continuar como visitante.');
    }
    applyIdentity(state.account || null, state.profile);
    onReady();
  });
  socket.on('account-profile', (profile) => { if (account && profile.id === account.id) onIdentity(profile, account); });
  socket.on('friends-state', (state) => {
    friends = { friends: state.friends || [], incoming: state.incoming || [], outgoing: state.outgoing || [] };
    render();
  });
  socket.on('account-error', ({ error }) => showToast(error, 'error'));
  socket.on('account-session-ended', async () => {
    await saveSession('');
    applyIdentity(null, getGuestProfile());
    showToast('Sua sessão terminou. Você continua como visitante.');
    setTimeout(() => socket.connect(), 200);
  });
  socket.on('connect', () => { connected = true; render(); });
  socket.on('disconnect', () => { connected = false; render(); });
  socket.on('room-info', (info) => {
    if (info.accounts !== true) {
      supported = false;
      if (account) applyIdentity(null, getGuestProfile());
      render();
    }
  });
  $('#btn-open-account').addEventListener('click', () => open());
  $('#btn-open-friends').addEventListener('click', () => open('friends'));
  $('#btn-close-account').addEventListener('click', close);
  $('#btn-account-guest').addEventListener('click', close);
  $('#btn-friends-register').addEventListener('click', () => { selectTab('account'); setMode('register'); $('#input-account-username').focus(); });
  $('#btn-friends-login').addEventListener('click', () => { selectTab('account'); setMode('login'); $('#input-account-username').focus(); });
  $('#btn-account-edit-profile').addEventListener('click', () => { close(); editProfile(); });
  for (const button of modal.querySelectorAll('[data-account-tab]')) button.addEventListener('click', () => selectTab(button.dataset.accountTab));
  for (const button of modal.querySelectorAll('[data-account-mode]')) button.addEventListener('click', () => setMode(button.dataset.accountMode));
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.target.matches('[data-account-tab]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const next = e.key === 'Home' ? 'account' : e.key === 'End' ? 'friends' : e.target.dataset.accountTab === 'account' ? 'friends' : 'account';
      selectTab(next); $(`#account-tab-${next}`).focus();
    }
    if (e.key === 'Tab') {
      const focusable = [...modal.querySelectorAll('button, input, [tabindex="0"]')].filter((el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  });
  $('#form-account-auth').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = $('#input-account-username').value.trim();
    const password = $('#input-account-password').value;
    if (mode === 'register' && password !== $('#input-account-confirm').value) return feedback('As duas senhas precisam ser iguais.', true);
    perform(async () => {
      const result = await request(`account-${mode}`, { username, password, ...(mode === 'register' ? { profile: getProfile() } : {}) });
      await saveSession(result.token);
      $('#input-account-password').value = ''; $('#input-account-confirm').value = '';
      applyIdentity(result.account, result.profile);
      selectTab('friends');
      feedback(`Pronto! Você está conectado como @${result.account.username}.`);
    });
  });
  $('#btn-account-logout').addEventListener('click', () => perform(async () => {
    const result = await request('account-logout', { profile: getGuestProfile() });
    await saveSession('');
    applyIdentity(null, result.profile);
    setMode('login');
    feedback('Você voltou ao seu perfil de visitante.');
  }));
  $('#form-add-friend').addEventListener('submit', (e) => {
    e.preventDefault();
    perform(async () => {
      await request('friend-request', { username: $('#input-friend-username').value });
      $('#input-friend-username').value = '';
      feedback('Pedido enviado! Agora é só a pessoa aceitar.');
    });
  });
  $('#friends-logged').addEventListener('click', (e) => {
    const button = e.target.closest('[data-friend-action]');
    if (!button) return;
    perform(async () => {
      await request(`friend-${button.dataset.friendAction}`, { userId: button.dataset.friendId });
      const messages = { accept: 'Amizade aceita!', reject: 'Pedido recusado.', cancel: 'Pedido cancelado.', remove: 'Amigo removido.' };
      feedback(messages[button.dataset.friendAction]);
    });
  });
  setMode('login'); render();
  return { get account() { return account; }, open };
}
