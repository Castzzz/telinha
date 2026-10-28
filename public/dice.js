const DIE_PATH = '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7 7h.01M17 7h.01M12 12h.01M7 17h.01M17 17h.01"/>';
const DIE_SHAPES = {
  4: '<path d="m12 2 10 18H2ZM12 2v12L2 20m10-6 10 6"/>',
  6: DIE_PATH,
  8: '<path d="m12 2 9 10-9 10L3 12ZM3 12h18M12 2v20"/>',
  10: '<path d="m12 2 9 7-9 13L3 9ZM3 9l9 5 9-5M12 2v12l-5 6m5-6 5 6"/>',
  12: '<path d="m12 2 10 7-4 12H6L2 9Zm0 5 5 4-2 6H9l-2-6ZM12 2v5M2 9l5 2m15-2-5 2M6 21l3-4m9 4-3-4"/>',
  20: '<path d="m12 2 10 6v9l-10 5-10-5V8Zm0 0L7 15l15-7M2 8l15 7-5-13M2 17l5-2 5 7 5-7 5 2M7 15h10"/>',
  100: '<rect x="2" y="3" width="13" height="13" rx="2"/><path d="M9 16v3a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-5M6 7h.01M11 12h.01M17 12h.01M17 17h.01"/>'
};
const svg = paths => `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
export function setupDice({ socket, showToast, escapeHtml }) {
  const buttons = ['#stage-controls-bar .stage-controls-right', '#chat-drawer .chat-header'].map(selector => {
    const parent = document.querySelector(selector);
    if (!parent) return null;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'btn-control-icon dice-trigger';
    button.title = 'Dados e histórico do servidor'; button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-controls', 'modal-dice'); button.innerHTML = svg(DIE_PATH);
    parent.prepend(button); return button;
  }).filter(Boolean);
  const news = document.querySelector('#btn-home-whats-new');
  if (news) {
    const actions = document.createElement('div'); actions.className = 'home-header-actions';
    news.parentElement.append(actions); actions.append(news);
    const homeButton = document.createElement('button'); homeButton.id = 'btn-home-dice';
    homeButton.type = 'button'; homeButton.className = 'home-news-button';
    homeButton.innerHTML = `${svg(DIE_PATH)}<span>Dados</span>`;
    homeButton.setAttribute('aria-controls', 'modal-dice'); actions.prepend(homeButton); buttons.push(homeButton);
  }
  const mobileButton = document.createElement('button');
  mobileButton.id = 'btn-mobile-dice'; mobileButton.type = 'button';
  mobileButton.className = 'mobile-icon-button mobile-only dice-trigger';
  mobileButton.setAttribute('aria-label', 'Dados e histórico do servidor');
  mobileButton.setAttribute('aria-controls', 'modal-dice'); mobileButton.innerHTML = svg(DIE_PATH);
  document.querySelector('#mobile-header')?.append(mobileButton); buttons.push(mobileButton);
  const modal = document.createElement('div');
  modal.id = 'modal-dice'; modal.className = 'modal-backdrop hidden';
  modal.innerHTML = `<section class="modal-card dice-modal" role="dialog" aria-modal="true" aria-labelledby="dice-title" tabindex="-1">
    <div class="modal-header"><div><span class="dice-eyebrow">PARA A SALA TODA</span><h2 id="dice-title">Rolar dados</h2></div><button type="button" class="btn-icon-close" id="dice-close" data-close-modal="modal-dice" aria-label="Fechar dados">✕</button></div>
    <p class="dice-hint">Escolha um dado para rolar. Todo mundo no servidor pode conferir o resultado.</p>
    <div class="dice-presets">${[4, 6, 8, 10, 12, 20, 100].map(sides => `<button type="button" class="btn-secondary" data-die="1d${sides}" aria-label="Rolar um d${sides}">${svg(DIE_SHAPES[sides])}<span>d${sides}</span></button>`).join('')}</div>
    <div id="dice-result" class="dice-result" role="status" aria-live="polite"><span id="dice-result-kind">Seu resultado</span><strong id="dice-result-value">—</strong><small id="dice-result-detail">Um clique no dado e a sorte está lançada.</small></div>
    <form id="dice-form" class="dice-form"><label for="dice-notation">Ou personalize a rolagem</label><div><input id="dice-notation" class="form-input" value="1d20" maxlength="24" placeholder="1d15 ou 2d6+3" autocomplete="off" required><button class="btn-primary" type="submit">Rolar</button></div></form>
    <p id="dice-status" class="dice-hint" role="status" aria-live="polite"></p>
    <div class="dice-history-heading"><h3>Histórico do servidor</h3><button type="button" id="dice-refresh" class="btn-secondary" aria-label="Atualizar histórico">Atualizar</button></div><p class="dice-hint">Últimas 30 rolagens de todos os canais, com nome, dado e resultado.</p><ol id="dice-history" class="dice-history"></ol>
  </section>`;
  document.body.append(modal);
  const $ = selector => modal.querySelector(selector);
  let history = [], generation = 0, busy = false, opener, supported = null;
  const visible = () => !modal.classList.contains('hidden');
  const unavailable = 'Os dados ainda não estão disponíveis nesta sala. O servidor precisa receber a atualização.';
  const merge = rolls => {
    history = [...new Map([...history, ...rolls].map(roll => [roll.id, roll])).values()].sort((a, b) => a.timestamp - b.timestamp).slice(-30);
  };
  const close = () => { generation++; modal.classList.add('hidden'); if (opener?.isConnected) opener.focus(); };
  const breakdown = roll => `${roll.values.join(' + ')}${roll.modifier ? ` ${roll.modifier > 0 ? '+' : '−'} ${Math.abs(roll.modifier)}` : ''}`;
  const render = () => {
    $('#dice-history').innerHTML = history.slice().reverse().map(roll => `<li><div><strong>${escapeHtml(roll.userName)}</strong><time datetime="${new Date(roll.timestamp).toISOString()}">${new Date(roll.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div><p><span>${escapeHtml(roll.notation)}</span><b>${roll.total}</b></p>${roll.values.length > 1 || roll.modifier ? `<small>${breakdown(roll)}</small>` : ''}</li>`).join('') || '<li class="dice-empty">As próximas rolagens da sala vão aparecer aqui.</li>';
    for (const button of modal.querySelectorAll('[data-die], button[type="submit"]')) button.disabled = busy || !socket.connected || supported !== true;
    $('#dice-refresh').disabled = !socket.connected || supported !== true;
  };
  const request = async (event, payload = {}) => {
    if (!socket.connected) throw new Error('Espere a conexão voltar para usar os dados.');
    if (supported !== true) throw new Error(unavailable);
    let result;
    try { result = await socket.timeout(7000).emitWithAck(event, payload); }
    catch { throw new Error('O servidor demorou para responder. Confira o histórico antes de rolar de novo.'); }
    if (!result?.success) throw new Error(result?.error || 'Não deu para concluir. Tente de novo.');
    if (result.scope !== 'server') throw new Error(unavailable);
    return result;
  };
  const load = async () => {
    const run = generation;
    $('#dice-status').textContent = supported === false ? unavailable : supported === null ? 'Verificando os dados da sala…' : 'Carregando histórico…';
    render();
    if (supported !== true) return;
    try {
      const response = await request('dice-history');
      if (run !== generation) return;
      merge(response.rolls); $('#dice-status').textContent = ''; render();
    } catch (err) { if (run === generation) $('#dice-status').textContent = err.message; }
  };
  const open = event => {
    opener = event.currentTarget; generation++;
    document.querySelector('#mobile-call-options')?.close();
    modal.classList.remove('hidden'); load(); $('#dice-notation').focus();
  };
  async function roll(notation) {
    if (busy || !visible()) return;
    busy = true; const run = generation;
    for (const button of modal.querySelectorAll('[data-die]')) button.classList.toggle('is-selected', button.dataset.die === notation);
    $('#dice-result').classList.add('is-rolling'); $('#dice-status').textContent = 'Rolando…'; render();
    try {
      const result = await request('dice-roll', { notation });
      if (run !== generation) return;
      merge([result.roll]);
      $('#dice-result-kind').textContent = `${result.roll.userName} · ${result.roll.notation}`;
      $('#dice-result-value').textContent = result.roll.total;
      $('#dice-result-detail').textContent = result.roll.values.length > 1 || result.roll.modifier ? breakdown(result.roll) : `1 dado de ${result.roll.sides} lados`;
      $('#dice-status').textContent = '';
    } catch (err) { if (run === generation) $('#dice-status').textContent = err.message; }
    finally { busy = false; $('#dice-result').classList.remove('is-rolling'); render(); }
  }
  for (const button of buttons) button.addEventListener('click', open);
  $('#dice-close').addEventListener('click', close);
  $('#dice-refresh').addEventListener('click', load);
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    if (event.key === 'Tab') {
      const focusable = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  $('#dice-form').addEventListener('submit', event => { event.preventDefault(); roll($('#dice-notation').value); });
  for (const button of modal.querySelectorAll('[data-die]')) button.addEventListener('click', () => { $('#dice-notation').value = button.dataset.die; roll(button.dataset.die); });
  socket.on('dice-rolled', payload => {
    if (payload?.scope !== 'server') return;
    merge([payload.roll]);
    if (visible()) render(); else showToast(`${payload.roll.userName} rolou ${payload.roll.notation}: ${payload.roll.total}`);
  });
  socket.on('room-info', info => {
    const previous = supported; supported = info?.diceVersion === 2;
    if (visible() && previous !== supported) load();
    render();
  });
  socket.on('connect', () => { supported = null; render(); });
  socket.on('disconnect', () => { supported = null; close(); });
  return { sync: render };
}
