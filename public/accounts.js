const ACCOUNT_ICON = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg>';

export function accountSession(prefs, serverUrl) {
  const session = prefs.accountSessions?.[serverUrl];
  return session && /^[a-f0-9]{64}$/.test(session.token || '') ? session : null;
}

// Usar antes de criar a chave local: entrar na conta não publica o perfil do visitante.
export function initialAccountProfile(prefs, serverUrl) {
  return accountSession(prefs, serverUrl)?.profile || prefs.profile;
}

// As imagens completas chegam do servidor; duplicá-las nas sessões estoura a cota local.
export function accountProfileSnapshot(profile) {
  const { avatar, banner, joinSound, ...snapshot } = profile;
  return snapshot;
}

function freshGuest() {
  const id = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
  return { id, name: `Amigo-${Math.floor(1000 + Math.random() * 9000)}`, color: '#5865F2' };
}

export function setupAccounts({ socket, prefs, savePrefs, serverUrl, getProfile, getMemberId = () => null,
  onProfile = () => {}, showToast, selectSettingsTab, reconnect = () => window.location.reload() }) {
  const $ = selector => document.querySelector(selector);
  const tabs = $('.settings-sidebar') || $('[data-settings-tab="perfil"]')?.parentElement;
  const body = $('[data-settings-section="perfil"]')?.parentElement;
  if (!tabs || !body) return { get ready() { return false; } };
  const tab = document.createElement('button');
  tab.type = 'button'; tab.className = 'settings-tab'; tab.dataset.settingsTab = 'conta';
  tab.innerHTML = `${ACCOUNT_ICON}<span>Conta</span>`;
  tabs.append(tab);
  const section = document.createElement('section');
  section.className = 'settings-section hidden'; section.dataset.settingsSection = 'conta';
  section.innerHTML = `
    <h4 class="settings-section-title">Sua conta</h4>
    <p class="account-intro">Opcional: use o mesmo perfil, cargos e acesso no computador e no Android. Seu usuário é só para entrar; o apelido dos amigos continua no perfil.</p>
    <p id="account-status" class="account-status" role="status">Verificando o suporte desta sala…</p>
    <div id="account-auth" class="hidden">
      <div class="account-modes" role="group" aria-label="Acesso à conta">
        <button type="button" class="btn-secondary" data-account-mode="login">Entrar</button>
        <button type="button" class="btn-secondary" data-account-mode="register">Criar conta</button>
        <button type="button" class="btn-secondary" data-account-mode="recover">Recuperar</button>
      </div>
      <form id="account-form" class="account-form">
        <label for="account-user">Usuário</label>
        <input id="account-user" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required minlength="3" maxlength="24" pattern="[a-zA-Z0-9_]{3,24}" placeholder="seu_usuario" />
        <div id="account-recovery-field" class="hidden">
          <label for="account-recovery-input">Código de recuperação</label>
          <input id="account-recovery-input" name="recoveryCode" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="80" placeholder="O código entregue ao criar sua conta" />
        </div>
        <label id="account-password-label" for="account-password">Senha</label>
        <input id="account-password" name="password" type="password" autocomplete="current-password" required maxlength="128" />
        <div id="account-confirm-field" class="hidden">
          <label for="account-confirm">Repita a senha</label>
          <input id="account-confirm" type="password" autocomplete="new-password" maxlength="128" />
        </div>
        <p id="account-help" class="account-help"></p>
        <button type="submit" id="account-submit" class="btn-primary">Entrar</button>
      </form>
    </div>
    <div id="account-logged" class="hidden">
      <p>Conectado como <strong id="account-username"></strong>.</p>
      <p class="account-help">A sessão fica salva neste aparelho. Guarde seu código de recuperação em um lugar seguro: sem a senha e sem o código, você perde o acesso.</p>
      <button type="button" id="account-logout" class="btn-secondary">Sair da conta neste aparelho</button>
    </div>
    <div id="account-recovery-result" class="account-recovery-result hidden">
      <h5>Guarde seu código de recuperação</h5>
      <p>Ele aparece só agora. Com esse código você pode trocar a senha e encerrar as sessões antigas. Guarde em um lugar privado, fora do app.</p>
      <code id="account-recovery-code" tabindex="0"></code>
      <div class="account-recovery-actions">
        <button type="button" id="account-copy-code" class="btn-secondary">Copiar código</button>
        <button type="button" id="account-continue" class="btn-primary">Já guardei, continuar</button>
      </div>
    </div>
    <p id="account-feedback" class="account-feedback hidden" role="status" aria-live="polite"></p>`;
  body.append(section);
  tab.addEventListener('click', () => selectSettingsTab?.('conta'));
  let current = accountSession(prefs, serverUrl)?.account || null;
  let connectedToken = accountSession(prefs, serverUrl)?.token || '';
  let supported = false, ready = false, profileLoaded = false, busy = false, mode = 'login', codeVisible = false;

  function feedback(message = '', error = false) {
    $('#account-feedback').textContent = message;
    $('#account-feedback').dataset.error = String(error);
    $('#account-feedback').classList.toggle('hidden', !message);
  }
  function render() {
    $('#account-status').textContent = !socket.connected && supported ? 'Você pode entrar com sua conta mesmo antes de informar a senha da sala.'
      : !socket.connected ? 'Espere a conexão voltar para acessar sua conta.'
      : !ready ? 'Verificando o suporte desta sala…'
      : !supported ? 'Esta sala ainda não oferece contas. Você pode continuar usando seu perfil normalmente.'
      : current ? 'Seu perfil está vinculado à conta nesta sala.' : 'Você está usando um perfil sem conta.';
    $('#account-auth').classList.toggle('hidden', !supported || Boolean(current) || codeVisible);
    $('#account-logged').classList.toggle('hidden', !current || codeVisible);
    $('#account-username').textContent = current ? `@${current.username}` : '';
    for (const button of section.querySelectorAll('button')) button.disabled = busy
      || (!socket.connected && button.dataset.accountMode === 'register')
      || (!socket.connected && button.id === 'account-submit' && mode === 'register');
  }
  function setMode(next) {
    mode = next;
    const creating = mode !== 'login', recovering = mode === 'recover';
    $('#account-confirm-field').classList.toggle('hidden', !creating);
    $('#account-confirm').required = creating; $('#account-confirm').disabled = !creating;
    $('#account-recovery-field').classList.toggle('hidden', !recovering);
    $('#account-recovery-input').required = recovering; $('#account-recovery-input').disabled = !recovering;
    $('#account-password').minLength = creating ? 8 : 1;
    $('#account-password').autocomplete = creating ? 'new-password' : 'current-password';
    $('#account-password-label').textContent = recovering ? 'Nova senha' : 'Senha';
    $('#account-submit').textContent = recovering ? 'Recuperar conta' : creating ? 'Criar conta' : 'Entrar';
    $('#account-help').textContent = recovering ? 'O código de recuperação substitui o anterior e encerra as sessões nos outros aparelhos.'
      : creating ? 'Use de 3 a 24 letras, números ou _ no usuário e de 8 a 128 caracteres na senha. Seu perfil e cargos atuais serão preservados. Não pedimos e-mail ou telefone.'
      : 'Entre na conta criada nesta sala. Você continua livre para usar o app sem conta.';
    for (const button of section.querySelectorAll('[data-account-mode]')) button.setAttribute('aria-pressed', String(button.dataset.accountMode === next));
    $('#account-password').value = ''; $('#account-confirm').value = ''; $('#account-recovery-input').value = '';
    feedback(); render();
  }
  const persist = async patch => {
    if (await savePrefs(patch) === false) throw new Error('Não foi possível salvar a sessão neste aparelho. Libere espaço e tente de novo.');
  };
  const request = async (event, payload) => {
    let result;
    if (!socket.connected && ['account-login', 'account-recover', 'account-logout'].includes(event)) {
      try {
        const response = await fetch(`${serverUrl}/api/account/${event.slice(8)}`, { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
        result = await response.json();
      } catch { throw new Error('Não deu para falar com o servidor. Confira sua conexão e tente de novo.'); }
    } else {
      if (!socket.connected) throw new Error('Entre na sala antes de criar uma conta para este perfil.');
      result = await socket.timeout(20000).emitWithAck(event, payload).catch(() => { throw new Error('O servidor demorou para responder. Tente de novo.'); });
    }
    if (!result?.success) throw new Error(result?.error || 'Não deu para concluir. Tente de novo.');
    return result;
  };
  const guestPatch = session => {
    const guest = session?.guest || { profile: freshGuest(), roomAccess: {} };
    return { profile: guest.profile, roomAccess: { ...prefs.roomAccess, [serverUrl]: guest.roomAccess || {} },
      accountSessions: { ...prefs.accountSessions, [serverUrl]: null } };
  };
  async function enter(result) {
    const existing = accountSession(prefs, serverUrl);
    const sameIdentity = result.account.accessId === getMemberId() || result.profile.id === getProfile().id;
    const guest = existing?.guest || (sameIdentity || mode === 'register'
      ? { profile: freshGuest(), roomAccess: {} }
      : { profile: structuredClone(getProfile()), roomAccess: { ...(prefs.roomAccess?.[serverUrl] || {}) } });
    const saved = { token: result.token, expiresAt: result.expiresAt, account: result.account, profile: accountProfileSnapshot(result.profile), guest };
    await persist({ accountSessions: { ...prefs.accountSessions, [serverUrl]: saved }, profile: freshGuest(),
      roomAccess: { ...prefs.roomAccess, [serverUrl]: { password: prefs.roomAccess?.[serverUrl]?.password || '' } } });
    current = result.account;
    $('#account-password').value = ''; $('#account-confirm').value = ''; $('#account-recovery-input').value = '';
    if (result.recoveryCode) {
      codeVisible = true;
      $('#account-recovery-code').textContent = result.recoveryCode;
      $('#account-recovery-result').classList.remove('hidden');
      $('#account-recovery-code').focus();
      feedback('Conta salva neste aparelho. Guarde o código antes de continuar.');
      // A conta já pode usar a sala, mesmo se a pessoa fechar este painel.
      connectedToken = result.token;
      socket.disconnect();
      socket.connect();
    } else await reconnect();
  }
  async function perform(action) {
    if (busy) return;
    busy = true; feedback(); render();
    try { await action(); } catch (error) { feedback(error.message, true); }
    finally { busy = false; render(); }
  }
  for (const button of section.querySelectorAll('[data-account-mode]')) button.addEventListener('click', () => setMode(button.dataset.accountMode));
  $('#account-form').addEventListener('submit', event => {
    event.preventDefault();
    if (mode !== 'login' && $('#account-password').value !== $('#account-confirm').value) return feedback('As duas senhas precisam ser iguais.', true);
    perform(async () => enter(await request(`account-${mode}`, { username: $('#account-user').value,
      password: $('#account-password').value, ...(mode === 'recover' ? { recoveryCode: $('#account-recovery-input').value } : {}) })));
  });
  $('#account-continue').addEventListener('click', () => perform(async () => reconnect()));
  $('#account-copy-code').addEventListener('click', () => perform(async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText($('#account-recovery-code').textContent);
    } catch { throw new Error('Não deu para copiar. Selecione o código acima e copie manualmente.'); }
    feedback('Código copiado. Guarde em um lugar privado.');
  }));
  $('#account-logout').addEventListener('click', () => perform(async () => {
    const session = accountSession(prefs, serverUrl);
    // Salvar o visitante antes de revogar impede reabrir com a identidade da conta.
    const patch = guestPatch(session);
    await persist(patch);
    try { await request('account-logout', { token: session?.token || '' }); } catch (error) { showToast?.(error.message, 'error'); }
    await reconnect();
  }));
  socket.on('account-state', async state => {
    ready = true; supported = state?.supported === true; current = state?.account || null;
    try {
      const saved = accountSession(prefs, serverUrl);
      if (saved && saved.token === connectedToken && !current && state?.sessionExpired) {
        await persist(guestPatch(saved));
        showToast?.('Sua sessão terminou. Entre de novo ou continue sem conta.');
        return await reconnect();
      }
      if (current && state.profile && saved) {
        onProfile(state.profile);
        profileLoaded = true;
        await persist({ accountSessions: { ...prefs.accountSessions,
          [serverUrl]: { ...saved, account: current, profile: accountProfileSnapshot(state.profile) } } });
      }
    } catch (error) { feedback(error.message, true); }
    render();
  });
  const expireSession = async () => {
    if ((accountSession(prefs, serverUrl)?.token || '') !== connectedToken) return;
    try {
      await persist(guestPatch(accountSession(prefs, serverUrl)));
      showToast?.('Sua sessão terminou. Você pode entrar de novo.');
      await reconnect();
    } catch (error) { feedback(error.message, true); }
  };
  socket.on('account-session-ended', expireSession);
  socket.on('connect_error', error => {
    if (error?.message === 'account-session-expired') expireSession();
  });
  socket.on('connect', () => {
    connectedToken = accountSession(prefs, serverUrl)?.token || '';
    ready = false; profileLoaded = false; render();
  });
  socket.on('disconnect', render);
  socket.on('room-info', info => {
    if (info.accounts !== true && !ready) { ready = true; supported = false; render(); }
  });
  fetch(`${serverUrl}/api/account`, { signal: AbortSignal.timeout(8000), cache: 'no-store' })
    .then(response => response.ok ? response.json() : null)
    .then(info => { if (!ready && info) { ready = true; supported = info.supported === true; render(); } })
    .catch(() => { if (!ready) { ready = true; supported = false; render(); } });
  setMode('login'); render();
  return { get ready() { return ready && (!accountSession(prefs, serverUrl) || profileLoaded); }, get account() { return current; },
    open() { selectSettingsTab?.('conta'); tab.focus(); } };
}
