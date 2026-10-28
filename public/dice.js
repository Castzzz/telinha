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
export function setupDice({ socket, appState, showToast, escapeHtml }) {
  const buttons = ['#stage-controls-bar .stage-controls-right', '#chat-drawer .chat-header'].map(selector => {
    const parent = document.querySelector(selector);
    if (!parent) return null;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'btn-control-icon dice-trigger';
    button.title = 'Rolar dados e conferir histórico'; button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-controls', 'modal-dice'); button.innerHTML = svg(DIE_PATH);
    parent.prepend(button); return button;
  }).filter(Boolean);
  const mobileButton = document.createElement('button');
  mobileButton.id = 'btn-mobile-dice'; mobileButton.type = 'button';
  mobileButton.className = 'mobile-icon-button mobile-only dice-trigger';
  mobileButton.title = 'Rolar dados e conferir histórico'; mobileButton.setAttribute('aria-label', mobileButton.title);
  mobileButton.setAttribute('aria-controls', 'modal-dice'); mobileButton.innerHTML = svg(DIE_PATH);
  document.querySelector('#mobile-header')?.append(mobileButton); buttons.push(mobileButton);
  const modal = document.createElement('div');
  modal.id = 'modal-dice'; modal.className = 'modal-backdrop hidden';
  modal.innerHTML = `<section class="modal-card dice-modal" role="dialog" aria-modal="true" aria-labelledby="dice-title" tabindex="-1">
    <div class="modal-header"><h2 id="dice-title">Rolar dados</h2><button type="button" class="btn-icon-close" id="dice-close" data-close-modal="modal-dice" aria-label="Fechar dados">✕</button></div>
    <p id="dice-channel" class="dice-hint"></p><div class="dice-presets">${[4, 6, 8, 10, 12, 20, 100].map(sides => `<button type="button" class="btn-secondary" data-die="1d${sides}">${svg(DIE_SHAPES[sides])}<span>d${sides}</span></button>`).join('')}</div>
    <form id="dice-form" class="dice-form"><label for="dice-notation">Rolagem personalizada</label><div><input id="dice-notation" class="form-input" value="1d20" maxlength="24" placeholder="1d15 ou 2d6+3" autocomplete="off" required><button class="btn-primary" type="submit">Rolar</button></div></form>
    <p id="dice-status" class="dice-hint" role="status" aria-live="polite"></p>
    <h3>Últimas 30 rolagens</h3><p class="dice-hint">Histórico compartilhado deste canal, com horário e cada resultado.</p><ol id="dice-history" class="dice-history"></ol>
  </section>`;
  document.body.append(modal);
  const $ = selector => modal.querySelector(selector);
  let target = null, history = [], generation = 0, busy = false, opener;
  const current = () => appState.textView ? { type: 'text', channelId: appState.textView } : appState.currentChannelId ? { type: 'voice', channelId: appState.currentChannelId } : null;
  const equal = (a, b) => a?.type === b?.type && a?.channelId === b?.channelId;
  const channel = () => (target?.type === 'text' ? appState.textChannels : appState.channels)?.get(target?.channelId);
  const close = () => { generation++; target = null; history = []; modal.classList.add('hidden'); if (opener?.isConnected) opener.focus(); };
  const render = () => {
    const ch = channel();
    $('#dice-channel').textContent = ch ? `#${ch.name}` : '';
    $('#dice-history').innerHTML = history.slice().reverse().map(roll => `<li><div><strong>${escapeHtml(roll.userName)}</strong><time datetime="${new Date(roll.timestamp).toISOString()}">${new Date(roll.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div><p><span>${escapeHtml(roll.notation)}</span><b>${roll.total}</b></p><small>${roll.values.join(' + ')}${roll.modifier ? ` ${roll.modifier > 0 ? '+' : '−'} ${Math.abs(roll.modifier)}` : ''}</small></li>`).join('') || '<li class="dice-hint">Nenhuma rolagem por aqui ainda.</li>';
    for (const button of modal.querySelectorAll('[data-die], button[type="submit"]')) button.disabled = busy || !socket.connected || ch?.canWrite === false;
  };
  const request = (event, payload) => socket.timeout(7000).emitWithAck(event, payload);
  const open = async event => {
    const selected = current();
    if (!selected) return showToast('Entre numa call ou abra um canal de texto para rolar dados.');
    opener = event.currentTarget; target = selected; history = []; const run = ++generation;
    document.querySelector('#mobile-call-options')?.close();
    modal.classList.remove('hidden'); $('#dice-status').textContent = 'Carregando histórico…'; render(); $('#dice-notation').focus();
    try {
      const response = await request('dice-history', selected);
      if (run !== generation) return;
      if (!response.success) throw new Error(response.error);
      // Uma rolagem pode chegar enquanto o histórico é carregado.
      history = [...new Map([...response.rolls, ...history].map(roll => [roll.id, roll])).values()].sort((a, b) => a.timestamp - b.timestamp).slice(-30);
      $('#dice-status').textContent = ''; render();
    } catch (err) { if (run === generation) $('#dice-status').textContent = err.message || 'O servidor não respondeu. Tente de novo.'; }
  };
  async function roll(notation) {
    if (busy || !target) return;
    busy = true; const run = generation, selected = { ...target }; render();
    try {
      const result = await request('dice-roll', { ...selected, notation });
      if (run !== generation) return;
      if (!result.success) throw new Error(result.error);
      if (!history.some(item => item.id === result.roll.id)) history = [...history, result.roll].slice(-30);
      $('#dice-status').textContent = `${result.roll.notation}: ${result.roll.total}`;
    } catch (err) { if (run === generation) $('#dice-status').textContent = err.message || 'Não deu para rolar. Tente de novo.'; }
    finally { busy = false; render(); }
  }
  for (const button of buttons) button.addEventListener('click', open);
  $('#dice-close').addEventListener('click', close);
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
    if (equal(target, payload)) {
      if (!history.some(item => item.id === payload.roll.id)) history = [...history, payload.roll].slice(-30);
      render();
    } else if (equal(current(), payload)) showToast(`${payload.roll.userName} rolou ${payload.roll.notation}: ${payload.roll.total}`);
  });
  socket.on('disconnect', close);
  const sync = () => {
    for (const button of buttons) button.classList.toggle('hidden', !current());
    if (target && (!equal(target, current()) || !channel())) close();
    else if (target) render();
  };
  return { sync };
}
