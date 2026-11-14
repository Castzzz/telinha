const icon = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="3"/><path d="m10 7 5 3-5 3ZM8 21h8m-4-4v4"/></svg>';

export function setupWatchTogether({ socket, appState, serverUrl, mountStageOverlay, showToast }) {
  const buttons = ['.app-topbar .topbar-right', '#stage-controls-bar .stage-controls-right', '#chat-drawer .chat-header'].map(selector => {
    const parent = document.querySelector(selector);
    if (!parent) return null;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'btn-control-icon watch-trigger';
    button.title = 'Assistir juntos'; button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-controls', 'modal-watch-together'); button.innerHTML = icon;
    parent.prepend(button); return button;
  }).filter(Boolean);
  const modal = document.createElement('div');
  modal.id = 'modal-watch-together'; modal.className = 'modal-backdrop hidden';
  modal.innerHTML = `<section class="modal-card watch-modal" role="dialog" aria-modal="true" aria-labelledby="watch-title" tabindex="-1">
    <div class="modal-header"><h2 id="watch-title">Assistir juntos</h2><button type="button" class="btn-icon-close" id="watch-close" aria-label="Fechar">✕</button></div>
    <p class="watch-hint">YouTube e Netflix no navegador, com play, pausa e posição sincronizados. Cada um assiste pela própria conta; quem guia controla a sessão.</p>
    <p id="watch-status" role="status" aria-live="polite"></p>
    <div class="watch-actions"><button type="button" class="btn-primary" id="watch-join">Criar sessão</button><button type="button" class="btn-secondary" id="watch-lead">Guiar sessão</button><button type="button" class="btn-secondary" id="watch-leave">Sair da sessão</button><button type="button" class="btn-secondary" id="watch-stop">Encerrar para todos</button></div>
    <p id="watch-video" class="watch-hint"></p><ul id="watch-members" class="watch-members"></ul>
    <section class="watch-connect"><h3>Conectar o navegador</h3>
      <ol class="watch-hint"><li>Instale a extensão no Chrome, Edge ou Brave do computador.</li><li>Entre na sessão e gere seu código aqui.</li><li>Cole o código na extensão, abra o vídeo e clique em <strong>Usar esta aba</strong>.</li></ol>
      <div class="watch-actions"><a id="watch-download" class="btn-secondary" target="_blank" rel="noopener">Baixar extensão</a><button type="button" class="btn-primary" id="watch-pair">Gerar meu código</button></div>
      <div id="watch-code-row" class="hidden"><label for="watch-code">Seu código — vale por 5 minutos, só para esta call</label><input id="watch-code" class="form-input" readonly spellcheck="false"><button type="button" class="btn-secondary" id="watch-copy">Copiar código</button><p class="watch-hint">Não envie seu código aos amigos: cada um gera o próprio.</p></div>
      <details><summary>Como instalar</summary><p class="watch-hint">Extraia o ZIP. Abra chrome://extensions (ou edge://extensions), ative o Modo do desenvolvedor e use “Carregar sem compactação” para selecionar a pasta extraída que contém manifest.json.</p></details>
      <p class="watch-hint">Experimental; reprodução em vídeos reais ainda em validação. Netflix exige acesso ao mesmo episódio em cada conta; planos com anúncios ainda não são suportados. Anúncios e travamentos podem interromper a sincronização; pode ser necessário clicar em play no navegador. O som e o volume ficam no próprio navegador.</p>
    </section></section>`;
  document.body.append(modal);
  const $ = selector => modal.querySelector(selector);
  $('#watch-download').href = `${serverUrl}/api/watch-together/extension.zip`;
  let channelId = appState.currentChannelId, session = null, busy = false, opener = null, generation = 0;
  const clearCode = () => { $('#watch-code').value = ''; $('#watch-code-row').classList.add('hidden'); };
  function render() {
    const inCall = Boolean(channelId && socket.connected), joined = session?.members.some(member => member.id === appState.myId);
    const host = session?.hostId === appState.myId;
    $('#watch-status').textContent = !inCall ? 'Entre numa call para assistir com os amigos.'
      : !session ? 'Crie uma sessão e escolha o vídeo no navegador.'
        : `${host ? 'Você está guiando' : `${session.hostName} está guiando`}${session.waiting ? ' · aguardando o vídeo no navegador' : ''}.`;
    $('#watch-join').textContent = session ? 'Entrar na sessão' : 'Criar sessão';
    $('#watch-join').hidden = Boolean(joined);
    $('#watch-lead').hidden = !joined || host;
    $('#watch-leave').hidden = !joined;
    $('#watch-stop').hidden = !host;
    for (const button of modal.querySelectorAll('.watch-actions button')) button.disabled = busy || !inCall;
    $('#watch-pair').disabled = busy || !inCall || !joined;
    $('#watch-video').textContent = session?.url || '';
    $('#watch-members').replaceChildren(...(session?.members || []).map(member => {
      const li = document.createElement('li');
      li.textContent = `${member.name}${member.id === session.hostId ? ' · guia' : ''} · ${member.connected ? 'navegador conectado' : 'aguardando extensão'}`;
      return li;
    }));
    for (const button of buttons) {
      button.classList.toggle('active', Boolean(joined));
      button.title = session ? 'Assistir juntos · sessão aberta' : 'Assistir juntos';
    }
  }
  async function request(action) {
    if (!socket.connected) throw new Error('Espere a conexão voltar.');
    let result;
    try { result = await socket.timeout(5000).emitWithAck(`watch-together:${action}`, {}); }
    catch { throw new Error('Assistir juntos ainda não respondeu. O servidor precisa receber esta atualização.'); }
    if (!result?.success) throw new Error(result?.error || 'Não deu para concluir.');
    return result;
  }
  async function act(action) {
    if (busy) return;
    busy = true; const run = generation; render();
    try {
      const result = await request(action);
      if (run !== generation) return;
      if ('session' in result) session = result.session;
      if (action === 'pair') {
        const payload = JSON.stringify({ server: new URL(serverUrl, location.href).origin, code: result.code });
        $('#watch-code').value = `teletela-wt1.${btoa(payload).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
        $('#watch-code-row').classList.remove('hidden'); $('#watch-code').focus(); $('#watch-code').select();
      }
      if (['leave', 'stop'].includes(action)) clearCode();
    } catch (err) { if (run === generation) showToast(err.message, 'error'); }
    finally { busy = false; render(); }
  }
  const close = () => { generation++; modal.classList.add('hidden'); clearCode(); opener?.focus(); };
  for (const button of buttons) button.addEventListener('click', () => {
    opener = button; mountStageOverlay(modal); modal.classList.remove('hidden');
    render(); act('state'); $('#watch-close').focus();
  });
  for (const action of ['join', 'pair', 'lead', 'leave', 'stop']) $(`#watch-${action}`).addEventListener('click', () => act(action));
  $('#watch-close').addEventListener('click', close);
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    if (event.key !== 'Tab') return;
    const elements = [...modal.querySelectorAll('button, a[href], input, summary')].filter(el => !el.disabled && el.getClientRects().length);
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  $('#watch-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#watch-code').value); showToast('Código copiado. Cole na extensão deste navegador.'); }
    catch { $('#watch-code').focus(); $('#watch-code').select(); showToast('Use Ctrl+C para copiar o código selecionado.'); }
  });
  socket.on('watch-together:state', payload => {
    if (payload?.channelId !== channelId) return;
    if (session?.id !== payload.session?.id) clearCode();
    session = payload.session; render();
  });
  function syncChannel() {
    const next = socket.connected ? appState.currentChannelId : null;
    if (next !== channelId) { channelId = next; session = null; generation++; clearCode(); }
    render();
  }
  socket.on('channel-state', () => { syncChannel(); if (channelId) act('state'); });
  socket.on('disconnect', () => { channelId = null; session = null; generation++; clearCode(); render(); });
  render();
  return { syncChannel };
}
