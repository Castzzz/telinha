import { profileIdentity, profileProof } from './profile-identity.js';
/**
 * public/app.js - Telinha Client Controller
 * Milestone 1: Discord/TeamSpeak Core Signaling & Channel Sidebar Architecture
 * Milestone 2: System Audio Loopback & Dual-Mesh WebRTC Media Pipeline
 */

import {
  AudioManager,
  VoiceActivityDetector,
  VolumeMixerManager,
  DeafenController,
  isSystemAudioLabel,
  isMicrophoneLabel,
  detectAudioDevices,
  refreshAudioDevices,
  generateSystemAudioConstraints,
  generateMicrophoneConstraints,
  enhanceOpusStereoSdp,
  enhanceOpusVoiceSdp,
  configureAudioSenderBitrate,
  sanitizeVolumePercent,
  setRemoteElementMuted
} from './audio-manager.js';
import { normalizeImageCrop, imageCropRect, imageCropStyle } from './image-crop.js';
import { activityElapsed } from './game-activity.js';
import { createMicrophonePipeline } from './microphone.js';
import { CameraSource } from './camera-source.js';
import { setupMobileUI, setMobileView, syncMobileState } from './mobile.js';
import { setupPermissions, hasPermission } from './permissions.js';
import { setupMusic } from './music.js';
import { setupDice } from './dice.js';
import { setupStageSocial } from './stage-social.js';
import { applyAppearance, setupPersonalization } from './personalization.js';
import { setupTransmissionDiagnostics } from './transmission-diagnostics.js';
import { setupChannelOrganization } from './channel-organization.js';
import { setupChatExtras } from './chat-extras.js';
import { setupMessageSearch } from './message-search.js';
import { setupAccounts, accountSession, initialAccountProfile, accountProfileSnapshot } from './accounts.js';

let channelOrganizer = null;
let musicUI = null;
let diceUI = null;
let stageSocialUI = null;

// -----------------------------------------------------------------------------
// 1. HELPERS & UTILITIES
// -----------------------------------------------------------------------------
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message, type = 'normal', duration = 3000) {
  const container = $('#toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'toast-error' : type === 'success' ? 'toast-success' : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

// WebRTC Configuration
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 4
};

// Video Quality Presets
const QUALITY_PRESETS = {
  '1440p60': { width: 2560, height: 1440, frameRate: 60, maxBitrate: 8500000 },
  '1080p60': { width: 1920, height: 1080, frameRate: 60, maxBitrate: 5500000 },
  '1080p30': { width: 1920, height: 1080, frameRate: 30, maxBitrate: 3800000 },
  '720p60':  { width: 1280, height: 720,  frameRate: 60, maxBitrate: 3200000 },
  '720p30':  { width: 1280, height: 720,  frameRate: 30, maxBitrate: 2000000 },
  'nativa60':{ width: 3840, height: 2160, frameRate: 60, maxBitrate: 12000000 }
};

// -----------------------------------------------------------------------------
// 2. STATE STORE (Single Source of Truth)
// -----------------------------------------------------------------------------
// Preferências (perfil, volume por pessoa, atalhos). No app desktop ficam num arquivo do
// app: o localStorage depende do link da sala, que muda toda vez que alguém hospeda.
const PREFS_KEY = 'telinha_prefs';

async function loadPrefs() {
  try {
    if (window.electronAPI?.getPrefs) return (await window.electronAPI.getPrefs()) || {};
  } catch (_) {}
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch (_) {
    return {};
  }
}

const prefs = await loadPrefs();

// Tema: escuro (padrão), preto ou claro
const THEMES = ['escuro', 'preto', 'claro'];
function applyTheme(theme) {
  document.documentElement.dataset.theme = THEMES.includes(theme) ? theme : 'escuro';
}
applyTheme(prefs.theme);
applyAppearance(prefs.appearanceExperiment);

// Desempenho: modo leve e pausa em segundo plano são opções independentes.
function applyPerformancePrefs() {
  const isLight = prefs.lightMode !== false; // padrão ligado (economiza CPU e GPU)
  const isPauseBg = prefs.pauseInBackground !== false; // padrão ligado
  document.documentElement.classList.toggle('light-mode', isLight);
  document.documentElement.classList.toggle('pause-in-background', isPauseBg);
}
applyPerformancePrefs();

// Sincroniza também ao abrir, caso o app já comece em segundo plano.
function syncAppVisibility() {
  document.documentElement.classList.toggle('app-hidden', document.visibilityState === 'hidden');
  document.documentElement.classList.toggle('app-unfocused', !document.hasFocus());
}
syncAppVisibility();
document.addEventListener('visibilitychange', syncAppVisibility);
window.addEventListener('blur', () => {
  document.documentElement.classList.add('app-unfocused');
});
window.addEventListener('focus', () => {
  document.documentElement.classList.remove('app-unfocused');
});


function savePrefs(patch) {
  Object.assign(prefs, patch);
  if (window.electronAPI?.setPrefs) {
    return window.electronAPI.setPrefs(patch).catch(() => false);
  }
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (_) { return Promise.resolve(false); }
  return Promise.resolve(true);
}

// randomUUID só existe em https/localhost; o link de rede local (http://192.168…) não é
function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Microfone desenhado (o emoji 🔇 é um alto-falante, não um microfone)
const MIC_PATHS = '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8"/>';
const MIC_ON_SVG = `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MIC_PATHS}</svg>`;
const MIC_OFF_SVG = `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MIC_PATHS}<path d="M3 3l18 18"/></svg>`;
// Fone (ensurdecer), no mesmo traço do microfone
const HEADPHONES_PATHS = '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>';
const HEADPHONES_ON_SVG = `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${HEADPHONES_PATHS}</svg>`;
const HEADPHONES_OFF_SVG = `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${HEADPHONES_PATHS}<path d="M3 3l18 18"/></svg>`;
const CHANNEL_LOCK_SVG = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/><path d="M12 14v3"/></svg>';
const CAMERA_SVG = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>';
// Balão do chat da call (no canal de voz em que você está)
const CHAT_BUBBLE_SVG = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
// Alto-falante (silenciar alguém só pra você)
const SPEAKER_PATHS = '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>';
const SPEAKER_OFF_SVG = `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SPEAKER_PATHS}<path d="M3 3l18 18"/></svg>`;

function updateMicButton() {
  const on = appState.myUser.isMicOn;
  $('#btn-toggle-mic')?.classList.toggle('active-muted', !on);
  const micIcon = $('#dock-mic-icon');
  if (micIcon) micIcon.innerHTML = on ? MIC_ON_SVG : MIC_OFF_SVG;
  updateDeafenButton();
  syncMobileState(appState);
}

function updateDeafenButton() {
  const deafened = appState.myUser.isDeafened;
  $('#btn-toggle-deafen')?.classList.toggle('active-danger', deafened);
  const deafIcon = $('#dock-deafen-icon');
  if (deafIcon) deafIcon.innerHTML = deafened ? HEADPHONES_OFF_SVG : HEADPHONES_ON_SVG;
}

// Cores prontas pro nome (além do seletor livre)
const NAME_COLORS = ['#FF5C5C', '#FF9F43', '#FEE75C', '#57F287', '#1ABC9C', '#00A8FC', '#9B84EC', '#EB459E'];
const PROFILE_COLORS = ['#5865F2', '#57F287', '#FEE75C', '#EB459E', '#ED4245', '#F47B67', '#9B84EC', '#00A8FC'];
const SERVER_URL = (() => {
  const fromQuery = new URLSearchParams(window.location.search).get('server');
  return fromQuery && /^https?:\/\//.test(fromQuery) ? fromQuery.replace(/\/+$/, '') : window.location.origin;
})();
const savedProfile = initialAccountProfile(prefs, SERVER_URL);
const isFirstRun = !savedProfile;
const myProfile = {
  id: savedProfile?.id || randomId(),
  name: savedProfile?.name || localStorage.getItem('telinha_username') || `Amigo-${Math.floor(1000 + Math.random() * 9000)}`,
  color: savedProfile?.color || localStorage.getItem('telinha_user_color') || PROFILE_COLORS[0],
  bio: savedProfile?.bio || '',
  avatar: savedProfile?.avatar || '',
  avatarCrop: normalizeImageCrop(savedProfile?.avatarCrop),
  nameColor: savedProfile?.nameColor || '',
  nameColor2: savedProfile?.nameColor2 || '',
  frame: savedProfile?.frame || '',
  frameColor: savedProfile?.frameColor || '',
  bannerColor: savedProfile?.bannerColor || '',
  banner: savedProfile?.banner || '',
  bannerCrop: normalizeImageCrop(savedProfile?.bannerCrop),
  joinSound: savedProfile?.joinSound || '',
  displayRoleId: savedProfile?.displayRoleId || ''
};
if (isFirstRun) await savePrefs({ profile: { ...myProfile } });
const profileCredential = accountSession(prefs, SERVER_URL) ? '' : await profileIdentity(prefs, myProfile.id, savePrefs);

function profilePayload() {
  return {
    profileId: myProfile.id,
    name: myProfile.name,
    color: myProfile.color,
    bio: myProfile.bio,
    avatar: myProfile.avatar,
    avatarCrop: myProfile.avatarCrop,
    nameColor: myProfile.nameColor,
    nameColor2: myProfile.nameColor2,
    frame: myProfile.frame,
    frameColor: myProfile.frameColor,
    bannerColor: myProfile.bannerColor,
    banner: myProfile.banner,
    bannerCrop: myProfile.bannerCrop,
    joinSound: myProfile.joinSound,
    displayRoleId: myProfile.displayRoleId
  };
}

const initialUsername = myProfile.name;
const initialColor = myProfile.color;

const appState = {
  myId: null,
  myUser: {
    name: initialUsername,
    color: initialColor,
    isSharing: false,
    isCameraOn: false,
    isMicOn: prefs.micOn === true,
    isDeafened: false,
    isSpeaking: false,
    streamQuality: QUALITY_PRESETS[prefs.streamQuality] ? prefs.streamQuality : '1080p60'
  },
  // Abrir a sala não entra em voz; o canal só é escolhido por uma ação da pessoa.
  currentChannelId: null,
  channels: new Map(), // channelId -> ChannelRecord
  channelChats: new Map(), // channelId -> Array<ChatMessage>
  unreadChannels: new Set(),
  activeStreams: new Map(), // userId -> { stream, userName, isLocal }
  focusedStreamUserId: null,
  // Com 2+ transmissões o palco vira mosaico; clicar numa abre só ela (null = mosaico)
  expandedStreamUserId: null,

  // MediaStreams
  localScreenStream: null,
  localCameraStream: null,
  cameraBusy: false,
  cameraFacingMode: 'user',
  extraScreens: new Map(), // número (2, 3) -> { stream, publisher }: telas a mais, só imagem
  localMicStream: null,

  // WebRTC Peer Connection Collections (Segregated Dual-Mesh)
  screenPeersOut: new Map(), // targetUserId -> RTCPeerConnection (Local sharer -> remote viewer)
  screenPeersIn: new Map(),  // senderUserId -> RTCPeerConnection (Remote sharer -> local viewer)
  voicePeers: new Map(),     // peerUserId   -> RTCPeerConnection (Bidirectional voice mesh)

  // ICE Candidate Buffers
  iceCandidatesQueue: new Map(), // `${type}:${peerId}` -> Array<RTCIceCandidateInit>

  // Transmissões pelo servidor (SFU), quando a sala tem
  sfuEnabled: false,
  sfuPublisher: null, // SfuSession da minha transmissão de tela
  sfuCameraPublisher: null, // SfuSession da minha câmera
  sfuViewers: new Map(), // userId -> SfuSession de quem estou assistindo
  sfuVoicePublisher: null, // SfuSession do meu microfone (sala com SFU)
  sfuVoiceListeners: new Map(), // userId -> SfuSession da voz de cada um do canal

  // Audio Context, VAD & Volume Mixers
  audioContext: null,
  audioManager: null,
  mixerManager: null,
  vadDetector: null,
  deafenController: null,
  userMixers: new Map(),
  streamMixers: new Map(),

  setUserVolume(userId, volumePercent) {
    if (this.mixerManager) {
      const gain = this.mixerManager.setUserVolume(userId, volumePercent);
      const entry = this.mixerManager.userMixers.get(userId);
      if (entry?.gainNode) this.userMixers.set(userId, entry.gainNode);
      return gain;
    }
    const safePercent = (typeof sanitizeVolumePercent === 'function')
      ? sanitizeVolumePercent(volumePercent, 100)
      : (volumePercent === null || volumePercent === undefined || volumePercent === '' || Number.isNaN(Number(volumePercent))) ? 100 : Number(volumePercent);
    let clampedGain = Math.max(0.0, Math.min(2.0, safePercent / 100));
    if (!Number.isFinite(clampedGain)) clampedGain = 1.0;
    let node = this.userMixers.get(userId);
    if (!node) {
      node = { gain: { value: 1.0, setValueAtTime(v) { this.value = v; } } };
      this.userMixers.set(userId, node);
    }
    node.gain.value = clampedGain;
    return clampedGain;
  },

  setStreamVolume(streamId, volumePercent) {
    if (this.mixerManager) {
      const gain = this.mixerManager.setStreamVolume(streamId, volumePercent);
      const entry = this.mixerManager.streamMixers.get(streamId);
      if (entry?.gainNode) this.streamMixers.set(streamId, entry.gainNode);
      return gain;
    }
    const safePercent = (typeof sanitizeVolumePercent === 'function')
      ? sanitizeVolumePercent(volumePercent, 100)
      : (volumePercent === null || volumePercent === undefined || volumePercent === '' || Number.isNaN(Number(volumePercent))) ? 100 : Number(volumePercent);
    let clampedGain = Math.max(0.0, Math.min(2.0, safePercent / 100));
    if (!Number.isFinite(clampedGain)) clampedGain = 1.0;
    let node = this.streamMixers.get(streamId);
    if (!node) {
      node = { gain: { value: 1.0, setValueAtTime(v) { this.value = v; } } };
      this.streamMixers.set(streamId, node);
    }
    node.gain.value = clampedGain;
    return clampedGain;
  }
};


// -----------------------------------------------------------------------------
// 3. SOCKET.IO CLIENT SETUP
// -----------------------------------------------------------------------------
// No app desktop a interface vem instalada no app (telinha://app/...?server=<sala>) e
// da sala só vem a conexão; no navegador a página é servida pela própria sala.


// Sala com senha: manda a senha guardada, a chave de membro (quem já entrou uma vez não
// precisa digitar) ou a senha de admin. Tudo guardado por sala, nas preferências.
function roomAccess() {
  return (prefs.roomAccess || {})[SERVER_URL] || {};
}

function saveRoomAccess(patch) {
  const all = { ...(prefs.roomAccess || {}) };
  const next = { ...(all[SERVER_URL] || {}), ...patch };
  for (const k of Object.keys(next)) if (!next[k]) delete next[k];
  all[SERVER_URL] = next;
  savePrefs({ roomAccess: all });
}

const socket = io(SERVER_URL, {
  auth: async (cb) => {
    let proof;
    try {
      const response = await fetch(`${SERVER_URL}/api/identity`, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      if (response.ok && profileCredential) proof = await profileProof(profileCredential, SERVER_URL, (await response.json()).challenge);
    } catch (_) { /* Servidores antigos continuam usando a credencial por sala. */ }
    cb({
    accountToken: accountSession(prefs, SERVER_URL)?.token || '',
    profileId: myProfile.id,
    memberKey: roomAccess().memberKey || '',
    roomPassword: roomAccess().password || '',
    adminKey: prefs.adminKeys?.[SERVER_URL] || '',
    permissionToken: roomAccess().permissionToken || '',
    profileProof: proof
    });
  },
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000
});

let connectionProbeTimer = null;
let connectionProbeRun = 0;
let connectionProbeActive = false;
let connectionPingSupported = false;

function showConnectionQuality(quality, text, detail, ping = null) {
  const status = $('#voice-panel-status');
  if (!status) return;
  status.dataset.quality = quality;
  status.setAttribute('aria-label', `${text}. ${detail}`);
  $('#voice-panel-status-text').textContent = text;
  const tooltip = $('#connection-tooltip');
  tooltip.dataset.quality = quality;
  $('#connection-tooltip-ping').textContent = ping === null ? '—' : ping;
  $('#connection-tooltip-unit').classList.toggle('hidden', ping === null);
  $('#connection-tooltip-quality').textContent = ping === null ? text : { good: 'Boa', fair: 'Regular', bad: 'Alta latência' }[quality];
  $('#connection-tooltip-detail').textContent = ping === null ? detail : 'Tempo de ida e volta até o servidor.';
  if (!appState.currentChannelId) tooltip.classList.add('hidden');
}

function setupConnectionTooltip() {
  const status = $('#voice-panel-status'), tooltip = $('#connection-tooltip');
  let closeTimer;
  const close = () => { clearTimeout(closeTimer); tooltip.classList.add('hidden'); };
  const open = () => {
    clearTimeout(closeTimer);
    const anchor = status.getBoundingClientRect();
    if (!appState.currentChannelId || !anchor.width || !anchor.height) return;
    tooltip.classList.remove('hidden');
    const box = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(12, Math.min(anchor.left, innerWidth - box.width - 12))}px`;
    tooltip.style.top = `${Math.max(12, anchor.top - box.height - 10)}px`;
  };
  const scheduleClose = () => {
    closeTimer = setTimeout(() => {
      if (document.activeElement !== status && !status.matches(':hover') && !tooltip.matches(':hover')) close();
    }, 100);
  };
  status.addEventListener('mouseenter', open);
  status.addEventListener('focus', open);
  status.addEventListener('mouseleave', scheduleClose);
  status.addEventListener('blur', scheduleClose);
  tooltip.addEventListener('mouseenter', () => clearTimeout(closeTimer));
  tooltip.addEventListener('mouseleave', scheduleClose);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  document.addEventListener('pointerdown', event => { if (!status.contains(event.target) && !tooltip.contains(event.target)) close(); });
  window.addEventListener('resize', close);
  window.addEventListener('blur', close);
}

function syncConnectionMonitor() {
  if (!appState.currentChannelId || !socket.connected) {
    clearTimeout(connectionProbeTimer);
    connectionProbeActive = false;
    ++connectionProbeRun;
    if (appState.currentChannelId) showConnectionQuality('bad', 'Reconectando…', 'Sem conexão com o servidor.');
    else showConnectionQuality('measuring', 'Fora da call', 'Entre em um canal de voz para medir a conexão.');
    return;
  }
  if (!connectionPingSupported) {
    clearTimeout(connectionProbeTimer);
    connectionProbeActive = false;
    ++connectionProbeRun;
    showConnectionQuality('measuring', 'Voz conectada', 'Este servidor ainda não informa o ping.');
    return;
  }
  if (connectionProbeActive) return;
  connectionProbeActive = true;
  const run = ++connectionProbeRun;
  showConnectionQuality('measuring', 'Voz conectada', 'Medindo o ping até o servidor…');
  const measure = () => {
    if (run !== connectionProbeRun) return;
    const started = performance.now();
    socket.timeout(4000).emit('connection-ping', (err, result) => {
      // Resposta da call anterior ou de uma conexão que já caiu não altera o painel.
      if (run !== connectionProbeRun) return;
      if (err || !result?.success) {
        showConnectionQuality('bad', 'Conexão instável', 'O servidor não respondeu em 4 segundos. Tentando novamente…');
      } else {
        const ping = Math.round(performance.now() - started);
        const quality = ping < 150 ? 'good' : ping < 300 ? 'fair' : 'bad';
        const description = quality === 'good' ? 'Boa' : quality === 'fair' ? 'Regular' : 'Ruim';
        showConnectionQuality(quality, 'Voz conectada', `Ping até o servidor: ${ping} ms · Conexão ${description.toLowerCase()}.`, ping);
      }
      connectionProbeTimer = setTimeout(measure, 5000);
    });
  };
  measure();
}

// -----------------------------------------------------------------------------
// 4. SIGNALING EVENT HANDLERS
// -----------------------------------------------------------------------------
// Propriedade só vem da identidade confirmada pelo protocolo novo.
appState.isAdmin = false;
appState.isOwner = false;
appState.legacyAdmin = false;
appState.ownershipSupported = false;
appState.serverHasAdmin = false;
const accountUI = setupAccounts({
  socket, prefs, savePrefs, serverUrl: SERVER_URL, getProfile: () => ({ ...myProfile }),
  getMemberId: () => appState.memberId, showToast, selectSettingsTab,
  onProfile: profile => {
    Object.assign(myProfile, profile);
    Object.assign(appState.myUser, { name: myProfile.name, color: myProfile.color });
    updateUserDockProfile();
  }
});

const permissionUI = setupPermissions({
  socket, state: appState, showToast, escapeHtml,
  saveIdentity: token => saveRoomAccess({ permissionToken: token }),
  onChange: () => { renderAdminSettings(); renderChannelsTree(); renderTextChannels(); updateVoiceLounge(); }
});

function saveAdminKey(key) {
  const adminKeys = { ...(prefs.adminKeys || {}) };
  if (key) adminKeys[SERVER_URL] = key;
  else delete adminKeys[SERVER_URL];
  savePrefs({ adminKeys });
}

function adminLogin(key, onDone) {
  socket.emit('admin-login', { key }, (res) => {
    if (!appState.ownershipSupported) {
      appState.legacyAdmin = Boolean(res?.success);
      appState.isAdmin = appState.legacyAdmin;
    }
    renderAdminSettings();
    renderChannelsTree();
    renderTextChannels();
    updateVoiceLounge();
    onDone?.(res || {});
  });
}

// Barrado pela senha da sala: pede a senha (o Socket.IO não tenta de novo sozinho)
socket.on('connect_error', (err) => {
  if (err?.message !== 'room-password') return;
  const wrong = err.data?.reason === 'wrong';
  if (wrong) saveRoomAccess({ password: '' });
  openRoomPasswordModal(wrong);
});

function openRoomPasswordModal(wrong) {
  const modal = $('#modal-room-password');
  if (!modal) return;
  $('#modal-settings')?.classList.add('hidden');
  $('#room-password-error').classList.toggle('hidden', !wrong);
  modal.classList.remove('hidden');
  const input = $('#input-room-password');
  input.value = '';
  input.focus();
}

function setupRoomPassword() {
  $('#btn-room-account')?.addEventListener('click', () => {
    $('#modal-room-password').classList.add('hidden');
    openSettings('conta');
  });
  $('#form-room-password')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const password = $('#input-room-password').value.trim();
    if (!password) return;
    saveRoomAccess({ password });
    $('#modal-room-password').classList.add('hidden');
    socket.connect();
  });
}

socket.on('member-key', ({ profileId, key } = {}) => {
  if (profileId === myProfile.id && typeof key === 'string') saveRoomAccess({ memberKey: key });
});

socket.on('room-password-changed', ({ password, by } = {}) => {
  saveRoomAccess({ password: password || '' });
  if (appState.isAdmin) return;
  showToast(password ? `🔒 ${by || 'A moderação'} colocou senha na sala (o seu app já guardou).` : `🔓 ${by || 'A moderação'} tirou a senha da sala.`);
});

socket.on('room-info', ({ hasPassword, connectionPing, assetKey } = {}) => {
  if (assetKey) appState.assetKey = assetKey;
  appState.roomHasPassword = Boolean(hasPassword);
  connectionPingSupported = connectionPing === true;
  syncConnectionMonitor();
  renderAdminSettings();
});

socket.on('connect', () => {
  appState.myId = socket.id;
  connectionPingSupported = false;
  syncConnectionMonitor();
  console.log(`[Socket.IO] Conectado ao servidor! ID: ${socket.id}`);

  // Texto e perfil funcionam mesmo antes de entrar em qualquer chamada.
  if (!accountSession(prefs, SERVER_URL)) socket.emit('update-profile', profilePayload());
  publishGameActivity(true);
  // Uma senha de admin salva nunca reivindica a propriedade automaticamente.

  // Reconectar retoma apenas a call já escolhida e a senha guardada nesta janela.
  if (appState.currentChannelId) requestChannelJoin(appState.currentChannelId, activeChannelPassword);
});

socket.on('disconnect', (reason) => {
  pendingChannelJoin = null;
  syncConnectionMonitor();
  renderServerHome();
  console.warn(`[Socket.IO] Desconectado: ${reason}`);
  showToast('Desconectado do servidor. Reconectando...', 'error');
});

// Nome e cor vêm do nosso perfil; o servidor só sugere um aleatório antes do join
socket.on('me', ({ id, sfu, admin, music }) => {
  appState.myId = id;
  // Sala com SFU (servidor na nuvem): transmissões passam pelo servidor, não P2P
  appState.sfuEnabled = Boolean(sfu);
  appState.serverHasAdmin = Boolean(admin);
  appState.musicEnabled = Boolean(music);
  musicUI?.syncChannel();
  renderAdminSettings();
  updateUserDockProfile();
});

socket.on('user-profile-updated', ({ userId, user }) => {
  if (!userId || !user) return;
  for (const ch of appState.channels.values()) {
    const existing = ch.users.get(userId);
    if (existing) Object.assign(existing, user);
  }
  if (userId !== appState.myId) applyUserVolume(userId);
  renderChannelsTree();
  updateVoiceLounge();
});

socket.on('user-activity-updated', ({ userId, activity }) => {
  if (userId === appState.myId) appState.myUser.activity = activity;
  for (const ch of appState.channels.values()) {
    const user = ch.users.get(userId);
    if (user) user.activity = activity;
  }
  renderUserActivity(userId, activity);
});

const handleChannelsSummary = (channelsList) => {
  if (!Array.isArray(channelsList)) return;

  // Canal que sumiu do servidor sai da lista. Antes ele ficava com a última pessoa que
  // esteve lá, como um fantasma, mesmo ela já estando em outro canal.
  const alive = new Set(channelsList.map((ch) => ch.id));
  for (const id of [...appState.channels.keys()]) {
    if (!alive.has(id) && id !== appState.currentChannelId) appState.channels.delete(id);
  }

  channelsList.forEach((ch) => {
    const userMap = new Map();
    if (Array.isArray(ch.users)) {
      ch.users.forEach((u) => userMap.set(u.id, u));
    }

    appState.channels.set(ch.id, {
      id: ch.id,
      name: ch.name,
      categoryId: ch.categoryId || 'voice', position: ch.position, isAfk: ch.isAfk,
      isDefault: ch.isDefault,
      createdBy: ch.createdBy || null,
      hasPassword: Boolean(ch.hasPassword),
      isPrivate: Boolean(ch.isPrivate),
      canManageAccess: Boolean(ch.canManageAccess),
      canWrite: ch.canWrite !== false,
      description: ch.description || '',
      callStartedAt: ch.callStartedAt || null,
      userCount: ch.userCount ?? userMap.size,
      activeStreams: ch.activeStreams ?? 0,
      users: userMap
    });
  });

  permissionUI.refreshChannels();
  renderChannelsTree();
  updateTopBar();
  updateVoiceLounge();
  syncSfuVoice();
};

// O servidor manda cada evento com dois nomes (compatibilidade). Escutar os dois
// rodava tudo duas vezes: avisos repetidos e ofertas de vídeo criadas em dobro.
socket.on('channel-layout', payload => {
  if (!payload || !Array.isArray(payload.categories)) return;
  appState.channelLayout = payload;
  renderChannelsTree(); renderTextChannels(); channelOrganizer?.refresh();
});
socket.on('channels-list', handleChannelsSummary);

socket.on('channel-state', ({ channelId, channelName, callStartedAt, me, users, recentMessages, soundSeed }) => {
  const attempt = pendingChannelJoin?.channelId === channelId ? pendingChannelJoin : null;
  if (attempt) {
    activeChannelPassword = attempt.password;
    pendingChannelJoin = null;
    closeChannelPasswordModal();
  }
  if (channelId !== appState.currentChannelId) activateVoiceChannel(channelId);
  // Eu entrei: ouço o mesmo áudio que tocou pra quem já estava no canal
  playCallSound(soundSeed, joinSoundUrl(myProfile));
  if (me) {
    if (me.id) appState.myId = me.id;
    if (me.name) appState.myUser.name = me.name;
    if (me.color) appState.myUser.color = me.color;
    appState.myUser.serverMuted = Boolean(me.serverMuted);
    appState.myUser.serverDeafened = Boolean(me.serverDeafened);
    updateUserDockProfile();
  }

  let ch = appState.channels.get(channelId);
  if (!ch) {
    ch = {
      id: channelId,
      name: channelName || channelId,
      isDefault: false,
      userCount: (users || []).length,
      activeStreams: 0,
      users: new Map()
    };
    appState.channels.set(channelId, ch);
  }

  if (callStartedAt) ch.callStartedAt = callStartedAt;
  ch.users.clear();
  if (Array.isArray(users)) {
    users.forEach((u) => ch.users.set(u.id, u));
    ch.userCount = ch.users.size;
  }

  // Populate recent messages
  if (Array.isArray(recentMessages)) {
    appState.channelChats.set(channelId, recentMessages);
  }

  // Voz: quem já está no canal com o mic ligado manda a oferta sozinho (user-joined).
  // Pedir aqui também gerava duas ofertas pro mesmo par: a resposta da primeira caía na
  // conexão da segunda e um não ouvia o outro até reiniciar o app.
  // Transmissão: só quando a pessoa clica no "AO VIVO".
  // Eu entrei com o mic ligado: quem está mutado não vai me oferecer nada, então eu ofereço
  if (Array.isArray(users) && appState.myUser.isMicOn && appState.localMicStream && !appState.sfuEnabled) {
    users.forEach((u) => {
      if (u.id !== appState.myId && !u.isMicOn) createVoiceOfferForUser(u.id);
    });
  }
  syncSfuVoice();

  renderChannelsTree();
  updateTopBar();
  renderChannelChat(channelId);
  updateVoiceLounge();
  if (attempt) setMobileView('sala');
  // A escolha salva restaura o botão; a captura só é aberta quando a call começa.
  if (appState.myUser.isMicOn && !appState.localMicStream) onMicrophoneToggle(true);
  if (attempt?.streamKey) openStream(attempt.streamKey);
});

const handleUserJoined = (data) => {
  const channelId = data.channelId;
  const user = data.user || {
    id: data.userId,
    name: data.name,
    color: data.color || '#5865F2',
    isSharing: false,
    isMicOn: false,
    isDeafened: false,
    isSpeaking: false
  };

  const ch = appState.channels.get(channelId);
  if (ch) {
    ch.users.set(user.id, user);
    ch.userCount = ch.users.size;
  }

  renderChannelsTree();

  if (channelId === appState.currentChannelId) {
    addSystemChatMessage(`👋 ${user.name} entrou no canal.`, channelId);
    playCallSound(data.soundSeed, joinSoundUrl(user));
    updateTopBar();
    updateVoiceLounge();

    // If my microphone is on, create WebRTC voice offer for newly joined user (só P2P)
    if (appState.myUser.isMicOn && appState.localMicStream && !appState.sfuEnabled) {
      createVoiceOfferForUser(user.id);
    }
    syncSfuVoice();
  }
};

socket.on('user-joined', handleUserJoined);

// Som de quando alguém entra ou sai da call: áudios gravados pelos próprios amigos.
// O servidor sorteia o número (soundSeed) e manda o mesmo pra todo mundo do canal,
// inclusive pra quem entrou/saiu: todos ouvem o mesmo áudio. Passa pelo volume geral
// e fica mudo com o ensurdecer.
const CALL_SOUNDS = Array.from({ length: 9 }, (_, i) => `/sounds/amigo-${i + 1}.ogg`);
const callSoundBuffers = new Map();
let lastCallSoundAt = 0;

// Som de entrada próprio de quem entrou (perfil), senão um dos áudios dos amigos
function joinSoundUrl(u) {
  if (!u) return '';
  if (u.id === appState.myId || u === myProfile) return myProfile.joinSound || '';
  return u.joinSoundV ? `${SERVER_URL}/api/join-sound/${encodeURIComponent(u.id)}?v=${encodeURIComponent(u.joinSoundV)}` : '';
}

// Cada um escolhe, só pra si, qual áudio dos amigos toca quando alguém entra ou sai:
// sorteado (padrão, igual pra todo mundo), um fixo, ou nenhum. O som de entrada do
// perfil de quem entrou continua tocando pra todos.
function setupCallSoundChoices() {
  for (const [kind, key] of [['join', 'joinSoundChoice'], ['leave', 'leaveSoundChoice']]) {
    const select = $(`#select-${kind}-sound`);
    if (!select) continue;
    select.innerHTML = '<option value="random">Sorteado (o mesmo que a galera ouve)</option>'
      + CALL_SOUNDS.map((_, i) => `<option value="${i + 1}">Áudio ${i + 1}</option>`).join('')
      + '<option value="off">Nenhum</option>';
    select.value = prefs[key] || 'random';
    const preview = () => {
      const url = select.value === 'random' ? CALL_SOUNDS[Math.floor(Math.random() * CALL_SOUNDS.length)] : callSoundChoiceUrl(kind);
      if (url) playCallSound(0, url, { force: true });
    };
    select.addEventListener('change', () => {
      savePrefs({ [key]: select.value });
      if (select.value !== 'random') preview();
    });
    $(`#btn-preview-${kind}-sound`)?.addEventListener('click', preview);
  }

  // Volume dos sons de entrada e saída (inclusive personalizados)
  const volInput = $('#input-call-sounds-volume');
  const volText = $('#call-sounds-volume-text');
  if (volInput) {
    const currentPct = typeof prefs.callSoundsVolume === 'number' ? prefs.callSoundsVolume : 100;
    volInput.value = String(currentPct);
    if (volText) volText.textContent = `${currentPct}%`;
    volInput.addEventListener('input', () => {
      const pct = Number(volInput.value);
      prefs.callSoundsVolume = pct;
      if (volText) volText.textContent = `${pct}%`;
    });
    volInput.addEventListener('change', () => {
      const pct = Number(volInput.value);
      savePrefs({ callSoundsVolume: pct });
    });
  }
}

function callSoundChoiceUrl(kind, soundSeed) {
  const choice = kind === 'leave' ? prefs.leaveSoundChoice : prefs.joinSoundChoice;
  if (choice === 'off') return null;
  const n = Number.parseInt(choice, 10);
  if (n >= 1 && n <= CALL_SOUNDS.length) return CALL_SOUNDS[n - 1];
  const index = Number.isInteger(soundSeed) ? soundSeed % CALL_SOUNDS.length : Math.floor(Math.random() * CALL_SOUNDS.length);
  return CALL_SOUNDS[index];
}

// Baixa e decodifica um áudio uma vez só (fica guardado pra próxima)
async function loadSoundBuffer(ctx, url) {
  let buffer = callSoundBuffers.get(url);
  if (buffer) return buffer;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  buffer = await ctx.decodeAudioData(await res.arrayBuffer());
  callSoundBuffers.set(url, buffer);
  return buffer;
}

async function playCallSound(soundSeed, customUrl = '', { force = false, kind = 'join' } = {}) {
  if (!force && (prefs.callSounds === false || appState.myUser.isDeafened)) return;
  const callVolPct = typeof prefs.callSoundsVolume === 'number' ? prefs.callSoundsVolume : 100;
  if (!force && callVolPct <= 0) return;
  const callVolGain = Math.max(0, callVolPct / 100);

  // Muita gente entrando junto (servidor reiniciou): um som só
  const now = Date.now();
  if (!force && now - lastCallSoundAt < 1500) return;
  if (!force) lastCallSoundAt = now;
  const url = customUrl || callSoundChoiceUrl(kind, soundSeed);
  if (!url) return;
  const mixer = appState.mixerManager;
  try {
    const ctx = mixer?.audioContext;
    if (!ctx || !mixer.masterDeafenGain) {
      const audio = new Audio(url);
      audio.volume = Math.min(1, Math.max(0, callVolGain));
      await audio.play();
      return;
    }
    let buffer;
    {
      try {
        buffer = await loadSoundBuffer(ctx, url);
      } catch (err) {
        // Som de entrada de alguém que não veio: toca um dos áudios dos amigos no lugar
        if (customUrl && !force) {
          console.warn('[Som] Som de entrada personalizado não veio, tocando o padrão:', err);
          lastCallSoundAt = 0;
          return playCallSound(soundSeed, '', { kind });
        }
        throw err;
      }
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gainNode = ctx.createGain();
    gainNode.gain.value = callVolGain;
    const dest = force ? (mixer.outputGain || mixer.masterDeafenGain) : mixer.masterDeafenGain;
    source.connect(gainNode).connect(dest);
    source.start();
  } catch (err) {
    console.warn('[Som] Não tocou o som de entrada/saída:', err);
  }
}

const CONTROL_SOUNDS = {
  mute: 'sounds/microfone-mutar.ogg', unmute: 'sounds/microfone-desmutar.ogg',
  deafen: 'sounds/audio-desativar.ogg', undeafen: 'sounds/audio-restaurar.ogg'
};
const ALTERNATIVE_CONTROL_SOUNDS = {
  mute: 'sounds/controle-alternativo-mutar.ogg', deafen: 'sounds/controle-alternativo-mutar.ogg',
  unmute: 'sounds/controle-alternativo-desmutar.ogg', undeafen: 'sounds/controle-alternativo-desmutar.ogg'
};
let controlSoundSource = null;
let controlSoundRequest = 0;
function stopControlSound() {
  controlSoundRequest++;
  controlSoundSource?.stop();
  controlSoundSource = null;
}
async function playControlSound(kind) {
  const sounds = prefs.controlSoundSet === 'alternativos' ? ALTERNATIVE_CONTROL_SOUNDS : CONTROL_SOUNDS;
  if (prefs.controlSounds === false || !sounds[kind]) return;
  const request = ++controlSoundRequest;
  try {
    controlSoundSource?.stop();
    controlSoundSource = null;
    const mixer = appState.mixerManager;
    const ctx = mixer?.audioContext;
    if (!ctx || !mixer.outputGain) return;
    await ctx.resume();
    const buffer = await loadSoundBuffer(ctx, sounds[kind]);
    if (request !== controlSoundRequest || prefs.controlSounds === false) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // O aviso de ensurdecer precisa continuar audível após zerar as vozes.
    source.connect(mixer.outputGain);
    controlSoundSource = source;
    source.onended = () => { source.disconnect(); if (controlSoundSource === source) controlSoundSource = null; };
    source.start();
  } catch (err) {
    console.warn('[Som] Não foi possível tocar o aviso do controle:', err.message);
  }
}

const handleUserLeft = (data) => {
  const channelId = data.channelId;
  const userId = data.userId;
  const userName = data.userName || data.name || 'Alguém';

  const ch = appState.channels.get(channelId);
  if (ch) {
    ch.users.delete(userId);
    ch.userCount = ch.users.size;
  }

  renderChannelsTree();

  if (channelId === appState.currentChannelId) {
    addSystemChatMessage(`${userName} saiu do canal.`, channelId);
    playCallSound(data.soundSeed, '', { kind: 'leave' });
    updateTopBar();
    updateVoiceLounge();
    cleanupUserConnections(userId);
  }
};

socket.on('user-left', handleUserLeft);

const handleUserStateChanged = (state) => {
  const channelId = state.channelId;
  const userId = state.userId;

  const ch = appState.channels.get(channelId);
  // O servidor manda o estado inteiro toda vez; compara pra saber se precisa redesenhar
  const visualSig = (u) => JSON.stringify([u.isSharing, u.isCameraOn, u.extraScreens, u.isMicOn, u.isDeafened, u.serverMuted, u.serverDeafened]);
  let visualChanged = true;
  if (ch && ch.users.has(userId)) {
    const u = ch.users.get(userId);
    const sigBefore = visualSig(u);
    if (typeof state.isCameraOn === 'boolean') {
      const wasOn = u.isCameraOn;
      u.isCameraOn = state.isCameraOn;
      if (channelId === appState.currentChannelId && userId !== appState.myId && wasOn && !state.isCameraOn) {
        unwatchScreen(streamKey(userId, 'camera'));
      }
    }
    if (typeof state.serverMuted === 'boolean' || typeof state.serverDeafened === 'boolean') {
      u.serverMuted = Boolean(state.serverMuted);
      u.serverDeafened = Boolean(state.serverDeafened);
      if (userId !== appState.myId) applyUserVolume(userId);
    }
    if (Array.isArray(state.extraScreens)) {
      const before = Array.isArray(u.extraScreens) ? u.extraScreens : [];
      u.extraScreens = state.extraScreens;
      if (channelId === appState.currentChannelId && userId !== appState.myId) {
        for (const n of before) {
          if (!state.extraScreens.includes(n)) unwatchScreen(streamKey(userId, `screen${n}`));
        }
      }
    }
    if (typeof state.isSharing === 'boolean') {
      const wasSharing = u.isSharing;
      u.isSharing = state.isSharing;
      // Quem começou a transmitir só ganha o "AO VIVO"; assistir é escolha de cada um
      if (channelId === appState.currentChannelId && userId !== appState.myId && wasSharing && !state.isSharing) {
        unwatchScreen(userId);
      }
    }
    if (typeof state.isMicOn === 'boolean') {
      u.isMicOn = state.isMicOn;
      if (userId !== appState.myId) applyUserVolume(userId);
      if (channelId === appState.currentChannelId && userId !== appState.myId) {
        const audioEl = document.getElementById(`voice-audio-${userId}`);
        if (audioEl) {
          setRemoteElementMuted(audioEl, !state.isMicOn || appState.myUser.isDeafened);
        }
        // Quem ligou o mic manda a oferta pra todo mundo; pedir aqui duplicava a conexão
      }
    }
    if (typeof state.isDeafened === 'boolean') u.isDeafened = state.isDeafened;
    if (Array.isArray(state.watching)) {
      u.watching = state.watching;
      renderStreamViewers();
    }
    if (typeof state.isSpeaking === 'boolean') {
      u.isSpeaking = state.isSpeaking;
      updateSpeakingIndicators(userId, state.isSpeaking);
    }
    visualChanged = visualSig(u) !== sigBefore;
  }

  // Só mudou o "falando": as bolinhas verdes já foram atualizadas acima. Redesenhar a lista
  // inteira aqui recriava todas as fotos/GIFs várias vezes por segundo enquanto alguém falava
  if (!visualChanged) return;

  renderChannelsTree();

  if (channelId === appState.currentChannelId) {
    updateVoiceLounge();
  }
};

socket.on('user-state-changed', handleUserStateChanged);


socket.on('channel-created', (payload) => {
  const chInfo = payload.channel || payload;
  if (!appState.channels.has(chInfo.id)) {
    appState.channels.set(chInfo.id, {
      id: chInfo.id,
      name: chInfo.name,
      isDefault: false,
      userCount: 0,
      activeStreams: 0,
      users: new Map()
    });
    renderChannelsTree();
    showToast(`Novo canal criado: #${chInfo.name}`, 'success');
  }
});

// Chat message receiving
socket.on('chat-message', (msg) => {
  if (!appState.channelChats.has(msg.channelId)) {
    appState.channelChats.set(msg.channelId, []);
  }
  appState.channelChats.get(msg.channelId).push(msg);

  clearTyping(msg.userId);
  if (mentionsMe(msg)) notifyMention(msg, 'chat da call', openCallChat);
  if (msg.channelId === appState.currentChannelId) {
    if (!appState.textView) appendChatMessage(msg, true);
    // Chat da call fora da vista: acende a bolinha no balão do canal
    if ((appState.textView || $('#chat-drawer')?.classList.contains('collapsed')) && msg.userId !== appState.myId) {
      appState.unreadChannels.add(msg.channelId);
      renderChannelsTree();
    }
  } else {
    appState.unreadChannels.add(msg.channelId);
    renderChannelsTree();
  }
});

// Floating reaction receiving
socket.on('reaction', ({ channelId, userId, userName, emoji }) => {
  // A minha já apareceu na hora em que cliquei (o servidor manda pro canal inteiro, eu incluso)
  if (userId === appState.myId) return;
  if (channelId === appState.currentChannelId) {
    spawnFloatingReaction(userName, emoji);
  }
});

// WebRTC signal hooks
setupWebRTCSignaling(socket);

// -----------------------------------------------------------------------------
// 5. CHANNEL NAVIGATION & LIFECYCLE
// -----------------------------------------------------------------------------
// A senha fica só na memória da call atual para retomar após uma queda de rede.
let activeChannelPassword = '';
let pendingChannelJoin = null;
let channelPasswordTarget = null;

function closeChannelPasswordModal() {
  $('#modal-channel-password').classList.add('hidden');
  $('#input-channel-password').value = '';
  channelPasswordTarget = null;
}

function openChannelPasswordModal(channelId, error = '', streamKey = null) {
  channelPasswordTarget = { channelId, streamKey };
  $('#channel-password-name').textContent = appState.channels.get(channelId)?.name || channelId;
  $('#channel-password-error').textContent = error;
  $('#channel-password-error').classList.toggle('hidden', !error);
  $('#modal-channel-password').classList.remove('hidden');
  const input = $('#input-channel-password');
  input.value = '';
  input.focus();
}

function requestChannelJoin(channelId, password = '', streamKey = null) {
  if (pendingChannelJoin) return;
  if (!socket.connected) return showToast('Espere a conexão voltar para entrar no canal.', 'error');
  const attempt = { channelId, password, streamKey };
  pendingChannelJoin = attempt;
  socket.emit('join-channel', {
    channelId,
    password,
    userName: appState.myUser.name,
    profile: profilePayload(),
    isMicOn: appState.myUser.isMicOn,
    isDeafened: appState.myUser.isDeafened,
    isSharing: appState.myUser.isSharing
  }, (res) => {
    if (pendingChannelJoin !== attempt) return;
    pendingChannelJoin = null;
    if (res?.success) return;
    if (channelId === appState.currentChannelId) leaveCallLocally();
    if (res?.code === 'channel-password') {
      const error = res.reason === 'required' ? '' : res.reason === 'wrong' ? 'Senha errada, tenta de novo.' : res.error;
      openChannelPasswordModal(channelId, error, streamKey);
    } else showToast(res?.error || 'Não deu pra entrar no canal.', 'error');
  });
}

function switchChannel(targetChannelId, password, streamKey = null) {
  if (!targetChannelId) return;
  const cleanId = targetChannelId.toLowerCase();
  if (cleanId === appState.currentChannelId) return;
  if (pendingChannelJoin) return;
  if (appState.channels.get(cleanId)?.hasPassword && password === undefined) {
    openChannelPasswordModal(cleanId, '', streamKey);
    return;
  }
  requestChannelJoin(cleanId, password || '', streamKey);
}

// Só troca a interface e as conexões de mídia depois que o servidor aceita a entrada.
function activateVoiceChannel(cleanId) {
  const oldChannelId = appState.currentChannelId;
  // Entrar e trocar de canal preservam o mute escolhido no dock.
  appState.currentChannelId = cleanId;
  appState.unreadChannels.delete(cleanId);
  if (appState.textView) closeTextView();

  // Update browser URL without reload
  // Mantém o ?server= (no app, sem ele o Ctrl+R perderia a sala)
  const params = new URLSearchParams(window.location.search);
  params.set('channel', cleanId);
  const newUrl = `${window.location.pathname}?${params}`;
  window.history.replaceState({}, '', newUrl);

  // Call M2 WebRTC teardown hook
  onWebRTCChannelChange(oldChannelId, cleanId);

  // Update UI components
  renderChannelsTree();
  updateTopBar();
  renderChannelChat(cleanId);
  updateVoiceLounge();

  const targetCh = appState.channels.get(cleanId);
  const targetName = targetCh ? targetCh.name : cleanId;
  addSystemChatMessage(`Você entrou no canal #${targetName}.`, cleanId);
}

// Sair da call sem fechar o app: desliga voz e transmissões e fica fora de todos os canais.
// Clicar num canal da lista entra de novo.
function leaveCall() {
  if (!appState.currentChannelId) return;
  // Eu saí: o servidor responde com o áudio que tocou pros outros
  socket.emit('leave-channel', {}, (res) => playCallSound(res?.soundSeed, '', { kind: 'leave' }));
  leaveCallLocally();
}

// Desliga voz e transmissões e fica fora dos canais (o servidor já sabe ou vai saber à parte)
function leaveCallLocally() {
  activeChannelPassword = '';
  const oldChannelId = appState.currentChannelId;
  if (!oldChannelId) return;
  onWebRTCChannelChange(oldChannelId, null);
  appState.currentChannelId = null;
  window.dispatchEvent(new Event('teletela-call-left'));
  appState.channels.get(oldChannelId)?.users.delete(appState.myId);

  const params = new URLSearchParams(window.location.search);
  params.delete('channel');
  window.history.replaceState({}, '', `${window.location.pathname}?${params}`);

  renderChannelsTree();
  updateTopBar();
  renderChannelChat(null);
  updateVoiceLounge();
}

// Admin me tirou da call: o servidor já me tirou do canal
socket.on('kicked', ({ by } = {}) => {
  leaveCallLocally();
  playCallSound(undefined, '', { kind: 'leave' });
  showToast(`🚪 ${by || 'A moderação'} tirou você da call. Clique num canal pra entrar de novo.`, 'error');
});

socket.on('channel-deleted', ({ channelId, channelName, by } = {}) => {
  if (!channelId) return;
  if (channelId === appState.currentChannelId) {
    leaveCallLocally();
    showToast(`🗑️ ${by || 'Alguém'} apagou o canal #${channelName || channelId}. Clique num canal pra entrar.`, 'error');
  }
  appState.channels.delete(channelId);
  appState.unreadChannels.delete(channelId);
  appState.channelChats?.delete(channelId);
  renderChannelsTree();
});

// Ícones de mutado/ensurdecido; com a 🛡️ quando foi o admin
function muteIndicatorsHtml(u) {
  const byAdmin = '<span class="admin-lock" aria-hidden="true">🛡️</span>';
  let html = '';
  if (!u.isMicOn) {
    html += u.serverMuted || u.serverDeafened
      ? `<span class="indicator-icon mic-muted" title="Mutado pela moderação">${MIC_OFF_SVG}${byAdmin}</span>`
      : `<span class="indicator-icon mic-muted" title="Microfone Mutado">${MIC_OFF_SVG}</span>`;
  }
  if (u.isDeafened) {
    html += u.serverDeafened
      ? `<span class="indicator-icon mic-muted" title="Ensurdecido pela moderação">${HEADPHONES_OFF_SVG}${byAdmin}</span>`
      : `<span class="indicator-icon mic-muted" title="Áudio Desativado">${HEADPHONES_OFF_SVG}</span>`;
  }
  return html;
}

function isMicLockedByAdmin() {
  return Boolean(appState.myUser.serverMuted || appState.myUser.serverDeafened);
}

const DRAG_USER_TYPE = 'application/x-teletela-user';

function moveUserToChannel(userId, channelId) {
  const u = findUser(userId);
  const ch = appState.channels.get(channelId);
  socket.emit('admin-move-user', { userId, channelId }, (res) => {
    if (res?.success) showToast(`➡️ ${u?.name || 'Pessoa'} foi pra #${ch?.name || channelId}.`, 'success');
    else showToast(`❌ ${res?.error || 'Não deu pra mudar de call.'}`, 'error');
  });
}

// Admin me mudou de call
socket.on('moved-by-admin', ({ channelId, channelName, by } = {}) => {
  if (!channelId || channelId === appState.currentChannelId) return;
  switchChannel(channelId);
  showToast(`➡️ ${by || 'A moderação'} te levou pra #${channelName || channelId}.`);
});

// Admin me mutou / ensurdeceu (ou desfez)
socket.on('server-moderation', ({ serverMuted, serverDeafened, by } = {}) => {
  const me = appState.myUser;
  const wasDeafenedByAdmin = me.serverDeafened;
  const wasLocked = isMicLockedByAdmin();
  me.serverMuted = Boolean(serverMuted);
  me.serverDeafened = Boolean(serverDeafened);
  // Lembra se o mic estava aberto, pra abrir de novo quando o admin liberar
  if (!wasLocked && isMicLockedByAdmin()) appState.micOnBeforeAdminLock = me.isMicOn;
  if (isMicLockedByAdmin() && me.isMicOn) {
    me.isMicOn = false;
    onMicrophoneToggle(false);
  }
  if (me.serverDeafened && !me.isDeafened) onDeafenToggle(true);
  else if (wasDeafenedByAdmin && !me.serverDeafened && me.isDeafened) onDeafenToggle(false);
  // Admin liberou: volta o mic como estava antes (e avisa todo mundo, senão aparece mutado)
  if (wasLocked && !isMicLockedByAdmin()) {
    const reopen = Boolean(appState.micOnBeforeAdminLock) && !me.isDeafened;
    appState.micOnBeforeAdminLock = false;
    if (reopen !== me.isMicOn) {
      me.isMicOn = reopen;
      onMicrophoneToggle(reopen);
    }
    socket.emit('user-state-changed', { isMicOn: me.isMicOn, isDeafened: me.isDeafened });
  }
  updateMicButton();
  renderChannelsTree();
  updateVoiceLounge();
  if (me.serverDeafened) showToast(`🎧 ${by || 'A moderação'} te ensurdeceu.`, 'error');
  else if (me.serverMuted) showToast(`🔇 ${by || 'A moderação'} te mutou pra todos.`, 'error');
  else showToast(`🎙️ ${by || 'A moderação'} liberou seu microfone.`, 'success');
});

function canDeleteChannel(ch) {
  if (!ch || ch.isDefault) return false;
  if (ch.isPrivate) return hasPermission(appState, 'manageChannels');
  return hasPermission(appState, 'manageChannels') || Boolean(ch.createdBy && ch.createdBy === myProfile.id);
}

function deleteChannel(chId) {
  const ch = appState.channels.get(chId);
  if (!ch) return;
  const inside = ch.users.size;
  const warn = inside > 0 ? `\n\n${inside === 1 ? '1 pessoa está' : `${inside} pessoas estão`} nele e vai sair da call.` : '';
  if (!window.confirm(`Apagar o canal #${ch.name}? Não dá pra desfazer.${warn}`)) return;
  socket.emit('delete-channel', { channelId: chId }, (res) => {
    if (res?.success) showToast(`🗑️ Canal #${ch.name} apagado.`, 'success');
    else showToast(`❌ ${res?.error || 'Não deu pra apagar o canal.'}`, 'error');
  });
}

// -----------------------------------------------------------------------------
// 6. UI RENDERING: CHANNELS & LIVE PRESENCE TREE
// -----------------------------------------------------------------------------
function renderChannelsTree() {
  const treeContainer = $('#channels-tree');
  if (!treeContainer) return;

  // Render each channel in state
  const defaultOrder = ['geral'];
  const channelIds = Array.from(appState.channels.keys());

  channelIds.sort((a,b) => {
    const first = appState.channels.get(a), second = appState.channels.get(b);
    return (first.position ?? 1e9) - (second.position ?? 1e9) || (a === 'geral' ? -1 : b === 'geral' ? 1 : a.localeCompare(b));
  });

  // Ensure default channels exist in appState if not yet received
  defaultOrder.forEach((defId) => {
    if (!appState.channels.has(defId)) {
      appState.channels.set(defId, {
        id: defId,
        name: defId.charAt(0).toUpperCase() + defId.slice(1),
        isDefault: true,
        userCount: 0,
        activeStreams: 0,
        users: new Map()
      });
    }
  });

  // Render tree
  treeContainer.innerHTML = '';
  // Recolhido (igual Discord): só o canal em que você está, com as fotos lado a lado
  const collapsed = Boolean(prefs.collapsedVoice);
  updateCategoryHeaders();

  channelIds.forEach((chId) => {
    const ch = appState.channels.get(chId);
    if (!ch) return;
    if (collapsed && (!ch.categoryId || ch.categoryId === 'voice') && chId !== appState.currentChannelId) return;

    const isActive = chId === appState.currentChannelId;
    const hasUnread = appState.unreadChannels.has(chId);

    const li = document.createElement('li');
    li.className = `channel-item ${isActive ? 'channel-active' : ''} ${hasUnread ? 'channel-unread' : ''}`;
    li.id = `channel-${chId}`;
    li.setAttribute('data-channel-id', chId);

    // Channel Row
    const row = document.createElement('div');
    row.className = 'channel-row';
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');

    let icon = '🔊';
    if (chId === 'cinema') icon = '🎬';
    else if (chId === 'futebol') icon = '⚽';
    else if (chId === 'gameplay') icon = '🎮';

    const userCount = ch.users.size;

    row.innerHTML = `
      <span class="channel-speaker-icon"${ch.hasPassword ? ' title="Canal com senha" aria-label="Canal com senha"' : ''}>${ch.hasPassword ? CHANNEL_LOCK_SVG : icon}</span>
      <span class="channel-name">${escapeHtml(ch.name)}${ch.isAfk ? ' <span class="badge-role">Ausentes</span>' : ''}${ch.isPrivate ? ' <span class="badge-role">Restrito</span>' : ''}</span>
      ${userCount > 0 && ch.callStartedAt ? `<span class="channel-call-timer" data-call-timer="${Number(ch.callStartedAt)}" title="Tempo ativo da call">${formatCallClock(ch.callStartedAt)}</span>` : ''}
      ${isActive
        ? `<button type="button" class="channel-chat-btn${hasUnread ? ' has-unread' : ''}" title="Abrir o chat da call" aria-label="Abrir o chat da call">${CHAT_BUBBLE_SVG}</button>`
        : userCount > 0 ? `<span class="channel-count" id="count-${chId}">${userCount}</span>` : ''}
      ${canDeleteChannel(ch) ? `<button type="button" class="channel-delete-btn" title="Apagar canal" aria-label="Apagar canal ${escapeHtml(ch.name)}">🗑️</button>` : ''}
      ${ch.canManageAccess ? `<button type="button" class="channel-settings-btn" title="Configurações do canal" aria-label="Configurações do canal ${escapeHtml(ch.name)}"><svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></svg></button>` : ''}
    `;

    row.querySelector('.channel-settings-btn')?.addEventListener('click', e => { e.stopPropagation(); permissionUI.openChannelSettings('voice', chId); });
    row.querySelector('.channel-delete-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteChannel(chId);
    });
    row.querySelector('.channel-chat-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openCallChat();
    });
    // Solta aqui a pessoa arrastada (admin)
    li.addEventListener('dragover', (e) => {
      if (!hasPermission(appState, 'moveMembers') || !e.dataTransfer.types.includes(DRAG_USER_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      li.classList.add('drop-target');
    });
    li.addEventListener('dragleave', (e) => {
      if (!li.contains(e.relatedTarget)) li.classList.remove('drop-target');
    });
    li.addEventListener('drop', (e) => {
      li.classList.remove('drop-target');
      const userId = e.dataTransfer.getData(DRAG_USER_TYPE);
      if (!userId || !hasPermission(appState, 'moveMembers')) return;
      e.preventDefault();
      if (ch.users.has(userId)) return;
      moveUserToChannel(userId, chId);
    });
    // Clicar no canal em que você já está, vendo um canal de texto: volta pra tela da call
    const openVoice = () => {
      if (chId === appState.currentChannelId) {
        if (appState.textView) closeTextView();
        setMobileView('sala');
      } else switchChannel(chId);
    };
    row.addEventListener('click', openVoice);
    row.addEventListener('keydown', (e) => {
      if (e.target !== row) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openVoice();
      }
    });

    li.appendChild(row);

    // Nested Users List
    const usersUl = document.createElement('ul');
    usersUl.className = `channel-users${collapsed ? ' compact' : ''}`;
    usersUl.id = `channel-users-${chId}`;

    sortedUsers(ch).forEach((u) => {
      const isMe = u.id === appState.myId;

      const userLi = document.createElement('li');
      userLi.className = `channel-user ${isMe ? 'is-me' : ''} ${u.isSpeaking ? 'is-speaking' : ''}`;
      userLi.setAttribute('data-user-id', u.id);
      userLi.setAttribute('data-username', u.name);

      userLi.innerHTML = `
        <div class="user-avatar-wrap ${u.isSpeaking ? 'is-speaking' : ''}">
          <div class="user-avatar${frameClass(u)}" style="background-color: ${safeColor(u.color)};${frameStyle(u)}">
            ${avatarInnerHtml(u)}
          </div>
          <span class="speaking-halo"></span>
        </div>
        <span class="channel-user-info"><span class="channel-user-name">
          <span class="user-name-text"${nameStyle(u)}>${escapeHtml(u.name)}</span>
          ${ownershipBadge(u)}
          ${(u.roles || []).filter(role => role.id === u.displayRoleId).map(role => `<span class="badge-role">${escapeHtml(role.name)}</span>`).join('')}
          ${isMe ? '<span class="badge-self">(Você)</span>' : ''}
        </span>${userCallTimerHtml(u)}</span>
        <div class="user-indicators">
          ${userGameBadgeHtml(u)}
          ${liveBadgesHtml(u, { compact: true })}
          ${muteIndicatorsHtml(u)}
          ${!isMe && getVolumePref(u).muted ? `<span class="indicator-icon local-muted" title="Silenciado por você">${SPEAKER_OFF_SVG}</span>` : ''}
        </div>
      `;
      userLi.title = isMe ? 'Ver seu perfil' : 'Ver perfil e ajustar volume';
      if (collapsed) userLi.title = `${u.name}${isMe ? ' (você)' : ''} · ${userLi.title}`;
      // Admin arrasta a pessoa pra outra call, igual no Discord
      if (hasPermission(appState, 'moveMembers')) {
        userLi.draggable = true;
        userLi.title += ' · arraste pra outra call';
        userLi.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData(DRAG_USER_TYPE, u.id);
          e.dataTransfer.effectAllowed = 'move';
          userLi.classList.add('dragging');
        });
        userLi.addEventListener('dragend', () => userLi.classList.remove('dragging'));
      }
      userLi.addEventListener('click', (e) => {
        openUserPopover(u.id, e);
      });

      // "AO VIVO": entra na transmissão (e no canal, se for outro)
      userLi.querySelectorAll('.badge-live-stream').forEach((liveBadge) => {
        liveBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          if (chId !== appState.currentChannelId) {
            switchChannel(chId);
          }
          openStream(liveBadge.dataset.streamKey);
        });
      });

      usersUl.appendChild(userLi);
    });

    li.appendChild(usersUl);
    treeContainer.appendChild(li);
  });
  renderStreamViewers();
  musicUI?.renderBot();
  channelOrganizer?.decorate('voice', treeContainer);
}

function updateTopBar() {
  diceUI?.sync();
  syncConnectionMonitor();
  updateTextLayout();
  updateStageControls();
  const inCall = Boolean(appState.currentChannelId);
  const ch = appState.channels.get(appState.currentChannelId);
  const name = ch ? ch.name : appState.currentChannelId || 'Fora da call';

  $('#btn-leave-call')?.classList.toggle('hidden', !inCall);
  $('#user-dock')?.classList.toggle('in-call', inCall);
  const voiceChannel = $('#voice-panel-channel');
  if (voiceChannel) voiceChannel.textContent = name;

  const textCh = appState.textView ? appState.textChannels.get(appState.textView) : null;
  const chatLabel = $('#chat-channel-label');
  if (chatLabel) chatLabel.textContent = textCh ? `#${textCh.name}` : inCall ? `#${name}-chat` : 'Fora da call';
  const description = textCh?.description || (!textCh && appState.channels.get(appState.currentChannelId)?.description) || '';
  $('#chat-channel-description').textContent = description;
  $('#chat-channel-description').classList.toggle('hidden', !description);
  $('#btn-chat-back-voice')?.classList.toggle('hidden', !textCh || !inCall);
  $('#btn-chat-pins')?.classList.toggle('hidden', !textCh);
  if (!textCh) $('#pins-popover')?.classList.add('hidden');
  renderTyping();
  syncMobileState(appState);

  const chatInput = $('#chat-input');
  if (chatInput) {
    // Canal de texto não precisa estar em call
    const canWrite = Boolean(textCh || inCall) && (textCh || appState.channels.get(appState.currentChannelId))?.canWrite !== false;
    chatInput.disabled = !canWrite;
    $('#chat-form')?.querySelectorAll('button').forEach(button => { button.disabled = !canWrite; });
    chatInput.placeholder = !canWrite && (textCh || inCall) ? 'Você pode ler este chat, mas não enviar mensagens.' : textCh
      ? `Mensagem em #${textCh.name}...`
      : inCall ? `Conversar em #${name}...` : 'Entre num canal pra conversar';
  }
}

let serverHomeSignature = '';

function renderServerHome() {
  if (appState.currentChannelId) return;
  const root = $('#server-home');
  if (!root) return;
  const channels = [...appState.channels.values()];
  const textChannels = [...(appState.textChannels?.values() || [])];
  // A fala muda várias vezes por segundo; o início só precisa mudar com canais e pessoas.
  const signature = JSON.stringify([
    socket.connected,
    channels.map((ch) => [ch.id, ch.name, sortedUsers(ch).map((u) => [u.id, u.name, u.color, u.avatarV, u.avatarCrop, u.frame, u.frameColor])]),
    textChannels.map((ch) => [ch.id, ch.name])
  ]);
  if (signature === serverHomeSignature) return;
  serverHomeSignature = signature;
  const count = channels.reduce((total, ch) => total + ch.users.size, 0);
  $('#home-summary').textContent = !socket.connected ? 'Reconectando à sala…'
    : count ? `${count} ${count === 1 ? 'pessoa em voz agora' : 'pessoas em voz agora'}`
      : 'A sala está aberta. Entre quando quiser.';
  $('#home-voice-count').textContent = String(channels.length);
  $('#home-voice-channels').innerHTML = channels.map((ch) => {
    const users = sortedUsers(ch);
    const names = users.slice(0, 3).map((u) => u.name).join(', ');
    const label = users.length ? `${names}${users.length > 3 ? ` e mais ${users.length - 3}` : ''}` : 'Livre para entrar';
    const faces = users.slice(0, 4).map((u) => `<span class="user-avatar home-person${frameClass(u)}" style="background:${safeColor(u.color)};${frameStyle(u)}" title="${escapeHtml(u.name)}">${avatarInnerHtml(u)}</span>`).join('');
    return `<button type="button" class="home-voice-card${users.length ? ' occupied' : ''}" data-home-voice="${escapeHtml(ch.id)}" ${socket.connected ? '' : 'disabled'}>
      <span class="home-channel-icon">${HEADPHONES_ON_SVG}</span>
      <span class="home-channel-info"><strong>${escapeHtml(ch.name)}</strong><span>${escapeHtml(label)}</span></span>
      <span class="home-card-bottom"><span class="home-people">${faces || '<span class="home-empty-mark" aria-hidden="true"></span>'}</span><span class="home-enter">Entrar <span aria-hidden="true">→</span></span></span>
    </button>`;
  }).join('');
  $('#home-text-section').classList.toggle('hidden', !textChannels.length);
  $('#home-text-channels').innerHTML = textChannels.map((ch) => `<button type="button" class="home-text-channel" data-home-text="${escapeHtml(ch.id)}" ${socket.connected ? '' : 'disabled'}><span class="home-text-hash" aria-hidden="true">#</span><span>${escapeHtml(ch.name)}</span><span class="home-text-arrow" aria-hidden="true">→</span></button>`).join('');
}

function setupServerHome() {
  $('#home-voice-channels').addEventListener('click', (e) => {
    const button = e.target.closest('[data-home-voice]');
    if (button) switchChannel(button.dataset.homeVoice);
  });
  $('#home-text-channels').addEventListener('click', (e) => {
    const button = e.target.closest('[data-home-text]');
    if (button) openTextChannel(button.dataset.homeText);
  });
}

function updateVoiceLounge() {
  stageSocialUI?.update();
  const lounge = $('#voice-lounge');
  const videosGrid = $('#videos-grid');
  if (!lounge) return;

  const home = $('#server-home');
  const inCall = Boolean(appState.currentChannelId);
  const hasStreams = appState.activeStreams.size > 0;
  home?.classList.toggle('hidden', inCall || hasStreams);
  if (!inCall) {
    lounge.classList.add('hidden');
    if (videosGrid) videosGrid.classList.toggle('hidden', !hasStreams);
    renderServerHome();
    return;
  }
  const ch = appState.channels.get(appState.currentChannelId);
  const name = ch ? ch.name : appState.currentChannelId;

  const title = $('#lounge-channel-title');
  if (title) {
    if (appState.currentChannelId) {
      const timerBadge = ch?.callStartedAt
        ? ` <span class="lounge-call-timer" data-call-timer="${Number(ch.callStartedAt)}" title="Tempo ativo desta call">⏱ ${formatCallClock(ch.callStartedAt)}</span>`
        : '';
      title.innerHTML = `Canal de Voz: ${escapeHtml(name)}${timerBadge}`;
    } else {
      title.textContent = 'Escolha um canal para começar';
    }
  }

  const iconEl = $('#lounge-channel-icon');
  if (iconEl) {
    if (!appState.currentChannelId) iconEl.innerHTML = CHAT_BUBBLE_SVG;
    else if (ch?.id === 'cinema') iconEl.textContent = '🎬';
    else if (ch?.id === 'futebol') iconEl.textContent = '⚽';
    else if (ch?.id === 'gameplay') iconEl.textContent = '🎮';
    else iconEl.textContent = '🔊';
  }

  // Populate users in lounge
  const loungeUsersGrid = $('#lounge-users-grid');
  if (loungeUsersGrid) {
    loungeUsersGrid.classList.toggle('hidden', !appState.currentChannelId);
    loungeUsersGrid.innerHTML = '';
    const users = ch ? sortedUsers(ch) : [];

    users.forEach((u) => {
      const isMe = u.id === appState.myId;

      const card = document.createElement('div');
      card.className = 'lounge-user-card';
      card.innerHTML = `
        <div class="user-avatar-wrap ${u.isSpeaking ? 'is-speaking' : ''}">
          <div class="user-avatar${frameClass(u)}" style="background-color: ${safeColor(u.color)};${frameStyle(u)}">
            ${avatarInnerHtml(u)}
          </div>
          <span class="speaking-halo"></span>
        </div>
        <span class="lounge-user-name"><span class="user-name-text"${nameStyle(u)}>${escapeHtml(u.name)}</span>${ownershipBadge(u)}${isMe ? ' (Você)' : ''}</span>
        ${userCallTimerHtml(u)}
        <div class="user-indicators">
          ${userGameBadgeHtml(u)}
          ${liveBadgesHtml(u)}
          ${muteIndicatorsHtml(u)}
          ${!isMe && getVolumePref(u).muted ? `<span class="indicator-icon" title="Silenciado por você">${SPEAKER_OFF_SVG}</span>` : ''}
        </div>
      `;
      card.title = isMe ? 'Ver seu perfil' : 'Ver perfil e ajustar volume';
      card.addEventListener('click', (e) => {
        openUserPopover(u.id, e);
      });
      card.querySelectorAll('.badge-live-stream').forEach((liveBadge) => {
        liveBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          openStream(liveBadge.dataset.streamKey);
        });
      });
      loungeUsersGrid.appendChild(card);
    });
  }
  musicUI?.renderBot();

  // Palco x sala de espera: pelo que eu estou assistindo de verdade (o mesmo critério do
  // updateStageLayout). Contar só quem tem tela ligada escondia a câmera sozinha: piscava e sumia.
  if (appState.activeStreams.size > 0 && videosGrid && videosGrid.children.length > 0) {
    lounge.classList.add('hidden');
    videosGrid.classList.remove('hidden');
  } else {
    lounge.classList.remove('hidden');
    if (videosGrid) videosGrid.classList.add('hidden');
  }
}

function updateUserDockProfile() {
  const nameEl = $('#dock-user-name');
  if (nameEl) {
    nameEl.textContent = appState.myUser.name;
    applyNameStyle(nameEl, myProfile);
  }

  const avatar = $('#dock-user-avatar');
  if (avatar) {
    avatar.style.backgroundColor = safeColor(appState.myUser.color);
    applyFrame(avatar, myProfile);
    avatar.innerHTML = avatarInnerHtml({ id: appState.myId, name: appState.myUser.name });
  }
  syncMobileState(appState);
}

// Avatar: a foto quando tem (a nossa vem do perfil local; a dos outros, do servidor),
// senão as iniciais. Se a foto falhar (amigo saiu da sala), volta pras iniciais.
function avatarInitials(name) {
  return escapeHtml((name || 'AM').trim().slice(0, 2).toUpperCase());
}

function avatarSrc(userId, avatarV) {
  if (userId && userId === appState.myId && myProfile.avatar) return myProfile.avatar;
  if (userId && avatarV) return `${SERVER_URL}/api/avatar/${encodeURIComponent(userId)}?v=${encodeURIComponent(avatarV)}`;
  return '';
}

function freezeAvatar(img) {
  if (!img || !img.src) return;

  const doFreeze = () => {
    try {
      const wrap = img.closest('.avatar-photo')?.parentElement;
      if (!wrap) return;
      const canvas = wrap.querySelector('canvas.avatar-static');
      if (canvas && img.naturalWidth > 0 && img.naturalHeight > 0) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const crop = imageCropRect(img.naturalWidth, img.naturalHeight, 1, JSON.parse(img.dataset.crop || '{}'));
        ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
        wrap.classList.add('has-frozen');
      }
    } catch (_) {
      // Ignora silenciosamente
    }
  };

  if (img.complete && img.naturalWidth > 0) {
    doFreeze();
  } else {
    img.addEventListener('load', doFreeze, { once: true });
  }
}
window.freezeAvatar = freezeAvatar;

function avatarInnerHtml(u) {
  const initials = avatarInitials(u?.name);
  const src = avatarSrc(u?.id, u?.avatarV);
  if (!src) return `<span>${initials}</span>`;
  const profile = u?.id === appState.myId ? myProfile : findUser(u?.id) || u;
  return avatarPhotoHtml(src, initials, profile?.avatarCrop);
}

function avatarPhotoHtml(src, initials, rawCrop) {
  const crop = normalizeImageCrop(rawCrop);
  return `<span class="avatar-photo profile-image-window"><img class="avatar-animated" style="${imageCropStyle(crop)}" data-crop="${escapeHtml(JSON.stringify(crop))}" src="${escapeHtml(src)}" alt="" data-initials="${initials}" onload="window.freezeAvatar?.(this)" /></span><canvas class="avatar-static" width="128" height="128"></canvas>`;
}

document.addEventListener('error', (e) => {
  const img = e.target;
  if (img?.tagName === 'IMG' && img.dataset.initials !== undefined) {
    const span = document.createElement('span');
    span.textContent = img.dataset.initials;
    const parent = img.closest('.avatar-photo')?.parentElement;
    if (parent) {
      parent.querySelectorAll('.avatar-static, .avatar-photo').forEach((el) => el.remove());
      parent.classList.remove('has-frozen', 'has-photo');
      parent.appendChild(span);
    } else {
      img.replaceWith(span);
    }
  }
}, true);

// Cores entram em style="": só aceita hex pra ninguém injetar CSS pelo perfil
function safeColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#5865f2';
}

// Cor do nome escolhida no perfil (sem ela, a cor normal do tema)
const HEX_RE = /^#[0-9a-f]{6}$/i;

// Cor do nome; com a segunda cor vira gradiente
function nameCss(u) {
  if (!HEX_RE.test(u?.nameColor || '')) return '';
  if (HEX_RE.test(u?.nameColor2 || '')) {
    return `background: linear-gradient(90deg, ${u.nameColor}, ${u.nameColor2}); -webkit-background-clip: text; background-clip: text; color: transparent;`;
  }
  return `color: ${u.nameColor};`;
}

function nameStyle(u) {
  const css = nameCss(u);
  return css ? ` style="${css}"` : '';
}

function applyNameStyle(el, u) {
  if (!el) return;
  el.style.background = '';
  el.style.webkitBackgroundClip = '';
  el.style.backgroundClip = '';
  el.style.color = '';
  el.style.cssText += nameCss(u);
}

// Moldura da foto: classe + a cor (pra moldura "cor")
const FRAME_PRESETS = [
  { id: '', label: 'Nenhuma' },
  { id: 'cor', label: 'Cor' },
  { id: 'ouro', label: 'Ouro' },
  { id: 'neon', label: 'Neon' },
  { id: 'fogo', label: 'Fogo' },
  { id: 'gelo', label: 'Gelo' },
  { id: 'arco-iris', label: 'Arco-íris' }
];
const FRAME_IDS = new Set(FRAME_PRESETS.map((f) => f.id).filter(Boolean));

function frameOf(u) {
  const src = u?.id === appState.myId ? myProfile : u;
  return FRAME_IDS.has(src?.frame) ? src : null;
}

function frameClass(u) {
  const f = frameOf(u);
  return f ? ` has-frame frame-${f.frame}` : '';
}

function frameStyle(u) {
  const f = frameOf(u);
  return f?.frame === 'cor' && HEX_RE.test(f.frameColor || '') ? ` --frame-color: ${f.frameColor};` : '';
}

function applyFrame(el, u) {
  if (!el) return;
  el.className = el.className.replace(/\s*has-frame|\s*frame-[a-z-]+/g, '');
  el.className += frameClass(u);
  el.style.removeProperty('--frame-color');
  const f = frameOf(u);
  if (f?.frame === 'cor' && HEX_RE.test(f.frameColor || '')) el.style.setProperty('--frame-color', f.frameColor);
}

// Banner do perfil: imagem, senão a cor escolhida, senão a cor da bolinha
function renderBanner(element, u) {
  if (!element) return;
  const src = u?.id === appState.myId ? myProfile : u;
  const color = safeColor(HEX_RE.test(src?.bannerColor || '') ? src.bannerColor : u?.color);
  let img = '';
  if (u?.id === appState.myId || src === myProfile) img = myProfile.banner || '';
  else if (src?.banner) img = src.banner;
  else if (u?.bannerV) img = `${SERVER_URL}/api/banner/${encodeURIComponent(u.id)}?v=${encodeURIComponent(u.bannerV)}`;
  element.style.background = color;
  element.classList.add('profile-image-window');
  element.innerHTML = img ? `<img src="${escapeHtml(img)}" alt="" style="${imageCropStyle(src?.bannerCrop)}" />` : '';
}

// -----------------------------------------------------------------------------
// 7. CHAT & REACTIONS RENDERING
// -----------------------------------------------------------------------------
function renderChannelChat(channelId) {
  const container = $('#chat-messages');
  if (!container) return;
  // Vendo um canal de texto: o chat da call fica pra quando voltar
  if (appState.textView) return;

  container.innerHTML = '';
  const messages = appState.channelChats.get(channelId) || [];

  const welcomeBanner = document.createElement('div');
  welcomeBanner.className = 'chat-welcome-banner';
  const ch = appState.channels.get(channelId);
  const name = ch ? ch.name : channelId;
  welcomeBanner.innerHTML = !channelId ? `
    <h3>Você está fora da call</h3>
    <p>Clique num canal da lista pra entrar e ver o chat dele.</p>
  ` : `
    <h3>Bem-vindo ao chat do canal #${escapeHtml(name)}!</h3>
    <p>As mensagens enviadas aqui são visíveis apenas para os amigos conectados neste canal.</p>
  `;
  container.appendChild(welcomeBanner);

  messages.forEach((msg) => appendChatMessage(msg, false));
  container.scrollTop = container.scrollHeight;
}

function appendChatMessage(msg, autoScroll = true) {
  const container = $('#chat-messages');
  if (!container) return;
  const div = buildChatMessage(msg);
  // Imagem que demora a carregar empurra o chat: desce de novo quando ela chegar
  const img = div.querySelector('.chat-image');
  if (img && autoScroll) img.addEventListener('load', () => { container.scrollTop = container.scrollHeight; }, { once: true });
  container.appendChild(div);
  if (autoScroll) container.scrollTop = container.scrollHeight;
}

function isMyMessage(msg) {
  return Boolean(msg?.profileId) && msg.profileId === myProfile.id;
}

// Chat aberto agora: um canal de texto ou o chat da call
function chatScope() {
  return appState.textView ? { scope: 'text', channelId: appState.textView } : { scope: 'call' };
}

function currentChatMessages() {
  return appState.textView
    ? (appState.textMessages.get(appState.textView)?.messages || [])
    : (appState.channelChats.get(appState.currentChannelId) || []);
}

const ACTION_ICONS = {
  reply: '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  react: '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg>',
  edit: '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  delete: '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  pin: '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5M9 3h6l-1 7 4 3v2H6v-2l4-3z"/></svg>'
};

function buildChatMessage(msg) {
  const div = document.createElement('div');
  div.className = `chat-msg${mentionsMe(msg) ? ' mention-me' : ''}`;
  if (msg.id) div.dataset.msgId = msg.id;

  const when = new Date(msg.timestamp || Date.now());
  const hour = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  // Canal de texto guarda mensagens de outros dias: aí mostra a data também
  const time = when.toDateString() === new Date().toDateString()
    ? hour
    : `${when.toLocaleDateString([], { day: '2-digit', month: '2-digit' })} ${hour}`;
  const color = safeColor(msg.userColor);
  const author = { id: msg.senderId || msg.userId, name: msg.userName || msg.senderName, avatarV: msg.userAvatarV };
  const mine = isMyMessage(msg);
  // Responder e reagir precisam do servidor novo (mensagem com id e perfil)
  const actions = msg.id ? [
    ['reply', 'Responder'],
    ['react', 'Reagir'],
    ...(appState.textView ? [['pin', msg.pinned ? 'Desfixar' : 'Fixar']] : []),
    ...(mine && msg.text !== undefined ? [['edit', 'Editar']] : []),
    ...(mine || hasPermission(appState, 'manageMessages') ? [['delete', 'Apagar']] : [])
  ] : [];

  div.innerHTML = `
    <div class="chat-msg-avatar${frameClass(findUser(author.id))}" data-user-id="${escapeHtml(author.id || '')}" style="background-color: ${color};${frameStyle(findUser(author.id))}">
      ${avatarInnerHtml(author)}
    </div>
    <div class="chat-msg-body">
      ${replyRefHtml(msg.replyTo)}
      <div class="chat-msg-header">
        <span class="chat-author" title="${escapeHtml(msg.profileName || msg.userName || msg.senderName)}" style="${nameCss({ nameColor: msg.userNameColor, nameColor2: msg.userNameColor2 }) || `color: ${color};`}">${escapeHtml(msg.userName || msg.senderName)}</span>
        <span class="chat-time">${time}</span>
        ${msg.pinned ? `<span class="chat-pinned" title="Fixada por ${escapeHtml(msg.pinned.by || '')}">${ACTION_ICONS.pin}</span>` : ''}
      </div>
      ${msg.text ? `<div class="chat-text">${linkifyText(msg.text)}${msg.editedAt ? ' <span class="chat-edited" title="Editada">(editado)</span>' : ''}</div>` : ''}
      ${chatImageHtml(msg.image)}
      ${chatAttachmentHtml(msg.attachment)}
      ${reactionsHtml(msg)}
    </div>
    ${actions.length ? `<div class="chat-msg-actions">${actions.map(([act, label]) => `<button type="button" data-act="${act}" title="${label}" aria-label="${label}"${act === 'delete' ? ' class="danger"' : ''}>${ACTION_ICONS[act]}</button>`).join('')}</div>` : ''}
  `;
  return div;
}

function replyRefHtml(reply) {
  if (!reply?.id) return '';
  const what = reply.text ? escapeHtml(reply.text) : (reply.image ? '🖼️ Imagem' : '');
  return `<button type="button" class="chat-reply-ref" data-jump="${escapeHtml(reply.id)}" title="Ver a mensagem respondida">
    ${ACTION_ICONS.reply}<strong>${escapeHtml(reply.userName || '')}</strong><span>${what}</span>
  </button>`;
}

function reactionsHtml(msg) {
  const entries = Object.entries(msg.reactions || {}).filter(([, list]) => Array.isArray(list) && list.length);
  if (!entries.length) return '';
  return `<div class="chat-reactions">${entries.map(([emoji, list]) => {
    const mineReacted = list.some((r) => r.p === myProfile.id);
    const names = list.map((r) => r.n).join(', ');
    return `<button type="button" class="chat-reaction${mineReacted ? ' mine' : ''}" data-emoji="${escapeHtml(emoji)}" title="${escapeHtml(names)}">${escapeHtml(emoji)}<span>${list.length}</span></button>`;
  }).join('')}<button type="button" class="chat-reaction chat-reaction-add" data-act="react" title="Reagir" aria-label="Reagir">${ACTION_ICONS.react}</button></div>`;
}

// Troca/remove a mensagem na tela (se ela estiver no chat aberto)
function chatMessageEl(id) {
  return id ? $('#chat-messages')?.querySelector(`[data-msg-id="${CSS.escape(id)}"]`) : null;
}

function replaceChatMessageEl(msg) {
  const el = chatMessageEl(msg.id);
  if (!el || el.querySelector('.chat-edit')) return; // editando: atualiza quando terminar
  el.replaceWith(buildChatMessage(msg));
}

function upsertInList(list, msg) {
  const i = list ? list.findIndex((m) => m.id === msg.id) : -1;
  if (i !== -1) list[i] = msg;
}

function removeFromList(list, id) {
  const i = list ? list.findIndex((m) => m.id === id) : -1;
  if (i !== -1) list.splice(i, 1);
}

// ---------- Responder ----------
appState.replyingTo = null;
function setReplyTo(msg) {
  appState.replyingTo = msg ? { id: msg.id, userName: msg.userName || msg.senderName } : null;
  const bar = $('#chat-reply-bar');
  if (!bar) return;
  bar.classList.toggle('hidden', !msg);
  if (msg) {
    $('#chat-reply-name').textContent = appState.replyingTo.userName;
    $('#chat-input')?.focus();
  }
}

// ---------- Editar ----------
function startEditMessage(id) {
  const msg = currentChatMessages().find((m) => m.id === id);
  const el = chatMessageEl(id);
  if (!msg || !el || !isMyMessage(msg) || el.querySelector('.chat-edit')) return;
  const body = el.querySelector('.chat-msg-body');
  el.querySelector('.chat-text')?.remove();
  const box = document.createElement('div');
  box.className = 'chat-edit';
  box.innerHTML = '<textarea rows="1" maxlength="4000"></textarea><small>Enter salva · Esc cancela</small>';
  const area = box.querySelector('textarea');
  area.value = msg.text || '';
  body.querySelector('.chat-msg-header').after(box);
  const fit = () => { area.style.height = 'auto'; area.style.height = `${area.scrollHeight}px`; };
  fit();
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);
  const finish = () => {
    const fresh = currentChatMessages().find((m) => m.id === id) || msg;
    el.replaceWith(buildChatMessage(fresh));
  };
  area.addEventListener('input', fit);
  area.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      finish();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = area.value.trim();
      if (text === (msg.text || '')) return finish();
      if (!text) {
        finish();
        deleteChatMessage(id);
        return;
      }
      socket.emit('message-edit', { ...chatScope(), messageId: id, text }, (res) => {
        if (!res?.success) showToast(`❌ ${res?.error || 'Não deu pra editar.'}`, 'error');
        finish();
      });
    }
  });
}

function deleteChatMessage(id) {
  if (!window.confirm('Apagar essa mensagem?')) return;
  socket.emit('message-delete', { ...chatScope(), messageId: id }, (res) => {
    if (!res?.success) showToast(`❌ ${res?.error || 'Não deu pra apagar.'}`, 'error');
  });
}

function reactToMessage(id, emoji) {
  socket.emit('message-react', { ...chatScope(), messageId: id, emoji }, (res) => {
    if (!res?.success) showToast(`❌ ${res?.error || 'Não deu pra reagir.'}`, 'error');
  });
  countReactionUse(emoji);
}

// Menu de reação de uma mensagem: os rápidos + "＋" com todos os emojis
let messagePicker = null;
async function openMessageReactPicker(anchor, onPick) {
  const pop = $('#msg-react-popover');
  if (!pop) return;
  const close = () => pop.classList.add('hidden');
  pop.innerHTML = `<div class="msg-react-quick">${quickReactions().map((e) => `<button type="button" data-emoji="${escapeHtml(e)}">${escapeHtml(e)}</button>`).join('')}<button type="button" class="msg-react-more" title="Qualquer emoji">＋</button></div>`;
  pop.classList.remove('hidden');
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    pop.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
    pop.style.top = `${r.top - h - 6 > 8 ? r.top - h - 6 : Math.min(r.bottom + 6, window.innerHeight - h - 8)}px`;
  };
  place();
  pop.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.emoji) {
      onPick(btn.dataset.emoji);
      close();
      return;
    }
    if (btn.classList.contains('msg-react-more')) {
      try {
        const [{ default: Picker }, { default: i18n }] = await Promise.all([
          import('./vendor/emoji-picker/picker.js'),
          import('./vendor/emoji-picker/pt_BR.js')
        ]);
        messagePicker ??= new Picker({ locale: 'pt', i18n, dataSource: new URL('vendor/emoji-picker/data-pt.json', window.location.href).href });
        messagePicker.className = document.documentElement.dataset.theme === 'claro' ? 'light' : 'dark';
        messagePicker.onemojiclick = null;
        pop.innerHTML = '';
        pop.appendChild(messagePicker);
        messagePicker.addEventListener('emoji-click', (ev) => {
          if (ev.detail?.unicode) onPick(ev.detail.unicode);
          close();
        }, { once: true });
        place();
        messagePicker.shadowRoot?.querySelector('input.search')?.focus();
      } catch (err) {
        console.error('[Reações] Seletor de emojis não carregou:', err);
        close();
      }
    }
  };
}

// ---------- Menções (@nome) ----------
const MENTION_ALL = ['todos', 'everyone', 'galera'];

function onlineNames() {
  const names = new Set();
  for (const ch of appState.channels.values()) for (const u of ch.users.values()) if (u.name) names.add(u.name);
  if (appState.myUser.name) names.add(appState.myUser.name);
  return [...names];
}

function mentionsMe(msg) {
  if (!msg?.text || isMyMessage(msg)) return false;
  const text = msg.text.toLocaleLowerCase('pt-BR');
  const me = (appState.myUser.name || myProfile.name || '').toLocaleLowerCase('pt-BR');
  if (me && text.includes(`@${me}`)) return true;
  return MENTION_ALL.some((w) => new RegExp(`(^|\\s)@${w}(?![\\p{L}\\p{N}])`, 'u').test(text));
}

const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Recebe texto já escapado: destaca @nome de quem está online, @todos e você
function mentionify(escaped) {
  if (!escaped.includes('@')) return escaped;
  const names = onlineNames().map((n) => escapeHtml(n)).sort((x, y) => y.length - x.length);
  const re = new RegExp(`@(${[...names.map(escapeRegExp), ...MENTION_ALL].join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  const me = escapeHtml(appState.myUser.name || '').toLocaleLowerCase('pt-BR');
  return escaped.replace(re, (m, name) => {
    const isMe = name.toLocaleLowerCase('pt-BR') === me || MENTION_ALL.includes(name.toLowerCase());
    return `<span class="chat-mention${isMe ? ' me' : ''}">${m}</span>`;
  });
}

// Marcaram você: som, aviso e notificação do sistema se o Teletela não estiver na frente
function notifyMention(msg, where, open) {
  playMentionPing();
  const who = msg.userName || msg.senderName || 'Alguém';
  const body = (msg.text || '').slice(0, 140);
  if (document.hasFocus()) {
    showToast(`💬 ${who} te marcou em ${where}`);
    return;
  }
  try {
    const show = () => {
      const n = new Notification(`${who} te marcou em ${where}`, { body, icon: 'icon.png', silent: true });
      n.onclick = () => {
        window.focus();
        open?.();
        n.close();
      };
    };
    if (Notification.permission === 'granted') show();
    else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => p === 'granted' && show());
  } catch (_) {}
}

function playMentionPing() {
  const ctx = appState.mixerManager?.audioContext;
  const out = appState.mixerManager?.outputGain;
  if (!ctx || !out || appState.myUser.isDeafened) return;
  const now = ctx.currentTime;
  [880, 1320].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + i * 0.12);
    gain.gain.linearRampToValueAtTime(0.18, now + i * 0.12 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.25);
    osc.connect(gain).connect(out);
    osc.start(now + i * 0.12);
    osc.stop(now + i * 0.12 + 0.3);
  });
}

// Autocompletar: digitou "@" no campo, aparecem os nomes de quem está online
function setupMentionAutocomplete() {
  const input = $('#chat-input');
  const box = $('#mention-suggest');
  if (!input || !box) return;
  let items = [];
  let active = 0;
  const close = () => {
    box.classList.add('hidden');
    items = [];
  };
  const query = () => {
    const upto = input.value.slice(0, input.selectionStart);
    const m = upto.match(/(^|\s)@([^@\n]{0,24})$/u);
    return m ? { text: m[2], start: upto.length - m[2].length - 1 } : null;
  };
  const render = () => {
    box.innerHTML = items.map((u, i) => `<button type="button" class="mention-item${i === active ? ' active' : ''}" data-i="${i}">
      <span class="mention-avatar user-avatar" style="background-color: ${safeColor(u.color)};">${u.isAll ? '@' : avatarInnerHtml(u)}</span>
      <span${u.isAll ? '' : nameStyle(u)}>${escapeHtml(u.name)}</span>${u.isAll ? '<small>avisa todo mundo</small>' : ''}</button>`).join('');
    box.classList.toggle('hidden', !items.length);
  };
  const pick = (u) => {
    const q = query();
    if (!q) return close();
    const before = input.value.slice(0, q.start);
    const after = input.value.slice(input.selectionStart);
    const insert = `@${u.name} `;
    input.value = before + insert + after;
    const pos = before.length + insert.length;
    input.setSelectionRange(pos, pos);
    input.focus();
    close();
  };
  input.addEventListener('input', () => {
    const q = query();
    if (!q) return close();
    const needle = q.text.toLocaleLowerCase('pt-BR');
    const seen = new Set();
    const people = [];
    for (const ch of appState.channels.values()) {
      for (const u of ch.users.values()) {
        if (u.id === appState.myId || seen.has(u.name) || !u.name?.toLocaleLowerCase('pt-BR').startsWith(needle)) continue;
        seen.add(u.name);
        people.push(u);
      }
    }
    people.sort((a, b) => NAME_COLLATOR.compare(a.name, b.name));
    items = [...people.slice(0, 7), ...('todos'.startsWith(needle) ? [{ name: 'todos', isAll: true, color: '#5865F2' }] : [])];
    active = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (box.classList.contains('hidden') || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      render();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      e.stopImmediatePropagation();
      pick(items[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  box.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('.mention-item');
    if (!btn) return;
    e.preventDefault();
    pick(items[Number(btn.dataset.i)]);
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}

// ---------- Soundboard ----------
// Os áudios dos amigos que vêm no app + os que cada um sobe (ficam salvos no servidor).
// Tocar manda pra toda a call; cada um escolhe nas configurações se ouve e o volume.
appState.soundboard = [];
const MAX_SOUNDBOARD_BYTES = 1024 * 1024;
const MAX_SOUNDBOARD_SECONDS = 10.5;

function soundboardUrl(id) {
  const builtIn = /^amigo-([1-9])$/.exec(id);
  return builtIn ? CALL_SOUNDS[Number(builtIn[1]) - 1] : `${SERVER_URL}/api/soundboard/${encodeURIComponent(id)}`;
}

async function playSoundboard(id) {
  if (prefs.soundboardOn === false || appState.myUser.isDeafened) return;
  const mixer = appState.mixerManager;
  const ctx = mixer?.audioContext;
  const url = soundboardUrl(id);
  try {
    if (!ctx || !mixer.masterDeafenGain) {
      const audio = new Audio(url);
      audio.volume = Math.min(1, (prefs.soundboardVolume ?? 100) / 100);
      await audio.play();
      return;
    }
    const buffer = await loadSoundBuffer(ctx, url);
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = (prefs.soundboardVolume ?? 100) / 100;
    source.buffer = buffer;
    source.connect(gain).connect(mixer.masterDeafenGain);
    source.start();
  } catch (err) {
    console.warn('[Soundboard] Não tocou:', err);
  }
}

function renderSoundboard() {
  const grid = $('#soundboard-grid');
  if (!grid) return;
  const ownerName = (s) => {
    for (const ch of appState.channels.values()) for (const u of ch.users.values()) if (u.profileId === s.profileId) return u.name;
    return s.ownerName;
  };
  const mine = appState.soundboard.filter((s) => s.profileId === myProfile.id);
  const others = appState.soundboard.filter((s) => s.profileId !== myProfile.id)
    .sort((a, b) => NAME_COLLATOR.compare(ownerName(a), ownerName(b)) || NAME_COLLATOR.compare(a.name, b.name));
  const tile = (s, canDelete) => `<div class="soundboard-tile-wrap"><button type="button" class="soundboard-tile" data-sound-id="${escapeHtml(s.id)}" title="${escapeHtml(s.name)}${s.profileId ? ` · de ${escapeHtml(ownerName(s))}` : ''}">
      <span class="soundboard-emoji">${escapeHtml(s.emoji || '🔊')}</span><span class="soundboard-name">${escapeHtml(s.name)}</span>
    </button>${canDelete ? `<button type="button" class="soundboard-delete" data-delete-sound="${escapeHtml(s.id)}" title="Apagar som" aria-label="Apagar ${escapeHtml(s.name)}">✕</button>` : ''}</div>`;
  const section = (title, list, canDelete) => list.length
    ? `<div class="soundboard-section"><span class="soundboard-section-title">${title}</span><div class="soundboard-tiles">${list.map((x) => tile(x, canDelete(x))).join('')}</div></div>`
    : '';
  const builtIns = CALL_SOUNDS.map((_, i) => ({ id: `amigo-${i + 1}`, name: `Áudio ${i + 1}`, emoji: '🗣️' }));
  grid.innerHTML = section('Seus sons', mine, () => true)
    + section('Da galera', others, () => hasPermission(appState, 'manageMessages'))
    + section('Do app', builtIns, () => false)
    + (mine.length ? '' : '<p class="soundboard-hint">Clique em <strong>＋ Adicionar som</strong> pra subir os seus (até 16).</p>');
}

async function readSoundboardFile(file) {
  if (file.size > MAX_SOUNDBOARD_BYTES) throw new Error('Áudio grande demais: o máximo é 1 MB (corte ou use .ogg/.mp3).');
  const dataUrl = await readAsDataUrl(file);
  if (!/^data:audio\/(ogg|mpeg|mp3|wav|x-wav|webm|mp4|x-m4a|aac);base64,/i.test(dataUrl)) {
    throw new Error('Esse formato não serve: use .ogg, .mp3, .wav ou .m4a.');
  }
  const ctx = appState.mixerManager?.audioContext;
  if (ctx) {
    let buffer;
    try {
      buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    } catch {
      throw new Error('Não consegui tocar esse áudio.');
    }
    if (buffer.duration > MAX_SOUNDBOARD_SECONDS) throw new Error(`Áudio longo demais (${buffer.duration.toFixed(1)} s): o máximo é 10 s.`);
  }
  return dataUrl;
}

function setupSoundboard() {
  const btn = $('#btn-soundboard');
  const pop = $('#soundboard-popover');
  if (!btn || !pop) return;
  const close = () => {
    pop.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', () => {
    if (!appState.currentChannelId) return;
    const opening = pop.classList.contains('hidden');
    if (!opening) return close();
    renderSoundboard();
    pop.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
  });
  document.addEventListener('mousedown', (e) => {
    if (!pop.classList.contains('hidden') && !pop.contains(e.target) && !btn.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  pop.addEventListener('click', (e) => {
    const del = e.target.closest('[data-delete-sound]');
    if (del) {
      const sound = appState.soundboard.find((x) => x.id === del.dataset.deleteSound);
      if (!sound || !window.confirm(`Apagar o som "${sound.name}"?`)) return;
      socket.emit('soundboard-delete', { id: sound.id }, (res) => {
        if (!res?.success) showToast(`❌ ${res?.error || 'Não deu pra apagar.'}`, 'error');
      });
      return;
    }
    const tile = e.target.closest('[data-sound-id]');
    if (!tile) return;
    if (!appState.currentChannelId) return showToast('Entre numa call pra tocar sons.');
    socket.emit('soundboard-play', { id: tile.dataset.soundId }, (res) => {
      if (!res?.success) showToast(`❌ ${res?.error || 'Não deu pra tocar.'}`, 'error');
    });
  });

  // Adicionar som
  const form = $('#soundboard-add-form');
  let pendingData = '';
  $('#btn-soundboard-add-toggle')?.addEventListener('click', () => {
    form.classList.toggle('hidden');
    if (!form.classList.contains('hidden')) $('#input-soundboard-name')?.focus();
  });
  $('#input-soundboard-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      pendingData = await readSoundboardFile(file);
      $('#soundboard-file-name').textContent = file.name;
      const name = $('#input-soundboard-name');
      if (name && !name.value) name.value = file.name.replace(/\.[^.]+$/, '').slice(0, 30);
      playCallSound(0, pendingData, { force: true });
    } catch (err) {
      pendingData = '';
      $('#soundboard-file-name').textContent = 'até 10 s e 1 MB';
      showToast(`❌ ${err.message || 'Não consegui abrir esse áudio.'}`, 'error');
    }
  });
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#input-soundboard-name').value.trim();
    if (!pendingData) return showToast('Escolha um áudio primeiro.');
    if (!name) return;
    const save = $('#btn-soundboard-save');
    save.disabled = true;
    socket.emit('soundboard-add', { name, emoji: $('#input-soundboard-emoji').value.trim() || '🔊', data: pendingData }, (res) => {
      save.disabled = false;
      if (!res?.success) return showToast(`❌ ${res?.error || 'Não deu pra salvar o som.'}`, 'error');
      pendingData = '';
      form.reset();
      $('#input-soundboard-emoji').value = '🔊';
      $('#soundboard-file-name').textContent = 'até 10 s e 1 MB';
      form.classList.add('hidden');
      showToast(`🔊 Som "${name}" adicionado!`, 'success');
    });
  });

  // Configurações > Som
  const on = $('#input-soundboard-on');
  if (on) {
    on.checked = prefs.soundboardOn !== false;
    on.addEventListener('change', () => savePrefs({ soundboardOn: on.checked }));
  }
  const vol = $('#input-soundboard-volume');
  const volText = $('#soundboard-volume-text');
  if (vol) {
    vol.value = String(prefs.soundboardVolume ?? 100);
    if (volText) volText.textContent = `${vol.value}%`;
    vol.addEventListener('input', () => {
      if (volText) volText.textContent = `${vol.value}%`;
    });
    vol.addEventListener('change', () => savePrefs({ soundboardVolume: Number(vol.value) }));
  }
}

socket.on('soundboard-list', (list) => {
  if (!Array.isArray(list)) return;
  appState.soundboard = list;
  if (!$('#soundboard-popover')?.classList.contains('hidden')) renderSoundboard();
});

socket.on('soundboard-played', ({ id, userName } = {}) => {
  if (typeof id !== 'string') return;
  playSoundboard(id);
  const sound = appState.soundboard.find((x) => x.id === id);
  spawnFloatingReaction(userName || 'Alguém', sound?.emoji || '🔊');
});

// ---------- Mensagens fixadas (canais de texto) ----------
function pinMessage(id, pinned) {
  if (!appState.textView) return;
  socket.emit('message-pin', { channelId: appState.textView, messageId: id, pinned }, (res) => {
    if (!res?.success) showToast(`❌ ${res?.error || 'Não deu pra fixar.'}`, 'error');
    else showToast(pinned ? '📌 Mensagem fixada.' : 'Mensagem desfixada.');
  });
}

function jumpToMessage(id) {
  const target = chatMessageEl(id);
  if (!target) {
    showToast('Essa mensagem é antiga: role o chat pra cima pra carregar.');
    return false;
  }
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.remove('flash');
  void target.offsetWidth;
  target.classList.add('flash');
  return true;
}

function renderPins() {
  const pop = $('#pins-popover');
  const id = appState.textView;
  if (!pop || pop.classList.contains('hidden') || !id) return;
  socket.emit('text-pins', { channelId: id }, (res) => {
    if (appState.textView !== id) return;
    const list = res?.messages || [];
    pop.innerHTML = `<div class="pins-head"><strong>Fixadas</strong><span>${list.length}</span></div>` + (list.length
      ? list.map((m) => `<div class="pin-item" data-pin-id="${escapeHtml(m.id)}">
          <div class="pin-item-head"><strong${nameStyle({ nameColor: m.userNameColor, nameColor2: m.userNameColor2 })}>${escapeHtml(m.userName || '')}</strong>
            <button type="button" class="pin-unpin" data-unpin="${escapeHtml(m.id)}" title="Desfixar" aria-label="Desfixar">✕</button></div>
          <div class="pin-item-text">${m.text ? linkifyText(m.text.slice(0, 300)) : (m.image ? '🖼️ Imagem' : escapeHtml(m.attachment?.name || ''))}</div>
          <small>Fixada por ${escapeHtml(m.pinned?.by || '')}</small>
        </div>`).join('')
      : '<p class="pins-empty">Nada fixado ainda. Passe o mouse numa mensagem e clique no 📌.</p>');
  });
}

function setupPins() {
  const btn = $('#btn-chat-pins');
  const pop = $('#pins-popover');
  if (!btn || !pop) return;
  btn.addEventListener('click', () => {
    pop.classList.toggle('hidden');
    renderPins();
  });
  pop.addEventListener('click', (e) => {
    const unpin = e.target.closest('[data-unpin]');
    if (unpin) return pinMessage(unpin.dataset.unpin, false);
    const item = e.target.closest('[data-pin-id]');
    if (item && !e.target.closest('a') && jumpToMessage(item.dataset.pinId)) pop.classList.add('hidden');
  });
  document.addEventListener('mousedown', (e) => {
    if (!pop.classList.contains('hidden') && !pop.contains(e.target) && !btn.contains(e.target) && !e.target.closest('#mobile-open-pins')) pop.classList.add('hidden');
  });
}

// ---------- "Fulano está digitando…" ----------
const TYPING_SHOW_MS = 4500;
const typingNow = new Map(); // "call:<canal>" ou "text:<canal>" -> Map(userId -> { name, until })
let lastTypingSentAt = 0;

function typingKey(scope, channelId) {
  return `${scope}:${channelId}`;
}

function currentTypingKey() {
  return appState.textView ? typingKey('text', appState.textView) : typingKey('call', appState.currentChannelId);
}

function clearTyping(userId) {
  for (const map of typingNow.values()) map.delete(userId);
  renderTyping();
}

function renderTyping() {
  const el = $('#typing-indicator');
  if (!el) return;
  const now = Date.now();
  const map = typingNow.get(currentTypingKey());
  const names = [];
  for (const [uid, t] of map || []) {
    if (t.until < now) map.delete(uid);
    else names.push(t.name);
  }
  el.classList.toggle('hidden', !names.length);
  if (!names.length) return;
  const who = names.length === 1 ? `<strong>${escapeHtml(names[0])}</strong> está`
    : names.length === 2 ? `<strong>${escapeHtml(names[0])}</strong> e <strong>${escapeHtml(names[1])}</strong> estão`
      : 'Várias pessoas estão';
  el.innerHTML = `<span class="typing-dots"><i></i><i></i><i></i></span>${who} digitando…`;
}

function setupTyping() {
  $('#chat-input')?.addEventListener('input', (e) => {
    if (!e.target.value.trim()) return;
    const now = Date.now();
    if (now - lastTypingSentAt < 3000) return;
    if (!appState.textView && !appState.currentChannelId) return;
    lastTypingSentAt = now;
    socket.emit('typing', chatScope());
  });
  setInterval(renderTyping, 1000);
}

socket.on('typing', ({ userId, name, scope, channelId } = {}) => {
  if (!userId || userId === appState.myId) return;
  const key = typingKey(scope, channelId);
  if (!typingNow.has(key)) typingNow.set(key, new Map());
  typingNow.get(key).set(userId, { name: name || 'Alguém', until: Date.now() + TYPING_SHOW_MS });
  renderTyping();
});

// ---------- Exportar / importar perfil (trocar de PC sem perder nada) ----------
function setupProfileTransfer() {
  $('#btn-profile-export')?.addEventListener('click', () => {
    const data = { app: 'teletela', tipo: 'perfil', versao: 2, accessIdentity: profileCredential, exportadoEm: new Date().toISOString(), profile: { ...myProfile } };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const safeName = (myProfile.name || 'perfil').normalize('NFD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'perfil';
    a.download = `teletela-perfil-${safeName}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    showToast(accountSession(prefs, SERVER_URL) ? 'Aparência exportada. Para recuperar os cargos da conta, entre com usuário e senha.' : '💾 Perfil exportado. Guarde o arquivo: ele permite recuperar seus cargos e acessos. Não compartilhe esse backup.');
  });
  $('#input-profile-import')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (accountSession(prefs, SERVER_URL)) return showToast('Saia da conta antes de importar outro perfil.', 'error');
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('Arquivo grande demais.');
      const data = JSON.parse(await file.text());
      const p = data?.profile;
      if (data?.app !== 'teletela' || !p || typeof p.id !== 'string' || !/^[a-z0-9-]{8,64}$/i.test(p.id) || typeof p.name !== 'string') {
        throw new Error('Esse arquivo não é um perfil do Teletela.');
      }
      if (!window.confirm(`Trocar o seu perfil pelo de "${p.name}"? O app vai recarregar.`)) return;
      const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
      const profile = {
        id: p.id,
        name: str(p.name, 24) || myProfile.name,
        color: HEX_RE.test(p.color || '') ? p.color : myProfile.color,
        bio: str(p.bio, 140),
        avatar: /^data:image\//.test(p.avatar || '') ? p.avatar : '',
        avatarCrop: normalizeImageCrop(p.avatarCrop),
        nameColor: HEX_RE.test(p.nameColor || '') ? p.nameColor : '',
        nameColor2: HEX_RE.test(p.nameColor2 || '') ? p.nameColor2 : '',
        frame: FRAME_IDS.has(p.frame) ? p.frame : '',
        frameColor: HEX_RE.test(p.frameColor || '') ? p.frameColor : '',
        bannerColor: HEX_RE.test(p.bannerColor || '') ? p.bannerColor : '',
        banner: /^data:image\//.test(p.banner || '') ? p.banner : '',
        bannerCrop: normalizeImageCrop(p.bannerCrop),
        joinSound: /^data:audio\//.test(p.joinSound || '') ? p.joinSound : ''
      };
      // A chave de membro é do perfil antigo: a do novo vem ao conectar
      const roomAccessAll = { ...(prefs.roomAccess || {}) };
      for (const k of Object.keys(roomAccessAll)) roomAccessAll[k] = { ...roomAccessAll[k], memberKey: undefined, permissionToken: p.id === myProfile.id ? roomAccessAll[k].permissionToken : undefined };
      const profileCredentials = { ...prefs.profileCredentials };
      if (/^[a-f0-9]{64}$/.test(data.accessIdentity || '')) profileCredentials[p.id] = data.accessIdentity;
      await savePrefs({ profile, profileCredentials, roomAccess: roomAccessAll });
      location.reload();
    } catch (err) {
      showToast(`❌ ${err.message || 'Não consegui ler esse arquivo.'}`, 'error');
    }
  });
}

// Cliques nas mensagens: botões de ação, reações e "ver a respondida"
function setupChatMessageActions() {
  const container = $('#chat-messages');
  if (!container) return;
  container.addEventListener('click', (e) => {
    const msgEl = e.target.closest('.chat-msg');
    const id = msgEl?.dataset.msgId;
    const jump = e.target.closest('.chat-reply-ref');
    if (jump) {
      jumpToMessage(jump.dataset.jump);
      return;
    }
    const chip = e.target.closest('.chat-reaction[data-emoji]');
    if (chip && id) return reactToMessage(id, chip.dataset.emoji);
    const btn = e.target.closest('[data-act]');
    if (!btn || !id) return;
    const msg = currentChatMessages().find((m) => m.id === id);
    if (!msg) return;
    const act = btn.dataset.act;
    if (act === 'reply') setReplyTo(msg);
    else if (act === 'react') openMessageReactPicker(btn, (emoji) => reactToMessage(id, emoji));
    else if (act === 'pin') pinMessage(id, !msg.pinned);
    else if (act === 'edit') startEditMessage(id);
    else if (act === 'delete') deleteChatMessage(id);
  });
  $('#btn-cancel-reply')?.addEventListener('click', () => setReplyTo(null));
  document.addEventListener('mousedown', (e) => {
    const pop = $('#msg-react-popover');
    if (pop && !pop.classList.contains('hidden') && !pop.contains(e.target) && !e.target.closest('[data-act="react"]')) pop.classList.add('hidden');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('#msg-react-popover')?.classList.add('hidden');
      if (appState.replyingTo && document.activeElement === $('#chat-input')) setReplyTo(null);
    }
  });
  // Seta pra cima com o campo vazio: edita a sua última mensagem
  $('#chat-input')?.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' || e.target.value || !$('#mention-suggest')?.classList.contains('hidden')) return;
    const last = [...currentChatMessages()].reverse().find((m) => isMyMessage(m) && m.text);
    if (!last) return;
    e.preventDefault();
    startEditMessage(last.id);
  });
}

// Links do chat viram clicáveis (abrem no navegador). O texto é escapado pedaço por pedaço.
const URL_IN_TEXT_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

function linkifyText(text) {
  const raw = String(text || '');
  let html = '';
  let last = 0;
  for (const match of raw.matchAll(URL_IN_TEXT_RE)) {
    // Pontuação no fim ("veja https://x.com.") fica fora do link
    const url = match[0].replace(/[.,!?;:)\]]+$/, '');
    html += mentionify(escapeHtml(raw.slice(last, match.index)));
    html += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="chat-link">${escapeHtml(url)}</a>`;
    last = match.index + url.length;
  }
  return html + mentionify(escapeHtml(raw.slice(last)));
}

function chatAssetUrl(url) { return `${SERVER_URL}${url}?access=${encodeURIComponent(appState.assetKey || '')}`; }

const IMAGE_DOWNLOAD_SVG = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>';
function chatImageHtml(image) {
  if (!image || typeof image.url !== 'string' || !/^\/api\/(chat|text)-image\/[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(image.url)) return '';
  const size = image.width && image.height ? ` width="${Number(image.width)}" height="${Number(image.height)}"` : '';
  return `<span class="chat-image-wrap"><img class="chat-image" src="${escapeHtml(chatAssetUrl(image.url))}"${size} alt="Imagem" loading="lazy" /><a class="chat-image-download" href="${escapeHtml(chatAssetUrl(image.url))}&amp;download=1" download aria-label="Baixar imagem">${IMAGE_DOWNLOAD_SVG}<span>Baixar imagem</span></a></span>`;
}

function chatAttachmentHtml(attachment) {
  if (!attachment || typeof attachment.url !== 'string' || !/^\/api\/(chat|text)-file\/[a-f0-9-]{36}\.(bin|mp4|webm)$/.test(attachment.url)) return '';
  const url = chatAssetUrl(attachment.url);
  const name = typeof attachment.name === 'string' ? attachment.name : 'Arquivo';
  const size = Number(attachment.size) || 0;
  const sizeText = size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`;
  const download = `${url}&download=1&name=${encodeURIComponent(name)}`;
  const video = /\.(mp4|webm)$/.test(attachment.url);
  return `${video ? `<video class="chat-video" src="${escapeHtml(url)}" controls playsinline preload="metadata" aria-label="${escapeHtml(name)}"></video>` : ''}
    <a class="chat-file" href="${escapeHtml(download)}" download="${escapeHtml(name)}">
      <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 12v6m-3-3 3 3 3-3"/></svg>
      <span><strong>${escapeHtml(name)}</strong><small>${sizeText} · Baixar${video ? ' vídeo' : ' arquivo'}</small></span>
    </a>`;
}

// Prepara a imagem pro chat: foto parada é reduzida (lado maior até 1920 px, WebP);
// GIF vai como está pra continuar animado. Máximo 15 MB.
const MAX_CHAT_IMAGE_BYTES = 15 * 1024 * 1024;
const CHAT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

async function prepareChatImage(file) {
  if (!CHAT_IMAGE_TYPES.includes(file.type)) throw new Error('Só dá pra mandar PNG, JPG, WebP ou GIF.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Não consegui abrir essa imagem.'));
      el.src = url;
    });
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (file.type === 'image/gif') {
      if (file.size > MAX_CHAT_IMAGE_BYTES) throw new Error('GIF grande demais (máximo 15 MB).');
      return { data: await file.arrayBuffer(), mime: file.type, width, height };
    }
    const scale = Math.min(1, 1920 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    // Ficou maior que o original (print pequeno, PNG simples)? Manda o original
    const useOriginal = !blob || (scale === 1 && file.size <= blob.size);
    const out = useOriginal ? file : blob;
    if (out.size > MAX_CHAT_IMAGE_BYTES) throw new Error('Imagem grande demais (máximo 15 MB).');
    return {
      data: await out.arrayBuffer(),
      mime: useOriginal ? file.type : 'image/webp',
      width: useOriginal ? width : canvas.width,
      height: useOriginal ? height : canvas.height
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

let sendingChatImage = false;
async function sendChatImage(file) {
  if (!file) return;
  const textChannelId = appState.textView;
  const callChannelId = appState.currentChannelId;
  if (!appState.currentChannelId && !textChannelId) {
    showToast('Abra um canal de texto ou entre numa call pra enviar anexos.');
    return;
  }
  if (sendingChatImage) return showToast('Já tem um anexo sendo enviado. Aguarde terminar.');
  sendingChatImage = true;
  const input = $('#chat-input');
  const text = input?.value.trim() || '';
  const replyTo = appState.replyingTo?.id;
  try {
    const isImage = CHAT_IMAGE_TYPES.includes(file.type);
    if (!isImage && file.size > MAX_ATTACHMENT_BYTES) throw new Error('Arquivo grande demais (máximo 20 MB).');
    if (!file.size) throw new Error('Escolha um arquivo que não esteja vazio.');
    const attachment = isImage ? await prepareChatImage(file) : { data: await file.arrayBuffer(), mime: file.type, name: file.name };
    if (!textChannelId && appState.currentChannelId !== callChannelId) throw new Error('A call mudou durante a preparação. Escolha o arquivo novamente.');
    showToast('📎 Enviando anexo...');
    const event = `${textChannelId ? 'text' : 'chat'}-${isImage ? 'image' : 'file'}`;
    const res = await socket.timeout(60000).emitWithAck(event, { ...attachment, text, ...(textChannelId ? { channelId: textChannelId } : {}), replyTo });
    if (res?.success) {
      // Quem trocou de canal ou continuou digitando durante o envio mantém seu rascunho.
      if (appState.textView === textChannelId && (textChannelId || appState.currentChannelId === callChannelId)) {
        if (input?.value.trim() === text) input.value = '';
        if (appState.replyingTo?.id === replyTo) setReplyTo(null);
      }
    } else {
      showToast(`❌ ${res?.error || 'Não deu pra mandar o anexo.'}`, 'error');
    }
  } catch (err) {
    showToast(`❌ ${err?.message || 'Não deu pra mandar o anexo.'}`, 'error');
  } finally {
    sendingChatImage = false;
  }
}

function setupChatImages() {
  const fileInput = $('#input-chat-image');
  fileInput?.addEventListener('change', () => {
    sendChatImage(fileInput.files?.[0]);
    fileInput.value = '';
  });
  // Ctrl+V com arquivo no campo do chat (texto normal continua sendo colado).
  $('#chat-input')?.addEventListener('paste', (e) => {
    const file = e.clipboardData?.files?.[0];
    if (!file) return;
    e.preventDefault();
    sendChatImage(file);
  });
  // Arrastar arquivo pro chat
  const drawer = $('#chat-drawer');
  drawer?.addEventListener('dragover', (e) => {
    if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) {
      e.preventDefault();
      drawer.classList.add('drag-over');
    }
  });
  drawer?.addEventListener('dragleave', (e) => {
    if (!drawer.contains(e.relatedTarget)) drawer.classList.remove('drag-over');
  });
  drawer?.addEventListener('drop', (e) => {
    drawer.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    e.preventDefault();
    sendChatImage(file);
  });

  // Clique na imagem: abre grande
  const viewer = $('#image-viewer');
  const viewerImg = $('#image-viewer-img');
  $('#chat-messages')?.addEventListener('click', (e) => {
    const img = e.target.closest('.chat-image');
    if (!img || !viewer || !viewerImg) return;
    viewerImg.removeAttribute('style');
    viewerImg.src = img.src;
    const download = $('#image-viewer-download'); download.href = img.closest('.chat-image-wrap').querySelector('a').href; download.classList.remove('hidden');
    viewer.dataset.chatScope = appState.textView ? 'text' : 'call'; viewer.dataset.chatChannel = appState.textView || appState.currentChannelId;
    mountStageOverlay(viewer);
    viewer.setAttribute('aria-label', 'Imagem do chat');
    viewer.classList.remove('avatar-view');
    viewer.classList.remove('hidden');
  });
  // Clique na foto de alguém (popup da pessoa ou chat): abre o perfil grande.
  // No perfil grande, clicar na foto mostra ela grande (GIF animando).
  document.addEventListener('click', (e) => {
    const bigImg = e.target.closest('#profile-card-avatar')?.querySelector('img');
    if (bigImg && viewer && viewerImg) {
      e.stopPropagation();
      viewerImg.style.cssText = imageCropStyle(JSON.parse(bigImg.dataset.crop || '{}'));
      viewerImg.src = bigImg.src;
      $('#image-viewer-download').classList.add('hidden'); delete viewer.dataset.chatChannel;
      viewer.setAttribute('aria-label', 'Foto de perfil ampliada');
      viewer.classList.add('avatar-view');
      viewer.classList.remove('hidden');
      return;
    }
    const avatar = e.target.closest('#user-popover-avatar, .chat-msg-avatar[data-user-id]');
    if (!avatar) return;
    const userId = avatar.id === 'user-popover-avatar' ? popoverUserId : avatar.dataset.userId;
    if (!findUser(userId)) return;
    e.stopPropagation();
    openProfileCard(userId);
  }, true);
  $('#modal-user-profile')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-user-profile') e.target.classList.add('hidden');
  });
  viewer?.addEventListener('click', event => { if (!event.target.closest('.image-viewer-actions')) viewer.classList.add('hidden'); });
  $('#image-viewer-close').addEventListener('click', () => viewer.classList.add('hidden'));
  const hideRevokedImage = () => { if (viewer?.dataset.chatChannel && (viewer.dataset.chatScope === 'text' ? !appState.textChannels.has(viewer.dataset.chatChannel) : appState.currentChannelId !== viewer.dataset.chatChannel)) { viewer.classList.add('hidden'); viewerImg.removeAttribute('src'); $('#image-viewer-download').removeAttribute('href'); } };
  socket.on('text-channels', hideRevokedImage); window.addEventListener('teletela-call-left', hideRevokedImage);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // Esc fecha primeiro a foto grande, depois o perfil
    if (viewer && !viewer.classList.contains('hidden')) viewer.classList.add('hidden');
    else $('#modal-user-profile')?.classList.add('hidden');
  });
}

// -----------------------------------------------------------------------------
// CANAIS DE TEXTO: o histórico fica salvo no servidor. Abrem no painel do chat, sem
// precisar estar (nem sair) de call nenhuma.
function updateCategoryHeaders() {
  for (const [id, key] of [['#category-voice', 'collapsedVoice'], ['#category-text', 'collapsedText']]) {
    const header = $(id);
    if (!header) continue;
    header.classList.toggle('collapsed', Boolean(prefs[key]));
    header.setAttribute('aria-expanded', String(!prefs[key]));
  }
}

function setupCategoryCollapse() {
  const bind = (id, key, render) => {
    const header = $(id);
    if (!header) return;
    const toggle = () => {
      savePrefs({ [key]: !prefs[key] });
      render();
    };
    header.addEventListener('click', (e) => {
      if (e.target.closest('button')) return; // o "+" continua criando canal
      toggle();
    });
    header.addEventListener('keydown', (e) => {
      if (e.target !== header || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      toggle();
    });
  };
  bind('#category-voice', 'collapsedVoice', renderChannelsTree);
  bind('#category-text', 'collapsedText', renderTextChannels);
  updateCategoryHeaders();
}

// -----------------------------------------------------------------------------
appState.textChannels = new Map(); // id -> { id, name, createdBy, createdAt, lastMessageAt }
appState.textView = null; // canal de texto aberto no chat (null = chat da call)
appState.textMentions = new Set(); // canais de texto onde te marcaram e você ainda não viu
appState.textMessages = new Map(); // id -> { messages: [], hasMore, loading }

function textLastSeen(id) {
  return (prefs.textLastSeen || {})[id] || 0;
}

function markTextSeen(id) {
  const ch = appState.textChannels.get(id);
  if (!ch?.lastMessageAt || textLastSeen(id) >= ch.lastMessageAt) return;
  savePrefs({ textLastSeen: { ...(prefs.textLastSeen || {}), [id]: ch.lastMessageAt } });
}

function renderTextChannels() {
  const tree = $('#text-channels-tree');
  if (!tree) return;
  tree.innerHTML = '';
  updateCategoryHeaders();
  for (const ch of appState.textChannels.values()) {
    const li = document.createElement('li');
    const active = appState.textView === ch.id;
    const unread = !active && ch.lastMessageAt > textLastSeen(ch.id);
    // Recolhido: só o canal aberto e os que têm mensagem nova
    if (prefs.collapsedText && (!ch.categoryId || ch.categoryId === 'text') && !active && !unread && !appState.textMentions.has(ch.id)) continue;
    li.className = `channel-item ${active ? 'channel-active' : ''} ${unread ? 'channel-unread' : ''}`;
    li.dataset.textChannelId = ch.id;
    li.innerHTML = `
      <div class="channel-row" role="button" tabindex="0">
        <span class="channel-speaker-icon channel-hash">#</span>
        <span class="channel-name">${escapeHtml(ch.name)}</span>
        ${appState.textMentions.has(ch.id) && !active ? '<span class="channel-mention-badge" title="Te marcaram aqui">@</span>' : ''}
      ${canDeleteChannel(ch) ? `<button type="button" class="channel-delete-btn" title="Apagar canal" aria-label="Apagar canal ${escapeHtml(ch.name)}">🗑️</button>` : ''}
        ${ch.canManageAccess ? `<button type="button" class="channel-settings-btn" title="Configurações do canal" aria-label="Configurações do canal ${escapeHtml(ch.name)}"><svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></svg></button>` : ''}
      </div>
    `;
    const row = li.querySelector('.channel-row');
    row.addEventListener('click', () => openTextChannel(ch.id));
    row.addEventListener('keydown', (e) => {
      if (e.target !== row) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openTextChannel(ch.id);
      }
    });
    li.querySelector('.channel-settings-btn')?.addEventListener('click', e => { e.stopPropagation(); permissionUI.openChannelSettings('text', ch.id); });
    li.querySelector('.channel-delete-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!window.confirm(`Apagar o canal de texto #${ch.name}? Todas as mensagens e imagens dele somem. Não dá pra desfazer.`)) return;
      socket.emit('delete-text-channel', { channelId: ch.id }, (res) => {
        if (res?.success) showToast(`🗑️ Canal #${ch.name} apagado.`, 'success');
        else showToast(`❌ ${res?.error || 'Não deu pra apagar o canal.'}`, 'error');
      });
    });
    tree.appendChild(li);
  }
  channelOrganizer?.decorate('text', tree);
  renderServerHome();
}

// O canal de texto ocupa o centro; a transmissão continua no mesmo vídeo, reduzida.
function updateTextLayout() {
  const watching = appState.activeStreams.size > 0;
  const available = Boolean(appState.currentChannelId || appState.textView);
  const drawer = $('#chat-drawer');
  const toggle = $('#btn-toggle-chat');
  drawer?.classList.toggle('hidden', !available);
  toggle?.classList.toggle('hidden', !available);
  const chatOpen = available && !drawer?.classList.contains('collapsed');
  toggle?.classList.toggle('active', chatOpen);
  toggle?.setAttribute('aria-expanded', String(chatOpen));
  const central = Boolean(appState.textView) && chatOpen;
  $('#app-layout')?.classList.toggle('text-full', central);
  $('#app-layout')?.classList.toggle('text-with-stream', central && watching);
}

// Balão do canal de voz: abre o chat da call no canto
function markCallChatSeen() {
  if (!appState.unreadChannels.delete(appState.currentChannelId)) return;
  renderChannelsTree();
}

function openCallChat() {
  if (!appState.currentChannelId) return;
  setMobileView('chat');
  closeTextView();
  markCallChatSeen();
  $('#chat-drawer')?.classList.remove('collapsed');
  $('#btn-toggle-chat')?.classList.add('active');
  updateTextLayout();
  $('#chat-input')?.focus();
}

function openTextChannel(id) {
  if (!appState.textChannels.has(id)) return;
  setMobileView('chat');
  if (appState.textView !== id) setReplyTo(null);
  appState.textView = id;
  appState.textMentions.delete(id);
  const drawer = $('#chat-drawer');
  drawer?.classList.remove('collapsed');
  $('#btn-toggle-chat')?.classList.add('active');
  markTextSeen(id);
  renderTextChannels();
  updateTopBar();
  updateTextLayout();
  const state = appState.textMessages.get(id);
  if (state) renderTextChat();
  else loadTextHistory(id);
  $('#chat-input')?.focus();
}

function closeTextView() {
  if (!appState.textView) return;
  appState.textView = null;
  setReplyTo(null);
  markCallChatSeen();
  renderTextChannels();
  updateTopBar();
  updateTextLayout();
  renderChannelChat(appState.currentChannelId);
}

function loadTextHistory(id, before = null) {
  const state = appState.textMessages.get(id) || { messages: [], hasMore: false, loading: false };
  if (state.loading) return;
  state.loading = true;
  appState.textMessages.set(id, state);
  if (!before) renderTextChat(); // mostra "carregando" enquanto chega
  socket.emit('text-history', before ? { channelId: id, before } : { channelId: id }, (res) => {
    state.loading = false;
    if (!appState.textChannels.has(id)) return;
    if (!res?.success) return;
    const container = $('#chat-messages');
    const keepFromBottom = container ? container.scrollHeight - container.scrollTop : 0;
    // Mensagem que chegou ao vivo enquanto o histórico vinha não fica repetida
    const known = new Set(state.messages.map((m) => m.id));
    const fresh = res.messages.filter((m) => !known.has(m.id));
    // As do servidor são sempre mais antigas que as que já estão aqui (ao vivo ou já carregadas)
    state.messages = [...fresh, ...state.messages];
    state.hasMore = res.hasMore;
    if (appState.textView !== id) return;
    renderTextChat();
    // Carregou as antigas em cima: a tela não pula
    if (before && container) container.scrollTop = container.scrollHeight - keepFromBottom;
  });
}

function renderTextChat() {
  const container = $('#chat-messages');
  const id = appState.textView;
  const ch = appState.textChannels.get(id);
  if (!container || !ch) return;
  const state = appState.textMessages.get(id) || { messages: [], hasMore: false, loading: true };
  container.innerHTML = '';
  const banner = document.createElement('div');
  banner.className = 'chat-welcome-banner';
  if (state.hasMore || (state.loading && !state.messages.length)) {
    banner.innerHTML = `<p>${state.loading ? 'Carregando mensagens...' : 'Role pra cima pra ver as mais antigas'}</p>`;
  } else {
    banner.innerHTML = `
      <h3>Este é o começo de #${escapeHtml(ch.name)}</h3>
      <p>Tudo que mandarem aqui fica salvo, mesmo depois de todo mundo sair.</p>
    `;
  }
  container.appendChild(banner);
  state.messages.forEach((msg) => appendChatMessage(msg, false));
  container.scrollTop = container.scrollHeight;
}

function setupTextChannels() {
  $('#btn-chat-back-voice')?.addEventListener('click', closeTextView);
  $('#btn-return-to-stream')?.addEventListener('click', () => { closeTextView(); setMobileView('sala'); });
  // Perto do topo: busca as mensagens mais antigas
  $('#chat-messages')?.addEventListener('scroll', (e) => {
    const id = appState.textView;
    const state = id && appState.textMessages.get(id);
    if (!state || !state.hasMore || state.loading || e.target.scrollTop > 60) return;
    const oldest = state.messages[0];
    if (oldest) loadTextHistory(id, oldest.id);
  });
}

socket.on('text-channels', (list) => {
  if (!Array.isArray(list)) return;
  appState.textChannels = new Map(list.map((ch) => [ch.id, ch]));
  for (const id of appState.textMessages.keys()) if (!appState.textChannels.has(id)) { appState.textMessages.delete(id); appState.textMentions.delete(id); }
  permissionUI.refreshChannels();
  // O canal aberto foi apagado enquanto estávamos desconectados
  if (appState.textView && !appState.textChannels.has(appState.textView)) closeTextView();
  renderTextChannels();
  updateTopBar();
});

socket.on('text-message', (msg) => {
  const ch = appState.textChannels.get(msg?.channelId);
  if (!ch) return;
  ch.lastMessageAt = msg.timestamp;
  clearTyping(msg.userId);
  if (mentionsMe(msg)) {
    if (appState.textView !== msg.channelId) appState.textMentions.add(msg.channelId);
    notifyMention(msg, `#${ch.name}`, () => openTextChannel(msg.channelId));
  }
  const state = appState.textMessages.get(msg.channelId);
  if (state && !state.messages.some((m) => m.id === msg.id)) state.messages.push(msg);
  if (appState.textView === msg.channelId) {
    appendChatMessage(msg, true);
    markTextSeen(msg.channelId);
  }
  renderTextChannels();
});

socket.on('text-message-updated', ({ channelId, message } = {}) => {
  if (!message?.id) return;
  upsertInList(appState.textMessages.get(channelId)?.messages, message);
  if (appState.textView === channelId) {
    replaceChatMessageEl(message);
    renderPins();
  }
});

socket.on('text-message-deleted', ({ channelId, messageId } = {}) => {
  removeFromList(appState.textMessages.get(channelId)?.messages, messageId);
  if (appState.textView === channelId) chatMessageEl(messageId)?.remove();
});

socket.on('chat-message-updated', ({ message } = {}) => {
  if (!message?.id) return;
  upsertInList(appState.channelChats.get(message.channelId), message);
  if (!appState.textView && message.channelId === appState.currentChannelId) replaceChatMessageEl(message);
});

socket.on('chat-message-deleted', ({ messageId } = {}) => {
  for (const list of appState.channelChats.values()) removeFromList(list, messageId);
  if (!appState.textView) chatMessageEl(messageId)?.remove();
});

socket.on('text-channel-deleted', ({ channelId, channelName, by } = {}) => {
  if (!channelId) return;
  if (appState.textView === channelId) {
    appState.textChannels.delete(channelId);
    closeTextView();
    showToast(`🗑️ ${by || 'Alguém'} apagou o canal #${channelName || channelId}.`, 'error');
  }
  appState.textChannels.delete(channelId);
  appState.textMessages.delete(channelId);
  renderTextChannels();
});

function addSystemChatMessage(text, channelId = appState.currentChannelId) {
  const container = $('#chat-messages');
  if (!container || channelId !== appState.currentChannelId || appState.textView) return;

  const div = document.createElement('div');
  div.className = 'chat-system-notice';
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function spawnFloatingReaction(userName, emoji) {
  if (stageSocialUI?.reaction({ userName, emoji, channelId: appState.currentChannelId })) return;
  const container = $('#reactions-layer');
  if (!container) return;
  while (container.childElementCount >= 40) container.firstElementChild?.remove();

  const reaction = document.createElement('div');
  reaction.className = 'floating-reaction';
  const randomLeft = 15 + Math.random() * 70;
  reaction.style.left = `${randomLeft}%`;

  reaction.innerHTML = `
    <span>${escapeHtml(emoji)}</span>
    <span class="reaction-sender">${escapeHtml(userName)}</span>
  `;

  container.appendChild(reaction);
  setTimeout(() => reaction.remove(), 2800);
}

// -----------------------------------------------------------------------------
// 8. DOCK CONTROLS & EVENT BINDINGS
// -----------------------------------------------------------------------------
function setupDockControls() {
  const micBtn = $('#btn-toggle-mic');
  const deafenBtn = $('#btn-toggle-deafen');
  const shareBtn = $('#btn-share-screen');
  const loungeShareBtn = $('#btn-lounge-start-share');

  // Mic Mute Toggle
  micBtn?.addEventListener('click', async () => {
    if (!appState.myUser.isMicOn && isMicLockedByAdmin()) {
      showToast(appState.myUser.serverDeafened ? '🎧 A moderação te ensurdeceu.' : '🔇 A moderação te mutou pra todos.', 'error');
      return;
    }
    const nextMicOn = !appState.myUser.isMicOn;
    if (nextMicOn && appState.myUser.isDeafened) onDeafenToggle(false);
    appState.myUser.isMicOn = nextMicOn;
    savePrefs({ micOn: nextMicOn });

    updateMicButton();

    await onMicrophoneToggle(nextMicOn);
    if (appState.myUser.isMicOn === nextMicOn) playControlSound(nextMicOn ? 'unmute' : 'mute');

    socket.emit('user-state-changed', {
      isMicOn: appState.myUser.isMicOn,
      isDeafened: appState.myUser.isDeafened
    });

    renderChannelsTree();
    updateVoiceLounge();
  });

  // Deafen Toggle
  deafenBtn?.addEventListener('click', () => {
    if (appState.myUser.isDeafened && appState.myUser.serverDeafened) {
      showToast('🎧 A moderação te ensurdeceu.', 'error');
      return;
    }
    const nextDeafened = !appState.myUser.isDeafened;
    onDeafenToggle(nextDeafened);
    savePrefs({ micOn: appState.myUser.isMicOn });
    playControlSound(nextDeafened ? 'deafen' : 'undeafen');

    updateMicButton();

    socket.emit('user-state-changed', {
      isDeafened: appState.myUser.isDeafened,
      isMicOn: appState.myUser.isMicOn
    });

    renderChannelsTree();
    updateVoiceLounge();
  });

  // Screen Share Toggle
  const toggleScreenShare = (e) => {
    if (!appState.myUser.isSharing && !appState.currentChannelId) {
      showToast('Entre num canal pra transmitir a tela.');
      return;
    }
    // Já transmitindo: menu pra pôr outra tela ou parar uma delas
    if (appState.myUser.isSharing || appState.extraScreens.size > 0) {
      openShareMenu(e?.currentTarget || shareBtn);
      return;
    }
    appState.myUser.isSharing = true;
    shareBtn?.classList.add('sharing');
    // Só avisa a sala quando a captura começar de verdade (onStartScreenShare emite):
    // avisar aqui deixava "AO VIVO" pros amigos mesmo se a pessoa cancelasse
    onStartScreenShare();

    renderChannelsTree();
    updateVoiceLounge();
  };

  shareBtn?.addEventListener('click', toggleScreenShare);
  loungeShareBtn?.addEventListener('click', toggleScreenShare);
  $('#btn-leave-call')?.addEventListener('click', leaveCall);
  $('#btn-dock-leave')?.addEventListener('click', leaveCall);
  $('#btn-share-camera')?.addEventListener('click', toggleCameraShare);
  $('#btn-mobile-flip-camera')?.addEventListener('click', flipCameraShare);

}

function setupChatAndReactions() {
  // Chat form
  const chatForm = $('#chat-form');
  const chatInput = $('#chat-input');

  chatForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput?.value?.trim();
    if (!text) return;

    const replyTo = appState.replyingTo?.id;
    if (appState.textView) {
      socket.emit('text-message', { channelId: appState.textView, text: text.slice(0, 4000), replyTo }, (res) => {
        if (!res?.success) showToast(`❌ ${res?.error || 'Não deu pra mandar a mensagem.'}`, 'error');
      });
    } else {
      socket.emit('chat-message', {
        text: text.slice(0, 600),
        replyTo
      });
    }

    chatInput.value = '';
    setReplyTo(null);
  });

  // Toggle Chat Drawer
  $('#btn-toggle-chat')?.addEventListener('click', () => {
    if (!appState.currentChannelId && !appState.textView) return;
    const drawer = $('#chat-drawer');
    if (drawer) {
      drawer.classList.toggle('collapsed');
      $('#btn-toggle-chat')?.classList.toggle('active', !drawer.classList.contains('collapsed'));
      if (!drawer.classList.contains('collapsed') && !appState.textView) markCallChatSeen();
      updateTextLayout();
    }
  });

  $('#btn-close-chat')?.addEventListener('click', () => {
    setMobileView('sala');
    $('#chat-drawer')?.classList.add('collapsed');
    $('#btn-toggle-chat')?.classList.remove('active');
    updateTextLayout();
  });

  // Emoji Reactions
  const sendReaction = (emoji) => {
    if (!appState.currentChannelId) return;
    socket.emit('reaction', { emoji });
    spawnFloatingReaction(appState.myUser.name, emoji);
    countReactionUse(emoji);
  };
  renderQuickReactions();
  setupEmojiPicker(sendReaction);

}

// Barra de reações rápidas: começa com estes e vai virando os emojis que você mais usa.
// Cada lugar só troca quando outro emoji passa o menos usado da barra (os botões não ficam
// pulando de posição enquanto você clica).
let closeCallReactions = () => {};
const DEFAULT_QUICK_REACTIONS = ['🔥', '😂', '😱', '⚽', '🎮', '👏', '❤️'];
const MAX_TRACKED_EMOJIS = 100;

function quickReactions() {
  const saved = Array.isArray(prefs.quickReactions) ? prefs.quickReactions.filter((e) => typeof e === 'string') : [];
  return saved.length === DEFAULT_QUICK_REACTIONS.length ? saved : [...DEFAULT_QUICK_REACTIONS];
}

function renderQuickReactions() {
  const bar = $('#quick-reactions');
  if (!bar) return;
  bar.innerHTML = quickReactions()
    .map((e) => `<button type="button" class="reaction-btn" data-emoji="${escapeHtml(e)}" title="Reagir com ${escapeHtml(e)}">${escapeHtml(e)}</button>`)
    .join('');
}

function countReactionUse(emoji) {
  const usage = { ...(prefs.emojiUsage || {}) };
  usage[emoji] = (usage[emoji] || 0) + 1;
  // Guarda só os mais usados
  const entries = Object.entries(usage);
  if (entries.length > MAX_TRACKED_EMOJIS) {
    entries.sort((a, b) => b[1] - a[1]);
    for (const [e] of entries.slice(MAX_TRACKED_EMOJIS)) delete usage[e];
  }

  const bar = quickReactions();
  let changed = false;
  if (!bar.includes(emoji)) {
    // Troca o menos usado da barra (empate: o mais à direita)
    let slot = bar.length - 1;
    for (let i = bar.length - 1; i >= 0; i--) {
      if ((usage[bar[i]] || 0) < (usage[bar[slot]] || 0)) slot = i;
    }
    if (usage[emoji] > (usage[bar[slot]] || 0)) {
      bar[slot] = emoji;
      changed = true;
    }
  }
  savePrefs(changed ? { emojiUsage: usage, quickReactions: bar } : { emojiUsage: usage });
  if (changed && $('#reaction-quick-popover')?.classList.contains('hidden') !== false) renderQuickReactions();
}

// Hover mostra só sete atalhos; a lista completa continua sendo carregada sob demanda.
function setupEmojiPicker(onPick) {
  const btn = $('#btn-more-reactions');
  const quick = $('#reaction-quick-popover');
  const popover = $('#emoji-picker-popover');
  if (!btn || !quick || !popover) return;
  let loading = null;
  let closeTimer = null;
  let request = 0;
  const cancelClose = () => clearTimeout(closeTimer);
  const close = () => {
    ++request;
    cancelClose();
    const hadQuick = !quick.classList.contains('hidden');
    quick.classList.add('hidden');
    popover.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
    if (hadQuick) renderQuickReactions();
  };
  closeCallReactions = close;
  const choose = (emoji) => {
    cancelClose();
    onPick(emoji);
  };
  const load = () => loading ??= Promise.all([
    import('./vendor/emoji-picker/picker.js'),
    import('./vendor/emoji-picker/pt_BR.js')
  ]).then(([{ default: Picker }, { default: i18n }]) => {
    const picker = new Picker({
      locale: 'pt', i18n,
      dataSource: new URL('vendor/emoji-picker/data-pt.json', window.location.href).href
    });
    picker.addEventListener('emoji-click', (e) => {
      if (e.detail?.unicode) choose(e.detail.unicode);
    });
    popover.appendChild(picker);
    return picker;
  }).catch((err) => { loading = null; throw err; });

  const openQuick = (focus = false) => {
    if (!appState.currentChannelId || !popover.classList.contains('hidden')) return;
    cancelClose();
    quick.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    if (focus) quick.querySelector('button')?.focus();
  };
  const openAll = async () => {
    const channelId = appState.currentChannelId;
    if (!channelId) return;
    cancelClose();
    const currentRequest = ++request;
    quick.classList.add('hidden');
    try {
      const picker = await load();
      if (currentRequest !== request || channelId !== appState.currentChannelId) return;
      picker.className = document.documentElement.dataset.theme === 'claro' ? 'light' : 'dark';
      popover.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      picker.shadowRoot?.querySelector('input.search')?.focus();
    } catch (err) {
      close();
      console.error('[Reações] Seletor de emojis não carregou:', err);
      showToast('❌ Não deu pra abrir os emojis.', 'error');
    }
  };
  const scheduleClose = () => {
    if (quick.contains(document.activeElement)) return;
    cancelClose();
    // Dá tempo de atravessar o pequeno espaço entre o botão e os atalhos.
    closeTimer = setTimeout(() => { if (popover.classList.contains('hidden')) close(); }, 220);
  };
  btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') openQuick(); });
  btn.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') scheduleClose(); });
  quick.addEventListener('pointerenter', cancelClose);
  quick.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') scheduleClose(); });
  quick.addEventListener('focusin', cancelClose);
  btn.addEventListener('click', (e) => {
    // O mouse pode ter aberto os atalhos antes do clique; o clique ainda permite usar o painel.
    if (!popover.classList.contains('hidden')) close();
    else openQuick(e.detail === 0);
  });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); openQuick(true); }
  });
  $('#quick-reactions').addEventListener('click', (e) => {
    const emoji = e.target.closest('[data-emoji]')?.dataset.emoji;
    if (emoji) choose(emoji);
  });
  $('#btn-all-reactions').addEventListener('click', openAll);
  document.addEventListener('mousedown', (e) => {
    if (!popover.contains(e.target) && !quick.contains(e.target) && !btn.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (!popover.classList.contains('hidden') || !quick.classList.contains('hidden'))) {
      close(); btn.focus();
    }
  });
}

// Dispositivos só são consultados nas abas de áudio.
async function populateSettingsDevices() {
  try {
    const detected = await refreshAudioDevices(true);
    const inputSelect = $('#select-audio-input');
    const outputSelect = $('#select-audio-output');
    const systemSelect = $('#select-audio-system');

    if (inputSelect) {
      inputSelect.innerHTML = '';
      if (detected.microphoneDevices.length === 0) {
        inputSelect.innerHTML = '<option value="">Nenhum microfone detectado</option>';
      } else {
        detected.microphoneDevices.forEach((d) => {
          const opt = document.createElement('option');
          opt.value = d.deviceId;
          opt.textContent = d.label || `Microfone (${d.deviceId.slice(0, 8)})`;
          if (d.deviceId === appState.audioManager?.selectedMicrophoneId) opt.selected = true;
          inputSelect.appendChild(opt);
        });
      }
    }

    if (outputSelect) {
      outputSelect.innerHTML = '';
      if (detected.audioOutputs.length === 0) {
        outputSelect.innerHTML = '<option value="">Dispositivo padrão</option>';
      } else {
        detected.audioOutputs.forEach((d) => {
          const opt = document.createElement('option');
          opt.value = d.deviceId;
          opt.textContent = d.label || `Saída (${d.deviceId.slice(0, 8)})`;
          if (d.deviceId === appState.audioManager?.selectedOutputId) opt.selected = true;
          outputSelect.appendChild(opt);
        });
      }
    }

    if (systemSelect) {
      systemSelect.innerHTML = '';
      if (detected.systemAudioDevices.length === 0) {
        systemSelect.innerHTML = '<option value="">Nenhum monitor sink detectado (usar padrão)</option>';
      } else {
        detected.systemAudioDevices.forEach((d) => {
          const opt = document.createElement('option');
          opt.value = d.deviceId;
          opt.textContent = d.label || `Som do PC (${d.deviceId.slice(0, 8)})`;
          if (d.deviceId === appState.audioManager?.selectedSystemAudioId) opt.selected = true;
          systemSelect.appendChild(opt);
        });
      }
    }
  } catch (e) {
    console.warn('[Configurações] Não consegui listar os dispositivos de áudio:', e);
  }
}

function selectSettingsTab(name) {
  $$('.settings-tab').forEach((tab) => {
    const active = tab.dataset.settingsTab === name;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', String(active));
  });
  $$('.settings-section').forEach((section) => {
    section.classList.toggle('hidden', section.dataset.settingsSection !== name);
  });
  const isProfile = name === 'perfil';
  $('#btn-profile-save').classList.toggle('hidden', !isProfile);
  $('#btn-profile-reset').classList.toggle('hidden', !isProfile);
  $('#btn-settings-done').classList.toggle('btn-primary', !isProfile);
  $('#btn-settings-done').classList.toggle('btn-secondary', isProfile);
  $('#modal-settings .settings-panels').scrollTop = 0;
  if (isProfile && !profileDraft) resetProfileDraft();
  if (['microfone', 'som', 'transmissao'].includes(name)) populateSettingsDevices();
}

async function setupAutostart() {
  if (!window.electronAPI?.getAutostart) return;
  const group = $('#autostart-setting'), input = $('#check-autostart'), status = $('#autostart-status');
  const refresh = state => {
    group.classList.remove('hidden');
    input.checked = state.enabled === true;
    input.disabled = !state.supported;
    status.textContent = state.error || 'Abre o aplicativo quando você entra no computador, sem entrar na call.';
  };
  try { refresh(await window.electronAPI.getAutostart()); }
  catch { refresh({ error: 'Não consegui consultar a inicialização automática.' }); }
  input.addEventListener('change', async () => {
    const previous = !input.checked;
    input.disabled = true;
    try { refresh(await window.electronAPI.setAutostart(input.checked)); }
    catch { refresh({ supported: true, enabled: previous, error: 'Não consegui alterar essa opção. Tente novamente.' }); }
  });
  $('#btn-open-settings')?.addEventListener('click', () => window.electronAPI.getAutostart().then(refresh).catch(() => {}));
}

function openSettings(name = $('.settings-tab.active')?.dataset.settingsTab || 'aparencia') {
  const modal = $('#modal-settings');
  mountStageOverlay(modal);
  if (modal.classList.contains('hidden')) {
    profileDraft = null;
    ++imageCropRequest;
  }
  modal.classList.remove('hidden');
  selectSettingsTab(name);
}

function setupModals() {
  const syncChannelPasswordField = () => {
    const isVoice = document.querySelector('input[name="channel-type"]:checked')?.value === 'voice';
    $('#channel-password-field').classList.toggle('hidden', !isVoice);
    $('#input-channel-password-new').disabled = !isVoice;
    $('#new-channel-access').classList.toggle('hidden', !hasPermission(appState, 'manageChannels'));
  };
  $$('input[name="channel-type"]').forEach((radio) => radio.addEventListener('change', syncChannelPasswordField));
  $('#form-channel-password').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!channelPasswordTarget) return;
    const { channelId, streamKey } = channelPasswordTarget;
    requestChannelJoin(channelId, $('#input-channel-password').value, streamKey);
  });
  $('#modal-channel-password').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeChannelPasswordModal();
  });
  // Open create channel modal
  const openCreateModal = (type = 'voice') => {
    const radio = document.querySelector(`input[name="channel-type"][value="${type}"]`);
    if (radio) radio.checked = true;
    $('#input-channel-password-new').value = '';
    $('#new-channel-access-private').checked = false;
    $('#new-channel-access-choices').classList.add('hidden');
    syncChannelPasswordField();
    $('#modal-create-channel')?.classList.remove('hidden');
    $('#input-channel-name')?.focus();
  };
  $('#btn-add-text-channel')?.addEventListener('click', () => openCreateModal('text'));

  $('#btn-header-add-channel')?.addEventListener('click', () => openCreateModal());
  $('#btn-add-channel-category')?.addEventListener('click', () => openCreateModal());

  // Close modals on buttons with data-close-modal
  $$('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close-modal');
      if (modalId) $(`#${modalId}`)?.classList.add('hidden');
      if (modalId === 'modal-settings') { profileDraft = null; ++imageCropRequest; }
      if (modalId === 'modal-whats-new') whatsNewReturnFocus?.focus();
    });
  });

  // Preset chips
  $$('.preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const preset = chip.getAttribute('data-preset');
      const input = $('#input-channel-name');
      if (input && preset) {
        input.value = preset;
        input.focus();
      }
    });
  });

  // Create channel form submission
  $('#form-create-channel')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#input-channel-name');
    const name = input?.value?.trim();
    if (!name) return;

    const type = document.querySelector('input[name="channel-type"]:checked')?.value;
    const password = type === 'voice' ? $('#input-channel-password-new').value : '';
    const finish = () => {
      input.value = '';
      $('#input-channel-password-new').value = '';
      $('#modal-create-channel').classList.add('hidden');
    };
    if (!socket.connected) return showToast('Espere a conexão voltar para criar o canal.', 'error');
    if (type === 'text') {
      socket.emit('create-text-channel', { name, profileId: myProfile.id, access: permissionUI.newAccess() }, (response) => {
        if (response?.success) { finish(); openTextChannel(response.channelId); }
        else showToast(`❌ ${response?.error || 'Não deu pra criar o canal.'}`, 'error');
      });
    } else {
      socket.emit('create-channel', { name, profileId: myProfile.id, password, access: permissionUI.newAccess() }, (response) => {
        if (response?.success && response.channelId) {
          finish();
          switchChannel(response.channelId, password);
        }
        else showToast(`❌ ${response?.error || 'Não deu pra criar o canal.'}`, 'error');
      });
    }
  });

  // Stream volume slider (0-300% GainNode boost)
  const volInput = $('#input-stream-volume');
  const volText = $('#stream-volume-text');
  volInput?.addEventListener('input', () => {
    const pct = Math.round(Number(volInput.value) * 100);
    if (volText) volText.textContent = `${pct}%`;
    if (appState.focusedStreamUserId) setStreamVolume(appState.focusedStreamUserId, pct);
  });

  $('#btn-stage-fullscreen')?.addEventListener('click', () => toggleStageFullscreen());
  $('#btn-stage-pip')?.addEventListener('click', toggleStagePip);
  $('#btn-stage-stop-watching')?.addEventListener('click', () => {
    // Mosaico: para todas; uma aberta: só ela (a sua própria transmissão fica)
    const ids = isMosaicView() ? [...appState.activeStreams.keys()] : [appState.focusedStreamUserId];
    ids.forEach((id) => {
      if (id && !appState.activeStreams.get(id)?.isLocal) unwatchScreen(id);
    });
  });

  // O mesmo editor atende o atalho no próprio perfil e a aba nas configurações.
  $$('.settings-tab').forEach((tab) => {
    tab.title = tab.textContent.trim();
    tab.addEventListener('click', () => selectSettingsTab(tab.dataset.settingsTab));
  });
  selectSettingsTab('aparencia');
  $('#btn-open-settings')?.addEventListener('click', () => openSettings());

  $('#select-audio-input')?.addEventListener('change', async (e) => {
    const micId = e.target.value;
    appState.audioManager?.savePreferences(null, micId, null);
    if (appState.localMicStream && (await restartMicrophone(micId))) showToast('Microfone alterado');
  });

  const noiseSelect = $('#select-noise-suppression');
  if (noiseSelect) {
    noiseSelect.value = noiseMode();
    noiseSelect.addEventListener('change', async () => {
      savePrefs({ noiseSuppression: noiseSelect.value });
      if (appState.localMicStream) await restartMicrophone();
      showToast(`Cancelamento de ruído: ${noiseSelect.selectedOptions[0]?.textContent || noiseSelect.value}`);
    });
  }

  $('#select-audio-output')?.addEventListener('change', (e) => {
    const outId = e.target.value;
    appState.audioManager?.savePreferences(null, null, outId);
    showToast('Dispositivo de saída selecionado');
  });

  $('#select-audio-system')?.addEventListener('change', (e) => {
    const sysId = e.target.value;
    appState.audioManager?.savePreferences(sysId, null, null);
    showToast('Dispositivo de som do sistema selecionado');
  });

  // Atalhos de mutar/ensurdecer (configuráveis em Configurações → Atalhos de teclado)
  window.addEventListener('keydown', (e) => {
    if (hotkeyCapture) return;
    const accelerator = SOLO_KEY_CODES[e.code] ? (e.repeat ? null : SOLO_KEY_CODES[e.code]) : eventToAccelerator(e);
    if (!accelerator) return;
    // Campo escondido (modal fechado) com foco não conta como digitando
    const typing =
      (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) &&
      e.target.offsetParent !== null;
    // Digitando no chat, só valem atalhos que não são letras soltas
    if (typing && !canBeGlobalHotkey(accelerator)) return;
    let handled = false;
    for (const [action, hotkey] of Object.entries(hotkeys)) {
      if (hotkey && hotkey === accelerator) {
        e.preventDefault();
        triggerHotkey(action);
        handled = true;
      }
    }
    // F = tela cheia da transmissão (se a pessoa não usou F pra mutar/ensurdecer)
    if (!handled && !typing && accelerator === 'F') {
      e.preventDefault();
      toggleStageFullscreen();
    }
    // P = janela flutuante
    if (!handled && !typing && accelerator === 'P') {
      e.preventDefault();
      toggleStagePip();
    }
  });
}

// -----------------------------------------------------------------------------
// 8a. TELA CHEIA DA TRANSMISSÃO (botão da barra de baixo, tecla F, duplo clique)
// -----------------------------------------------------------------------------
function isStageFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement || document.body.classList.contains('stage-fullscreen'));
}

function exitStageFullscreen() {
  document.body.classList.remove('stage-fullscreen');
  document.querySelectorAll('.stage-fullscreen-tile').forEach((el) => el.classList.remove('stage-fullscreen-tile'));
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (document.webkitFullscreenElement) document.webkitExitFullscreen?.();
  screen.orientation?.unlock?.();
  window.TeletelaAndroid?.setFullscreen?.(false);
}

window.teletelaExitFullscreen = () => {
  if (!isStageFullscreen()) return false;
  exitStageFullscreen();
  return true;
};

let stageControlsHome = null;
let stageControlsElement = null;
document.addEventListener('fullscreenchange', () => {
  // O alvo pode sair do DOM ao parar de assistir; conserva a referência à barra.
  const controls = stageControlsElement ||= $('#stage-controls-bar');
  const target = document.fullscreenElement;
  if (controls) {
    if (!stageControlsHome) {
      stageControlsHome = document.createComment('Lugar da barra da transmissão');
      controls.before(stageControlsHome);
      // A roda sobre os controles não deve dar zoom no vídeo em tela cheia.
      controls.addEventListener('wheel', event => event.stopPropagation());
    }
    if (target && (target.id === 'videos-grid' || target.classList.contains('video-tile'))) target.appendChild(controls);
    else stageControlsHome.after(controls);
  }
  for (const id of ['user-popover', 'modal-user-profile', 'modal-settings', 'image-viewer']) mountStageOverlay(document.getElementById(id));
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    document.body.classList.remove('stage-fullscreen');
    document.querySelectorAll('.stage-fullscreen-tile').forEach((el) => el.classList.remove('stage-fullscreen-tile'));
    screen.orientation?.unlock?.();
    window.TeletelaAndroid?.setFullscreen?.(false);
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('stage-fullscreen') && !document.fullscreenElement) {
    exitStageFullscreen();
  }
});

function toggleStageFullscreen(customTarget = null) {
  if (isStageFullscreen()) {
    exitStageFullscreen();
    return;
  }
  const fallbackId = appState.activeStreams.has(appState.expandedStreamUserId)
    ? appState.expandedStreamUserId
    : appState.activeStreams.has(appState.focusedStreamUserId)
      ? appState.focusedStreamUserId
      : appState.activeStreams.keys().next().value;
  // Mosaico: todas as telas juntas; uma aberta: só ela
  const target = (customTarget instanceof HTMLElement ? customTarget : null) || (isMosaicView()
    ? $('#videos-grid')
    : document.getElementById(`video-tile-${fallbackId}`));
  if (!target || !appState.activeStreams.size) {
    showToast('Nenhuma transmissão pra colocar em tela cheia.');
    return;
  }
  if (appState.textView) { closeTextView(); setMobileView('sala'); }
  document.querySelectorAll('.stage-fullscreen-tile').forEach((el) => el.classList.remove('stage-fullscreen-tile'));
  if (target.classList.contains('video-tile')) target.classList.add('stage-fullscreen-tile');
  document.body.classList.add('stage-fullscreen');
  window.TeletelaAndroid?.setFullscreen?.(true);
  screen.orientation?.lock?.('landscape').catch(() => {});
  const req = target.requestFullscreen || target.webkitRequestFullscreen;
  if (typeof req === 'function') {
    Promise.resolve(req.call(target)).catch(() => {
      // Sem Fullscreen API nativa: mantém o modo de tela cheia em CSS (stage-fullscreen)
    });
  }
}

// Janela flutuante (picture-in-picture): a transmissão aberta continua visível por cima
// do jogo ou de outro programa. No mosaico vai a que está em foco.
async function toggleStagePip() {
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => {});
    return;
  }
  const userId = appState.activeStreams.has(appState.expandedStreamUserId)
    ? appState.expandedStreamUserId
    : appState.activeStreams.has(appState.focusedStreamUserId)
      ? appState.focusedStreamUserId
      : appState.activeStreams.keys().next().value;
  const video = userId && document.getElementById(`video-el-${userId}`);
  if (!video) {
    showToast('Nenhuma transmissão pra abrir na janela flutuante.');
    return;
  }
  if (!document.pictureInPictureEnabled) {
    showToast('❌ Janela flutuante não disponível aqui.', 'error');
    return;
  }
  try {
    await video.requestPictureInPicture();
  } catch (err) {
    console.warn('[Stage] Janela flutuante recusada:', err);
    showToast('❌ Não consegui abrir a janela flutuante.', 'error');
  }
}

// -----------------------------------------------------------------------------
// 8b. VOLUME POR PESSOA (só pra você)
// Salvo pelo id do perfil do amigo, então vale em qualquer sala e qualquer link.
// -----------------------------------------------------------------------------
// Pessoas da call em ordem alfabética (sem diferenciar maiúscula nem acento)
const NAME_COLLATOR = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
function sortedUsers(ch) {
  return [...ch.users.values()].sort((a, b) => NAME_COLLATOR.compare(a.name || '', b.name || ''));
}

function findUser(userId) {
  for (const ch of appState.channels.values()) {
    const u = ch.users.get(userId);
    if (u) return u;
  }
  return null;
}

// O relógio muda só o texto; não reconstrói fotos, canais nem conexões de mídia.
const GAME_SVG = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7h12a3 3 0 0 1 3 2.5l1 8a2 2 0 0 1-3.4 1.7L16 16H8l-2.6 3.2A2 2 0 0 1 2 17.5l1-8A3 3 0 0 1 6 7zM7 10v4M5 12h4M16 11h.01M19 13h.01"/></svg>';
let localGameActivity = null;
let publishedGameActivity;
let gamePollTimer;
let gamePollRun = 0;

function formatCallClock(startedAt, now = Date.now()) {
  const start = Number(startedAt);
  if (!Number.isFinite(start) || start <= 0) return '00:00';
  const totalSec = Math.max(0, Math.floor((now - start) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function userCallTimerHtml(user) {
  const start = Number(user?.voiceJoinedAt || user?.joinedAt || Date.now());
  return `<span class="user-call-timer" data-call-timer="${start}" title="Tempo na call">${formatCallClock(start)}</span>`;
}

function userGameBadgeHtml(user) {
  const activity = user.id === appState.myId ? localGameActivity : user.activity;
  return `<span class="indicator-icon game-activity-badge${activity ? '' : ' hidden'}" data-activity-badge-user="${escapeHtml(user.id)}" title="Jogando — clique para ver no perfil">${GAME_SVG}</span>`;
}

function activityContent(activity) {
  if (!activity) return '';
  return `${GAME_SVG}<span class="activity-game-name"><span class="activity-game-prefix">Jogando </span>${escapeHtml(activity.name)}</span><span class="activity-time" data-activity-start="${Number(activity.startedAt)}">· ${activityElapsed(activity.startedAt)}</span>`;
}

function userActivityHtml(user) {
  const activity = user.id === appState.myId ? localGameActivity : user.activity;
  return `<span class="game-activity${activity ? '' : ' hidden'}" data-activity-user="${escapeHtml(user.id)}" title="${activity ? escapeHtml(`Jogando ${activity.name}`) : ''}">${activityContent(activity)}</span>`;
}

function renderUserActivity(userId, activity) {
  for (const el of $$('[data-activity-user]')) {
    if (el.dataset.activityUser !== userId) continue;
    el.classList.toggle('hidden', !activity);
    el.innerHTML = activityContent(activity);
    el.title = activity ? `Jogando ${activity.name}` : '';
  }
  for (const el of $$('[data-activity-badge-user]')) {
    if (el.dataset.activityBadgeUser !== userId) continue;
    el.classList.toggle('hidden', !activity);
  }
}

function publishGameActivity(force = false) {
  if (!window.electronAPI?.getGameActivity || !socket.connected) return;
  const activity = prefs.shareGameActivity === false ? null : localGameActivity;
  const signature = JSON.stringify(activity);
  if (!force && signature === publishedGameActivity) return;
  publishedGameActivity = signature;
  socket.emit('update-activity', activity);
}

function showGameActivity(activity) {
  localGameActivity = activity;
  appState.myUser.activity = activity;
  renderUserActivity(appState.myId, activity);
  const status = $('#game-activity-status');
  if (status) {
    status.textContent = prefs.shareGameActivity === false ? 'Compartilhamento desligado.'
      : activity ? `Jogando ${activity.name} · ${activityElapsed(activity.startedAt)}` : 'Nenhum jogo reconhecido aberto.';
  }
  publishGameActivity();
}

async function pollGameActivity() {
  clearTimeout(gamePollTimer);
  const run = ++gamePollRun;
  if (!window.electronAPI?.getGameActivity || prefs.shareGameActivity === false) {
    showGameActivity(null);
    return;
  }
  try {
    const result = await window.electronAPI.getGameActivity();
    if (run !== gamePollRun) return;
    showGameActivity(result.activity);
    if (result.error) $('#game-activity-status').textContent = result.error;
  } catch {
    if (run !== gamePollRun) return;
    showGameActivity(null);
    $('#game-activity-status').textContent = 'Não consegui detectar os jogos neste PC.';
  }
  if (run === gamePollRun) gamePollTimer = setTimeout(pollGameActivity, 15000);
}

function setupGameActivity() {
  const supported = window.electronAPI?.getGameActivity && ['linux', 'win32'].includes(window.electronAPI.platform);
  const check = $('#check-game-activity');
  const form = $('#form-custom-game');
  check.checked = prefs.shareGameActivity !== false;
  check.disabled = !supported;
  form.querySelectorAll('input, button').forEach((el) => { el.disabled = !supported; });
  if (!supported) $('#game-activity-status').textContent = 'A detecção de jogos está disponível no app para Windows e Linux. Pelo navegador você pode ver a atividade dos amigos.';
  check.addEventListener('change', async () => {
    // Esconde imediatamente, mesmo se uma detecção anterior ainda estiver terminando.
    ++gamePollRun;
    clearTimeout(gamePollTimer);
    if (!check.checked) showGameActivity(null);
    await savePrefs({ shareGameActivity: check.checked });
    pollGameActivity();
  });
  const renderCustomGames = () => {
    const games = Array.isArray(prefs.customGames) ? prefs.customGames : [];
    $('#custom-games-list').innerHTML = games.map((g, i) => `<li><span><strong>${escapeHtml(g.name)}</strong><small>${escapeHtml(g.executable)}</small></span><button type="button" class="btn-secondary" data-remove-game="${i}" aria-label="Remover ${escapeHtml(g.name)}">Remover</button></li>`).join('');
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#input-game-name').value.trim();
    const executable = $('#input-game-executable').value.trim().toLowerCase();
    if (!name || !/^[\p{L}\p{N}_. ()-]{1,100}$/u.test(executable)) {
      showToast('Informe o nome e só o nome do executável, por exemplo: meu-jogo.exe.', 'error');
      return;
    }
    const games = Array.isArray(prefs.customGames) ? prefs.customGames : [];
    const existing = games.findIndex((g) => g.executable === executable);
    if (existing < 0 && games.length >= 20) { showToast('Você pode cadastrar até 20 jogos.', 'error'); return; }
    const customGames = games.filter((g) => g.executable !== executable).concat({ name, executable });
    await savePrefs({ customGames });
    form.reset();
    renderCustomGames();
    pollGameActivity();
  });
  $('#custom-games-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-remove-game]');
    if (!button) return;
    await savePrefs({ customGames: prefs.customGames.filter((_, i) => i !== Number(button.dataset.removeGame)) });
    renderCustomGames();
    pollGameActivity();
  });
  renderCustomGames();
  if (supported) pollGameActivity();
  setInterval(() => {
    for (const el of $$('[data-activity-start]')) el.textContent = `· ${activityElapsed(Number(el.dataset.activityStart))}`;
  }, 15000);
  setInterval(() => {
    if (document.hidden) return;
    const now = Date.now();
    for (const el of $$('[data-call-timer]')) {
      const prefix = el.classList.contains('lounge-call-timer') ? '⏱ ' : '';
      el.textContent = `${prefix}${formatCallClock(Number(el.dataset.callTimer), now)}`;
    }
  }, 1000);
}

function volumeKey(u) {
  if (u?.profileId) return u.profileId;
  return u?.name ? `name:${u.name}` : null;
}

function getVolumePref(u) {
  const saved = (prefs.volumes || {})[volumeKey(u)];
  return { volume: saved?.volume ?? 100, muted: Boolean(saved?.muted) };
}

function setVolumePref(userId, patch) {
  const u = findUser(userId);
  const key = volumeKey(u);
  if (!key) return;
  const volumes = { ...(prefs.volumes || {}) };
  const next = { ...getVolumePref(u), ...patch };
  if (next.volume === 100 && !next.muted) delete volumes[key];
  else volumes[key] = next;
  savePrefs({ volumes });
  applyUserVolume(userId);
}

function applyUserVolume(userId) {
  const u = findUser(userId);
  if (!u) return;
  const { volume, muted } = getVolumePref(u);
  // Mutado (por ele ou pela moderação): ninguém ouve, mesmo que o app dele insista em mandar a
  // voz (ex: app antigo que não desliga o mic quando o admin muta)
  appState.setUserVolume(userId, muted || u.serverMuted || u.serverDeafened || u.isMicOn === false ? 0 : volume);
}

let popoverUserId = null;

function mountStageOverlay(element) {
  const host = document.fullscreenElement || document.webkitFullscreenElement || document.body;
  if (element && host !== element && element.parentElement !== host) host.appendChild(element);
}

function openUserPopover(userId, anchorEvent) {
  const u = findUser(userId);
  const pop = $('#user-popover');
  if (!u || !pop) return;
  mountStageOverlay(pop);
  popoverUserId = userId;
  const isMe = userId === appState.myId;
  const shown = isMe ? { ...u, ...myProfile, id: userId } : u;

  const avatar = $('#user-popover-avatar');
  avatar.style.backgroundColor = safeColor(shown.color);
  avatar.innerHTML = avatarInnerHtml(isMe ? { ...u, name: shown.name } : u);
  $('#user-popover-name').textContent = shown.name;
  applyNameStyle($('#user-popover-name'), shown);
  applyFrame(avatar, shown);
  const banner = $('#user-popover-banner');
  renderBanner(banner, shown);
  $('#user-popover-bio').textContent = shown.bio || '';
  $('#user-popover-roles').innerHTML = roleBadges(u);
  $('#user-popover-activity').innerHTML = userActivityHtml(u);
  pop.setAttribute('aria-label', isMe ? 'Seu perfil' : 'Perfil do amigo');
  $('#user-popover-volume-label')?.classList.toggle('hidden', isMe);
  $('#user-popover-volume-row')?.classList.toggle('hidden', isMe);
  $('#user-popover-actions')?.classList.toggle('hidden', isMe);
  $('#user-popover-reconnect')?.classList.toggle('hidden', isMe);
  $('#user-popover-edit-self')?.classList.toggle('hidden', !isMe);
  $('#user-popover-nickname').classList.toggle('hidden', !isMe || !appState.currentChannelId);
  if (!isMe) renderUserPopoverVolume();
  $('#user-popover-kick')?.classList.toggle('hidden', isMe || !hasPermission(appState, 'kickMembers') || !u.channelId);
  const adminRow = $('#user-popover-admin');
  adminRow?.classList.toggle('hidden', isMe || !['kickMembers', 'muteMembers', 'deafenMembers'].some(p => hasPermission(appState, p)));
  $('#user-popover-server-mute')?.classList.toggle('hidden', isMe || !hasPermission(appState, 'muteMembers'));
  $('#user-popover-server-deafen')?.classList.toggle('hidden', isMe || !hasPermission(appState, 'deafenMembers'));
  const muteAll = $('#user-popover-server-mute');
  if (muteAll) muteAll.innerHTML = u.serverMuted ? `${MIC_ON_SVG} Desmutar pra todos` : `${MIC_OFF_SVG} Mutar pra todos`;
  const deafAll = $('#user-popover-server-deafen');
  if (deafAll) deafAll.innerHTML = u.serverDeafened ? `${HEADPHONES_ON_SVG} Tirar o ensurdecer` : `${HEADPHONES_OFF_SVG} Ensurdecer pra todos`;

  pop.classList.remove('hidden');
  // Abre ao lado do clique, sem sair da janela
  const rect = pop.getBoundingClientRect();
  const x = Math.min(anchorEvent.clientX + 8, window.innerWidth - rect.width - 8);
  const y = Math.min(anchorEvent.clientY + 8, window.innerHeight - rect.height - 8);
  pop.style.left = `${Math.max(8, x)}px`;
  pop.style.top = `${Math.max(8, y)}px`;
}

function renderUserPopoverVolume() {
  const u = findUser(popoverUserId);
  if (!u) return;
  const { volume, muted } = getVolumePref(u);
  $('#user-popover-volume').value = String(volume);
  $('#user-popover-volume-text').textContent = `${volume}%`;
  const muteBtn = $('#user-popover-mute');
  muteBtn.classList.toggle('active', muted);
  muteBtn.innerHTML = `${SPEAKER_OFF_SVG} ${muted ? 'Silenciado' : 'Silenciar pra mim'}`;
}

// Perfil grande no meio da tela: banner, foto com moldura, nome e bio
function ownershipBadge(u) {
  return u.isOwner === true ? ''
    : u.isAdmin ? '<span class="badge-admin" title="Admin no servidor antigo">🛡️</span>' : '';
}

function roleBadges(u) {
  return (u.isOwner === true ? '<span class="badge-role">Dono do servidor</span>' : u.isAdmin ? '<span class="badge-role">Admin no servidor antigo</span>' : '') + (u.roles || []).map(role => `<span class="badge-role">${escapeHtml(role.name)}</span>`).join('');
}

function openProfileCard(userId) {
  const u = findUser(userId);
  if (!u) return;
  mountStageOverlay($('#modal-user-profile'));
  closeUserPopover();
  const isMe = userId === appState.myId;
  const shown = isMe ? { ...u, ...myProfile, id: userId } : u;
  renderBanner($('#profile-card-banner'), shown);
  const avatar = $('#profile-card-avatar');
  avatar.style.backgroundColor = safeColor(shown.color);
  avatar.innerHTML = avatarInnerHtml(isMe ? { id: userId, name: shown.name } : u);
  avatar.classList.toggle('has-photo', Boolean(avatar.querySelector('img')));
  applyFrame(avatar, shown);
  const name = $('#profile-card-name');
  name.textContent = shown.name;
  applyNameStyle(name, shown);
  $('#profile-card-badges').innerHTML = `${ownershipBadge(u)}${isMe ? ' <span class="badge-self">(você)</span>' : ''}`;
  $('#profile-card-bio').textContent = shown.bio || '';
  $('#profile-card-roles').innerHTML = roleBadges(u);
  $('#profile-card-activity').innerHTML = userActivityHtml(u);
  const ch = appState.channels.get(u.channelId);
  $('#profile-card-meta').textContent = ch ? `🔊 Na call: ${ch.name}` : '';
  $('#profile-card-nickname').classList.toggle('hidden', !isMe || !appState.currentChannelId);
  $('#modal-user-profile').classList.remove('hidden');
}

function closeUserPopover() {
  $('#user-popover')?.classList.add('hidden');
  popoverUserId = null;
}

function setupUserPopover() {
  const pop = $('#user-popover');
  if (!pop) return;

  $('#user-popover-volume').addEventListener('input', (e) => {
    if (!popoverUserId) return;
    setVolumePref(popoverUserId, { volume: Number(e.target.value) });
    renderUserPopoverVolume();
  });
  $('#user-popover-mute').addEventListener('click', () => {
    const u = findUser(popoverUserId);
    if (!u) return;
    setVolumePref(popoverUserId, { muted: !getVolumePref(u).muted });
    renderUserPopoverVolume();
    renderChannelsTree();
    updateVoiceLounge();
  });
  $('#user-popover-reset').addEventListener('click', () => {
    if (!popoverUserId) return;
    setVolumePref(popoverUserId, { volume: 100, muted: false });
    renderUserPopoverVolume();
    renderChannelsTree();
    updateVoiceLounge();
  });

  const moderate = (event, field, done) => {
    const u = findUser(popoverUserId);
    if (!u) return;
    const on = !u[field];
    socket.emit(event, { userId: u.id, on }, (res) => {
      if (res?.success) showToast(done(u.name, on), 'success');
      else showToast(`❌ ${res?.error || 'Não deu certo.'}`, 'error');
    });
    closeUserPopover();
  };
  $('#user-popover-server-mute')?.addEventListener('click', () =>
    moderate('admin-mute-user', 'serverMuted', (name, on) => (on ? `🔇 ${name} está mutado pra todos.` : `🎙️ ${name} pode falar de novo.`)));
  $('#user-popover-server-deafen')?.addEventListener('click', () =>
    moderate('admin-deafen-user', 'serverDeafened', (name, on) => (on ? `🎧 ${name} está ensurdecido.` : `🎧 ${name} voltou a ouvir.`)));

  $('#user-popover-kick')?.addEventListener('click', () => {
    const u = findUser(popoverUserId);
    if (!u) return;
    closeUserPopover();
    if (!window.confirm(`Tirar ${u.name} da call?`)) return;
    socket.emit('kick-user', { userId: u.id }, (res) => {
      if (res?.success) showToast(`🚪 ${u.name} saiu da call.`, 'success');
      else showToast(`❌ ${res?.error || 'Não deu pra tirar da call.'}`, 'error');
    });
  });

  $('#user-popover-reconnect')?.addEventListener('click', () => {
    if (!popoverUserId) return;
    reconnectVoice(popoverUserId);
    showToast('🔄 Reconectando a voz...');
    closeUserPopover();
  });

  $('#user-popover-edit-self')?.addEventListener('click', () => {
    openProfileSettings();
  });

  document.addEventListener('mousedown', (e) => {
    if (popoverUserId && !pop.contains(e.target)) closeUserPopover();
  }, true);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popoverUserId) closeUserPopover();
  });
}

// -----------------------------------------------------------------------------
// 8c. PERFIL (nome, cor, bio, foto) — salvo no app, mandado pra sala ao entrar
// -----------------------------------------------------------------------------
let profileDraft = null;

function resetProfileDraft() {
  ++imageCropRequest;
  profileDraft = { ...myProfile };
  $('#input-profile-name').value = profileDraft.name;
  $('#input-profile-bio').value = profileDraft.bio;
  const roleSelect = $('#profile-display-role');
  roleSelect.innerHTML = '<option value="">Ocultar ao lado do nome</option>' + (appState.permissionRoles || []).map(role => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.name)}</option>`).join('');
  roleSelect.value = profileDraft.displayRoleId || '';
  renderProfileDraft();
}

function openProfileSettings() {
  closeUserPopover();
  openSettings('perfil');
  $('#input-profile-name').focus();
}

function isProfileEditorOpen() {
  return !$('#modal-settings').classList.contains('hidden')
    && !$('.settings-section[data-settings-section="perfil"]').classList.contains('hidden');
}

// Linha de bolinhas de cor (+ "Normal"/"Nenhuma" quando dá pra deixar sem, + cor livre)
function renderColorRow(container, colors, current, onPick, emptyLabel = '') {
  if (!container) return;
  container.innerHTML = '';
  const cur = (current || '').toLowerCase();
  if (emptyLabel) {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = `btn-secondary profile-name-color-reset ${cur ? '' : 'selected'}`;
    reset.textContent = emptyLabel;
    reset.addEventListener('click', () => onPick(''));
    container.appendChild(reset);
  }
  for (const color of colors) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = `profile-color-swatch ${color.toLowerCase() === cur ? 'selected' : ''}`;
    swatch.style.backgroundColor = color;
    swatch.title = color;
    swatch.addEventListener('click', () => onPick(color));
    container.appendChild(swatch);
  }
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.className = 'profile-color-custom';
  custom.title = 'Outra cor';
  custom.value = safeColor(current);
  custom.addEventListener('change', () => onPick(custom.value));
  container.appendChild(custom);
}

const BANNER_COLORS = ['#5865F2', '#7C3AED', '#EB459E', '#ED4245', '#F47B67', '#FEE75C', '#57F287', '#1ABC9C', '#111214'];

function renderProfileDraft() {
  const pick = (key) => (value) => {
    profileDraft[key] = value;
    renderProfileDraft();
  };
  const preview = $('#profile-avatar-preview');
  preview.style.backgroundColor = safeColor(profileDraft.color);
  preview.innerHTML = profileDraft.avatar
    ? avatarPhotoHtml(profileDraft.avatar, avatarInitials($('#input-profile-name').value || profileDraft.name), profileDraft.avatarCrop)
    : `<span>${avatarInitials($('#input-profile-name').value || profileDraft.name)}</span>`;
  applyFrame(preview, { ...profileDraft, id: null });
  $('#btn-profile-remove-avatar').classList.toggle('hidden', !profileDraft.avatar);
  const bannerPreview = $('#profile-banner-preview');
  renderBanner(bannerPreview, profileDraft);
  $('#btn-profile-adjust-avatar')?.classList.toggle('hidden', !profileDraft.avatar);
  $('#btn-profile-adjust-banner')?.classList.toggle('hidden', !profileDraft.banner);
  $('#btn-profile-remove-banner')?.classList.toggle('hidden', !profileDraft.banner);
  $('#btn-profile-remove-sound')?.classList.toggle('hidden', !profileDraft.joinSound);
  $('#btn-profile-play-sound')?.classList.toggle('hidden', !profileDraft.joinSound);
  const soundStatus = $('#profile-sound-status');
  if (soundStatus) soundStatus.textContent = profileDraft.joinSound ? 'Som de entrada escolhido.' : 'Sem som próprio: toca um dos áudios dos amigos.';

  renderColorRow($('#profile-colors'), PROFILE_COLORS, profileDraft.color, pick('color'));
  renderColorRow($('#profile-name-colors'), NAME_COLORS, profileDraft.nameColor, pick('nameColor'), 'Normal');
  renderColorRow($('#profile-name-colors2'), NAME_COLORS, profileDraft.nameColor2, pick('nameColor2'), 'Nenhuma');
  $('#profile-name-colors2')?.classList.toggle('disabled', !profileDraft.nameColor);
  renderColorRow($('#profile-banner-colors'), BANNER_COLORS, profileDraft.bannerColor, pick('bannerColor'), 'Cor do avatar');

  // Molduras: cada opção mostra uma bolinha com a moldura
  const frames = $('#profile-frames');
  if (frames) {
    frames.innerHTML = '';
    for (const f of FRAME_PRESETS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `profile-frame-option ${(profileDraft.frame || '') === f.id ? 'selected' : ''}`;
      const sample = { frame: f.id, frameColor: profileDraft.frameColor || profileDraft.nameColor || profileDraft.color };
      btn.innerHTML = `<span class="profile-frame-sample user-avatar${frameClass(sample)}" style="background-color: ${safeColor(profileDraft.color)};${frameStyle(sample)}"></span><span>${f.label}</span>`;
      btn.addEventListener('click', () => {
        profileDraft.frame = f.id;
        if (f.id === 'cor' && !profileDraft.frameColor) profileDraft.frameColor = sample.frameColor;
        renderProfileDraft();
      });
      frames.appendChild(btn);
    }
    if (profileDraft.frame === 'cor') {
      const custom = document.createElement('input');
      custom.type = 'color';
      custom.className = 'profile-color-custom';
      custom.title = 'Cor da moldura';
      custom.value = safeColor(profileDraft.frameColor);
      custom.addEventListener('change', () => pick('frameColor')(custom.value));
      frames.appendChild(custom);
    }
  }

  $('#profile-bio-preview').textContent = $('#input-profile-bio').value.trim();
  const namePreview = $('#profile-name-preview');
  if (namePreview) {
    namePreview.textContent = $('#input-profile-name').value || profileDraft.name;
    applyNameStyle(namePreview, profileDraft);
  }
}

// Mantém a imagem inteira para permitir reenquadrar depois. GIF nunca passa pelo canvas.
async function prepareProfileImage(file, kind) {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
    throw new Error('Use uma imagem PNG, JPEG, WebP ou GIF.');
  }
  if (file.type === 'image/gif' && file.size > 10 * 1024 * 1024) {
    throw new Error('GIF muito grande: o máximo é 10 MB.');
  }
  const data = await readAsDataUrl(file);
  if (file.type === 'image/gif') return data;
  const img = await loadProfileImage(data);
  const canvas = document.createElement('canvas');
  const maxSide = kind === 'avatar' ? 1024 : 1800;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const limit = kind === 'avatar' ? 200 * 1024 : 1024 * 1024;
  // Texturas difíceis de comprimir também precisam caber no limite do servidor.
  for (let attempt = 0; attempt < 8; attempt++) {
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/webp', Math.max(0.5, 0.88 - attempt * 0.06));
    if (result.length * 3 / 4 <= limit) return result;
    canvas.width = Math.max(1, Math.round(canvas.width * 0.8));
    canvas.height = Math.max(1, Math.round(canvas.height * 0.8));
  }
  throw new Error('Não consegui reduzir essa imagem. Tente uma imagem menor.');
}

function loadProfileImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não consegui abrir essa imagem.'));
    img.src = src;
  });
}

let imageCropEditor = null;
let imageCropRequest = 0;

async function editProfileImage(kind, file = null) {
  const draft = profileDraft;
  if (!draft) return;
  const request = ++imageCropRequest;
  const returnFocus = document.activeElement;
  try {
    const data = file ? await prepareProfileImage(file, kind) : draft[kind];
    if (!data) return;
    const img = await loadProfileImage(data);
    if (request !== imageCropRequest || draft !== profileDraft || !isProfileEditorOpen()) return;
    imageCropEditor = {
      kind, data, img, draft, returnFocus,
      crop: normalizeImageCrop(file ? null : draft[`${kind}Crop`])
    };
    $('#image-crop-title').textContent = kind === 'avatar' ? 'Ajustar foto de perfil' : 'Ajustar banner';
    $('#image-crop-preview').classList.toggle('crop-avatar', kind === 'avatar');
    $('#modal-image-crop').classList.remove('hidden');
    renderImageCrop();
    $('#input-image-crop-zoom').focus();
  } catch (err) {
    if (request === imageCropRequest) showToast(`❌ ${err.message || 'Não consegui abrir essa imagem.'}`, 'error');
  }
}

function renderImageCrop() {
  if (!imageCropEditor) return;
  const { crop, data } = imageCropEditor;
  const preview = $('#image-crop-preview');
  let img = preview.querySelector('img');
  if (!img) { img = new Image(); img.alt = ''; img.draggable = false; preview.appendChild(img); }
  if (img.getAttribute('src') !== data) img.src = data;
  img.style.cssText = imageCropStyle(crop);
  for (const field of ['zoom', 'x', 'y']) {
    const value = Math.round(crop[field] * 100);
    $(`#input-image-crop-${field}`).value = value;
    $(`#image-crop-${field}-value`).textContent = `${value}%`;
  }
}

function closeImageCrop(save = false) {
  ++imageCropRequest;
  const editor = imageCropEditor;
  if (save && editor && editor.draft === profileDraft) {
    profileDraft[editor.kind] = editor.data;
    profileDraft[`${editor.kind}Crop`] = { ...editor.crop };
    renderProfileDraft();
  }
  imageCropEditor = null;
  $('#modal-image-crop').classList.add('hidden');
  $('#image-crop-preview').replaceChildren();
  editor?.returnFocus?.focus();
}

function setupImageCrop() {
  for (const field of ['zoom', 'x', 'y']) {
    $(`#input-image-crop-${field}`).addEventListener('input', (e) => {
      if (!imageCropEditor) return;
      imageCropEditor.crop[field] = Number(e.target.value) / 100;
      renderImageCrop();
    });
  }
  $('#btn-image-crop-save').addEventListener('click', () => closeImageCrop(true));
  $('#btn-image-crop-cancel').addEventListener('click', () => closeImageCrop());
  $('#btn-image-crop-reset').addEventListener('click', () => {
    if (!imageCropEditor) return;
    imageCropEditor.crop = normalizeImageCrop();
    renderImageCrop();
  });
  const modal = $('#modal-image-crop');
  modal.addEventListener('click', (e) => { if (e.target === modal) closeImageCrop(); });
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeImageCrop(); }
    if (e.key === 'Tab') {
      const controls = [...modal.querySelectorAll('button, input')];
      if (e.shiftKey && document.activeElement === controls[0]) {
        e.preventDefault(); controls.at(-1).focus();
      } else if (!e.shiftKey && document.activeElement === controls.at(-1)) {
        e.preventDefault(); controls[0].focus();
      }
    }
  });
  const preview = $('#image-crop-preview');
  let drag = null;
  preview.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !imageCropEditor) return;
    e.preventDefault();
    drag = { x: e.clientX, y: e.clientY };
    preview.setPointerCapture(e.pointerId);
  });
  preview.addEventListener('pointermove', (e) => {
    if (!drag || !imageCropEditor) return;
    const { img, crop } = imageCropEditor;
    const bounds = preview.getBoundingClientRect();
    const rect = imageCropRect(img.naturalWidth, img.naturalHeight, bounds.width / bounds.height, crop);
    const extraX = img.naturalWidth / rect.width * bounds.width - bounds.width;
    const extraY = img.naturalHeight / rect.height * bounds.height - bounds.height;
    if (extraX > 0.01) crop.x -= (e.clientX - drag.x) / extraX;
    if (extraY > 0.01) crop.y -= (e.clientY - drag.y) / extraY;
    imageCropEditor.crop = normalizeImageCrop(crop);
    drag = { x: e.clientX, y: e.clientY };
    renderImageCrop();
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    preview.addEventListener(event, () => { drag = null; });
  }
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Som de entrada: curtinho e leve, porque vai pra todo mundo da sala
const MAX_JOIN_SOUND_BYTES = 1024 * 1024;
const MAX_JOIN_SOUND_SECONDS = 5.5;
async function readJoinSound(file) {
  if (file.size > MAX_JOIN_SOUND_BYTES) throw new Error('Áudio grande demais: o máximo é 1 MB (corte ou use .ogg/.mp3).');
  const dataUrl = await readAsDataUrl(file);
  if (!/^data:audio\/(ogg|mpeg|mp3|wav|x-wav|webm|mp4|x-m4a|aac);base64,/i.test(dataUrl)) {
    throw new Error('Esse formato não serve: use .ogg, .mp3, .wav ou .m4a.');
  }
  const ctx = appState.mixerManager?.audioContext;
  if (ctx) {
    let buffer;
    try {
      buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    } catch {
      throw new Error('Não consegui tocar esse áudio.');
    }
    if (buffer.duration > MAX_JOIN_SOUND_SECONDS) throw new Error(`Áudio longo demais (${buffer.duration.toFixed(1)} s): o máximo é 5 s.`);
  }
  return dataUrl;
}

function setupProfileSettings() {
  $$('[data-profile-file]').forEach((button) => {
    button.addEventListener('click', () => document.getElementById(button.dataset.profileFile)?.click());
  });
  $('#btn-profile-reset').addEventListener('click', resetProfileDraft);
  $('#user-profile')?.addEventListener('click', openProfileSettings);
  $('#user-profile')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openProfileSettings();
    }
  });

  for (const field of ['name', 'bio']) {
    $(`#input-profile-${field}`).addEventListener('input', () => {
      if (profileDraft) renderProfileDraft();
    });
  }

  for (const kind of ['avatar', 'banner']) {
    $(`#input-profile-${kind}`)?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) editProfileImage(kind, file);
    });
    $(`#btn-profile-adjust-${kind}`).addEventListener('click', () => editProfileImage(kind));
    $(`#btn-profile-remove-${kind}`).addEventListener('click', () => {
      if (!profileDraft) return;
      ++imageCropRequest;
      profileDraft[kind] = '';
      profileDraft[`${kind}Crop`] = normalizeImageCrop();
      renderProfileDraft();
    });
  }

  $('#input-profile-sound')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !profileDraft) return;
    try {
      const draft = profileDraft;
      const sound = await readJoinSound(file);
      if (draft !== profileDraft || !isProfileEditorOpen()) return;
      draft.joinSound = sound;
      renderProfileDraft();
      playCallSound(0, sound, { force: true });
    } catch (err) {
      showToast(`❌ ${err.message || 'Não consegui abrir esse áudio.'}`, 'error');
    }
  });
  $('#btn-profile-play-sound')?.addEventListener('click', () => {
    if (profileDraft?.joinSound) playCallSound(0, profileDraft.joinSound, { force: true });
  });
  $('#btn-profile-remove-sound')?.addEventListener('click', () => {
    if (!profileDraft) return;
    profileDraft.joinSound = '';
    renderProfileDraft();
  });

  let profileSaving = false;
  $('#form-profile')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#input-profile-name').value.trim().slice(0, 24);
    if (!name || !profileDraft || profileSaving) return;
    if (accountSession(prefs, SERVER_URL) && !accountUI.ready) return showToast('Espere seu perfil da conta carregar.', 'error');
    const draft = { ...myProfile, ...profileDraft, name,
      bio: $('#input-profile-bio').value.trim().slice(0, 140), displayRoleId: $('#profile-display-role').value };
    profileSaving = true;
    $('#btn-profile-save').disabled = true;
    try {
      const session = accountSession(prefs, SERVER_URL);
      if (session) {
        if (!socket.connected) throw new Error('Espere a conexão voltar para salvar o perfil na conta.');
        const result = await socket.timeout(20000).emitWithAck('update-profile', { ...draft, profileId: draft.id });
        if (!result?.success) throw new Error(result?.error || 'Não deu para guardar o perfil na conta.');
        const currentSession = accountSession(prefs, SERVER_URL);
        if (!currentSession || currentSession.token !== session.token) throw new Error('Sua sessão mudou. Abra o perfil de novo.');
        if (await savePrefs({ accountSessions: { ...prefs.accountSessions,
          [SERVER_URL]: { ...currentSession, profile: accountProfileSnapshot(draft) } } }) === false) {
          throw new Error('Perfil guardado no servidor, mas não deu para salvar neste aparelho.');
        }
      } else {
        if (await savePrefs({ profile: draft }) === false) throw new Error('Não deu para salvar o perfil neste aparelho.');
        socket.emit('update-profile', { ...draft, profileId: draft.id });
      }
      Object.assign(myProfile, draft);
      appState.myUser.name = myProfile.name;
      appState.myUser.color = myProfile.color;
      updateUserDockProfile(); renderChannelsTree(); updateVoiceLounge();
      document.activeElement?.blur(); resetProfileDraft();
      showToast('Perfil salvo!', 'success');
    } catch (err) { showToast(err.message || 'Não deu para salvar. Tente de novo.', 'error'); }
    finally { profileSaving = false; $('#btn-profile-save').disabled = false; }
  });
}

// -----------------------------------------------------------------------------
// 8d. ATALHOS DE TECLADO (mutar / ensurdecer)
// Guardados no formato de accelerator do Electron ("Ctrl+Shift+M", "F9", "M"),
// o mesmo usado pra registrar o atalho global no app desktop.
// -----------------------------------------------------------------------------
const DEFAULT_HOTKEYS = { mute: 'M', deafen: 'D' };
const hotkeys = { ...DEFAULT_HOTKEYS, ...(prefs.hotkeys || {}) };
let hotkeysGlobal = prefs.hotkeysGlobal !== false;
let hotkeyCapture = null; // ação esperando a tecla nova
const lastHotkeyAt = {};

const HOTKEY_KEY_NAMES = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Insert: 'Insert', Delete: 'Delete',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Pause: 'Pause', ScrollLock: 'Scrolllock',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv', NumpadDecimal: 'numdec', NumpadEnter: 'Enter',
  Backspace: 'Backspace', CapsLock: 'Capslock', NumLock: 'Numlock', PrintScreen: 'PrintScreen',
  IntlBackslash: '\\', IntlRo: '/', AudioVolumeMute: 'VolumeMute', MediaPlayPause: 'MediaPlayPause',
  MediaTrackNext: 'MediaNextTrack', MediaTrackPrevious: 'MediaPreviousTrack', MediaStop: 'MediaStop'
};

// Modificador apertado sozinho (ex: o Ctrl da direita) também vale como atalho
const SOLO_KEY_CODES = {
  ControlLeft: 'LeftCtrl', ControlRight: 'RightCtrl', ShiftLeft: 'LeftShift', ShiftRight: 'RightShift',
  AltLeft: 'LeftAlt', AltRight: 'RightAlt', MetaLeft: 'LeftSuper', MetaRight: 'RightSuper'
};
const SOLO_KEY_LABELS = {
  LeftCtrl: 'Ctrl esquerdo', RightCtrl: 'Ctrl direito', LeftShift: 'Shift esquerdo', RightShift: 'Shift direito',
  LeftAlt: 'Alt esquerdo', RightAlt: 'Alt direito (AltGr)', LeftSuper: 'Windows esquerdo', RightSuper: 'Windows direito'
};
const SOLO_KEYS = new Set(Object.values(SOLO_KEY_CODES));

function eventToAccelerator(e) {
  const code = e.code || '';
  let key = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else if (/^Numpad[0-9]$/.test(code)) key = `num${code.slice(6)}`;
  else key = HOTKEY_KEY_NAMES[code] || null;
  if (!key) return null; // só modificador, ou tecla que não dá pra usar
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');
  parts.push(key);
  return parts.join('+');
}

// Atalho global rouba a tecla de todos os programas: só combinações ou teclas que ninguém digita
function canBeGlobalHotkey(accelerator) {
  if (!accelerator) return false;
  if (SOLO_KEYS.has(accelerator)) return true; // só observado, não rouba a tecla de ninguém
  const parts = accelerator.split('+');
  const key = parts[parts.length - 1];
  return parts.some((p) => p === 'Ctrl' || p === 'Alt' || p === 'Super') ||
    /^F([1-9]|1[0-9]|2[0-4])$/.test(key) ||
    ['Pause', 'Scrolllock', 'Insert', 'Capslock', 'Numlock', 'PrintScreen', 'VolumeMute', 'MediaPlayPause',
      'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop'].includes(key);
}

function formatHotkey(accelerator) {
  if (!accelerator) return 'Nenhum';
  if (SOLO_KEY_LABELS[accelerator]) return SOLO_KEY_LABELS[accelerator];
  return accelerator
    .split('+')
    .map((p) => p.replace(/^num(\d)$/, 'Num $1').replace(/^num(add|sub|mult|div|dec)$/, (_m, k) => `Num ${{ add: '+', sub: '-', mult: '*', div: '/', dec: '.' }[k]}`))
    .join(' + ');
}

function triggerHotkey(action) {
  // O atalho global e o da janela podem disparar juntos: ignora repetição em 250 ms
  const now = Date.now();
  if (now - (lastHotkeyAt[action] || 0) < 250) return;
  lastHotkeyAt[action] = now;
  if (action === 'mute') $('#btn-toggle-mic')?.click();
  else if (action === 'deafen') $('#btn-toggle-deafen')?.click();
}

async function applyGlobalHotkeys() {
  const api = window.electronAPI;
  if (!api?.setGlobalHotkeys) return {};
  const wanted = {};
  for (const [action, accelerator] of Object.entries(hotkeys)) {
    if (hotkeysGlobal && canBeGlobalHotkey(accelerator)) wanted[action] = accelerator;
  }
  try {
    return (await api.setGlobalHotkeys(wanted)) || {};
  } catch (_) {
    return {};
  }
}

function renderHotkeys() {
  $$('[data-hotkey-action]').forEach((btn) => {
    const action = btn.getAttribute('data-hotkey-action');
    const listening = hotkeyCapture === action;
    btn.classList.toggle('listening', listening);
    btn.textContent = listening ? 'Aperte a tecla…' : formatHotkey(hotkeys[action]);
  });
  const mic = $('#btn-toggle-mic');
  if (mic) mic.title = `Mutar Microfone (${formatHotkey(hotkeys.mute)})`;
  const deafen = $('#btn-toggle-deafen');
  if (deafen) deafen.title = `Ensurdecer (Desativar Áudio) (${formatHotkey(hotkeys.deafen)})`;
}

async function saveHotkey(action, accelerator) {
  // A mesma tecla em duas ações: tira da outra
  for (const other of Object.keys(hotkeys)) {
    if (other !== action && accelerator && hotkeys[other] === accelerator) hotkeys[other] = null;
  }
  hotkeys[action] = accelerator;
  savePrefs({ hotkeys: { ...hotkeys } });
  renderHotkeys();
  const registered = await applyGlobalHotkeys();
  if (!accelerator || !window.electronAPI?.setGlobalHotkeys || !hotkeysGlobal) return;
  if (!canBeGlobalHotkey(accelerator)) {
    showToast('ℹ️ Esse atalho só funciona com o Teletela na frente. Use Ctrl/Alt + tecla ou F1–F24 pra funcionar minimizado.');
  } else if (registered[action] === false) {
    showToast('⚠️ Outro programa já usa esse atalho; ele só vai funcionar com o Teletela na frente.', 'error');
  }
}

function setupHotkeys() {
  const globalInput = $('#input-hotkey-global');
  if (!window.electronAPI?.setGlobalHotkeys) {
    $('#hotkey-global-wrap')?.classList.add('hidden');
  } else if (globalInput) {
    globalInput.checked = hotkeysGlobal;
    globalInput.addEventListener('change', () => {
      hotkeysGlobal = globalInput.checked;
      savePrefs({ hotkeysGlobal });
      applyGlobalHotkeys();
    });
    window.electronAPI.onGlobalHotkey?.((action) => triggerHotkey(action));
    applyGlobalHotkeys();
    if (window.electronAPI.isWayland) $('#hotkey-wayland-help')?.classList.remove('hidden');
  }

  $$('[data-hotkey-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      hotkeyCapture = btn.getAttribute('data-hotkey-action');
      renderHotkeys();
    });
  });

  // Captura antes de todo mundo, pra tecla nova não mutar/fechar nada.
  // Esc tira o atalho. Ctrl/Shift/Alt: se soltar sem apertar outra tecla, vale ele sozinho.
  let pendingSolo = null;
  window.addEventListener('keydown', (e) => {
    if (!hotkeyCapture) return;
    e.preventDefault();
    e.stopPropagation();
    const action = hotkeyCapture;
    if (e.key === 'Escape') {
      hotkeyCapture = null;
      pendingSolo = null;
      saveHotkey(action, null);
      return;
    }
    if (SOLO_KEY_CODES[e.code]) {
      if (!e.repeat) pendingSolo = SOLO_KEY_CODES[e.code];
      return;
    }
    pendingSolo = null;
    const accelerator = eventToAccelerator(e);
    if (!accelerator) return;
    hotkeyCapture = null;
    saveHotkey(action, accelerator);
  }, true);
  window.addEventListener('keyup', (e) => {
    if (!hotkeyCapture || !pendingSolo || SOLO_KEY_CODES[e.code] !== pendingSolo) return;
    e.preventDefault();
    const action = hotkeyCapture;
    const solo = pendingSolo;
    hotkeyCapture = null;
    pendingSolo = null;
    saveHotkey(action, solo);
  }, true);

  renderHotkeys();
}

// Ganho do microfone (Configurações): muda na hora, sem reconectar ninguém
function setupMicGain() {
  const input = $('#input-mic-gain');
  const text = $('#mic-gain-text');
  if (!input) return;
  const show = (pct) => { if (text) text.textContent = `${pct}%`; };
  input.value = String(prefs.micGain ?? 100);
  show(Number(input.value));
  input.addEventListener('input', () => {
    const pct = Number(input.value);
    prefs.micGain = pct;
    appState.micProcessor?.setGain(micGainValue());
    show(pct);
  });
  input.addEventListener('change', () => savePrefs({ micGain: Number(input.value) }));
}

// Volume geral do Telinha (Configurações): vozes e transmissões juntas, até 200%
function setupMasterVolume() {
  const input = $('#input-master-volume');
  const text = $('#master-volume-text');
  if (!input) return;
  const show = (pct) => { if (text) text.textContent = `${pct}%`; };
  input.value = String(prefs.masterVolume ?? 100);
  show(Number(input.value));
  input.addEventListener('input', () => {
    const pct = Number(input.value);
    appState.mixerManager?.setMasterVolume(pct);
    show(pct);
  });
  input.addEventListener('change', () => savePrefs({ masterVolume: Number(input.value) }));
}

// Propriedade e poderes delegados por cargo; os IDs antigos mantêm compatibilidade.
function renderAdminSettings() {
  const group = $('#admin-settings');
  if (!group) return;
  group.classList.toggle('hidden', !appState.serverHasAdmin && !appState.isAdmin);
  $('#settings-tab-admin')?.classList.remove('hidden');
  $('#admin-login-row')?.classList.toggle('hidden', appState.isAdmin);
  $('#admin-logged-row')?.classList.toggle('hidden', !appState.isAdmin);
  $('#admin-room-password')?.classList.toggle('hidden', !hasPermission(appState, 'manageServer'));
  $('#btn-admin-login').textContent = !appState.ownershipSupported ? 'Entrar como admin (antigo)' : appState.ownerClaimed ? 'Servidor já tem dono' : 'Assumir propriedade';
  $('#btn-admin-login').disabled = Boolean(appState.ownerClaimed);
  $('#btn-owner-recover').classList.toggle('hidden', !appState.ownershipSupported || !appState.ownerClaimed || appState.isOwner);
  $('#admin-logged-row .admin-status').textContent = appState.isOwner ? 'Você é o dono deste servidor.' : 'Você é admin no servidor antigo. A propriedade exige o servidor atualizado.';
  const status = $('#room-password-status');
  if (status) status.textContent = appState.roomHasPassword ? '🔒 A sala tem senha.' : '🔓 A sala está aberta (sem senha).';
  $('#btn-room-password-remove')?.classList.toggle('hidden', !appState.roomHasPassword);
}

function setupRoomPasswordAdmin() {
  const input = $('#input-room-password-new');
  const done = (msg) => (res) => {
    if (res?.success) {
      if (input) input.value = '';
      showToast(msg, 'success');
    } else {
      showToast(`❌ ${res?.error || 'Não deu.'}`, 'error');
    }
  };
  $('#btn-room-password-save')?.addEventListener('click', () => {
    const password = input?.value.trim();
    if (!password) return showToast('Digite a senha nova.');
    socket.emit('admin-set-room-password', { password }, done('🔒 Senha da sala salva. Quem já usa o app continua entrando direto.'));
  });
  $('#btn-room-password-remove')?.addEventListener('click', () => {
    if (!window.confirm('Tirar a senha da sala? Qualquer um com o endereço vai poder entrar.')) return;
    socket.emit('admin-set-room-password', { password: '' }, done('🔓 Senha da sala tirada.'));
  });
  $('#btn-room-reset-members')?.addEventListener('click', () => {
    if (!window.confirm('Quem não estiver online agora vai precisar digitar a senha da sala na próxima vez. Continuar?')) return;
    socket.emit('admin-reset-members', {}, done('Pronto: quem não está online vai precisar da senha.'));
  });
}

function setupAdminSettings() {
  setupRoomPasswordAdmin();
  const input = $('#input-admin-key');
  const loginBtn = $('#btn-admin-login');
  const login = () => {
    const key = input?.value.trim();
    if (!key) return;
    loginBtn.disabled = true;
    const finish = (res) => {
      loginBtn.disabled = false;
      if (res.success) {
        saveAdminKey('');
        input.value = '';
        showToast(appState.ownershipSupported ? '👑 Você é o dono deste servidor.' : 'Você entrou como admin no servidor antigo.', 'success');
      } else {
        showToast(`❌ ${res.error || 'Senha errada.'}`, 'error');
      }
    };
    if (appState.ownershipSupported) socket.emit('owner-claim', { key }, finish);
    else adminLogin(key, finish);
  };
  loginBtn?.addEventListener('click', login);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('#btn-owner-recover')?.addEventListener('click', () => {
    const key = input?.value.trim();
    if (!key || !window.confirm('Recuperar a propriedade para este perfil? O dono anterior perderá a propriedade.')) return;
    socket.emit('owner-recover', { key }, res => {
      if (res?.success) { input.value = ''; saveAdminKey(''); showToast('Propriedade recuperada para este perfil.', 'success'); }
      else showToast(res?.error || 'Não foi possível recuperar.', 'error');
    });
  });
  renderAdminSettings();
}

function setupThemeSelect() {
  const select = $('#select-theme');
  if (!select) return;
  select.value = document.documentElement.dataset.theme;
  select.addEventListener('change', () => {
    applyTheme(select.value);
    savePrefs({ theme: select.value });
  });
}

function setupPerformanceSelect() {
  const checkLight = $('#check-light-mode');
  const checkPause = $('#check-pause-background');
  if (checkLight) {
    checkLight.checked = prefs.lightMode !== false;
    checkLight.addEventListener('change', () => {
      const val = checkLight.checked;
      prefs.lightMode = val;
      applyPerformancePrefs();
      savePrefs({ lightMode: val });
    });
  }
  if (checkPause) {
    checkPause.checked = prefs.pauseInBackground !== false;
    checkPause.addEventListener('change', () => {
      const val = checkPause.checked;
      prefs.pauseInBackground = val;
      applyPerformancePrefs();
      savePrefs({ pauseInBackground: val });
    });
  }
}

// Novidades da versão: mostra uma vez só (quem abre o app pela primeira vez vê o perfil, não isso)
const WHATS_NEW_VERSION = '4.1.0';
let whatsNewReturnFocus = null;

function openWhatsNew(seen = 0, returnFocus = document.activeElement) {
  closeUserPopover();
  whatsNewReturnFocus = returnFocus;
  const seenParts = String(seen).split('.').map(Number);
  for (const version of ['4-0-0', '3-9-0', '3-8-0', '3-7-0', '3-6-2', '3-6-0', '3-5-0', '3-4-1', '3-4', '3-3', '3-2', '3-1', '3-0', '2-2', '2-1', '2-0']) {
    const parts = version.split('-').map(Number);
    // Compara também a correção: quem viu 3.4.0 ainda precisa das novidades de 3.4.1.
    const difference = parts.findIndex((part, index) => part !== (seenParts[index] || 0));
    const alreadySeen = difference === -1 || (seenParts[difference] || 0) > parts[difference];
    $(`#whats-new-${version}`)?.classList.toggle('hidden', alreadySeen);
  }
  $('#modal-whats-new .modal-body').scrollTop = 0;
  $('#modal-whats-new').classList.remove('hidden');
  $('#modal-whats-new .modal-close-btn').focus();
}

function setupWhatsNew() {
  $('#settings-app-version').textContent = `Versão ${WHATS_NEW_VERSION}`;
  for (const id of ['btn-home-whats-new', 'btn-settings-whats-new']) {
    document.getElementById(id).addEventListener('click', (e) => openWhatsNew(0, e.currentTarget));
  }
  $('#modal-whats-new').addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    $('#modal-whats-new').classList.add('hidden');
    whatsNewReturnFocus?.focus();
  });
}

function showWhatsNewOnce() {
  if (prefs.seenWhatsNew === WHATS_NEW_VERSION) return;
  const seen = prefs.seenWhatsNew || '0';
  savePrefs({ seenWhatsNew: WHATS_NEW_VERSION });
  if (!isFirstRun) openWhatsNew(seen);
}

// Barra de salas e canais (borda direita) e chat (borda esquerda): arrasta a borda pra mudar
// a largura (guardada nas preferências)
const SIDEBAR_MIN_WIDTH = 220; // cabe o dock com os 5 botões
const SIDEBAR_MAX_WIDTH = 480;
const CHAT_MIN_WIDTH = 240;
const CHAT_MAX_WIDTH = 520;

function setupSidebarResize() {
  setupPanelResize($('#sidebar-channels'), $('#sidebar-resizer'), {
    min: SIDEBAR_MIN_WIDTH, max: SIDEBAR_MAX_WIDTH, prefKey: 'sidebarWidth', edge: 'right'
  });
  setupPanelResize($('#chat-drawer'), $('#chat-resizer'), {
    min: CHAT_MIN_WIDTH, max: CHAT_MAX_WIDTH, prefKey: 'chatWidth', edge: 'left'
  });
}

function setupPanelResize(sidebar, handle, { min, max, prefKey, edge }) {
  if (!sidebar || !handle) return;
  // Borda esquerda: arrastar pra esquerda alarga
  const dir = edge === 'left' ? -1 : 1;
  const clamp = (w) => Math.round(Math.min(max, Math.max(min, w)));
  const apply = (w) => { sidebar.style.width = w ? `${clamp(w)}px` : ''; };
  const save = () => savePrefs({ [prefKey]: sidebar.style.width ? parseInt(sidebar.style.width, 10) : null });
  apply(prefs[prefKey]);

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebar.getBoundingClientRect().width;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing-sidebar');
    const onMove = (ev) => apply(startWidth + dir * (ev.clientX - startX));
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.removeEventListener(type, onUp);
      window.removeEventListener('blur', onUp);
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      document.body.classList.remove('resizing-sidebar');
      save();
    };
    handle.addEventListener('pointermove', onMove);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, onUp);
    window.addEventListener('blur', onUp);
  });
  handle.addEventListener('dblclick', () => { apply(null); save(); });
  handle.addEventListener('keydown', (e) => {
    const step = (e.key === 'ArrowLeft' ? -20 : e.key === 'ArrowRight' ? 20 : 0) * dir;
    if (!step) return;
    e.preventDefault();
    apply(sidebar.getBoundingClientRect().width + step);
    save();
  });
}

// Tela e câmera da mesma pessoa são transmissões diferentes: a câmera tem a chave "<id>__cam"
const CAMERA_SUFFIX = '__cam';
const CAMERA_BITRATE = 2500000;

// Telas a mais da mesma pessoa: tipo "screen2"/"screen3", chave "<id>__s2"/"<id>__s3".
// A tela 1 continua com o tipo "screen" e a chave = id (compatível com quem tem só uma).
const EXTRA_SCREEN_NUMBERS = [2, 3];
const EXTRA_SCREEN_RE = /__s(\d)$/;

function streamKey(userId, kind = 'screen') {
  if (kind === 'camera') return `${userId}${CAMERA_SUFFIX}`;
  const extra = /^screen(\d)$/.exec(kind);
  return extra ? `${userId}__s${extra[1]}` : userId;
}

function streamKind(key) {
  const k = String(key);
  if (k.endsWith(CAMERA_SUFFIX)) return 'camera';
  const extra = EXTRA_SCREEN_RE.exec(k);
  return extra ? `screen${extra[1]}` : 'screen';
}

function streamOwner(key) {
  return String(key).replace(/__(cam|s\d)$/, '');
}

// Tipos de transmissão (tela 1, telas extras, câmera); voz é outra coisa
function isStreamKind(kind) {
  return kind === 'screen' || kind === 'camera' || /^screen[23]$/.test(String(kind));
}

function extraScreenNumber(kind) {
  const extra = /^screen(\d)$/.exec(String(kind));
  return extra ? Number(extra[1]) : null;
}

// Todas as chaves de transmissão que uma pessoa pode ter
function allStreamKeys(userId) {
  return [userId, streamKey(userId, 'camera'), ...EXTRA_SCREEN_NUMBERS.map((n) => streamKey(userId, `screen${n}`))];
}

function streamLabel(key) {
  const ownerId = streamOwner(key);
  const name = ownerId === appState.myId ? `${appState.myUser.name} (Você)` : findUser(ownerId)?.name || 'Amigo';
  const kind = streamKind(key);
  if (kind === 'camera') return `${name} 📷`;
  const n = extraScreenNumber(kind);
  return n ? `${name} · tela ${n}` : name;
}

// Minha transmissão local de cada tipo (tela 1, extras, câmera)
function localStreamFor(kind) {
  if (kind === 'camera') return appState.localCameraStream;
  if (kind === 'screen') return appState.localScreenStream;
  return appState.extraScreens.get(extraScreenNumber(kind))?.stream || null;
}

// Selos da lista/cards: "AO VIVO" (tela) e "CÂMERA", cada um abre a sua transmissão
// compact (lista lateral): com várias telas, "🔴 1"/"🔴 2" pra não espremer o nome
function liveBadgesHtml(u, { compact = false } = {}) {
  const badge = (kind, label) => {
    const key = streamKey(u.id, kind);
    const watching = appState.activeStreams.has(key);
    const n = kind === 'screen' ? 1 : extraScreenNumber(kind);
    const what = kind === 'camera' ? 'Câmera' : `Tela ${n}`;
    return `<span class="badge-live-stream${watching ? ' watching' : ''}" data-stream-key="${escapeHtml(key)}" title="${what}: ${watching ? 'você está assistindo' : 'clique pra assistir'}">${label}</span>`;
  };
  const extras = Array.isArray(u.extraScreens) ? u.extraScreens.filter((n) => EXTRA_SCREEN_NUMBERS.includes(n)) : [];
  // Com mais de uma tela, cada selo diz qual é
  const many = extras.length > 0;
  const dot = '<span class="live-pulse" aria-hidden="true"></span>';
  const screenLabel = (n) => (compact ? `${dot}${n}` : `${dot}TELA ${n}`);
  return `${u.isSharing ? badge('screen', many ? screenLabel(1) : `${dot}AO VIVO`) : ''}${extras.map((n) => badge(`screen${n}`, screenLabel(n))).join('')}${u.isCameraOn ? badge('camera', compact && many ? CAMERA_SVG : `${CAMERA_SVG}CÂMERA`) : ''}`;
}

// "AO VIVO" da lista: começa a assistir (se ainda não assiste) e abre essa transmissão
function openStream(userId) {
  if (streamOwner(userId) === appState.myId) {
    const preview = appState.localPreviews.get(userId);
    if (!preview) return;
    if (!appState.activeStreams.has(userId)) registerScreenStream(userId, preview.label, preview.stream, true);
    focusStream(userId);
    return;
  }
  if (!appState.activeStreams.has(userId)) {
    watchScreen(userId);
    // Já assistindo outra: quando essa chegar, abre ela em vez do mosaico
    if (appState.activeStreams.size > 0) appState.expandedStreamUserId = userId;
  }
  focusStream(userId);
}

// Para de assistir alguém (o "AO VIVO" continua na lista pra voltar quando quiser)
function unwatchScreen(userId) {
  stopWatchingScreen(userId);
  removeScreenStream(userId);
  if (appState.screenPeersIn.has(userId)) {
    try { appState.screenPeersIn.get(userId).close(); } catch (_) {}
    appState.screenPeersIn.delete(userId);
  }
}

// Abas do topo: abre essa transmissão (com várias, sai do mosaico)
function focusStream(userId) {
  setMobileView('sala');
  appState.focusedStreamUserId = userId;
  if (appState.activeStreams.size > 1) appState.expandedStreamUserId = userId;
  updateStageLayout();
  console.log(`[Stream Focus] Focado na transmissão de ${userId}`);
}

// -----------------------------------------------------------------------------
// 9. DUAL-MESH WEBRTC MEDIA PIPELINE & PEER CONNECTION HELPERS
// -----------------------------------------------------------------------------

function enqueueIceCandidate(key, candidate) {
  if (!appState.iceCandidatesQueue.has(key)) {
    appState.iceCandidatesQueue.set(key, []);
  }
  appState.iceCandidatesQueue.get(key).push(candidate);
}

async function drainIceCandidates(key, pc) {
  if (!appState.iceCandidatesQueue.has(key) || !pc) return;
  const candidates = appState.iceCandidatesQueue.get(key);
  appState.iceCandidatesQueue.delete(key);

  const IceCandidate = window.RTCIceCandidate || globalThis.RTCIceCandidate;
  for (const candidate of candidates) {
    try {
      if (IceCandidate) {
        await pc.addIceCandidate(new IceCandidate(candidate));
      } else if (pc.addIceCandidate) {
        await pc.addIceCandidate(candidate);
      }
    } catch (err) {
      console.warn(`[WebRTC ICE] Error adding queued candidate (${key}):`, err);
    }
  }
}

// Voz em Opus mono 64 kbps (o padrão do Chromium é ~32 kbps, que soa abafado)
const VOICE_BITRATE = 64000;

async function applySenderBitrates(pc, maxVideoBitrate = 5500000, maxAudioBitrate = 256000) {
  if (!pc || !pc.getSenders) return;
  const senders = pc.getSenders();
  for (const sender of senders) {
    if (!sender.track) continue;
    try {
      const params = sender.getParameters ? sender.getParameters() : null;
      if (!params) continue;
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      if (sender.track.kind === 'video') {
        params.encodings[0].maxBitrate = maxVideoBitrate;
        params.degradationPreference = 'maintain-framerate';
      } else if (sender.track.kind === 'audio') {
        params.encodings[0].maxBitrate = maxAudioBitrate;
        // Internet apertou: corta a qualidade do vídeo antes de picotar o som
        params.encodings[0].priority = 'high';
        params.encodings[0].networkPriority = 'high';
      }
      if (sender.setParameters) {
        await sender.setParameters(params);
      }
    } catch (e) {
      console.warn('[WebRTC] Error setting sender parameters:', e);
    }
  }
}

let isAutoplayUnlocked = false;

function enableAutoplayOnFirstInteraction() {
  if (isAutoplayUnlocked) return;

  const unlock = () => {
    isAutoplayUnlocked = true;
    if (appState.audioContext && appState.audioContext.state === 'suspended') {
      appState.audioContext.resume().catch(() => {});
    }
    document.querySelectorAll('#voice-streams-container audio').forEach((a) => {
      a.play().catch(() => {});
    });
    document.querySelectorAll('#videos-grid video').forEach((v) => {
      if (!v.muted) v.play().catch(() => {});
    });
    window.removeEventListener('click', unlock);
    window.removeEventListener('keydown', unlock);
  };

  window.addEventListener('click', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

function updateSpeakingIndicators(userId, isSpeaking) {
  stageSocialUI?.updateSpeaking(userId, isSpeaking);
  // 1. Sidebar Channels tree
  const userRow = document.querySelector(`.channel-user[data-user-id="${userId}"]`);
  if (userRow) {
    userRow.classList.toggle('is-speaking', isSpeaking);
    const wrap = userRow.querySelector('.user-avatar-wrap');
    if (wrap) wrap.classList.toggle('is-speaking', isSpeaking);
  }

  // 2. Persistent bottom dock (local user)
  if (userId === appState.myId) {
    const dockWrap = document.getElementById('dock-avatar-wrap');
    if (dockWrap) dockWrap.classList.toggle('is-speaking', isSpeaking);
  }

  // 3. Voice Lounge cards
  const loungeCards = document.querySelectorAll('.lounge-user-card');
  loungeCards.forEach((card) => {
    const wrap = card.querySelector('.user-avatar-wrap');
    const nameSpan = card.querySelector('.lounge-user-name');
    const ch = appState.channels.get(appState.currentChannelId);
    const u = ch?.users.get(userId);
    if (u && nameSpan && (nameSpan.textContent.includes(u.name) || card.getAttribute('data-user-id') === userId)) {
      if (wrap) wrap.classList.toggle('is-speaking', isSpeaking);
    }
  });
}

function attachVoiceStream(userId, stream) {
  let container = document.getElementById('voice-streams-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'voice-streams-container';
    container.className = 'visually-hidden';
    document.body.appendChild(container);
  }

  let audioEl = document.getElementById(`voice-audio-${userId}`);
  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.id = `voice-audio-${userId}`;
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    container.appendChild(audioEl);
  }

  audioEl.srcObject = stream;
  audioEl.muted = appState.myUser.isDeafened;

  // Web Audio GainNode mixer (0-200%)
  if (appState.mixerManager) {
    const ch = appState.channels.get(appState.currentChannelId);
    const user = ch?.users.get(userId);
    const userName = user?.name || '';
    appState.mixerManager.attachUserStream(userId, stream, userName);
    const entry = appState.mixerManager.userMixers.get(userId);
    if (entry?.gainNode) {
      appState.userMixers.set(userId, entry.gainNode);
    }
    routeElementThroughMixer(audioEl, entry);
  }

  applyUserVolume(userId);

  audioEl.play().catch((err) => {
    console.warn(`[WebRTC Autoplay] Voice audio play blocked for user ${userId}:`, err);
    enableAutoplayOnFirstInteraction();
  });
}

// O som sai só pelo mixer (Web Audio, 0–200%). O elemento continua com o stream
// (o Chrome precisa disso para tocar áudio WebRTC no Web Audio), mas fica mudo:
// tocar pelos dois ao mesmo tempo dobra o som e deixa a voz metálica.
function routeElementThroughMixer(el, mixerEntry) {
  if (!el || !mixerEntry?.sourceNode) return;
  el.dataset.mixerOutput = '1';
  el.muted = true;
  const ctx = appState.mixerManager?.audioContext;
  if (ctx && ctx.state !== 'running') {
    ctx.resume().catch(() => {});
    enableAutoplayOnFirstInteraction();
  }
}

// Volume de cada transmissão (0–300%), salvo pelo perfil de quem transmite
// Chave do volume salvo: perfil de quem transmite (+ "__cam" pra câmera, que tem o seu)
function streamVolumeKey(key) {
  const owner = streamOwner(key);
  const base = volumeKey(findUser(owner));
  // Câmera e telas extras têm o volume delas ("__cam", "__s2"...)
  return base ? `${base}${String(key).slice(owner.length)}` : base;
}

// Ensurdecer cala as vozes; as transmissões só se a pessoa pediu nas configurações
function streamsDeafened() {
  return appState.myUser.isDeafened && prefs.deafenStreams === true;
}

function savedStreamVolume(userId) {
  return (prefs.streamVolumes || {})[streamVolumeKey(userId)] ?? 100;
}

function getStreamVolume(userId) {
  const live = appState.mixerManager?.streamMixers.get(userId)?.volumePercent;
  return Number.isFinite(live) ? live : savedStreamVolume(userId);
}

function setStreamVolume(userId, percent, { save = true } = {}) {
  const pct = Math.max(0, Math.min(300, Math.round(Number(percent) || 0)));
  appState.setStreamVolume(userId, pct);
  // Sem o mixer o som sai pelo próprio <video> (que só vai até 100%)
  const videoEl = document.getElementById(`video-el-${userId}`);
  if (videoEl && !streamsDeafened() && videoEl.dataset.mixerOutput !== '1') {
    videoEl.volume = Math.min(1.0, pct / 100);
    setRemoteElementMuted(videoEl, pct === 0);
  }
  const key = streamVolumeKey(userId);
  if (save && key) {
    const streamVolumes = { ...(prefs.streamVolumes || {}) };
    if (pct === 100) delete streamVolumes[key];
    else streamVolumes[key] = pct;
    savePrefs({ streamVolumes });
  }
  syncStreamVolumeUi(userId);
}

// Deixa o slider da tela e o da barra de baixo (se ela estiver aberta) com o mesmo valor
function syncStreamVolumeUi(userId) {
  const pct = getStreamVolume(userId);
  const tileInput = document.getElementById(`tile-volume-${userId}`);
  if (tileInput) tileInput.value = String(pct);
  const tileText = document.getElementById(`tile-volume-text-${userId}`);
  if (tileText) tileText.textContent = `${pct}%`;
  if (userId === appState.focusedStreamUserId) {
    const volInput = $('#input-stream-volume');
    if (volInput) volInput.value = String(pct / 100);
    const volText = $('#stream-volume-text');
    if (volText) volText.textContent = `${pct}%`;
  }
}

// Fotinho de quem transmite (selo da tela e abas do topo); sem perfil, a bolinha vermelha
function streamerAvatarHtml(key, className) {
  const userId = streamOwner(key);
  const u = userId === appState.myId ? { ...appState.myUser, id: userId, avatarV: myProfile.avatar ? 1 : 0 } : findUser(userId);
  if (!u) return '<span class="live-dot"></span>';
  return `<span class="${className}" style="background-color: ${safeColor(u.color)};">${avatarInnerHtml(u)}</span>`;
}

// Mouse parado 2,5 s em cima da transmissão: esconde o cursor e o que fica por cima do vídeo
function setupTileIdleCursor(tile) {
  let timer = null;
  const wake = () => {
    tile.classList.remove('idle');
    clearTimeout(timer);
    timer = setTimeout(() => tile.classList.add('idle'), 2500);
  };
  tile.addEventListener('mousemove', wake);
  tile.addEventListener('mouseenter', wake);
  tile.addEventListener('pointerdown', wake);
  tile.addEventListener('mouseleave', () => {
    clearTimeout(timer);
    tile.classList.remove('idle');
  });
}

// Zoom (1x a 5x) e arraste (pan) na transmissão (roda do mouse no PC e pinça/toque no celular)
function setupTileZoomPan(tile, video, zoomResetBtn) {
  let scale = 1;
  let panX = 0;
  let panY = 0;
  let suppressClickUntil = 0;
  const pointers = new Map();
  let lastPinchDist = 0;
  let lastPinchMid = null;
  let dragMoved = 0;

  const clampPan = () => {
    const rect = tile.getBoundingClientRect();
    const maxX = Math.max(0, (rect.width * (scale - 1)) / 2);
    const maxY = Math.max(0, (rect.height * (scale - 1)) / 2);
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
  };

  const applyTransform = () => {
    if (scale <= 1.01) {
      scale = 1;
      panX = 0;
      panY = 0;
      video.style.transform = '';
      tile.classList.remove('is-zoomed', 'is-panning');
      zoomResetBtn?.classList.add('hidden');
    } else {
      clampPan();
      video.style.transform = `translate3d(${panX.toFixed(1)}px, ${panY.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
      tile.classList.add('is-zoomed');
      if (zoomResetBtn) {
        zoomResetBtn.textContent = `${Math.round(scale * 100)}% ✕`;
        zoomResetBtn.classList.remove('hidden');
      }
    }
  };

  const zoomAt = (nextScale, clientX, clientY) => {
    const clamped = Math.max(1, Math.min(5, nextScale));
    const rect = tile.getBoundingClientRect();
    const cx = clientX - (rect.left + rect.width / 2);
    const cy = clientY - (rect.top + rect.height / 2);
    const ratio = clamped / scale;
    panX = cx - (cx - panX) * ratio;
    panY = cy - (cy - panY) * ratio;
    scale = clamped;
    applyTransform();
  };

  const resetZoom = () => {
    scale = 1;
    panX = 0;
    panY = 0;
    applyTransform();
  };

  zoomResetBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    resetZoom();
  });

  tile.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0018);
    zoomAt(scale * factor, e.clientX, e.clientY);
  }, { passive: false });

  video.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragMoved = 0;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      lastPinchDist = Math.hypot(b.x - a.x, b.y - a.y);
      lastPinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    if (scale > 1.01 || pointers.size === 2) {
      try { video.setPointerCapture(e.pointerId); } catch {}
    }
  });

  video.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
      pointers.delete(e.pointerId);
      tile.classList.remove('is-panning');
      return;
    }
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (lastPinchDist > 8 && dist > 8) {
        if (lastPinchMid) {
          panX += mid.x - lastPinchMid.x;
          panY += mid.y - lastPinchMid.y;
        }
        zoomAt(scale * (dist / lastPinchDist), mid.x, mid.y);
        suppressClickUntil = Date.now() + 350;
      }
      lastPinchDist = dist;
      lastPinchMid = mid;
      return;
    }

    if (pointers.size === 1 && scale > 1.01) {
      dragMoved += Math.hypot(dx, dy);
      if (dragMoved > 4) {
        tile.classList.add('is-panning');
        suppressClickUntil = Date.now() + 350;
      }
      panX += dx;
      panY += dy;
      applyTransform();
    }
  });

  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) {
      lastPinchDist = 0;
      lastPinchMid = null;
    }
    if (pointers.size === 0) tile.classList.remove('is-panning');
  };
  video.addEventListener('pointerup', endPointer);
  video.addEventListener('pointercancel', endPointer);

  return {
    wasGesture: () => Date.now() < suppressClickUntil,
    resetZoom
  };
}

function registerScreenStream(userId, userName, stream, isLocal) {
  appState.activeStreams.set(userId, { stream, userName, isLocal });

  let tile = document.getElementById(`video-tile-${userId}`);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = `video-tile-${userId}`;

    const badge = document.createElement('div');
    badge.className = 'tile-badge';
    badge.innerHTML = `${streamerAvatarHtml(userId, 'tile-badge-avatar')} <span>${escapeHtml(userName)}</span>`;

    const video = document.createElement('video');
    video.id = `video-el-${userId}`;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = isLocal || streamsDeafened();

    const unmuteBtn = document.createElement('button');
    unmuteBtn.id = `unmute-btn-${userId}`;
    unmuteBtn.className = 'btn-unmute-overlay hidden';
    unmuteBtn.innerHTML = '🔊 Clique para ativar o som';
    unmuteBtn.addEventListener('click', () => {
      appState.mixerManager?.audioContext?.resume?.().catch(() => {});
      setRemoteElementMuted(video, false);
      video.play().catch(() => {});
      unmuteBtn.classList.add('hidden');
    });

    const zoomResetBtn = document.createElement('button');
    zoomResetBtn.type = 'button';
    zoomResetBtn.className = 'tile-btn tile-zoom-reset hidden';
    zoomResetBtn.title = 'Resetar zoom (100%)';
    zoomResetBtn.setAttribute('aria-label', 'Resetar zoom da transmissão');
    zoomResetBtn.textContent = '100% ✕';
    ['click', 'dblclick', 'pointerdown'].forEach((evt) => zoomResetBtn.addEventListener(evt, (e) => e.stopPropagation()));

    const fsBtn = document.createElement('button');
    fsBtn.type = 'button';
    fsBtn.className = 'tile-btn tile-fullscreen-btn';
    fsBtn.title = 'Tela cheia (F)';
    fsBtn.setAttribute('aria-label', 'Alternar tela cheia');
    fsBtn.textContent = '⛶';
    ['click', 'dblclick', 'pointerdown'].forEach((evt) => fsBtn.addEventListener(evt, (e) => e.stopPropagation()));
    fsBtn.addEventListener('click', () => toggleStageFullscreen(tile));

    const zoomPan = setupTileZoomPan(tile, video, zoomResetBtn);

    // Clique: abre só essa transmissão / volta pro mosaico. Duplo clique: tela cheia.
    // O clique espera um instante pra não disparar junto com o duplo clique.
    let clickTimer = null;
    video.addEventListener('click', () => {
      if (zoomPan.wasGesture()) return;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => toggleExpandedStream(userId), 250);
    });
    video.addEventListener('dblclick', () => {
      clearTimeout(clickTimer);
      toggleStageFullscreen(tile);
    });

    tile.appendChild(badge);
    tile.appendChild(video);
    tile.appendChild(unmuteBtn);
    tile.appendChild(zoomResetBtn);
    tile.appendChild(fsBtn);
    setupTileIdleCursor(tile);

    if (!isLocal) {
      const volWrap = document.createElement('div');
      volWrap.className = 'tile-volume';
      volWrap.title = `Volume da transmissão de ${userName} (0–300%)`;
      volWrap.innerHTML = `
        <span aria-hidden="true">🔊</span>
        <input type="range" id="tile-volume-${userId}" min="0" max="300" step="5" value="100" aria-label="Volume da transmissão de ${escapeHtml(userName)}" />
        <span class="tile-volume-text" id="tile-volume-text-${userId}">100%</span>
      `;
      ['click', 'dblclick', 'pointerdown'].forEach((evt) => volWrap.addEventListener(evt, (e) => e.stopPropagation()));
      volWrap.querySelector('input').addEventListener('input', (e) => setStreamVolume(userId, e.target.value));
      tile.appendChild(volWrap);
    }

    const grid = document.getElementById('videos-grid');
    if (grid) grid.appendChild(tile);
  }

  const videoEl = document.getElementById(`video-el-${userId}`);
  const unmuteBtn = document.getElementById(`unmute-btn-${userId}`);
  if (videoEl) {
    if (videoEl.srcObject !== stream) {
      videoEl.srcObject = stream;
    }
    videoEl.play().catch(() => {
      if (!isLocal) {
        videoEl.muted = true;
        videoEl.play().catch(() => {});
        if (unmuteBtn) unmuteBtn.classList.remove('hidden');
      }
    });
  }

  // Attach screen audio to mixer manager if remote stream
  if (!isLocal && appState.mixerManager && stream.getAudioTracks().length > 0) {
    appState.mixerManager.attachScreenStream(userId, stream);
    const entry = appState.mixerManager.streamMixers.get(userId);
    if (entry?.gainNode) {
      appState.streamMixers.set(userId, entry.gainNode);
    }
    routeElementThroughMixer(videoEl, entry);
  }
  if (!isLocal) setStreamVolume(userId, savedStreamVolume(userId), { save: false });

  if (!appState.focusedStreamUserId || (appState.focusedStreamUserId === appState.myId && userId !== appState.myId)) {
    appState.focusedStreamUserId = userId;
  }

  updateStageLayout();
  updateVoiceLounge();
  renderChannelsTree(); // "AO VIVO" de quem você assiste fica destacado
}

function removeScreenStream(userId) {
  appState.activeStreams.delete(userId);
  const tile = document.getElementById(`video-tile-${userId}`);
  if (document.pictureInPictureElement && tile?.contains(document.pictureInPictureElement)) {
    document.exitPictureInPicture().catch(() => {});
  }
  if (tile?.classList.contains('stage-fullscreen-tile') || !appState.activeStreams.size) {
    exitStageFullscreen();
  }
  if (tile) tile.remove();

  if (appState.mixerManager) {
    appState.mixerManager.detachScreenStream(userId);
  }
  appState.streamMixers.delete(userId);

  if (appState.focusedStreamUserId === userId) {
    const remaining = Array.from(appState.activeStreams.keys());
    appState.focusedStreamUserId = remaining.length > 0 ? remaining[0] : null;
  }
  if (appState.expandedStreamUserId === userId) appState.expandedStreamUserId = null;

  updateStageLayout();
  updateVoiceLounge();
  renderChannelsTree();
}

// Mosaico = 2+ transmissões e nenhuma aberta sozinha
function isMosaicView() {
  return appState.activeStreams.size > 1 && !appState.activeStreams.has(appState.expandedStreamUserId);
}

function toggleExpandedStream(userId) {
  if (appState.activeStreams.size < 2) return; // com uma só ela já ocupa o palco
  appState.expandedStreamUserId = appState.expandedStreamUserId === userId ? null : userId;
  appState.focusedStreamUserId = userId;
  updateStageLayout();
}

// Avisa o servidor o que você está assistindo, pra aparecer sua foto na transmissão dos outros
let lastWatchingSent = '';
function syncWatching() {
  const keys = appState.currentChannelId
    ? [...appState.activeStreams.entries()].filter(([, info]) => !info.isLocal).map(([key]) => key).sort()
    : [];
  appState.myUser.watching = keys;
  const sig = `${appState.currentChannelId}|${keys.join()}`;
  if (sig === lastWatchingSent) return;
  lastWatchingSent = sig;
  if (appState.currentChannelId) socket.emit('user-state-changed', { watching: keys });
}

// Fotinhas de quem está assistindo, do lado do nome de quem transmite
const MAX_VIEWER_AVATARS = 6;
function renderStreamViewers() {
  const ch = appState.channels.get(appState.currentChannelId);
  for (const key of appState.activeStreams.keys()) {
    const badge = document.querySelector(`#video-tile-${CSS.escape(key)} .tile-badge`);
    if (!badge) continue;
    const viewers = [];
    for (const u of ch?.users.values() || []) {
      const list = u.id === appState.myId ? appState.myUser.watching : u.watching;
      if (Array.isArray(list) && list.includes(key)) viewers.push(u.id === appState.myId ? { ...u, ...appState.myUser, id: u.id, avatarV: myProfile.avatar ? 1 : 0 } : u);
    }
    let box = badge.querySelector('.tile-viewers');
    if (!viewers.length) {
      box?.remove();
      continue;
    }
    if (!box) {
      box = document.createElement('span');
      box.className = 'tile-viewers';
      badge.appendChild(box);
    }
    const shown = viewers.slice(0, MAX_VIEWER_AVATARS);
    const extra = viewers.length - shown.length;
    box.title = `Assistindo: ${viewers.map((u) => u.name).join(', ')}`;
    box.innerHTML = shown
      .map((u) => `<span class="tile-viewer-avatar" style="background-color: ${safeColor(u.color)};">${avatarInnerHtml(u)}</span>`)
      .join('') + (extra > 0 ? `<span class="tile-viewer-more">+${extra}</span>` : '');
  }
}

// Mosaico: colunas com largura ajustável. Arrastar a divisória entre duas transmissões
// alarga uma e estreita a outra (duplo clique volta tudo igual).
const MIN_MOSAIC_WEIGHT = 0.25;
appState.mosaicWeights = [];

let mosaicObserver = null;
function layoutMosaic(grid, count) {
  if (!grid) return;
  // Janela/painéis mudaram de tamanho: as divisórias acompanham
  if (!mosaicObserver && typeof ResizeObserver !== 'undefined') {
    mosaicObserver = new ResizeObserver(() => {
      grid.querySelectorAll('.mosaic-gutter').forEach((g, j) => placeGutter(grid, g, j));
    });
    mosaicObserver.observe(grid);
  }
  grid.querySelectorAll('.mosaic-gutter').forEach((g) => g.remove());
  if (!count) {
    grid.style.gridTemplateColumns = '';
    grid.style.gridTemplateRows = '';
    return;
  }
  // Até 3 numa linha; mais que isso, duas linhas
  const perRow = count <= 3 ? count : Math.ceil(count / 2);
  const rows = Math.ceil(count / perRow);
  if (appState.mosaicWeights.length !== perRow) appState.mosaicWeights = Array(perRow).fill(1);
  const weights = appState.mosaicWeights;
  grid.style.gridTemplateColumns = weights.map((w) => `minmax(0, ${w}fr)`).join(' ');
  grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;

  for (let i = 0; i < perRow - 1; i++) {
    const gutter = document.createElement('div');
    gutter.className = 'mosaic-gutter';
    gutter.title = 'Arraste pra mudar o tamanho (duplo clique deixa igual)';
    grid.appendChild(gutter);
    placeGutter(grid, gutter, i);
    gutter.addEventListener('click', (e) => e.stopPropagation());
    gutter.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      appState.mosaicWeights = Array(perRow).fill(1);
      layoutMosaic(grid, count);
    });
    gutter.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      gutter.setPointerCapture(e.pointerId);
      document.body.classList.add('resizing-sidebar');
      const startX = e.clientX;
      const start = [...weights];
      const total = start.reduce((a, b) => a + b, 0);
      const pxPerWeight = grid.clientWidth / total;
      const pair = start[i] + start[i + 1];
      const onMove = (ev) => {
        const delta = (ev.clientX - startX) / pxPerWeight;
        const left = Math.min(pair - MIN_MOSAIC_WEIGHT, Math.max(MIN_MOSAIC_WEIGHT, start[i] + delta));
        weights[i] = left;
        weights[i + 1] = pair - left;
        grid.style.gridTemplateColumns = weights.map((w) => `minmax(0, ${w}fr)`).join(' ');
        grid.querySelectorAll('.mosaic-gutter').forEach((g, j) => placeGutter(grid, g, j));
      };
      const onUp = () => {
        gutter.removeEventListener('pointermove', onMove);
        document.body.classList.remove('resizing-sidebar');
      };
      gutter.addEventListener('pointermove', onMove);
      gutter.addEventListener('pointerup', onUp, { once: true });
      gutter.addEventListener('pointercancel', onUp, { once: true });
    });
  }
}

// Divisória no vão entre a coluna i e a i+1
function placeGutter(grid, gutter, i) {
  const weights = appState.mosaicWeights;
  const total = weights.reduce((a, b) => a + b, 0);
  const style = getComputedStyle(grid);
  const padL = parseFloat(style.paddingLeft) || 0;
  const padR = parseFloat(style.paddingRight) || 0;
  const gap = parseFloat(style.columnGap) || 0;
  const inner = grid.clientWidth - padL - padR - gap * (weights.length - 1);
  const before = weights.slice(0, i + 1).reduce((a, b) => a + b, 0);
  gutter.style.left = `${padL + (inner * before) / total + gap * i + gap / 2}px`;
}

// Cada controle aparece junto da ação que está disponível na sala.
function updateStageControls() {
  musicUI?.syncChannel();
  stageSocialUI?.update();
  const inCall = Boolean(appState.currentChannelId);
  const watching = appState.activeStreams.size > 0;
  const watchingOthers = [...appState.activeStreams.values()].some((info) => !info.isLocal);
  $('#stage-controls-bar')?.classList.toggle('hidden', !inCall && !watching);
  $('#stage-controls-bar')?.classList.toggle('has-streams', watching);
  $('.stage-controls-left')?.classList.toggle('hidden', !watching);
  $('.reactions-bar')?.classList.toggle('hidden', !inCall);
  $('.lounge-cta')?.classList.toggle('hidden', !inCall);
  for (const id of ['btn-share-screen', 'btn-share-camera', 'btn-soundboard']) {
    document.getElementById(id)?.classList.toggle('hidden', !inCall);
  }
  $('#btn-stage-stop-watching')?.classList.toggle('hidden', !watchingOthers);
  for (const id of ['btn-stage-pip', 'btn-stage-fullscreen']) {
    document.getElementById(id)?.classList.toggle('hidden', !watching);
  }
  if (!inCall) {
    closeCallReactions();
    $('#soundboard-popover')?.classList.add('hidden');
    $('#btn-soundboard')?.setAttribute('aria-expanded', 'false');
    $('#reactions-layer')?.replaceChildren();
  }
  syncMobileState(appState);
}

function updateStageLayout() {
  updateTextLayout();
  updateStageControls();
  syncWatching();
  renderStreamViewers();
  const grid = document.getElementById('videos-grid');
  const lounge = document.getElementById('voice-lounge');
  const watchingLabel = document.getElementById('watching-stream-label');
  const streamTabs = document.getElementById('stream-tabs');

  const count = appState.activeStreams.size;

  if (count === 0) {
    if (grid) grid.classList.add('hidden');
    if (lounge) lounge.classList.toggle('hidden', !appState.currentChannelId);
    $('#server-home')?.classList.toggle('hidden', Boolean(appState.currentChannelId));
    if (!appState.currentChannelId) renderServerHome();
    if (watchingLabel) watchingLabel.textContent = '';
    if (streamTabs) streamTabs.innerHTML = '';
    $('#stream-volume-control')?.classList.add('hidden');
    return;
  }

  if (grid) grid.classList.remove('hidden');
  if (lounge) lounge.classList.add('hidden');
  $('#server-home')?.classList.add('hidden');

  // Render stream tabs in topbar
  if (streamTabs) {
    streamTabs.innerHTML = '';
    for (const [uid, info] of appState.activeStreams.entries()) {
      const tab = document.createElement('button');
      tab.className = `stream-tab-chip ${uid === appState.focusedStreamUserId ? 'active' : ''}`;
      tab.innerHTML = `${streamerAvatarHtml(uid, 'stream-tab-avatar')} <span>${escapeHtml(info.userName)}</span>`;
      tab.addEventListener('click', () => {
        focusStream(uid);
      });
      if (!info.isLocal || prefs.hideOwnStream) {
        const close = document.createElement('span');
        close.className = 'stream-tab-close';
        close.textContent = '✕';
        close.title = info.isLocal ? 'Esconder esta prévia' : 'Parar de assistir';
        close.setAttribute('role', 'button');
        close.tabIndex = 0;
        close.setAttribute('aria-label', close.title);
        const hide = (e) => {
          e.stopPropagation();
          if (info.isLocal) removeScreenStream(uid);
          else unwatchScreen(uid);
        };
        close.addEventListener('click', hide);
        close.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hide(e); }
        });
        tab.appendChild(close);
      }
      streamTabs.appendChild(tab);
    }
  }

  const mosaic = isMosaicView();
  // Uma transmissão sozinha ocupa o palco; com várias, a aberta é a "expandida"
  const shownAlone = count === 1 ? appState.activeStreams.keys().next().value : appState.expandedStreamUserId;
  if (grid) grid.className = `videos-grid ${mosaic ? 'mosaic-grid' : 'single-stage'}${count > 1 ? ' multi' : ''}`;

  for (const [uid, info] of appState.activeStreams.entries()) {
    const tile = document.getElementById(`video-tile-${uid}`);
    const videoEl = document.getElementById(`video-el-${uid}`);
    if (!tile || !videoEl) continue;

    tile.title = count > 1 ? (mosaic ? 'Clique pra ver só essa · duplo clique: tela cheia' : 'Clique pra voltar pro mosaico · duplo clique: tela cheia') : 'Duplo clique: tela cheia';
    if (mosaic || uid === shownAlone) {
      tile.classList.remove('hidden-tile');
      tile.classList.remove('hidden');
    } else {
      tile.classList.add('hidden-tile');
      tile.classList.add('hidden');
    }

    if (!info.isLocal) {
      const vol = getStreamVolume(uid) / 100;
      const audible = mosaic || uid === shownAlone;
      appState.mixerManager?.setStreamAudible(uid, audible);
      if (streamsDeafened()) {
        videoEl.muted = true;
      } else {
        videoEl.volume = Math.min(1.0, vol);
        setRemoteElementMuted(videoEl, !audible || vol === 0);
      }
    }
  }

  layoutMosaic(grid, mosaic && count > 1 ? count : 0);

  if (watchingLabel) {
    if (appState.focusedStreamUserId && appState.activeStreams.has(appState.focusedStreamUserId)) {
      const current = appState.activeStreams.get(appState.focusedStreamUserId);
      watchingLabel.textContent = `Assistindo: ${current.userName}`;
    } else {
      watchingLabel.textContent = `${count} transmissões ativas`;
    }
  }
  // A barra de baixo mostra o volume da transmissão aberta
  if (appState.activeStreams.has(appState.focusedStreamUserId)) syncStreamVolumeUi(appState.focusedStreamUserId);
  // Volume da barra de baixo só com uma transmissão de outra pessoa aberta (a sua não toca som pra você)
  const focused = appState.activeStreams.get(appState.focusedStreamUserId);
  $('#stream-volume-control')?.classList.toggle('hidden', !focused || focused.isLocal);
}

function cleanupUserConnections(userId) {
  // A câmera e as telas extras da pessoa são transmissões à parte
  for (const key of allStreamKeys(userId).slice(1)) {
    unwatchScreen(key);
    if (appState.screenPeersOut.has(key)) {
      try { appState.screenPeersOut.get(key).close(); } catch (_) {}
      appState.screenPeersOut.delete(key);
    }
    appState.mixerManager?.detachScreenStream(key);
  }

  stopWatchingScreen(userId);
  if (appState.screenPeersOut.has(userId)) {
    try { appState.screenPeersOut.get(userId).close(); } catch (_) {}
    appState.screenPeersOut.delete(userId);
  }
  if (appState.screenPeersIn.has(userId)) {
    try { appState.screenPeersIn.get(userId).close(); } catch (_) {}
    appState.screenPeersIn.delete(userId);
  }
  if (appState.voicePeers.has(userId)) {
    try { appState.voicePeers.get(userId).close(); } catch (_) {}
    appState.voicePeers.delete(userId);
  }
  appState.sfuVoiceListeners.get(userId)?.close();
  appState.sfuVoiceListeners.delete(userId);

  const audioEl = document.getElementById(`voice-audio-${userId}`);
  if (audioEl) audioEl.remove();

  if (appState.mixerManager) {
    appState.mixerManager.detachUserStream(userId);
    appState.mixerManager.detachScreenStream(userId);
  }
  appState.userMixers.delete(userId);
  appState.streamMixers.delete(userId);

  removeScreenStream(userId);
}

// -----------------------------------------------------------------------------
// TRANSMISSÃO PELO SERVIDOR (SFU)
// Quem transmite manda o vídeo uma vez pro SFU; cada um que assiste recebe de lá.
// Sinalização num WebSocket próprio (/sfu/ws), com senha temporária do server.js.
// -----------------------------------------------------------------------------
class SfuSession {
  constructor({ ownerId, role, kind = 'screen', stream = null, onStream = null, onClose = null }) {
    this.ownerId = ownerId;
    this.role = role; // 'host' (eu transmito) ou 'viewer'
    this.kind = kind; // 'screen' (tela/câmera) ou 'voice' (microfone)
    this.channelId = appState.currentChannelId;
    this.stream = stream;
    this.onStream = onStream;
    this.onClose = onClose;
    this.pc = null;
    this.ws = null;
    this.closed = false;
    this.retries = 0;
  }

  async start() {
    if (this.closed) return;
    const auth = await socket.timeout(5000).emitWithAck('sfu-token', { ownerId: this.ownerId, role: this.role, kind: this.kind }).catch(() => null);
    if (this.closed) return;
    if (!auth?.ok) {
      this.retryLater();
      return;
    }
    // Normalmente /sfu/ws no mesmo endereço da sala; SFU_PATH também aceita ws(s)://… completo
    const base = /^wss?:\/\//.test(auth.path) ? auth.path : `${SERVER_URL.replace(/^http/, 'ws')}${auth.path}`;
    const query = new URLSearchParams({ sala: auth.sala, role: auth.role, exp: auth.exp, token: auth.token });
    const ws = new WebSocket(`${base}?${query}`);
    this.ws = ws;
    ws.onmessage = (e) => this.handle(e.data).catch((err) => console.warn('[SFU]', err));
    ws.onclose = () => {
      if (this.ws === ws) this.retryLater();
    };
  }

  // Caiu (internet piscou, servidor reiniciou): tenta de novo algumas vezes
  retryLater() {
    if (this.closed) return;
    this.resetPeer();
    if (++this.retries > 5) {
      console.warn(`[SFU] Desisti de conectar (${this.role} de ${this.ownerId})`);
      this.close();
      return;
    }
    setTimeout(() => this.start(), 1500 * this.retries);
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ to: 'sfu', data }));
  }

  newPeer(iceServers) {
    this.resetPeer();
    const PeerConnection = window.RTCPeerConnection || globalThis.RTCPeerConnection;
    const pc = new PeerConnection({ ...RTC_CONFIG, iceServers: iceServers || RTC_CONFIG.iceServers });
    this.pc = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') this.retries = 0;
      if (pc.connectionState === 'failed' && this.pc === pc) this.ws?.close();
    };
    return pc;
  }

  async handle(raw) {
    const msg = JSON.parse(raw);
    if (msg.type === 'hello') {
      this.iceServers = msg.iceServers;
      if (this.role === 'host') await this.publish();
    } else if (msg.type === 'signal' && msg.data?.sdp) {
      const sdp = msg.data.sdp;
      if (sdp.type === 'answer' && this.pc) {
        await this.pc.setRemoteDescription(sdp);
      } else if (sdp.type === 'offer' && this.role === 'viewer') {
        await this.watch(sdp);
      }
    } else if (msg.type === 'host-left') {
      this.resetPeer();
    } else if (msg.type === 'error') {
      console.warn('[SFU] Servidor recusou:', msg.message);
    }
  }

  async publish() {
    const pc = this.newPeer(this.iceServers);
    this.stream.getTracks().forEach((track) => pc.addTrack(track, this.stream));
    const offer = await pc.createOffer();
    if (this.kind === 'voice') {
      offer.sdp = enhanceOpusVoiceSdp(offer.sdp);
      await pc.setLocalDescription(offer);
      await applySenderBitrates(pc, 0, VOICE_BITRATE);
    } else {
      offer.sdp = enhanceOpusStereoSdp(offer.sdp, 256000);
      await pc.setLocalDescription(offer);
      const preset = QUALITY_PRESETS[appState.myUser.streamQuality] || QUALITY_PRESETS['1080p60'];
      await applySenderBitrates(pc, this.kind === 'camera' ? CAMERA_BITRATE : preset.maxBitrate, 256000);
    }
    this.send({ sdp: pc.localDescription });
  }

  async watch(offer) {
    const pc = this.newPeer(this.iceServers);
    const MediaStreamClass = window.MediaStream || globalThis.MediaStream;
    const remote = new MediaStreamClass();
    pc.ontrack = (e) => {
      if (!remote.getTracks().includes(e.track)) remote.addTrack(e.track);
      this.onStream?.(remote);
    };
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    answer.sdp = this.kind === 'voice' ? enhanceOpusVoiceSdp(answer.sdp) : enhanceOpusStereoSdp(answer.sdp, 256000);
    await pc.setLocalDescription(answer);
    this.send({ sdp: pc.localDescription });
  }

  resetPeer() {
    try { this.pc?.close(); } catch (_) {}
    this.pc = null;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch (_) {}
    this.resetPeer();
    this.onClose?.();
  }
}

// -----------------------------------------------------------------------------
// VOZ PELO SFU (sala na nuvem): cada um manda a voz UMA vez pro servidor, que repassa
// pra todo mundo do canal. Não depende da internet/roteador de cada amigo se acharem
// (o P2P falhava em alguns NATs) e o upload não cresce com o tamanho da call.
// Sem SFU (sala hospedada no PC), a voz continua P2P.
// -----------------------------------------------------------------------------

// Deixa as conexões de voz com o servidor batendo com o canal atual. Pode chamar à vontade:
// só abre o que falta e fecha o que sobrou.
function syncSfuVoice() {
  if (!appState.sfuEnabled) return;
  const channelId = socket.connected ? appState.currentChannelId : null;

  // Meu mic: publicado enquanto estiver aberto (mutar só desliga a faixa, então desmutar é na hora)
  const micLive = appState.localMicStream?.getAudioTracks().some((t) => t.readyState === 'live');
  const pub = appState.sfuVoicePublisher;
  const pubStale = pub && (pub.closed || pub.ownerId !== appState.myId || pub.channelId !== channelId || pub.stream !== appState.localMicStream);
  if (pub && (pubStale || !micLive || !channelId)) {
    pub.close();
    appState.sfuVoicePublisher = null;
  }
  if (micLive && channelId && !appState.sfuVoicePublisher) {
    const session = new SfuSession({ ownerId: appState.myId, role: 'host', kind: 'voice', stream: appState.localMicStream });
    appState.sfuVoicePublisher = session;
    session.start();
  }

  // Voz dos outros: uma conexão por pessoa do canal. Ela fica aberta mesmo com a pessoa
  // mutada; quando ela liga o mic, o servidor já manda o som.
  const ch = channelId ? appState.channels.get(channelId) : null;
  const others = new Set(ch ? [...ch.users.keys()].filter((id) => id !== appState.myId) : []);
  for (const [userId, session] of appState.sfuVoiceListeners) {
    if (session.closed || !others.has(userId) || session.channelId !== channelId) {
      session.close();
      appState.sfuVoiceListeners.delete(userId);
    }
  }
  for (const userId of others) {
    if (appState.sfuVoiceListeners.has(userId)) continue;
    const session = new SfuSession({
      ownerId: userId,
      role: 'viewer',
      kind: 'voice',
      onStream: (stream) => attachVoiceStream(userId, stream),
      onClose: () => {
        if (appState.sfuVoiceListeners.get(userId) === session) appState.sfuVoiceListeners.delete(userId);
      }
    });
    appState.sfuVoiceListeners.set(userId, session);
    session.start();
  }
}

function stopSfuVoice() {
  appState.sfuVoicePublisher?.close();
  appState.sfuVoicePublisher = null;
  for (const session of appState.sfuVoiceListeners.values()) session.close();
  appState.sfuVoiceListeners.clear();
}

// Começa a assistir alguém: pelo SFU quando a sala tem, senão pede a oferta P2P
// key = streamKey(pessoa, 'screen' | 'camera'): a tela e a câmera de alguém são transmissões separadas
function watchScreen(key) {
  const ownerId = streamOwner(key);
  const kind = streamKind(key);
  if (!appState.sfuEnabled) {
    socket.emit('request-stream', { targetId: ownerId, type: kind });
    return;
  }
  if (appState.sfuViewers.has(key)) return;
  const session = new SfuSession({
    ownerId,
    role: 'viewer',
    kind,
    onStream: (stream) => registerScreenStream(key, streamLabel(key), stream, false),
    onClose: () => {
      if (appState.sfuViewers.get(key) === session) appState.sfuViewers.delete(key);
    }
  });
  appState.sfuViewers.set(key, session);
  session.start();
}

function stopWatchingScreen(key) {
  appState.sfuViewers.get(key)?.close();
  appState.sfuViewers.delete(key);
}

// kind 'screen' (tela) ou 'camera': cada um tem a sua conexão, chave = streamKey(pessoa, kind)
async function createScreenOfferForUser(targetId, kind = 'screen') {
  const localStream = localStreamFor(kind);
  if (!localStream || targetId === appState.myId) return;
  const key = streamKey(targetId, kind);

  if (appState.screenPeersOut.has(key)) {
    try { appState.screenPeersOut.get(key).close(); } catch (_) {}
  }

  const PeerConnection = window.RTCPeerConnection || globalThis.RTCPeerConnection;
  const pc = new PeerConnection(RTC_CONFIG);
  appState.screenPeersOut.set(key, pc);

  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc-ice-candidate', {
        targetId,
        candidate: event.candidate,
        type: `${kind}-out`
      });
    }
  };

  // O amigo parou de assistir (fechou a conexão dele): para de codificar vídeo pra ele
  pc.onconnectionstatechange = () => {
    if (['failed', 'closed'].includes(pc.connectionState) && appState.screenPeersOut.get(key) === pc) {
      try { pc.close(); } catch (_) {}
      appState.screenPeersOut.delete(key);
    }
  };

  const preset = QUALITY_PRESETS[appState.myUser.streamQuality] || QUALITY_PRESETS['1080p60'];

  try {
    const offer = await pc.createOffer();
    offer.sdp = enhanceOpusStereoSdp(offer.sdp, 256000);
    await pc.setLocalDescription(offer);
    await applySenderBitrates(pc, kind === 'camera' ? CAMERA_BITRATE : preset.maxBitrate, 256000);

    socket.emit('webrtc-offer', {
      targetId,
      sdp: pc.localDescription,
      type: kind
    });
  } catch (err) {
    console.error(`[WebRTC] Error creating screen offer for ${targetId}:`, err);
  }
}

async function handleIncomingScreenOffer(senderId, sdp, kind = 'screen') {
  const key = streamKey(senderId, kind);
  if (appState.screenPeersIn.has(key)) {
    try { appState.screenPeersIn.get(key).close(); } catch (_) {}
  }

  const PeerConnection = window.RTCPeerConnection || globalThis.RTCPeerConnection;
  const pc = new PeerConnection(RTC_CONFIG);
  appState.screenPeersIn.set(key, pc);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc-ice-candidate', {
        targetId: senderId,
        candidate: event.candidate,
        type: `${kind}-in`
      });
    }
  };

  const MediaStreamClass = window.MediaStream || globalThis.MediaStream;
  const remoteStream = new MediaStreamClass();
  pc.ontrack = (event) => {
    if (!remoteStream.getTracks().includes(event.track)) {
      remoteStream.addTrack(event.track);
    }
    registerScreenStream(key, streamLabel(key), remoteStream, false);
  };

  try {
    const SessionDescription = window.RTCSessionDescription || globalThis.RTCSessionDescription;
    await pc.setRemoteDescription(new SessionDescription(sdp));
    await drainIceCandidates(`screen-in:${key}`, pc);

    const answer = await pc.createAnswer();
    answer.sdp = enhanceOpusStereoSdp(answer.sdp, 256000);
    await pc.setLocalDescription(answer);

    socket.emit('webrtc-answer', {
      targetId: senderId,
      sdp: pc.localDescription,
      type: kind
    });
  } catch (err) {
    console.error(`[WebRTC] Error handling screen offer from ${senderId}:`, err);
  }
}

// Conexão de voz caiu (rede trocou, Wi-Fi piscou): refaz sozinho em vez de ficar mudo
function watchVoiceConnection(peerId, pc) {
  pc.onconnectionstatechange = () => {
    if (pc.connectionState !== 'failed' || appState.voicePeers.get(peerId) !== pc) return;
    console.warn(`[WebRTC] Voz com ${peerId} caiu, reconectando...`);
    reconnectVoice(peerId);
  };
}

// Refaz a conexão de voz com alguém: oferece o meu mic, ou pede o dela se eu estou mutado
function reconnectVoice(peerId) {
  if (appState.sfuEnabled) {
    appState.sfuVoiceListeners.get(peerId)?.close();
    appState.sfuVoiceListeners.delete(peerId);
    syncSfuVoice();
    return;
  }
  const pc = appState.voicePeers.get(peerId);
  if (pc) {
    try { pc.close(); } catch (_) {}
    appState.voicePeers.delete(peerId);
  }
  appState.iceCandidatesQueue.delete(`voice:${peerId}`);
  if (appState.myUser.isMicOn && appState.localMicStream) createVoiceOfferForUser(peerId);
  else socket.emit('request-stream', { targetId: peerId, type: 'voice' });
}

async function createVoiceOfferForUser(targetId) {
  if (!appState.localMicStream || targetId === appState.myId) return;

  if (appState.voicePeers.has(targetId)) {
    try { appState.voicePeers.get(targetId).close(); } catch (_) {}
  }

  const PeerConnection = window.RTCPeerConnection || globalThis.RTCPeerConnection;
  const pc = new PeerConnection(RTC_CONFIG);
  appState.voicePeers.set(targetId, pc);
  watchVoiceConnection(targetId, pc);

  appState.localMicStream.getTracks().forEach((track) => {
    pc.addTrack(track, appState.localMicStream);
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc-ice-candidate', {
        targetId,
        candidate: event.candidate,
        type: 'voice'
      });
    }
  };

  pc.ontrack = (event) => {
    const MediaStreamClass = window.MediaStream || globalThis.MediaStream;
    const stream = event.streams && event.streams[0] ? event.streams[0] : new MediaStreamClass([event.track]);
    attachVoiceStream(targetId, stream);
  };

  try {
    const offer = await pc.createOffer();
    offer.sdp = enhanceOpusVoiceSdp(offer.sdp);
    await pc.setLocalDescription(offer);
    await applySenderBitrates(pc, 0, VOICE_BITRATE);

    socket.emit('webrtc-offer', {
      targetId,
      sdp: pc.localDescription,
      type: 'voice'
    });
  } catch (err) {
    console.error(`[WebRTC] Error creating voice offer for ${targetId}:`, err);
  }
}

async function handleIncomingVoiceOffer(senderId, sdp) {
  // As duas pontas mandaram oferta juntas (ligaram o mic ou entraram ao mesmo tempo): antes cada
  // uma fechava a sua e respondia a da outra, e ninguém se ouvia até reiniciar o app.
  // Agora quem tem o id "maior" mantém a própria oferta e ignora a outra; a outra ponta responde.
  const existing = appState.voicePeers.get(senderId);
  if (existing && existing.signalingState === 'have-local-offer' && appState.myId > senderId) {
    console.log(`[WebRTC] Colisão de ofertas de voz com ${senderId}: mantendo a minha`);
    return;
  }

  if (appState.voicePeers.has(senderId)) {
    try { appState.voicePeers.get(senderId).close(); } catch (_) {}
  }

  const PeerConnection = window.RTCPeerConnection || globalThis.RTCPeerConnection;
  const pc = new PeerConnection(RTC_CONFIG);
  appState.voicePeers.set(senderId, pc);
  watchVoiceConnection(senderId, pc);

  if (appState.myUser.isMicOn && appState.localMicStream) {
    appState.localMicStream.getTracks().forEach((track) => {
      pc.addTrack(track, appState.localMicStream);
    });
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc-ice-candidate', {
        targetId: senderId,
        candidate: event.candidate,
        type: 'voice'
      });
    }
  };

  pc.ontrack = (event) => {
    const MediaStreamClass = window.MediaStream || globalThis.MediaStream;
    const stream = event.streams && event.streams[0] ? event.streams[0] : new MediaStreamClass([event.track]);
    attachVoiceStream(senderId, stream);
  };

  try {
    const SessionDescription = window.RTCSessionDescription || globalThis.RTCSessionDescription;
    await pc.setRemoteDescription(new SessionDescription(sdp));
    await drainIceCandidates(`voice:${senderId}`, pc);

    const answer = await pc.createAnswer();
    answer.sdp = enhanceOpusVoiceSdp(answer.sdp);
    await pc.setLocalDescription(answer);
    await applySenderBitrates(pc, 0, VOICE_BITRATE);

    socket.emit('webrtc-answer', {
      targetId: senderId,
      sdp: pc.localDescription,
      type: 'voice'
    });
  } catch (err) {
    console.error(`[WebRTC] Error handling voice offer from ${senderId}:`, err);
  }
}

// -----------------------------------------------------------------------------
// 10. M2 WEBRTC & SYSTEM AUDIO PIPELINE HOOKS
// -----------------------------------------------------------------------------

function onWebRTCChannelChange(oldChannelId, newChannelId) {
  console.log(`[WebRTC] Channel changed from #${oldChannelId} to #${newChannelId}. Tearing down old mesh...`);

  // Close all inbound screen connections
  for (const [senderId, pc] of appState.screenPeersIn.entries()) {
    try { pc.close(); } catch (_) {}
    removeScreenStream(senderId);
  }
  appState.screenPeersIn.clear();

  // Close all outbound screen connections
  for (const [, pc] of appState.screenPeersOut.entries()) {
    try { pc.close(); } catch (_) {}
  }
  appState.screenPeersOut.clear();

  for (const userId of [...appState.sfuViewers.keys()]) {
    stopWatchingScreen(userId);
    removeScreenStream(userId);
  }

  // Close all voice connections
  stopSfuVoice();
  document.querySelectorAll('#voice-streams-container audio').forEach((el) => el.remove());
  for (const [peerId, pc] of appState.voicePeers.entries()) {
    try { pc.close(); } catch (_) {}
    const audioEl = document.getElementById(`voice-audio-${peerId}`);
    if (audioEl) audioEl.remove();
  }
  appState.voicePeers.clear();

  // Clear ICE queue
  appState.iceCandidatesQueue.clear();

  // If local user was sharing, stop screen share (e a câmera)
  if (appState.myUser.isSharing) {
    onStopScreenShare();
  }
  stopCameraShare({ silent: true });
  stopAllExtraScreens();

  // Fora da call, o Android não deve manter captura sem o serviço de microfone.
  if (window.TeletelaAndroid && !newChannelId) {
    appState.localMicStream?.getTracks().forEach(track => track.stop());
    appState.localMicStream = null;
    appState.vadDetector?.setEnabled(false);
    appState.myUser.isSpeaking = false;
  }

  updateStageLayout();
  updateVoiceLounge();
}

// -----------------------------------------------------------------------------
// CANCELAMENTO DE RUÍDO DO MICROFONE
// 'ia': RNNoise, como na 3.7
// 'basico': o filtro do próprio Chromium · 'off': microfone cru
// -----------------------------------------------------------------------------
function noiseMode() {
  return ['ia', 'basico', 'off'].includes(prefs.noiseSuppression) ? prefs.noiseSuppression : 'ia';
}

// Ganho do microfone (Configurações): 0–300%, aplicado pelo próprio Telinha. Serve pra quem
// tem o mic baixo no sistema (ou que o Windows fica abaixando) sem mexer no PC.
function micGainValue() {
  const pct = Number(prefs.micGain ?? 100);
  return Number.isFinite(pct) ? Math.max(0, Math.min(300, pct)) / 100 : 1;
}

// A mesma faixa processada alimenta o VAD, o P2P e o SFU.
async function processMicrophone(raw, noiseFilter) {
  const pipeline = await createMicrophonePipeline(raw, {
    noiseFilter, gain: micGainValue(),
    onStop: () => { if (appState.micProcessor === pipeline) appState.micProcessor = null; }
  });
  appState.micProcessor = pipeline;
  return pipeline.stream;
}

async function openMicrophone(deviceId) {
  const manager = appState.audioManager;
  const mode = noiseMode();
  const raw = await manager.acquireMicrophoneStream(deviceId ?? manager.selectedMicrophoneId, {
    noiseSuppression: mode === 'basico'
  });
  if (mode === 'ia') {
    try {
      return await processMicrophone(raw, 'rnnoise');
    } catch (err) {
      console.warn('[Mic] IA indisponível, usando o filtro básico:', err);
      showToast('⚠️ Cancelamento de ruído com IA indisponível; usando o básico.', 'error');
      raw.getTracks().forEach((t) => t.stop());
      const basic = await manager.acquireMicrophoneStream(deviceId ?? manager.selectedMicrophoneId, { noiseSuppression: true });
      return processMicrophone(basic, 'off').catch(() => basic);
    }
  }
  // Sem IA: só o ganho (se o Web Audio falhar, vai o microfone cru)
  return processMicrophone(raw, 'off').catch((err) => {
    console.warn('[Mic] Ganho indisponível, usando o microfone direto:', err);
    return raw;
  });
}

// Troca o microfone em uso (outro dispositivo ou outro filtro) sem derrubar as chamadas
async function restartMicrophone(deviceId) {
  try {
    const wasEnabled = appState.localMicStream?.getAudioTracks()[0]?.enabled ?? true;
    appState.localMicStream?.getTracks().forEach((t) => t.stop());
    appState.localMicStream = await openMicrophone(deviceId);
    const newTrack = appState.localMicStream.getAudioTracks()[0];
    if (newTrack) newTrack.enabled = wasEnabled;
    const voicePcs = [...appState.voicePeers.values()];
    // Voz pelo SFU: troca a faixa na mesma conexão (sem reconectar)
    const pub = appState.sfuVoicePublisher;
    if (pub) {
      pub.stream = appState.localMicStream;
      if (pub.pc) voicePcs.push(pub.pc);
    }
    for (const pc of voicePcs) {
      const sender = pc.getSenders?.().find((s) => s.track && s.track.kind === 'audio');
      if (sender && newTrack) {
        sender.replaceTrack(newTrack).catch(() => {});
      }
    }
    appState.vadDetector?.setStream(appState.localMicStream);
    syncMobileState(appState);
    return true;
  } catch (err) {
    console.warn('[Mic] Erro ao trocar o microfone:', err);
    return false;
  }
}

async function onMicrophoneToggle(isMicOn) {
  console.log(`[WebRTC] Microphone toggled: ${isMicOn ? 'ON' : 'OFF'}`);

  // O botão pode escolher o estado antes de entrar, sem abrir o microfone no Android.
  if (isMicOn && window.TeletelaAndroid && !appState.currentChannelId) return;

  if (isMicOn) {
    try {
      if (!appState.localMicStream?.getAudioTracks().some(track => track.readyState === 'live')) {
        appState.localMicStream = await openMicrophone();
      }

      // A permissão pode ter ficado aberta enquanto a pessoa saía da call.
      if (window.TeletelaAndroid && !appState.currentChannelId) {
        appState.localMicStream.getTracks().forEach(track => track.stop());
        appState.localMicStream = null;
        return;
      }

      // Mutar ou receber moderação durante a permissão também precisa ser respeitado.
      if (!appState.myUser.isMicOn || appState.myUser.isDeafened || isMicLockedByAdmin()) {
        onMicrophoneToggle(false);
        return;
      }

      appState.localMicStream.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });

      syncMobileState(appState);

      // Initialize or enable VAD
      if (!appState.vadDetector && appState.localMicStream) {
        appState.vadDetector = new VoiceActivityDetector(appState.localMicStream, {
          audioContext: appState.audioContext,
          onSpeakingChange: (speaking) => {
            appState.myUser.isSpeaking = speaking;
            updateSpeakingIndicators(appState.myId, speaking);
            socket.emit('user-state-changed', { isSpeaking: speaking });
          },
          onVolumeLevel: (norm) => {
            const meter = document.getElementById('vad-meter-bar');
            if (meter && meter.offsetParent !== null) {
              meter.style.width = `${Math.round(norm * 100)}%`;
              meter.style.background = norm > 0.35 ? 'var(--accent-green)' : 'var(--text-muted)';
            }
          }
        });
      } else if (appState.vadDetector) {
        appState.vadDetector.setStream(appState.localMicStream);
        appState.vadDetector.setEnabled(true);
      }

      // Sala com SFU: publica no servidor; sem SFU, oferece a voz pra cada um (P2P)
      syncSfuVoice();
      const ch = appState.sfuEnabled ? null : appState.channels.get(appState.currentChannelId);
      if (ch) {
        for (const [userId] of ch.users.entries()) {
          if (userId !== appState.myId) {
            createVoiceOfferForUser(userId);
          }
        }
      }
    } catch (err) {
      console.error('[WebRTC] Failed to acquire microphone:', err);
      appState.myUser.isMicOn = false;
      savePrefs({ micOn: false });
      updateMicButton();
      socket.emit('user-state-changed', { isMicOn: false });
      renderChannelsTree();
      updateVoiceLounge();
      showToast('❌ Permissão de microfone negada ou indisponível.', 'error');
    }
  } else {
    // Microphone turned OFF
    if (appState.localMicStream) {
      appState.localMicStream.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
    }

    if (appState.vadDetector) {
      appState.vadDetector.setEnabled(false);
    }

    appState.myUser.isSpeaking = false;
    updateSpeakingIndicators(appState.myId, false);
    socket.emit('user-state-changed', { isSpeaking: false });

    // CRITICAL ISOLATION CHECK: Screen audio track MUST remain untouched!
    if (appState.localScreenStream) {
      const screenAudio = appState.localScreenStream.getAudioTracks()[0];
      if (screenAudio && screenAudio.readyState === 'live') {
        console.log('[WebRTC Isolation] Screen loopback audio confirmed LIVE despite mic mute.');
      }
    }
  }
}

function onDeafenToggle(isDeafened) {
  console.log(`[WebRTC] Deafen toggled: ${isDeafened ? 'DEAFENED' : 'RESTORED'}`);

  if (appState.deafenController) {
    appState.deafenController.setDeafened(isDeafened);
  } else {
    appState.myUser.isDeafened = Boolean(isDeafened);
    const voiceAudios = document.querySelectorAll('#voice-streams-container audio');
    voiceAudios.forEach((audioEl) => {
      setRemoteElementMuted(audioEl, isDeafened);
    });

    for (const [userId, info] of appState.activeStreams.entries()) {
      if (!info.isLocal) {
        const videoEl = document.getElementById(`video-el-${userId}`);
        if (videoEl && prefs.deafenStreams === true) {
          setRemoteElementMuted(videoEl, isDeafened);
        }
      }
    }

    if (isDeafened) {
      if (appState.myUser.isMicOn) {
        appState._wasMicOnBeforeDeafen = true;
        appState.myUser.isMicOn = false;
        onMicrophoneToggle(false);
      }
    } else {
      if (appState._wasMicOnBeforeDeafen) {
        appState.myUser.isMicOn = true;
        onMicrophoneToggle(true);
      }
    }
  }

  // CRITICAL ISOLATION CHECK: Outbound screen loopback audio MUST continue playing for peers!
  if (appState.localScreenStream) {
    const screenAudio = appState.localScreenStream.getAudioTracks()[0];
    if (screenAudio) {
      screenAudio.enabled = true;
    }
  }
}

function promptElectronDesktopSource() {
  return new Promise(async (resolve) => {
    if (!window.electronAPI || typeof window.electronAPI.getDesktopSources !== 'function') {
      return resolve(null);
    }
    const modal = document.getElementById('modal-screen-picker');
    const grid = document.getElementById('screen-picker-grid');
    if (!modal || !grid) return resolve(null);

    let sources = [];
    try {
      sources = await window.electronAPI.getDesktopSources();
    } catch (_) {
      return resolve(null);
    }
    if (!Array.isArray(sources) || sources.length === 0) {
      return resolve(null);
    }

    let currentTab = 'screens';
    const tabs = modal.querySelectorAll('.picker-tab');

    const cleanup = (result) => {
      modal.classList.add('hidden');
      resolve(result);
    };

    const renderSources = () => {
      grid.innerHTML = '';
      const filtered = sources.filter((s) =>
        currentTab === 'screens' ? s.type === 'screen' : s.type === 'window'
      );
      const list = filtered.length > 0 ? filtered : sources;
      list.forEach((src) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'screen-picker-item';
        card.style.cssText = 'display:flex;flex-direction:column;gap:8px;background:var(--bg-secondary);border:1px solid var(--border-medium);border-radius:8px;padding:10px;color:var(--text-header);cursor:pointer;text-align:left;';
        card.innerHTML = `
          <img src="${src.thumbnail || ''}" alt="${escapeHtml(src.name)}" style="width:100%;height:130px;object-fit:contain;background:var(--bg-tertiary);border-radius:6px;" />
          <span style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(src.name)}</span>
        `;
        card.addEventListener('click', async () => {
          try {
            await window.electronAPI.selectDesktopSource(src.id);
          } catch (_) {}
          cleanup(src.id);
        });
        grid.appendChild(card);
      });
    };

    tabs.forEach((t) => {
      t.onclick = () => {
        tabs.forEach((btn) => btn.classList.remove('active'));
        t.classList.add('active');
        currentTab = t.getAttribute('data-picker-tab') || 'screens';
        renderSources();
      };
    });

    modal.querySelectorAll('[data-close-modal="modal-screen-picker"]').forEach((btn) => {
      btn.onclick = () => cleanup(false);
    });

    renderSources();
    renderQualityChoosers();
    modal.classList.remove('hidden');
  });
}

// Linux (app desktop): escolhe entre o som de um app só, o PC inteiro ou nenhum.
// Resolve { mode: 'app', key, name } | { mode: 'system' } | { mode: 'none' } | false (cancelou)
function promptAudioSource() {
  return new Promise((resolve) => {
    const api = window.electronAPI;
    const modal = document.getElementById('modal-audio-picker');
    const list = document.getElementById('audio-picker-list');
    if (!api || typeof api.listAudioApps !== 'function' || !modal || !list) {
      return resolve({ mode: 'system' });
    }

    const cleanup = (result) => {
      modal.classList.add('hidden');
      resolve(result);
    };

    const option = (label, hint, result) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--bg-secondary);border:1px solid var(--border-medium);border-radius:8px;padding:10px 12px;color:var(--text-header);cursor:pointer;text-align:left;font-size:14px;';
      btn.innerHTML = `<span>${label}</span><span style="font-size:12px;color:#949ba4;">${hint}</span>`;
      btn.addEventListener('click', () => cleanup(result));
      list.appendChild(btn);
    };

    const render = async () => {
      let apps = [];
      try {
        apps = await api.listAudioApps();
      } catch (_) {}
      list.innerHTML = '';
      apps.forEach((a) => {
        option(`🎮 ${escapeHtml(a.name)}`, a.playing ? '🔊 tocando agora' : 'pausado', {
          mode: 'app',
          key: a.key,
          name: a.name
        });
      });
      option('🖥️ Som do PC inteiro', 'inclui as vozes da chamada', { mode: 'system' });
      option('🔇 Sem som', 'só a imagem', { mode: 'none' });
    };

    modal.querySelectorAll('[data-close-modal="modal-audio-picker"]').forEach((btn) => {
      btn.onclick = () => cleanup(false);
    });
    const refresh = document.getElementById('audio-picker-refresh');
    if (refresh) refresh.onclick = render;

    renderQualityChoosers();
    render().then(() => modal.classList.remove('hidden'));
  });
}

// Windows: som de um app só via telinha-audio.exe (PCM 16-bit 48 kHz estéreo pelo IPC).
// O worklet guarda o PCM num buffer circular e toca silêncio quando o app está quieto.
const WIN_AUDIO_WORKLET = `
class TelinhaPcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 48000 * 2; // 1 s de estéreo intercalado
    this.buf = new Float32Array(this.size);
    this.read = 0;
    this.write = 0;
    this.port.onmessage = (e) => {
      const pcm = e.data;
      for (let i = 0; i < pcm.length; i++) {
        this.buf[this.write] = pcm[i] / 32768;
        this.write = (this.write + 1) % this.size;
      }
      // Mais de 150 ms acumulados (a página travou): pula pra frente pra não criar atraso
      const queued = (this.write - this.read + this.size) % this.size;
      if (queued > 48000 * 2 * 0.15) this.read = (this.write - 48000 * 2 * 0.04 + this.size) % this.size & ~1;
    };
  }
  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    for (let i = 0; i < left.length; i++) {
      if (this.read === this.write) {
        left[i] = 0;
        right[i] = 0;
        continue;
      }
      left[i] = this.buf[this.read];
      right[i] = this.buf[this.read + 1];
      this.read = (this.read + 2) % this.size;
    }
    return true;
  }
}
registerProcessor('telinha-pcm-player', TelinhaPcmPlayer);
`;

async function acquireWinProcessAudioTrack(sourceId) {
  const api = window.electronAPI;
  if (api?.platform !== 'win32' || typeof api.startWinAudio !== 'function') return null;
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  let unsubscribe = null;
  try {
    const url = URL.createObjectURL(new Blob([WIN_AUDIO_WORKLET], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(ctx, 'telinha-pcm-player', { outputChannelCount: [2] });
    const dest = ctx.createMediaStreamDestination();
    dest.channelCount = 2;
    node.connect(dest);

    // Pedaços do pipe podem cortar uma amostra no meio: guarda o byte que sobrar
    let leftover = null;
    unsubscribe = api.onWinAudioData((chunk) => {
      let bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      if (leftover) {
        const joined = new Uint8Array(leftover.length + bytes.length);
        joined.set(leftover);
        joined.set(bytes, leftover.length);
        bytes = joined;
        leftover = null;
      }
      const usable = bytes.length & ~1;
      if (usable < bytes.length) leftover = bytes.slice(usable);
      const pcm = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + usable));
      node.port.postMessage(pcm, [pcm.buffer]);
    });

    const started = await api.startWinAudio(sourceId);
    if (!started?.ok) throw new Error(started?.error || 'falhou');
    await ctx.resume().catch(() => {});

    const track = dest.stream.getAudioTracks()[0];
    appState.winAudioCapture = {
      stop: () => {
        unsubscribe?.();
        api.stopWinAudio().catch(() => {});
        ctx.close().catch(() => {});
      }
    };
    return track;
  } catch (err) {
    unsubscribe?.();
    api.stopWinAudio().catch(() => {});
    ctx.close().catch(() => {});
    throw err;
  }
}

function stopWinProcessAudio() {
  appState.winAudioCapture?.stop();
  appState.winAudioCapture = null;
}

// Windows: captura só o som do PC (loopback). O Chromium exige vídeo junto, então pede
// a tela em baixa resolução e descarta o vídeo, ficando só com a faixa de áudio.
async function acquireWindowsLoopbackTrack(sourceId) {
  let screenId = sourceId && sourceId.startsWith('screen:') ? sourceId : null;
  if (!screenId) {
    const sources = await window.electronAPI.getDesktopSources();
    screenId = sources.find((s) => s.type === 'screen')?.id;
  }
  const audioOnly = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'desktop' } },
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        ...(screenId ? { chromeMediaSourceId: screenId } : {}),
        maxWidth: 320,
        maxHeight: 180,
        maxFrameRate: 1
      }
    }
  });
  audioOnly.getVideoTracks().forEach((t) => t.stop());
  return audioOnly.getAudioTracks()[0] || null;
}

// Qualidade escolhida na hora de transmitir (dentro do primeiro modal do fluxo).
// Ordem igual à do antigo seletor do topo, que nunca chegou a ser lido.
const QUALITY_LABELS = {
  '720p30': '720p · 30 fps',
  '720p60': '720p · 60 fps',
  '1080p30': '1080p · 30 fps',
  '1080p60': '1080p · 60 fps',
  '1440p60': '1440p · 60 fps',
  nativa60: 'Nativa · 60 fps'
};

function renderQualityChoosers() {
  $$('[data-quality-chooser]').forEach((box) => {
    box.innerHTML = `
      <span class="quality-chooser-label">Qualidade da transmissão</span>
      <div class="quality-options">
        ${Object.entries(QUALITY_LABELS)
          .map(
            ([key, label]) =>
              `<button type="button" class="quality-option ${key === appState.myUser.streamQuality ? 'selected' : ''}" data-quality="${key}">${label}</button>`
          )
          .join('')}
      </div>
      <p class="quality-hint">Internet fraca ou amigos travando? Use 720p. 60 fps é melhor pra jogo; 30 fps pra filme.</p>
    `;
    box.querySelectorAll('[data-quality]').forEach((btn) => {
      btn.addEventListener('click', () => {
        appState.myUser.streamQuality = btn.dataset.quality;
        savePrefs({ streamQuality: btn.dataset.quality });
        renderQualityChoosers();
      });
    });
  });
}

// Navegador: não há modal de som nem de tela antes, então pergunta a qualidade aqui
function promptShareQuality() {
  return new Promise((resolve) => {
    const modal = $('#modal-share-quality');
    if (!modal) return resolve(true);
    const finish = (ok) => {
      modal.classList.add('hidden');
      resolve(ok);
    };
    $('#btn-share-quality-go').onclick = () => finish(true);
    modal.querySelectorAll('[data-close-modal="modal-share-quality"]').forEach((btn) => {
      btn.onclick = () => finish(false);
    });
    renderQualityChoosers();
    modal.classList.remove('hidden');
  });
}

async function onStartScreenShare() {
  if (!navigator.mediaDevices || (!navigator.mediaDevices.getDisplayMedia && !window.electronAPI)) {
    showToast('❌ Captura de tela não suportada ou bloqueada pelo navegador.', 'error');
    appState.myUser.isSharing = false;
    updateShareButton();
    return;
  }

  try {
    if (!window.electronAPI && !(await promptShareQuality())) {
      appState.myUser.isSharing = false;
      updateShareButton();
      return;
    }

    let audioChoice = { mode: 'system' };
    if (window.electronAPI?.platform === 'linux') {
      audioChoice = await promptAudioSource();
      if (audioChoice === false) {
        appState.myUser.isSharing = false;
        updateShareButton();
        return;
      }
    }

    let selectedElectronSourceId = null;
    if (
      window.electronAPI &&
      !window.electronAPI.isWayland &&
      typeof window.electronAPI.getDesktopSources === 'function'
    ) {
      selectedElectronSourceId = await promptElectronDesktopSource();
      if (selectedElectronSourceId === false) {
        // Usuário cancelou no modal
        appState.myUser.isSharing = false;
        updateShareButton();
        return;
      }
    }

    // Lida só agora: a qualidade pode ter sido trocada nos modais acima
    const presetKey = appState.myUser.streamQuality;
    const preset = QUALITY_PRESETS[presetKey] || QUALITY_PRESETS['1080p60'];
    console.log(`[WebRTC] Starting screen share with preset: ${presetKey}`);

    const isWindowsElectron = window.electronAPI?.platform === 'win32';
    let winAudioError = null;

    // Windows 10 2004+/11: som só do app da janela escolhida, ou do PC menos o Telinha.
    // Se o telinha-audio.exe falhar, cai no loopback do Chromium (som do PC inteiro).
    let processAudioTrack = null;
    if (isWindowsElectron) {
      processAudioTrack = await acquireWinProcessAudioTrack(selectedElectronSourceId).catch((err) => {
        console.warn('[WebRTC] Per-app audio unavailable, using system loopback:', err);
        return null;
      });
    }
    const wantLoopback = !processAudioTrack;

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: preset.width },
          height: { ideal: preset.height },
          frameRate: { ideal: preset.frameRate }
        },
        // getDisplayMedia rejeita constraints com min/exact (TypeError), só "ideal"
        audio: wantLoopback && {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 2 },
          sampleRate: { ideal: 48000 }
        },
        systemAudio: 'include',
        selfBrowserSurface: 'exclude'
      });
    } catch (innerErr) {
      if (innerErr.name === 'NotAllowedError') throw innerErr;
      console.warn('[WebRTC] getDisplayMedia with constraints failed, retrying plain:', innerErr);
      // Tentativa simples: ainda passa pelo handler do Electron (Windows = loopback com som do PC)
      try {
        if (selectedElectronSourceId) await window.electronAPI.selectDesktopSource(selectedElectronSourceId);
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: wantLoopback });
      } catch (plainErr) {
        if (plainErr.name === 'NotAllowedError') throw plainErr;
        console.warn('[WebRTC] Plain getDisplayMedia failed too:', plainErr);
      }
    }
    if (!stream) {
      if (selectedElectronSourceId) {
        const legacyVideo = {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: selectedElectronSourceId,
            maxWidth: preset.width,
            maxHeight: preset.height,
            maxFrameRate: preset.frameRate
          }
        };
        // Windows: o caminho antigo também pega o som do PC (loopback); se falhar, vai só a imagem
        if (isWindowsElectron && wantLoopback) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: { mandatory: { chromeMediaSource: 'desktop' } },
              video: legacyVideo
            });
          } catch (legacyErr) {
            winAudioError = legacyErr;
            console.warn('[WebRTC] Legacy desktop capture with audio failed:', legacyErr);
          }
        }
        if (!stream) stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: legacyVideo });
      } else {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      }
    }

    if (processAudioTrack) stream.addTrack(processAudioTrack);

    // Windows: a imagem veio mas o som não (loopback recusado) → pega o som do PC à parte
    if (isWindowsElectron && stream.getAudioTracks().length === 0) {
      const winTrack = await acquireWindowsLoopbackTrack(selectedElectronSourceId).catch((err) => {
        winAudioError = err;
        console.warn('[WebRTC] Windows loopback audio failed:', err);
        return null;
      });
      if (winTrack) stream.addTrack(winTrack);
    }

    // Linux: som de um app só, via saída virtual criada pelo app desktop
    if (audioChoice.mode === 'app') {
      let appTrack = null;
      try {
        const routed = await window.electronAPI.routeAppAudio(audioChoice.key);
        if (routed?.ok) {
          appState.appAudioRouted = true;
          appTrack = await appState.audioManager?.acquireAppAudioTrack();
        }
      } catch (appErr) {
        console.warn('[WebRTC] Could not capture app audio:', appErr);
      }
      if (appTrack) {
        stream.addTrack(appTrack);
      } else {
        showToast(`⚠️ Não consegui pegar o som de ${audioChoice.name}. Transmitindo só a imagem.`, 'error');
      }
    }

    // Linux PipeWire / PulseAudio System Audio Loopback fallback
    if (audioChoice.mode === 'system' && stream.getAudioTracks().length === 0) {
      try {
        let sysTrack = null;
        if (appState.audioManager) {
          sysTrack = await appState.audioManager.acquireSystemAudioTrack();
        } else {
          const devs = await refreshAudioDevices(true);
          const sysDev = devs.defaultSystemAudio;
          if (sysDev) {
            const sysStream = await navigator.mediaDevices.getUserMedia(
              generateSystemAudioConstraints(sysDev.deviceId)
            );
            sysTrack = sysStream.getAudioTracks()[0];
          }
        }

        if (sysTrack) {
          sysTrack.contentHint = 'music';
          stream.addTrack(sysTrack);
          console.log('[WebRTC] Attached Linux system audio loopback to screen stream.');
        }
      } catch (sysErr) {
        console.warn('[WebRTC] Could not capture Linux system audio loopback:', sysErr);
      }
    }

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.contentHint = preset.frameRate >= 60 ? 'motion' : 'detail';
      videoTrack.onended = () => {
        onStopScreenShare();
      };
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.contentHint = 'music';
    }

    appState.localScreenStream = stream;
    appState.myUser.isSharing = true;

    // Register local tile
    showLocalPreview(appState.myId, `${appState.myUser.name} (Você)`, stream);

    // Notify peers in channel
    socket.emit('user-state-changed', { isSharing: true, streamQuality: presetKey });

    if (appState.sfuEnabled) {
      // Manda uma vez pro servidor, que repassa pra todo mundo do canal
      appState.sfuPublisher = new SfuSession({ ownerId: appState.myId, role: 'host', stream });
      appState.sfuPublisher.start();
    }
    // Sem SFU, cada amigo pede o vídeo (request-stream) quando clica no "AO VIVO"

    if (stream.getAudioTracks().length > 0 && audioChoice.mode === 'app') {
      showToast(`🎬 Transmissão ao vivo iniciada com o som de ${audioChoice.name}!`, 'success');
    } else if (processAudioTrack && selectedElectronSourceId?.startsWith('window:')) {
      showToast('🎬 Transmissão ao vivo iniciada com o som só desse app!', 'success');
    } else if (processAudioTrack) {
      showToast('🎬 Transmissão ao vivo iniciada com o som do PC (sem as vozes da call)!', 'success');
    } else if (stream.getAudioTracks().length > 0) {
      showToast('🎬 Transmissão ao vivo iniciada com Som do PC (Estéreo 48kHz)!', 'success');
    } else if (winAudioError) {
      showToast(`⚠️ Transmissão sem som do PC (${winAudioError.name || 'erro'}: ${winAudioError.message || '?'}).`, 'error');
    } else {
      showToast('⚠️ Transmissão iniciada sem som do sistema.');
    }
  } catch (err) {
    if (err.name !== 'NotAllowedError') {
      console.error('[WebRTC] Failed to start screen sharing:', err);
      showToast(`❌ Erro ao iniciar captura: ${err.message || err.name}`, 'error');
    }
    if (appState.appAudioRouted) {
      appState.appAudioRouted = false;
      window.electronAPI?.unrouteAppAudio?.().catch(() => {});
    }
    stopWinProcessAudio();
    appState.myUser.isSharing = false;
    updateShareButton();
  }
}

// Câmera: transmissão separada da tela (dá pra ter as duas ligadas ao mesmo tempo).
// Os amigos veem o selo "📷 CÂMERA" e clicam pra assistir, igual ao "AO VIVO".
let cameraSource = null;
function getCameraSource() {
  if (cameraSource) return cameraSource;
  cameraSource = new CameraSource({
    onState({ busy, facing }) {
      appState.cameraBusy = busy;
      appState.cameraFacingMode = facing;
      syncMobileState(appState);
    },
    onLost: () => stopCameraShare({ silent: true }),
    async onStream(stream, previous, active) {
      appState.localCameraStream = stream;
      appState.myUser.isCameraOn = true;
      document.getElementById('btn-share-camera')?.classList.add('sharing');
      if (previous) {
        const track = stream.getVideoTracks()[0];
        const replace = async (pc, retry) => {
          const sender = pc?.getSenders().find(s => s.track?.kind === 'video');
          if (!sender) return;
          try { await sender.replaceTrack(track); }
          catch (error) {
            if (active()) { console.warn('[Câmera] Reconectando vídeo:', error); retry(); }
          }
        };
        const publisher = appState.sfuCameraPublisher;
        const jobs = [replace(publisher?.pc, () => {
          if (appState.sfuCameraPublisher !== publisher) return;
          publisher.close();
          appState.sfuCameraPublisher = new SfuSession({ ownerId: appState.myId, role: 'host', kind: 'camera', stream });
          appState.sfuCameraPublisher.start();
        })];
        for (const [key, pc] of appState.screenPeersOut) {
          if (streamKind(key) !== 'camera') continue;
          jobs.push(replace(pc, () => {
            if (appState.screenPeersOut.get(key) === pc) createScreenOfferForUser(streamOwner(key), 'camera');
          }));
        }
        await Promise.all(jobs);
      } else {
        socket.emit('user-state-changed', { isCameraOn: true });
        if (appState.sfuEnabled) {
          appState.sfuCameraPublisher = new SfuSession({ ownerId: appState.myId, role: 'host', kind: 'camera', stream });
          appState.sfuCameraPublisher.start();
        }
      }
      if (!active()) return;
      showLocalPreview(streamKey(appState.myId, 'camera'), streamLabel(streamKey(appState.myId, 'camera')), stream);
      renderChannelsTree();
      updateVoiceLounge();
    }
  });
  return cameraSource;
}

async function toggleCameraShare() {
  if (appState.myUser.isCameraOn || appState.cameraBusy) { stopCameraShare(); return; }
  if (!appState.currentChannelId) { showToast('Entre num canal pra ligar a câmera.'); return; }
  try {
    if (await getCameraSource().start()) showToast('📷 Câmera ligada! Seus amigos veem clicando em "CÂMERA" do seu lado.', 'success');
  } catch (error) {
    console.warn('[Câmera] Não abriu:', error);
    showToast(error.name === 'NotFoundError' ? '❌ Nenhuma câmera encontrada.' : '❌ Não consegui abrir a câmera.', 'error');
  }
}

async function flipCameraShare() {
  if (!appState.myUser.isCameraOn || appState.cameraBusy) return;
  try {
    if (await getCameraSource().flip()) showToast(appState.cameraFacingMode === 'environment' ? 'Câmera traseira ligada.' : 'Câmera frontal ligada.');
  } catch (error) {
    console.warn('[Câmera] Não trocou:', error);
    showToast(appState.myUser.isCameraOn ? 'Não consegui trocar a câmera. A câmera anterior continua ligada.' : error.message, 'error');
  }
}

function stopCameraShare({ silent = false } = {}) {
  if (!appState.myUser.isCameraOn && !appState.localCameraStream && !appState.cameraBusy) return;
  cameraSource?.stop();
  appState.myUser.isCameraOn = false;
  appState.localCameraStream?.getTracks().forEach((track) => track.stop());
  appState.localCameraStream = null;
  appState.sfuCameraPublisher?.close();
  appState.sfuCameraPublisher = null;
  for (const [key, pc] of [...appState.screenPeersOut.entries()]) {
    if (streamKind(key) !== 'camera') continue;
    try { pc.close(); } catch (_) {}
    appState.screenPeersOut.delete(key);
  }
  dropLocalPreview(streamKey(appState.myId, 'camera'));
  socket.emit('user-state-changed', { isCameraOn: false });
  document.getElementById('btn-share-camera')?.classList.remove('sharing');
  if (!silent) showToast('Câmera desligada.');
  renderChannelsTree();
  updateVoiceLounge();
}

// Prévia das minhas transmissões no palco. Dá pra esconder (Configurações ou menu do
// botão de transmitir): some só daqui, os amigos continuam vendo normalmente.
appState.localPreviews = new Map(); // chave -> { label, stream }

function showLocalPreview(key, label, stream) {
  appState.localPreviews.set(key, { label, stream });
  if (!prefs.hideOwnStream) registerScreenStream(key, label, stream, true);
}

function dropLocalPreview(key) {
  appState.localPreviews.delete(key);
  removeScreenStream(key);
}

function setHideOwnStream(hide) {
  savePrefs({ hideOwnStream: hide });
  for (const [key, { label, stream }] of appState.localPreviews) {
    if (hide) removeScreenStream(key);
    else registerScreenStream(key, label, stream, true);
  }
  const checkbox = $('#input-hide-own-stream');
  if (checkbox) checkbox.checked = hide;
  updateStageLayout();
  updateVoiceLounge();
}

// Botão de transmitir aceso enquanto qualquer tela minha estiver no ar
function updateShareButton() {
  const live = appState.myUser.isSharing || appState.extraScreens.size > 0;
  document.getElementById('btn-share-screen')?.classList.toggle('sharing', live);
  // O botão grande do meio abre o mesmo menu quando já tem tela no ar
  const label = document.getElementById('lounge-share-label');
  if (label) label.textContent = live ? 'Gerenciar minhas telas' : 'Transmitir minha tela';
}

function extraScreensState() {
  return [...appState.extraScreens.keys()].sort();
}

// Tela a mais (2 ou 3): só a imagem. O som do PC/app vai na tela 1, senão sairia repetido.
async function startExtraScreen() {
  const n = EXTRA_SCREEN_NUMBERS.find((num) => !appState.extraScreens.has(num));
  if (!n) {
    showToast(`Dá pra transmitir até ${EXTRA_SCREEN_NUMBERS.length + 1} telas ao mesmo tempo.`);
    return;
  }
  if (!appState.currentChannelId) return;
  const preset = QUALITY_PRESETS[appState.myUser.streamQuality] || QUALITY_PRESETS['1080p60'];
  let stream;
  try {
    if (window.electronAPI && !window.electronAPI.isWayland && typeof window.electronAPI.getDesktopSources === 'function') {
      const sourceId = await promptElectronDesktopSource();
      if (sourceId === false) return;
    }
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: preset.frameRate } },
      audio: false,
      selfBrowserSurface: 'exclude'
    });
  } catch (err) {
    if (err.name !== 'NotAllowedError') {
      console.error('[WebRTC] Tela extra não abriu:', err);
      showToast(`❌ Não consegui abrir a outra tela: ${err.message || err.name}`, 'error');
    }
    return;
  }
  // Escolheu enquanto outra tela ocupava esse número, ou saiu do canal no meio
  if (appState.extraScreens.has(n) || !appState.currentChannelId) {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }
  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.contentHint = preset.frameRate >= 60 ? 'motion' : 'detail';
    videoTrack.onended = () => stopExtraScreen(n);
  }
  const kind = `screen${n}`;
  const entry = { stream, publisher: null };
  appState.extraScreens.set(n, entry);
  showLocalPreview(streamKey(appState.myId, kind), streamLabel(streamKey(appState.myId, kind)), stream);
  socket.emit('user-state-changed', { extraScreens: extraScreensState() });
  if (appState.sfuEnabled) {
    entry.publisher = new SfuSession({ ownerId: appState.myId, role: 'host', kind, stream });
    entry.publisher.start();
  }
  // Sem SFU, cada amigo pede essa tela (request-stream "screenN") quando clica no selo
  updateShareButton();
  showToast(`🖥️ Tela ${n} no ar (só imagem; o som vai na tela 1).`, 'success');
  renderChannelsTree();
  updateVoiceLounge();
}

function stopExtraScreen(n, { silent = false } = {}) {
  const entry = appState.extraScreens.get(n);
  if (!entry) return;
  appState.extraScreens.delete(n);
  entry.stream.getTracks().forEach((track) => track.stop());
  entry.publisher?.close();
  const key = streamKey(appState.myId, `screen${n}`);
  if (appState.screenPeersOut.has(key)) {
    try { appState.screenPeersOut.get(key).close(); } catch (_) {}
    appState.screenPeersOut.delete(key);
  }
  dropLocalPreview(key);
  socket.emit('user-state-changed', { extraScreens: extraScreensState() });
  updateShareButton();
  if (!silent) showToast(`Tela ${n} encerrada.`);
  updateStageLayout();
  renderChannelsTree();
  updateVoiceLounge();
}

function stopAllExtraScreens() {
  for (const n of [...appState.extraScreens.keys()]) stopExtraScreen(n, { silent: true });
}

// Menu do botão de transmitir quando já tem tela no ar: pôr outra ou parar uma delas
function openShareMenu(anchor) {
  const menu = $('#share-menu');
  if (!menu) return;
  if (!menu.classList.contains('hidden')) {
    closeShareMenu();
    return;
  }
  const item = (label, action, danger = false) =>
    `<button type="button" class="share-menu-item${danger ? ' danger' : ''}" data-share-action="${action}">${label}</button>`;
  const rows = [];
  const total = (appState.myUser.isSharing ? 1 : 0) + appState.extraScreens.size;
  if (total < EXTRA_SCREEN_NUMBERS.length + 1) {
    rows.push(item(appState.myUser.isSharing ? '➕ Transmitir outra tela' : '➕ Transmitir a tela 1 (com som)', 'add'));
  }
  if (appState.myUser.isSharing) rows.push(item(appState.extraScreens.size ? '⏹ Parar a tela 1' : '⏹ Parar a transmissão', 'stop-1', true));
  for (const n of extraScreensState()) rows.push(item(`⏹ Parar a tela ${n}`, `stop-${n}`, true));
  if (total > 1) rows.push(item('⏹ Parar todas', 'stop-all', true));
  rows.push(item(prefs.hideOwnStream ? '👁 Mostrar minha transmissão aqui' : '🙈 Esconder minha transmissão daqui', 'toggle-preview'));
  menu.innerHTML = rows.join('');

  menu.classList.remove('hidden');
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menuRect.width - 8))}px`;
  menu.style.top = `${Math.max(8, rect.top - menuRect.height - 8)}px`;
}

function closeShareMenu() {
  $('#share-menu')?.classList.add('hidden');
}

function setupShareMenu() {
  const menu = $('#share-menu');
  if (!menu) return;
  menu.addEventListener('click', (e) => {
    const action = e.target.closest('[data-share-action]')?.getAttribute('data-share-action');
    if (!action) return;
    closeShareMenu();
    if (action === 'add') {
      if (appState.myUser.isSharing) {
        startExtraScreen();
      } else {
        appState.myUser.isSharing = true;
        updateShareButton();
        onStartScreenShare();
      }
    } else if (action === 'stop-1') {
      onStopScreenShare();
    } else if (action === 'toggle-preview') {
      setHideOwnStream(!prefs.hideOwnStream);
      showToast(prefs.hideOwnStream ? '🙈 Sua transmissão sumiu só daqui; os amigos continuam vendo.' : '👁 Sua transmissão voltou pro palco.');
    } else if (action === 'stop-all') {
      stopAllExtraScreens();
      onStopScreenShare();
    } else if (action.startsWith('stop-')) {
      stopExtraScreen(Number(action.slice(5)));
    }
    renderChannelsTree();
    updateVoiceLounge();
  });
  document.addEventListener('mousedown', (e) => {
    if (menu.classList.contains('hidden') || menu.contains(e.target)) return;
    if (e.target.closest('#btn-share-screen, #btn-lounge-start-share')) return;
    closeShareMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeShareMenu();
  });
}

function onStopScreenShare() {
  if (!appState.myUser.isSharing && !appState.localScreenStream) return;
  console.log('[WebRTC] Stopping screen share...');

  appState.myUser.isSharing = false;

  if (appState.localScreenStream) {
    appState.localScreenStream.getTracks().forEach((track) => track.stop());
    appState.localScreenStream = null;
  }

  if (appState.appAudioRouted) {
    appState.appAudioRouted = false;
    window.electronAPI?.unrouteAppAudio?.().catch(() => {});
  }
  stopWinProcessAudio();
  appState.sfuPublisher?.close();
  appState.sfuPublisher = null;

  // Só as conexões da tela; as da câmera continuam
  for (const [key, pc] of [...appState.screenPeersOut.entries()]) {
    if (streamKind(key) !== 'screen') continue;
    try { pc.close(); } catch (_) {}
    appState.screenPeersOut.delete(key);
  }

  dropLocalPreview(appState.myId);

  socket.emit('user-state-changed', { isSharing: false });

  updateShareButton();

  showToast('Transmissão de tela encerrada.');
  updateStageLayout();
  updateVoiceLounge();
}

function setupWebRTCSignaling(sock) {
  if (!sock) return;

  // 1. Incoming WebRTC Offer
  sock.on('webrtc-offer', async ({ senderId, sdp, type }) => {
    console.log(`[WebRTC] Received ${type} offer from ${senderId}`);
    if (isStreamKind(type)) {
      await handleIncomingScreenOffer(senderId, sdp, type);
    } else if (type === 'voice') {
      await handleIncomingVoiceOffer(senderId, sdp);
    }
  });

  // 2. Incoming WebRTC Answer
  sock.on('webrtc-answer', async ({ senderId, sdp, type }) => {
    console.log(`[WebRTC] Received ${type} answer from ${senderId}`);
    const SessionDescription = window.RTCSessionDescription || globalThis.RTCSessionDescription;
    if (isStreamKind(type)) {
      const key = streamKey(senderId, type);
      const pc = appState.screenPeersOut.get(key);
      if (pc && pc.signalingState !== 'stable') {
        await pc.setRemoteDescription(new SessionDescription(sdp));
        await drainIceCandidates(`screen-out:${key}`, pc);
      }
    } else if (type === 'voice') {
      const pc = appState.voicePeers.get(senderId);
      if (pc && pc.signalingState !== 'stable') {
        await pc.setRemoteDescription(new SessionDescription(sdp));
        await drainIceCandidates(`voice:${senderId}`, pc);
      }
    }
  });

  // 3. Incoming ICE Candidate
  sock.on('webrtc-ice-candidate', async ({ senderId, candidate, type }) => {
    if (!candidate) return;
    const IceCandidate = window.RTCIceCandidate || globalThis.RTCIceCandidate;
    try {
      // "<kind>-out" vem de quem transmite (vai pra minha conexão de assistir) e "<kind>-in" de quem assiste
      const [kind, dir] = String(type).split('-');
      if (isStreamKind(kind) && dir === 'out') {
        const key = streamKey(senderId, kind);
        const pc = appState.screenPeersIn.get(key);
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new IceCandidate(candidate));
        } else {
          enqueueIceCandidate(`screen-in:${key}`, candidate);
        }
      } else if (isStreamKind(kind) && dir === 'in') {
        const key = streamKey(senderId, kind);
        const pc = appState.screenPeersOut.get(key);
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new IceCandidate(candidate));
        } else {
          enqueueIceCandidate(`screen-out:${key}`, candidate);
        }
      } else if (type === 'voice') {
        const pc = appState.voicePeers.get(senderId);
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new IceCandidate(candidate));
        } else {
          enqueueIceCandidate(`voice:${senderId}`, candidate);
        }
      }
    } catch (e) {
      console.warn(`[WebRTC ICE] Error processing candidate from ${senderId}:`, e);
    }
  });

  // 4. Stream Request Handler
  sock.on('request-stream', ({ requesterId, type }) => {
    console.log(`[WebRTC] Stream requested by ${requesterId} (type: ${type})`);
    if (type === 'screen' && appState.myUser.isSharing && appState.localScreenStream && !appState.sfuEnabled) {
      createScreenOfferForUser(requesterId);
    } else if (type !== 'screen' && isStreamKind(type) && localStreamFor(type) && !appState.sfuEnabled) {
      // Câmera ou tela extra
      createScreenOfferForUser(requesterId, type);
    } else if (type === 'voice' && appState.myUser.isMicOn && appState.localMicStream) {
      createVoiceOfferForUser(requesterId);
    }
  });

  // 5. Unified Fallback Signal Handler
  sock.on('webrtc-signal', async ({ sender, type, signal }) => {
    if (!signal) return;
    const SessionDescription = window.RTCSessionDescription || globalThis.RTCSessionDescription;
    const IceCandidate = window.RTCIceCandidate || globalThis.RTCIceCandidate;
    if (signal.type === 'offer') {
      if (type === 'screen') await handleIncomingScreenOffer(sender, signal);
      else if (type === 'voice') await handleIncomingVoiceOffer(sender, signal);
    } else if (signal.type === 'answer') {
      const pc = type === 'screen' ? appState.screenPeersOut.get(sender) : appState.voicePeers.get(sender);
      if (pc && pc.signalingState !== 'stable') {
        await pc.setRemoteDescription(new SessionDescription(signal));
      }
    } else if (signal.candidate) {
      const pc = type === 'screen'
        ? (appState.screenPeersIn.get(sender) || appState.screenPeersOut.get(sender))
        : appState.voicePeers.get(sender);
      if (pc && pc.remoteDescription) {
        await pc.addIceCandidate(new IceCandidate(signal.candidate));
      }
    }
  });
}

// -----------------------------------------------------------------------------
// 11. INITIALIZATION & AUDIO SUBSYSTEM SETUP
// -----------------------------------------------------------------------------

function initAudioSystem() {
  const AudioContextClass = typeof window !== 'undefined'
    ? (window.AudioContext || window.webkitAudioContext)
    : null;

  if (AudioContextClass) {
    try {
      appState.audioContext = new AudioContextClass();
    } catch (_) {}
  }

  appState.mixerManager = new VolumeMixerManager({ audioContext: appState.audioContext });
  appState.mixerManager.setMasterVolume(prefs.masterVolume ?? 100);
  appState.mixerManager.setDeafenStreams(prefs.deafenStreams === true);
  appState.audioManager = new AudioManager({ volumeMixer: appState.mixerManager });
  appState.deafenController = new DeafenController({
    appState,
    mixerManager: appState.mixerManager,
    socket,
    vadDetector: appState.vadDetector
  });

  if (typeof window !== 'undefined') {
    window.appState = appState;
    window.audioManager = appState.audioManager;
    window.mixerManager = appState.mixerManager;
    window.deafenController = appState.deafenController;
  }
}

// O módulo espera as preferências (await no topo): o DOMContentLoaded pode já ter passado
function initApp() {
  // Links e recargas também começam fora da call, mantendo o endereço do servidor no app.
  const params = new URLSearchParams(window.location.search);
  if (params.has('channel')) {
    params.delete('channel');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }
  initAudioSystem();
  musicUI = setupMusic({ socket, appState, prefs, savePrefs, showToast, createSfuSession: options => new SfuSession(options) });
  diceUI = setupDice({ socket, appState, showToast, escapeHtml });
  stageSocialUI = setupStageSocial({ appState, prefs, savePrefs, music: musicUI,
    avatarInnerHtml, safeColor, frameClass, frameStyle, nameStyle, sortedUsers,
    isWatching: () => appState.activeStreams.size > 0,
    openUserPopover });
  setupMobileUI({ getState: () => appState, openChat: openCallChat, showRoom: closeTextView, openSettings });
  updateUserDockProfile();
  setupDockControls();
  setupServerHome();
  setupWhatsNew();
  setupChatAndReactions();
  setupChatImages();
  setupTextChannels();
  channelOrganizer = setupChannelOrganization({ socket, state: appState, prefs, savePrefs, showToast, mountStageOverlay, renderVoice: renderChannelsTree, renderText: renderTextChannels });
  channelOrganizer.refresh();
  setupChatExtras({ socket, state: appState, prefs, savePrefs, showToast, mountStageOverlay, switchChannel, closeUserPopover });
  setupMessageSearch({ socket, appState, showToast, mountStageOverlay });
  setupCategoryCollapse();
  setupChatMessageActions();
  setupRoomPassword();
  setupTyping();
  setupConnectionTooltip();
  setupPins();
  setupProfileTransfer();
  setupMentionAutocomplete();
  setupSoundboard();
  setupModals();
  setupUserPopover();
  setupProfileSettings();
  setupImageCrop();
  setupHotkeys();
  setupSidebarResize();
  setupMasterVolume();
  setupMicGain();
  setupThemeSelect();
  setupAutostart();
  setupPersonalization({ prefs, savePrefs, showToast });
  setupTransmissionDiagnostics({ mountStageOverlay, getConnections: () => {
    const list = [];
    const add = (pc, label, direction, route) => { if (pc && pc.connectionState !== 'closed') list.push({ pc, label, direction, route }); };
    const name = id => appState.channels.get(appState.currentChannelId)?.users.get(id)?.name || 'Amigo';
    add(appState.sfuPublisher?.pc, 'Sua tela', 'outbound', 'SFU');
    add(appState.sfuCameraPublisher?.pc, 'Sua câmera', 'outbound', 'SFU');
    for (const [n, entry] of appState.extraScreens) add(entry.publisher?.pc, `Sua tela ${n}`, 'outbound', 'SFU');
    for (const [key, session] of appState.sfuViewers) add(session.pc, streamLabel(key), 'inbound', 'SFU');
    for (const [key, pc] of appState.screenPeersIn) add(pc, streamLabel(key), 'inbound', 'Direta');
    for (const [key, pc] of appState.screenPeersOut) add(pc, `Enviando ${streamKind(key) === 'camera' ? 'câmera' : 'tela'} para ${name(streamOwner(key))}`, 'outbound', 'Direta');
    return list;
  } });
  setupPerformanceSelect();
  setupGameActivity();
  setupAdminSettings();
  setupShareMenu();
  updateMicButton();
  const hideOwnInput = $('#input-hide-own-stream');
  if (hideOwnInput) {
    hideOwnInput.checked = Boolean(prefs.hideOwnStream);
    hideOwnInput.addEventListener('change', () => setHideOwnStream(hideOwnInput.checked));
  }
  const deafenStreamsInput = $('#input-deafen-streams');
  if (deafenStreamsInput) {
    deafenStreamsInput.checked = prefs.deafenStreams === true;
    deafenStreamsInput.addEventListener('change', () => {
      savePrefs({ deafenStreams: deafenStreamsInput.checked });
      appState.mixerManager?.setDeafenStreams(deafenStreamsInput.checked);
      updateStageLayout();
    });
  }
  setupCallSoundChoices();
  const controlSoundsInput = $('#input-control-sounds');
  if (controlSoundsInput) {
    controlSoundsInput.checked = prefs.controlSounds !== false;
    controlSoundsInput.addEventListener('change', () => {
      savePrefs({ controlSounds: controlSoundsInput.checked });
      if (!controlSoundsInput.checked) stopControlSound();
    });
  }
  const controlSoundSetInput = $('#select-control-sound-set');
  if (controlSoundSetInput) {
    controlSoundSetInput.value = prefs.controlSoundSet === 'alternativos' ? 'alternativos' : 'originais';
    controlSoundSetInput.addEventListener('change', () => {
      stopControlSound();
      savePrefs({ controlSoundSet: controlSoundSetInput.value });
    });
  }
  const callSoundsInput = $('#input-call-sounds');
  if (callSoundsInput) {
    callSoundsInput.checked = prefs.callSounds !== false;
    callSoundsInput.addEventListener('change', () => savePrefs({ callSounds: callSoundsInput.checked }));
  }
  renderChannelsTree();
  updateTopBar();
  renderChannelChat(appState.currentChannelId);
  updateVoiceLounge();
  if (isFirstRun) openProfileSettings();
  showWhatsNewOnce();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp);
else initApp();

