import { setupMobilePip, syncMobilePip } from './mobile-pip.js';

const smallScreen = window.matchMedia('(max-width: 760px), (max-width: 1100px) and (max-height: 540px) and (pointer: coarse)');
const $ = selector => document.querySelector(selector);
const all = selector => document.querySelectorAll(selector);
const svg = paths => `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const icons = {
  mic: svg('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8"/>'),
  micOff: svg('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8M3 3l18 18"/>'),
  audio: svg('<path d="M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>'),
  audioOff: svg('<path d="M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3zM3 3l18 18"/>'),
  camera: svg('<path d="m23 7-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>'),
  leave: svg('<path d="M3 16v-3c0-6 18-6 18 0v3h-5v-4M8 12v4H3"/>')
};
let hooks, currentState;
let chatReturnView = 'canais';
let avatarSignature = '';
let avatarDirty = true;

function text(selector, value) {
  const node = $(selector);
  if (node && node.textContent !== value) node.textContent = value;
}

function renderChrome(state) {
  if (!state || !smallScreen.matches) return;
  const view = document.body.dataset.mobileView || 'canais';
  const inCall = Boolean(state.currentChannelId);
  const channel = state.channels.get(state.currentChannelId);
  const name = channel?.name || 'Sua call';
  const root = ['sala', 'chat'].includes(view) ? 'canais' : view;
  all('.mobile-nav [data-mobile-view]').forEach(button => {
    if (button.dataset.mobileView === root) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.body.classList.toggle('mobile-in-call', inCall);
  const count = [...state.channels.values()].reduce((sum, ch) => sum + ch.users.size, 0);
  text('#mobile-room-summary', count ? `${count} ${count === 1 ? 'pessoa na voz agora' : 'pessoas na voz agora'}` : 'A sala está aberta. Chega mais!');
  text('#mobile-page-title', view === 'sala' ? name : view === 'chat' ? $('#chat-channel-label')?.textContent || 'Conversa' : view === 'voce' ? 'Você' : view === 'amigos' ? 'Amigos' : 'Teletela');
  text('#mobile-page-subtitle', view === 'sala' ? `${channel?.users.size || 0} na call · fique à vontade` : view === 'chat' ? state.textView ? 'Conversa por texto' : 'Chat da call' : view === 'voce' ? 'Seu perfil, do seu jeito' : 'Seu ponto de encontro');
  $('#mobile-back')?.classList.toggle('hidden', !['sala', 'chat'].includes(view));
  $('#mobile-create-channel')?.classList.toggle('hidden', view !== 'canais');
  $('#mobile-open-chat')?.classList.toggle('hidden', view !== 'sala' || !inCall);
  $('#mobile-call-more')?.classList.toggle('hidden', !['sala', 'chat'].includes(view) || !inCall);
  $('#mobile-open-pins')?.classList.toggle('hidden', view !== 'chat' || !state.textView);
  text('#mobile-callbar-name', name);
  text('#mobile-callbar-status', state.myUser.isDeafened ? 'Áudio desativado' : state.myUser.isMicOn ? 'Você está na call' : 'Microfone mutado · toque para abrir');
  // Os controles móveis acionam os originais: uma única lógica de mute e câmera.
  const actions = {
    'btn-toggle-mic': { icon: state.myUser.isMicOn ? icons.mic : icons.micOff, label: state.myUser.isMicOn ? 'Mutar microfone' : 'Ligar microfone', active: !state.myUser.isMicOn },
    'btn-toggle-deafen': { icon: state.myUser.isDeafened ? icons.audioOff : icons.audio, label: state.myUser.isDeafened ? 'Restaurar áudio' : 'Desativar áudio', active: state.myUser.isDeafened },
    'btn-share-camera': { icon: icons.camera, label: state.myUser.isCameraOn ? 'Desligar câmera' : 'Ligar câmera', active: state.myUser.isCameraOn },
    'btn-dock-leave': { icon: icons.leave, label: 'Sair da call' }
  };
  for (const [id, action] of Object.entries(actions)) all(`[data-mobile-proxy="${id}"]`).forEach(button => {
    const icon = button.querySelector('.mobile-action-icon') || button;
    if (icon.innerHTML !== action.icon) icon.innerHTML = action.icon;
    button.setAttribute('aria-label', action.label);
    button.classList.toggle('is-active', Boolean(action.active));
    if (action.active !== undefined) button.setAttribute('aria-pressed', String(Boolean(action.active)));
  });
  text('#mobile-profile-name', state.myUser.name);
  const account = $('#account-button-label')?.textContent || 'Conta';
  text('#mobile-profile-account', account.startsWith('@') ? account : 'Perfil de visitante');
  text('#mobile-account-description', account.startsWith('@') ? 'Gerenciar sua conta' : 'Entrar ou criar uma conta');
  const source = $('#dock-user-avatar');
  // Uma foto em GIF pode ser grande; só a serializa quando o perfil muda.
  if (avatarDirty && source) {
    const signature = source.innerHTML + source.style.cssText;
    if (signature !== avatarSignature) {
      avatarSignature = signature;
      all('.mobile-self-avatar').forEach(avatar => { avatar.innerHTML = source.innerHTML; avatar.style.cssText = source.style.cssText; });
    }
    avatarDirty = false;
  }
  $('#mobile-open-admin')?.classList.toggle('hidden', $('#settings-tab-admin')?.classList.contains('hidden') !== false);
  $('#mobile-friends-count')?.classList.toggle('hidden', $('#friends-request-count')?.classList.contains('hidden') !== false);
  $('#btn-mobile-audio-output')?.classList.toggle('hidden', !window.TeletelaAndroid?.chooseAudioOutput);
  if ($('#btn-mobile-audio-output')) $('#btn-mobile-audio-output').disabled = !inCall;
}

export function setMobileView(view) {
  if (!smallScreen.matches || !['canais', 'sala', 'chat', 'amigos', 'voce'].includes(view)) return;
  const previous = document.body.dataset.mobileView || 'canais';
  if (view === 'chat' && previous !== 'chat') chatReturnView = previous === 'sala' ? 'sala' : 'canais';
  if (previous === 'amigos' && view !== 'amigos') {
    $('#modal-account')?.classList.add('hidden');
    $('#modal-account')?.classList.remove('mobile-account-route');
    $('#modal-account')?.setAttribute('aria-modal', 'true');
  }
  if (view !== 'sala') $('#mobile-call-options')?.close();
  document.body.dataset.mobileView = view;
  renderChrome(currentState);
}

export function syncMobileState(state) {
  currentState = state;
  syncMobilePip(state);
  const view = document.body.dataset.mobileView;
  if ((!state.currentChannelId && view === 'sala') || (!state.currentChannelId && !state.textView && view === 'chat')) setMobileView('canais');
  renderChrome(state);
  // Mudar de tela não interfere na captura nem no serviço da call.
  const detail = { inCall: Boolean(state.currentChannelId), microphone: Boolean(state.localMicStream), name: state.channels.get(state.currentChannelId)?.name || 'Call' };
  const signature = JSON.stringify(detail);
  if (signature !== syncMobileState.lastState) {
    syncMobileState.lastState = signature;
    window.TeletelaAndroid?.setCallState(signature);
  }
}

function back() {
  if ($('#mobile-message-options')?.open) { $('#mobile-message-options').close(); return true; }
  const sheet = $('#mobile-call-options');
  if (sheet?.open) { sheet.close(); return true; }
  if (!$('#user-popover')?.classList.contains('hidden')) { $('#user-popover').classList.add('hidden'); return true; }
  if (!$('#image-viewer')?.classList.contains('hidden')) { $('#image-viewer').classList.add('hidden'); return true; }
  const modal = [...all('.modal-backdrop:not(.hidden)')].at(-1);
  if (modal?.classList.contains('mobile-account-route')) { setMobileView('canais'); return true; }
  const close = modal?.querySelector('[data-close-modal], #btn-close-account');
  if (close) { close.click(); return true; }
  const view = document.body.dataset.mobileView;
  if (view === 'chat') {
    hooks.showRoom();
    setMobileView(chatReturnView === 'sala' && hooks.getState().currentChannelId ? 'sala' : 'canais');
    return true;
  }
  if (view !== 'canais') { setMobileView('canais'); return true; }
  return false;
}

export function setupMobileUI(options) {
  hooks = options;
  setupMobilePip(options.getState);
  if (window.TeletelaAndroid) document.documentElement.dataset.platform = 'android';
  document.body.dataset.mobileView = 'canais';
  all('[data-mobile-icon]').forEach(node => { node.innerHTML = icons[node.dataset.mobileIcon] || ''; });
  all('.mobile-nav [data-mobile-view]').forEach(button => button.addEventListener('click', () => {
    const view = button.dataset.mobileView;
    setMobileView(view);
    if (view === 'amigos') {
      $('#modal-account').classList.add('mobile-account-route');
      $('#modal-account').setAttribute('aria-modal', 'false');
      $('#btn-open-friends').click();
    }
    if (view === 'canais') options.showRoom();
  }));
  all('[data-mobile-proxy]').forEach(button => button.addEventListener('click', () => {
    document.getElementById(button.dataset.mobileProxy)?.click();
    renderChrome(options.getState());
  }));
  all('[data-mobile-settings]').forEach(button => button.addEventListener('click', () => { $('#mobile-call-options').close(); options.openSettings(button.dataset.mobileSettings); }));
  $('#mobile-open-account').addEventListener('click', () => $('#btn-open-account').click());
  $('#mobile-open-news').addEventListener('click', () => $('#btn-home-whats-new').click());
  $('#mobile-create-channel').addEventListener('click', () => $('#btn-header-add-channel').click());
  $('#mobile-open-chat').addEventListener('click', options.openChat);
  $('#mobile-return-call').addEventListener('click', () => { options.showRoom(); setMobileView('sala'); });
  $('#mobile-back').addEventListener('click', back);
  $('#mobile-call-more').addEventListener('click', () => $('#mobile-call-options').showModal());
  $('#mobile-close-options').addEventListener('click', () => $('#mobile-call-options').close());
  $('#mobile-call-options').addEventListener('click', event => { if (event.target === event.currentTarget) event.currentTarget.close(); });
  $('#btn-mobile-audio-output').addEventListener('click', () => { $('#mobile-call-options').close(); window.TeletelaAndroid?.chooseAudioOutput?.(); });
  const popover = $('#user-popover');
  $('#mobile-popover-backdrop').addEventListener('click', () => popover.classList.add('hidden'));
  new MutationObserver(() => $('#mobile-popover-backdrop').classList.toggle('hidden', !smallScreen.matches || popover.classList.contains('hidden'))).observe(popover, { attributes: true, attributeFilter: ['class'] });
  const updateTitles = () => {
    $('#modal-settings').dataset.mobileTopic = $('.settings-tab.active')?.dataset.settingsTab || '';
    text('#modal-settings-title', smallScreen.matches ? $('.settings-tab.active span')?.textContent || 'Configurações' : 'Configurações');
    text('#modal-account-title', smallScreen.matches ? $('[data-account-tab][aria-selected="true"]')?.textContent || 'Sua conta' : 'Conta e amigos');
    renderChrome(options.getState());
  };
  new MutationObserver(updateTitles).observe($('.settings-nav'), { attributes: true, subtree: true, attributeFilter: ['class'] });
  new MutationObserver(updateTitles).observe($('.account-tabs'), { attributes: true, subtree: true, attributeFilter: ['aria-selected'] });
  new MutationObserver(() => { if ($('#modal-account').classList.contains('hidden') && document.body.dataset.mobileView === 'amigos') setMobileView('canais'); }).observe($('#modal-account'), { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(() => renderChrome(options.getState())).observe($('#account-button-label'), { childList: true, characterData: true, subtree: true });
  new MutationObserver(() => { avatarDirty = true; renderChrome(options.getState()); }).observe($('#dock-user-avatar'), { childList: true, attributes: true, attributeFilter: ['style'] });
  setupMessageActions();
  if (!navigator.mediaDevices?.getDisplayMedia && !window.electronAPI) {
    $('#btn-share-screen')?.classList.add('mobile-unsupported');
    $('#btn-lounge-start-share')?.classList.add('mobile-unsupported');
  }
  if (!document.fullscreenEnabled) $('#btn-stage-fullscreen')?.classList.add('mobile-unsupported');
  if (!document.pictureInPictureEnabled) $('#btn-stage-pip')?.classList.add('mobile-unsupported');
  let largestHeight = window.innerHeight;
  let lastWidth = window.innerWidth;
  const resize = () => {
    const height = window.visualViewport?.height || window.innerHeight;
    if (Math.abs(window.innerWidth - lastWidth) > 100) largestHeight = height;
    lastWidth = window.innerWidth;
    largestHeight = Math.max(largestHeight, height);
    document.body.classList.toggle('mobile-keyboard', largestHeight - height > 140 || window.innerHeight - height > 140);
    document.documentElement.style.setProperty('--mobile-height', `${height}px`);
  };
  window.visualViewport?.addEventListener('resize', resize);
  window.addEventListener('resize', resize);
  smallScreen.addEventListener('change', () => {
    $('#mobile-call-options').close();
    $('#mobile-message-options').close();
    if (!smallScreen.matches) {
      document.body.classList.remove('mobile-keyboard');
      $('#mobile-popover-backdrop').classList.add('hidden');
      $('#modal-account').classList.remove('mobile-account-route');
      $('#modal-account').setAttribute('aria-modal', 'true');
    }
    updateTitles(); resize(); syncMobileState(options.getState());
  });
  resize();
  window.teletelaMobileBack = back;
  syncMobileState(options.getState());
}

// No celular, as ações ficam numa folha aberta por toque ou pressão longa.
function setupMessageActions() {
  const sheet = $('#mobile-message-options');
  const open = message => {
    if (!smallScreen.matches) return;
    const actions = message.querySelector('.chat-msg-actions');
    if (!actions) return;
    const list = $('#mobile-message-actions');
    list.replaceChildren();
    actions.querySelectorAll('button').forEach(original => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mobile-settings-row';
      const label = original.getAttribute('aria-label') || original.title || original.textContent.trim();
      button.textContent = label;
      if (original.classList.contains('danger')) button.style.color = 'var(--accent-red)';
      button.addEventListener('click', () => { sheet.close(); if (original.isConnected) original.click(); });
      list.appendChild(button);
    });
    if (list.childElementCount) sheet.showModal();
  };
  const addButtons = () => all('#chat-messages .chat-msg').forEach(message => {
    if (message.querySelector('.mobile-message-more') || !message.querySelector('.chat-msg-actions')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mobile-only mobile-message-more';
    button.setAttribute('aria-label', 'Opções da mensagem');
    button.innerHTML = '<svg class="icon-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
    button.addEventListener('click', event => { event.stopPropagation(); open(message); });
    message.querySelector('.chat-msg-body')?.appendChild(button);
  });
  new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches('.chat-msg') || node.querySelector('.chat-msg'))))) addButtons();
  }).observe($('#chat-messages'), { childList: true, subtree: true });
  $('#chat-messages').addEventListener('contextmenu', event => {
    const message = event.target.closest('.chat-msg');
    if (smallScreen.matches && message && !event.target.closest('a, img, video')) { event.preventDefault(); open(message); }
  });
  $('#mobile-close-message-options').addEventListener('click', () => sheet.close());
  sheet.addEventListener('click', event => { if (event.target === sheet) sheet.close(); });
  addButtons();
}
