// A senha e a seleção ficam no servidor. A interface só inicia a mídia após a autorização.
export function setupStreamAccess({ socket, appState, streamKind, streamOwner, streamKey, unwatchScreen, interromper, showToast }) {
  const $ = id => document.getElementById(id);
  const dialog = $('acesso-transmissao'), entrar = $('entrar-transmissao');
  const fonte = $('acesso-fonte'), modo = $('acesso-modo'), senha = $('acesso-senha');
  const status = $('acesso-aviso'), pessoas = $('acesso-pessoas'), campos = $('acesso-campos');
  let supported = false, channelId, revision = 0, current, joinRevision = 0;
  const protegidas = new Set(), revisar = new Set();
  const request = payload => socket.timeout(7000).emitWithAck('stream-access', payload);
  function reset() {
    revision++;
    joinRevision++;
    dialog.close();
    entrar.close();
  }
  for (const modal of [dialog, entrar]) {
    modal.querySelector('[data-fechar]').onclick = () => modal.close();
  }
  dialog.addEventListener('close', () => { senha.value = ''; revision++; });
  entrar.addEventListener('close', () => { $('entrar-senha').value = ''; });
  socket.on('disconnect', () => {
    supported = false;
    for (const kind of protegidas) {
      revisar.add(kind);
      interromper(kind);
    }
    if (revisar.size) showToast('A conexão caiu. Revise o acesso antes de transmitir novamente.');
    document.querySelectorAll('[data-stream-access-open]').forEach(b => b.classList.add('hidden'));
    reset();
  });
  socket.on('room-info', info => {
    if (info.streamAccess !== true) return;
    supported = true;
    document.querySelectorAll('[data-stream-access-open]').forEach(b => b.classList.remove('hidden'));
  });
  function opcoes() {
    $('acesso-segredo').hidden = modo.value !== 'password';
    senha.required = modo.value === 'password' && current?.mode !== 'password';
    senha.placeholder = current?.mode === 'password' ? 'Deixe em branco para manter a senha' : '';
    pessoas.querySelectorAll('[data-convite]').forEach(box => {
      box.hidden = modo.value !== 'invite';
      box.disabled = box.hidden;
    });
  }
  function preencher(result) {
    current = result;
    modo.value = result.mode;
    senha.value = '';
    listarPessoas(result.allowed);
  }
  function listarPessoas(allowed) {
    pessoas.replaceChildren();
    const users = appState.channels.get(channelId)?.users;
    const membros = new Map();
    const key = streamKey(appState.myId, fonte.value);
    for (const person of users?.values() || []) {
      if (!membros.has(person.memberId) || person.watching?.includes(key)) membros.set(person.memberId, person);
    }
    for (const person of membros.values()) {
      if (person.id === appState.myId || !person.memberId || person.memberId === appState.memberId) continue;
      const row = document.createElement('div'), label = document.createElement('label');
      row.className = 'acesso-pessoa';
      const check = document.createElement('input');
      check.type = 'checkbox'; check.dataset.convite = ''; check.value = person.memberId;
      check.checked = allowed.includes(person.memberId);
      label.append(check, document.createTextNode(person.name));
      const bloqueado = current.blocked.includes(person.memberId);
      const assistindo = person.watching?.includes(key);
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.membro = person.memberId;
      button.textContent = bloqueado ? 'Liberar' : assistindo ? 'Expulsar' : 'Bloquear';
      button.title = bloqueado ? 'Permitir acesso conforme a regra da transmissão' : 'Impedir esta pessoa de assistir até você liberar ou a transmissão terminar';
      button.setAttribute('aria-label', button.textContent + ' · ' + person.name);
      button.onclick = async () => {
        const reply = await enviar({ action: bloqueado ? 'unblock' : 'block', viewerId: person.id, memberId: person.memberId });
        if (!reply) return;
        current.blocked = reply.blocked;
        listarPessoas(selecionados());
        status.textContent = bloqueado ? 'Bloqueio removido.' : 'Acesso bloqueado nesta transmissão.';
      };
      row.append(label, button); pessoas.append(row);
    }
    $('acesso-acao-ajuda').hidden = !pessoas.childElementCount;
    if (!pessoas.childElementCount) pessoas.textContent = 'Ainda não há outras pessoas na call.';
    opcoes();
  }
  function selecionados() {
    const marcados = new Set(current?.allowed || []);
    for (const box of pessoas.querySelectorAll('[data-convite]')) {
      if (box.checked) marcados.add(box.value); else marcados.delete(box.value);
    }
    return [...marcados];
  }
  // Os selos de espectador acompanham a call também enquanto a janela está aberta.
  for (const event of ['user-joined', 'user-left']) {
    socket.on(event, () => {
      if (dialog.open && current) queueMicrotask(() => {
        if (dialog.open && current) listarPessoas(selecionados());
      });
    });
  }
  socket.on('user-state-changed', state => {
    if (!dialog.open || !current || !Array.isArray(state.watching) || state.channelId !== channelId) return;
    const users = appState.channels.get(channelId)?.users;
    const person = users?.get(state.userId);
    if (!person || current.blocked.includes(person.memberId)) return;
    const button = pessoas.querySelector(`[data-membro="${CSS.escape(person.memberId)}"]`);
    if (button) {
      const key = streamKey(appState.myId, fonte.value);
      const watching = state.watching.includes(key) || [...users.values()].some(u => u.id !== person.id && u.memberId === person.memberId && u.watching?.includes(key));
      button.textContent = watching ? 'Expulsar' : 'Bloquear';
      button.setAttribute('aria-label', button.textContent + ' · ' + person.name);
    }
  });
  async function enviar(payload) {
    const turn = ++revision;
    // Se a conexão cair antes da resposta, a próxima captura também exige revisão.
    if (payload.action === 'block' || (payload.action === 'save' && payload.mode !== 'open')) protegidas.add(fonte.value);
    const salvar = $('acesso-form').querySelector('[type="submit"]');
    campos.disabled = true; salvar.disabled = true; fonte.disabled = payload.action !== 'get';
    status.textContent = '';
    try {
      const reply = await request({ ...payload, channelId, kind: fonte.value });
      if (turn !== revision || !dialog.open || channelId !== appState.currentChannelId) return;
      if (!reply?.success) throw new Error(reply?.error || 'Não consegui atualizar o acesso.');
      if (payload.action !== 'get') {
        if (reply.mode !== 'open' || reply.blocked.length) protegidas.add(fonte.value);
        else protegidas.delete(fonte.value);
        if (payload.action === 'save') revisar.delete(fonte.value);
      }
      return reply;
    } catch (err) {
      if (turn === revision) status.textContent = err.message === 'operation has timed out' ? 'A sala demorou a responder. Abra o acesso novamente para conferir.' : err.message;
    } finally { if (turn === revision) { fonte.disabled = false; campos.disabled = !current; salvar.disabled = campos.disabled; } }
  }
  async function carregar() {
    current = null; pessoas.replaceChildren(); senha.value = '';
    $('acesso-segredo').hidden = true; $('acesso-acao-ajuda').hidden = true;
    const result = await enviar({ action: 'get' });
    if (result) {
      preencher(result);
      campos.disabled = false;
      $('acesso-form').querySelector('[type="submit"]').disabled = false;
    }
  }
  function open(kind = 'screen') {
    if (!appState.currentChannelId || !supported) return;
    $('mobile-call-options')?.close(); if ($('stage-more')) $('stage-more').open = false;
    channelId = appState.currentChannelId;
    fonte.value = kind;
    const host = document.fullscreenElement || document.body;
    if (dialog.parentElement !== host) host.append(dialog);
    if (!dialog.open) dialog.showModal();
    carregar();
  }
  document.addEventListener('click', e => {
    const button = e.target.closest('[data-stream-access-open]');
    if (button) open(button.dataset.streamAccessOpen || 'screen');
  });
  fonte.onchange = carregar; modo.onchange = opcoes;
  $('acesso-form').onsubmit = async e => {
    e.preventDefault();
    const reply = await enviar({ action: 'save', mode: modo.value, password: senha.value, allowed: selecionados() });
    if (reply) { dialog.close(); showToast('Acesso à transmissão atualizado.'); }
  };

  async function autorizar(key) {
    if (!supported) return true;
    const turn = joinRevision, call = appState.currentChannelId;
    const payload = { action: 'join', channelId: call, ownerId: streamOwner(key), kind: streamKind(key) };
    const valido = () => turn === joinRevision && call === appState.currentChannelId;
    try {
      let result = await request(payload);
      if (!valido()) return false;
      if (result.passwordRequired) {
        if (entrar.open) return false;
        const input = $('entrar-senha'), form = entrar.querySelector('form'), aviso = entrar.querySelector('[role="status"]');
        input.value = ''; aviso.textContent = '';
        $('entrar-titulo').textContent = 'Assistir · ' + (appState.channels.get(call)?.users.get(payload.ownerId)?.name || 'Transmissão');
        (document.fullscreenElement || document.body).append(entrar);
        entrar.showModal(); input.focus();
        result = await new Promise(resolve => {
          let pending = false;
          let answer = null;
          async function enviarSenha(e) {
            e.preventDefault();
            if (pending) return;
            pending = true;
            try {
              const reply = await request({ ...payload, password: input.value });
              if (!valido() || !entrar.open || form.onsubmit !== enviarSenha) return;
              if (reply.passwordRequired) { aviso.textContent = reply.error; input.select(); return; }
              answer = reply;
              entrar.close();
            } catch { if (valido() && entrar.open) aviso.textContent = 'Não consegui verificar a senha. Tente novamente.'; }
            finally { pending = false; }
          }
          form.onsubmit = enviarSenha;
          entrar.addEventListener('close', () => { form.onsubmit = null; resolve(answer); }, { once: true });
        });
      }
      if (!result || !valido()) return false;
      if (!result.success) showToast(result.error || 'Acesso negado.', 'error');
      return !!result.success;
    } catch { if (valido()) showToast('Não consegui confirmar o acesso à transmissão.', 'error'); return false; }
  }
  socket.on('stream-access-cut', ({ kind, viewerId }) => {
    const key = streamKey(viewerId, kind);
    appState.screenPeersOut.get(key)?.close(); appState.screenPeersOut.delete(key);
  });
  socket.on('stream-access-ended', ({ kind, ownerId }) => {
    const key = streamKey(ownerId, kind);
    if (appState.activeStreams.has(key) || appState.sfuViewers.has(key) || appState.screenPeersIn.has(key)) {
      unwatchScreen(key); showToast('Seu acesso a essa transmissão foi encerrado.');
    }
  });
  return { autorizar, reset, open,
    mudouDeCall() {
      for (const kind of protegidas) revisar.add(kind);
      protegidas.clear();
    },
    terminou(kind) { protegidas.delete(kind); },
    podeTransmitir(kind) {
      if (!revisar.has(kind)) return true;
      if (supported) {
        showToast('Confira o acesso desta transmissão e salve antes de começar.');
        open(kind);
      } else showToast('O servidor precisa oferecer controle de acesso para retomar esta transmissão.', 'error');
      return false;
    },
    get supported() { return supported; }
  };
}
