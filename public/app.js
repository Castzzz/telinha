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

function savePrefs(patch) {
  Object.assign(prefs, patch);
  if (window.electronAPI?.setPrefs) {
    window.electronAPI.setPrefs(patch).catch(() => {});
    return;
  }
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (_) {}
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

function updateMicButton() {
  const on = appState.myUser.isMicOn;
  $('#btn-toggle-mic')?.classList.toggle('active-muted', !on);
  const micIcon = $('#dock-mic-icon');
  if (micIcon) micIcon.innerHTML = on ? MIC_ON_SVG : MIC_OFF_SVG;
  updateDeafenButton();
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
const isFirstRun = !prefs.profile;
const myProfile = {
  id: prefs.profile?.id || randomId(),
  name: prefs.profile?.name || localStorage.getItem('telinha_username') || `Amigo-${Math.floor(1000 + Math.random() * 9000)}`,
  color: prefs.profile?.color || localStorage.getItem('telinha_user_color') || PROFILE_COLORS[0],
  bio: prefs.profile?.bio || '',
  avatar: prefs.profile?.avatar || '',
  nameColor: prefs.profile?.nameColor || ''
};
if (isFirstRun) savePrefs({ profile: { ...myProfile } });

function profilePayload() {
  return {
    profileId: myProfile.id,
    name: myProfile.name,
    color: myProfile.color,
    bio: myProfile.bio,
    avatar: myProfile.avatar,
    nameColor: myProfile.nameColor
  };
}

const initialUsername = myProfile.name;
const initialColor = myProfile.color;
const initialChannel = (new URLSearchParams(window.location.search).get('channel') || localStorage.getItem('telinha_last_channel') || 'geral').toLowerCase();

const appState = {
  myId: null,
  myUser: {
    name: initialUsername,
    color: initialColor,
    isSharing: false,
    isCameraOn: false,
    isMicOn: false,
    isDeafened: false,
    isSpeaking: false,
    streamQuality: QUALITY_PRESETS[prefs.streamQuality] ? prefs.streamQuality : '1080p60'
  },
  currentChannelId: initialChannel,
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
const SERVER_URL = (() => {
  const fromQuery = new URLSearchParams(window.location.search).get('server');
  return fromQuery && /^https?:\/\//.test(fromQuery) ? fromQuery.replace(/\/+$/, '') : window.location.origin;
})();

const socket = io(SERVER_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000
});

// -----------------------------------------------------------------------------
// 4. SIGNALING EVENT HANDLERS
// -----------------------------------------------------------------------------
// Ao entrar na call (abrindo o app ou voltando depois de "Sair da call") o microfone abre
// sozinho quando o canal responder. Trocar de canal ou reconectar mantém o mute como estava.
let openMicOnJoin = false;
let connectedOnce = false;

function openMicAfterJoin() {
  if (!openMicOnJoin) return;
  openMicOnJoin = false;
  if (appState.myUser.isMicOn || appState.myUser.isDeafened || isMicLockedByAdmin()) return;
  appState.myUser.isMicOn = true;
  updateMicButton();
  onMicrophoneToggle(true);
  socket.emit('user-state-changed', { isMicOn: true, isDeafened: appState.myUser.isDeafened });
  renderChannelsTree();
  updateVoiceLounge();
}

// Admin: a senha fica salva por sala (cada servidor tem a sua) e vai sozinha ao conectar
appState.isAdmin = false;
appState.serverHasAdmin = false;

function savedAdminKey() {
  return prefs.adminKeys?.[SERVER_URL] || '';
}

function saveAdminKey(key) {
  const adminKeys = { ...(prefs.adminKeys || {}) };
  if (key) adminKeys[SERVER_URL] = key;
  else delete adminKeys[SERVER_URL];
  savePrefs({ adminKeys });
}

function adminLogin(key, onDone) {
  socket.emit('admin-login', { key }, (res) => {
    appState.isAdmin = Boolean(res?.success);
    renderAdminSettings();
    renderChannelsTree();
    renderTextChannels();
    updateVoiceLounge();
    onDone?.(res || {});
  });
}

socket.on('connect', () => {
  appState.myId = socket.id;
  console.log(`[Socket.IO] Conectado ao servidor! ID: ${socket.id}`);

  appState.isAdmin = false;
  const adminKey = savedAdminKey();
  if (adminKey) {
    adminLogin(adminKey, (res) => {
      // Senha trocada no servidor: esquece a velha
      if (!res.success) saveAdminKey('');
    });
  }

  // Send join-channel with current user state (fora da call não entra em nenhum)
  if (!appState.currentChannelId) return;
  if (!connectedOnce) openMicOnJoin = true;
  connectedOnce = true;
  socket.emit('join-channel', {
    channelId: appState.currentChannelId,
    userName: appState.myUser.name,
    profile: profilePayload(),
    isMicOn: appState.myUser.isMicOn,
    isDeafened: appState.myUser.isDeafened,
    isSharing: appState.myUser.isSharing
  });
});

socket.on('disconnect', (reason) => {
  console.warn(`[Socket.IO] Desconectado: ${reason}`);
  showToast('Desconectado do servidor. Reconectando...', 'error');
});

socket.on('reconnect', () => {
  showToast('Reconectado com sucesso!', 'success');
  if (!appState.currentChannelId) return;
  socket.emit('join-channel', {
    channelId: appState.currentChannelId,
    userName: appState.myUser.name,
    isMicOn: appState.myUser.isMicOn,
    isDeafened: appState.myUser.isDeafened,
    isSharing: appState.myUser.isSharing
  });
});

// Nome e cor vêm do nosso perfil; o servidor só sugere um aleatório antes do join
socket.on('me', ({ id, sfu, admin }) => {
  appState.myId = id;
  // Sala com SFU (servidor na nuvem): transmissões passam pelo servidor, não P2P
  appState.sfuEnabled = Boolean(sfu);
  appState.serverHasAdmin = Boolean(admin);
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
      isDefault: ch.isDefault,
      createdBy: ch.createdBy || null,
      userCount: ch.userCount ?? userMap.size,
      activeStreams: ch.activeStreams ?? 0,
      users: userMap
    });
  });

  renderChannelsTree();
  updateTopBar();
  updateVoiceLounge();
  syncSfuVoice();
};

// O servidor manda cada evento com dois nomes (compatibilidade). Escutar os dois
// rodava tudo duas vezes: avisos repetidos e ofertas de vídeo criadas em dobro.
socket.on('channels-list', handleChannelsSummary);

socket.on('channel-state', ({ channelId, channelName, me, users, recentMessages, soundSeed }) => {
  // Eu entrei: ouço o mesmo áudio que tocou pra quem já estava no canal
  playCallSound(soundSeed);
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
  openMicAfterJoin();
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
    playCallSound(data.soundSeed);
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

async function playCallSound(soundSeed) {
  if (prefs.callSounds === false || appState.myUser.isDeafened) return;
  // Muita gente entrando junto (servidor reiniciou): um som só
  const now = Date.now();
  if (now - lastCallSoundAt < 1500) return;
  lastCallSoundAt = now;
  // Servidor antigo (sem soundSeed): sorteia aqui mesmo
  const index = Number.isInteger(soundSeed) ? soundSeed % CALL_SOUNDS.length : Math.floor(Math.random() * CALL_SOUNDS.length);
  const url = CALL_SOUNDS[index];
  const mixer = appState.mixerManager;
  try {
    const ctx = mixer?.audioContext;
    if (!ctx || !mixer.masterDeafenGain) {
      await new Audio(url).play();
      return;
    }
    let buffer = callSoundBuffers.get(url);
    if (!buffer) {
      const res = await fetch(url);
      if (!res.ok) return;
      buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      callSoundBuffers.set(url, buffer);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(mixer.masterDeafenGain);
    source.start();
  } catch (err) {
    console.warn('[Som] Não tocou o som de entrada/saída:', err);
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
    playCallSound(data.soundSeed);
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
  if (ch && ch.users.has(userId)) {
    const u = ch.users.get(userId);
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
      if (channelId === appState.currentChannelId && userId !== appState.myId) {
        const audioEl = document.getElementById(`voice-audio-${userId}`);
        if (audioEl) {
          setRemoteElementMuted(audioEl, !state.isMicOn || appState.myUser.isDeafened);
        }
        // Quem ligou o mic manda a oferta pra todo mundo; pedir aqui duplicava a conexão
      }
    }
    if (typeof state.isDeafened === 'boolean') u.isDeafened = state.isDeafened;
    if (typeof state.isSpeaking === 'boolean') {
      u.isSpeaking = state.isSpeaking;
      updateSpeakingIndicators(userId, state.isSpeaking);
    }
  }

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

  if (msg.channelId === appState.currentChannelId) {
    if (!appState.textView) appendChatMessage(msg, true);
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
function switchChannel(targetChannelId) {
  if (!targetChannelId) return;
  const cleanId = targetChannelId.toLowerCase();
  if (cleanId === appState.currentChannelId) return;

  const oldChannelId = appState.currentChannelId;
  if (!oldChannelId) openMicOnJoin = true;
  appState.currentChannelId = cleanId;
  appState.unreadChannels.delete(cleanId);
  localStorage.setItem('telinha_last_channel', cleanId);

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

  // Notify server
  socket.emit('join-channel', {
    channelId: cleanId,
    userName: appState.myUser.name,
    isMicOn: appState.myUser.isMicOn,
    isDeafened: appState.myUser.isDeafened,
    isSharing: appState.myUser.isSharing
  });

  const targetCh = appState.channels.get(cleanId);
  const targetName = targetCh ? targetCh.name : cleanId;
  addSystemChatMessage(`Você entrou no canal #${targetName}.`, cleanId);
  showToast(`Conectado a #${targetName}`);
}

// Sair da call sem fechar o app: desliga voz e transmissões e fica fora de todos os canais.
// Clicar num canal da lista entra de novo.
function leaveCall() {
  if (!appState.currentChannelId) return;
  // Eu saí: o servidor responde com o áudio que tocou pros outros
  socket.emit('leave-channel', {}, (res) => playCallSound(res?.soundSeed));
  leaveCallLocally();
  showToast('Você saiu da call. Clique num canal pra entrar de novo.');
}

// Desliga voz e transmissões e fica fora dos canais (o servidor já sabe ou vai saber à parte)
function leaveCallLocally() {
  const oldChannelId = appState.currentChannelId;
  if (!oldChannelId) return;
  onWebRTCChannelChange(oldChannelId, null);
  appState.currentChannelId = null;
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
  playCallSound();
  showToast(`🚪 ${by || 'Um admin'} tirou você da call. Clique num canal pra entrar de novo.`, 'error');
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
  if (localStorage.getItem('telinha_last_channel') === channelId) localStorage.removeItem('telinha_last_channel');
  renderChannelsTree();
});

// Ícones de mutado/ensurdecido; com a 🛡️ quando foi o admin
function muteIndicatorsHtml(u) {
  const byAdmin = '<span class="admin-lock" aria-hidden="true">🛡️</span>';
  let html = '';
  if (!u.isMicOn) {
    html += u.serverMuted || u.serverDeafened
      ? `<span class="indicator-icon mic-muted" title="Mutado pelo admin">${MIC_OFF_SVG}${byAdmin}</span>`
      : `<span class="indicator-icon mic-muted" title="Microfone Mutado">${MIC_OFF_SVG}</span>`;
  }
  if (u.isDeafened) {
    html += u.serverDeafened
      ? `<span class="indicator-icon mic-muted" title="Ensurdecido pelo admin">${HEADPHONES_OFF_SVG}${byAdmin}</span>`
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
  showToast(`➡️ ${by || 'Um admin'} te levou pra #${channelName || channelId}.`);
});

// Admin me mutou / ensurdeceu (ou desfez)
socket.on('server-moderation', ({ serverMuted, serverDeafened, by } = {}) => {
  const me = appState.myUser;
  const wasDeafenedByAdmin = me.serverDeafened;
  me.serverMuted = Boolean(serverMuted);
  me.serverDeafened = Boolean(serverDeafened);
  if (isMicLockedByAdmin() && me.isMicOn) {
    me.isMicOn = false;
    onMicrophoneToggle(false);
  }
  if (me.serverDeafened && !me.isDeafened) onDeafenToggle(true);
  else if (wasDeafenedByAdmin && !me.serverDeafened && me.isDeafened) onDeafenToggle(false);
  updateMicButton();
  renderChannelsTree();
  updateVoiceLounge();
  if (me.serverDeafened) showToast(`🎧 ${by || 'Um admin'} te ensurdeceu.`, 'error');
  else if (me.serverMuted) showToast(`🔇 ${by || 'Um admin'} te mutou pra todos.`, 'error');
  else showToast(`🎙️ ${by || 'Um admin'} liberou seu microfone.`, 'success');
});

function canDeleteChannel(ch) {
  if (!ch || ch.isDefault) return false;
  return appState.isAdmin || Boolean(ch.createdBy && ch.createdBy === myProfile.id);
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

  // Sort channels: default first in standard order, then custom by creation
  channelIds.sort((a, b) => {
    const idxA = defaultOrder.indexOf(a);
    const idxB = defaultOrder.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
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

  channelIds.forEach((chId) => {
    const ch = appState.channels.get(chId);
    if (!ch) return;

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
      <span class="channel-speaker-icon">${icon}</span>
      <span class="channel-name">${escapeHtml(ch.name)}</span>
      ${userCount > 0 ? `<span class="channel-count" id="count-${chId}">${userCount}</span>` : ''}
      ${canDeleteChannel(ch) ? `<button type="button" class="channel-delete-btn" title="Apagar canal" aria-label="Apagar canal ${escapeHtml(ch.name)}">🗑️</button>` : ''}
    `;

    row.querySelector('.channel-delete-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteChannel(chId);
    });
    // Solta aqui a pessoa arrastada (admin)
    li.addEventListener('dragover', (e) => {
      if (!appState.isAdmin || !e.dataTransfer.types.includes(DRAG_USER_TYPE)) return;
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
      if (!userId || !appState.isAdmin) return;
      e.preventDefault();
      if (ch.users.has(userId)) return;
      moveUserToChannel(userId, chId);
    });
    row.addEventListener('click', () => switchChannel(chId));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        switchChannel(chId);
      }
    });

    li.appendChild(row);

    // Nested Users List
    const usersUl = document.createElement('ul');
    usersUl.className = 'channel-users';
    usersUl.id = `channel-users-${chId}`;

    ch.users.forEach((u) => {
      const isMe = u.id === appState.myId;

      const userLi = document.createElement('li');
      userLi.className = `channel-user ${isMe ? 'is-me' : ''} ${u.isSpeaking ? 'is-speaking' : ''}`;
      userLi.setAttribute('data-user-id', u.id);
      userLi.setAttribute('data-username', u.name);

      userLi.innerHTML = `
        <div class="user-avatar-wrap ${u.isSpeaking ? 'is-speaking' : ''}">
          <div class="user-avatar" style="background-color: ${safeColor(u.color)};">
            ${avatarInnerHtml(u)}
          </div>
          <span class="speaking-halo"></span>
        </div>
        <span class="channel-user-name">
          <span class="user-name-text"${nameStyle(u)}>${escapeHtml(u.name)}</span>
          ${u.isAdmin ? '<span class="badge-admin" title="Admin">👑</span>' : ''}
          ${isMe ? '<span class="badge-self">(Você)</span>' : ''}
        </span>
        <div class="user-indicators">
          ${liveBadgesHtml(u, { compact: true })}
          ${muteIndicatorsHtml(u)}
          ${!isMe && getVolumePref(u).muted ? `<span class="indicator-icon local-muted" title="Silenciado por você">🔕</span>` : ''}
        </div>
      `;
      userLi.title = isMe ? 'Editar seu perfil' : 'Ver perfil e ajustar volume';
      // Admin arrasta a pessoa pra outra call, igual no Discord
      if (appState.isAdmin) {
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
        if (isMe) openProfileModal();
        else openUserPopover(u.id, e);
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
}

function updateTopBar() {
  const inCall = Boolean(appState.currentChannelId);
  const ch = appState.channels.get(appState.currentChannelId);
  const name = ch ? ch.name : appState.currentChannelId || 'Fora da call';
  const count = ch ? ch.users.size : inCall ? 1 : 0;

  $('#btn-leave-call')?.classList.toggle('hidden', !inCall);

  const topName = $('#topbar-channel-name');
  if (topName) topName.textContent = name;

  const topCount = $('#topbar-users-count');
  if (topCount) topCount.textContent = String(count);

  const textCh = appState.textView ? appState.textChannels.get(appState.textView) : null;
  const chatLabel = $('#chat-channel-label');
  if (chatLabel) chatLabel.textContent = textCh ? `#${textCh.name}` : `#${name}-chat`;
  $('#btn-chat-back-voice')?.classList.toggle('hidden', !textCh || !inCall);

  const chatInput = $('#chat-input');
  if (chatInput) {
    // Canal de texto não precisa estar em call
    chatInput.disabled = !inCall && !textCh;
    chatInput.placeholder = textCh
      ? `Mensagem em #${textCh.name}...`
      : inCall ? `Conversar em #${name}...` : 'Entre num canal pra conversar';
  }
}

function updateVoiceLounge() {
  const lounge = $('#voice-lounge');
  const videosGrid = $('#videos-grid');
  if (!lounge) return;

  const ch = appState.channels.get(appState.currentChannelId);
  const name = ch ? ch.name : appState.currentChannelId;

  const title = $('#lounge-channel-title');
  if (title) {
    title.textContent = appState.currentChannelId ? `Canal de Voz: ${name}` : 'Fora da call: clique num canal da lista pra entrar';
  }

  const iconEl = $('#lounge-channel-icon');
  if (iconEl) {
    if (ch?.id === 'cinema') iconEl.textContent = '🎬';
    else if (ch?.id === 'futebol') iconEl.textContent = '⚽';
    else if (ch?.id === 'gameplay') iconEl.textContent = '🎮';
    else iconEl.textContent = '🔊';
  }

  // Populate users in lounge
  const loungeUsersGrid = $('#lounge-users-grid');
  if (loungeUsersGrid) {
    loungeUsersGrid.innerHTML = '';
    const users = ch ? Array.from(ch.users.values()) : [];

    users.forEach((u) => {
      const isMe = u.id === appState.myId;

      const card = document.createElement('div');
      card.className = 'lounge-user-card';
      card.innerHTML = `
        <div class="user-avatar-wrap ${u.isSpeaking ? 'is-speaking' : ''}">
          <div class="user-avatar" style="background-color: ${safeColor(u.color)};">
            ${avatarInnerHtml(u)}
          </div>
          <span class="speaking-halo"></span>
        </div>
        <span class="lounge-user-name"><span class="user-name-text"${nameStyle(u)}>${escapeHtml(u.name)}</span>${u.isAdmin ? ' <span class="badge-admin" title="Admin">👑</span>' : ''}${isMe ? ' (Você)' : ''}</span>
        <div class="user-indicators">
          ${liveBadgesHtml(u)}
          ${muteIndicatorsHtml(u)}
          ${!isMe && getVolumePref(u).muted ? `<span class="indicator-icon" title="Silenciado por você">🔕</span>` : ''}
        </div>
      `;
      card.title = isMe ? 'Editar seu perfil' : 'Ver perfil e ajustar volume';
      card.addEventListener('click', (e) => {
        if (isMe) openProfileModal();
        else openUserPopover(u.id, e);
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
    nameEl.style.color = nameStyle(myProfile) ? myProfile.nameColor : '';
  }

  const avatar = $('#dock-user-avatar');
  if (avatar) {
    avatar.style.backgroundColor = safeColor(appState.myUser.color);
    avatar.innerHTML = avatarInnerHtml({ id: appState.myId, name: appState.myUser.name });
  }
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

function avatarInnerHtml(u) {
  const initials = avatarInitials(u?.name);
  const src = avatarSrc(u?.id, u?.avatarV);
  if (!src) return `<span>${initials}</span>`;
  return `<img src="${escapeHtml(src)}" alt="" data-initials="${initials}" />`;
}

document.addEventListener('error', (e) => {
  const img = e.target;
  if (img?.tagName === 'IMG' && img.dataset.initials !== undefined) {
    const span = document.createElement('span');
    span.textContent = img.dataset.initials;
    img.replaceWith(span);
  }
}, true);

// Cores entram em style="": só aceita hex pra ninguém injetar CSS pelo perfil
function safeColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#5865f2';
}

// Cor do nome escolhida no perfil (sem ela, a cor normal do tema)
function nameStyle(u) {
  return /^#[0-9a-f]{6}$/i.test(u?.nameColor || '') ? ` style="color: ${u.nameColor};"` : '';
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

  const div = document.createElement('div');
  div.className = 'chat-msg';

  const when = new Date(msg.timestamp || Date.now());
  const hour = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  // Canal de texto guarda mensagens de outros dias: aí mostra a data também
  const time = when.toDateString() === new Date().toDateString()
    ? hour
    : `${when.toLocaleDateString([], { day: '2-digit', month: '2-digit' })} ${hour}`;
  const color = safeColor(msg.userColor);
  const author = { id: msg.senderId || msg.userId, name: msg.userName || msg.senderName, avatarV: msg.userAvatarV };

  div.innerHTML = `
    <div class="chat-msg-avatar" style="background-color: ${color};">
      ${avatarInnerHtml(author)}
    </div>
    <div class="chat-msg-body">
      <div class="chat-msg-header">
        <span class="chat-author" style="color: ${msg.userNameColor ? safeColor(msg.userNameColor) : color};">${escapeHtml(msg.userName || msg.senderName)}</span>
        <span class="chat-time">${time}</span>
      </div>
      ${msg.text ? `<div class="chat-text">${linkifyText(msg.text)}</div>` : ''}
      ${chatImageHtml(msg.image)}
    </div>
  `;
  // Imagem que demora a carregar empurra o chat: desce de novo quando ela chegar
  const img = div.querySelector('.chat-image');
  if (img && autoScroll) img.addEventListener('load', () => { container.scrollTop = container.scrollHeight; }, { once: true });

  container.appendChild(div);

  if (autoScroll) {
    container.scrollTop = container.scrollHeight;
  }
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
    html += escapeHtml(raw.slice(last, match.index));
    html += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="chat-link">${escapeHtml(url)}</a>`;
    last = match.index + url.length;
  }
  return html + escapeHtml(raw.slice(last));
}

function chatImageHtml(image) {
  if (!image || typeof image.url !== 'string' || !/^\/api\/(chat|text)-image\/[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(image.url)) return '';
  const size = image.width && image.height ? ` width="${Number(image.width)}" height="${Number(image.height)}"` : '';
  return `<img class="chat-image" src="${escapeHtml(SERVER_URL + image.url)}"${size} alt="Imagem" loading="lazy" />`;
}

// Prepara a imagem pro chat: foto parada é reduzida (lado maior até 1920 px, WebP);
// GIF vai como está pra continuar animado. Máximo 8 MB.
const MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024;
const CHAT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

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
      if (file.size > MAX_CHAT_IMAGE_BYTES) throw new Error('GIF grande demais (máximo 8 MB).');
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
    if (out.size > MAX_CHAT_IMAGE_BYTES) throw new Error('Imagem grande demais (máximo 8 MB).');
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
  if (!appState.currentChannelId && !textChannelId) {
    showToast('Entre num canal pra mandar imagem.');
    return;
  }
  if (sendingChatImage) return;
  sendingChatImage = true;
  const input = $('#chat-input');
  try {
    const image = await prepareChatImage(file);
    showToast('📎 Enviando imagem...');
    // A legenda é o que estiver escrito no campo
    const text = input?.value.trim() || '';
    const res = textChannelId
      ? await socket.timeout(60000).emitWithAck('text-image', { ...image, text, channelId: textChannelId })
      : await socket.timeout(60000).emitWithAck('chat-image', { ...image, text });
    if (res?.success) {
      if (input) input.value = '';
    } else {
      showToast(`❌ ${res?.error || 'Não deu pra mandar a imagem.'}`, 'error');
    }
  } catch (err) {
    showToast(`❌ ${err?.message || 'Não deu pra mandar a imagem.'}`, 'error');
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
  // Ctrl+V com imagem no campo do chat
  $('#chat-input')?.addEventListener('paste', (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    sendChatImage(file);
  });
  // Arrastar imagem pro chat
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
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
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
    viewerImg.src = img.src;
    viewer.classList.remove('hidden');
  });
  viewer?.addEventListener('click', () => viewer.classList.add('hidden'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') viewer?.classList.add('hidden');
  });
}

// -----------------------------------------------------------------------------
// CANAIS DE TEXTO: o histórico fica salvo no servidor. Abrem no painel do chat, sem
// precisar estar (nem sair) de call nenhuma.
// -----------------------------------------------------------------------------
appState.textChannels = new Map(); // id -> { id, name, createdBy, createdAt, lastMessageAt }
appState.textView = null; // canal de texto aberto no chat (null = chat da call)
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
  for (const ch of appState.textChannels.values()) {
    const li = document.createElement('li');
    const active = appState.textView === ch.id;
    const unread = !active && ch.lastMessageAt > textLastSeen(ch.id);
    li.className = `channel-item ${active ? 'channel-active' : ''} ${unread ? 'channel-unread' : ''}`;
    li.dataset.textChannelId = ch.id;
    li.innerHTML = `
      <div class="channel-row" role="button" tabindex="0">
        <span class="channel-speaker-icon channel-hash">#</span>
        <span class="channel-name">${escapeHtml(ch.name)}</span>
        ${canDeleteChannel(ch) ? `<button type="button" class="channel-delete-btn" title="Apagar canal" aria-label="Apagar canal ${escapeHtml(ch.name)}">🗑️</button>` : ''}
      </div>
    `;
    const row = li.querySelector('.channel-row');
    row.addEventListener('click', () => openTextChannel(ch.id));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openTextChannel(ch.id);
      }
    });
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
}

function openTextChannel(id) {
  if (!appState.textChannels.has(id)) return;
  appState.textView = id;
  const drawer = $('#chat-drawer');
  drawer?.classList.remove('collapsed');
  $('#btn-toggle-chat')?.classList.add('active');
  markTextSeen(id);
  renderTextChannels();
  updateTopBar();
  const state = appState.textMessages.get(id);
  if (state) renderTextChat();
  else loadTextHistory(id);
  $('#chat-input')?.focus();
}

function closeTextView() {
  if (!appState.textView) return;
  appState.textView = null;
  renderTextChannels();
  updateTopBar();
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
  // O canal aberto foi apagado enquanto estávamos desconectados
  if (appState.textView && !appState.textChannels.has(appState.textView)) closeTextView();
  renderTextChannels();
  updateTopBar();
});

socket.on('text-message', (msg) => {
  const ch = appState.textChannels.get(msg?.channelId);
  if (!ch) return;
  ch.lastMessageAt = msg.timestamp;
  const state = appState.textMessages.get(msg.channelId);
  if (state && !state.messages.some((m) => m.id === msg.id)) state.messages.push(msg);
  if (appState.textView === msg.channelId) {
    appendChatMessage(msg, true);
    markTextSeen(msg.channelId);
  }
  renderTextChannels();
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
  const container = $('#reactions-layer');
  if (!container) return;

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
  const settingsBtn = $('#btn-open-settings');

  // Mic Mute Toggle
  micBtn?.addEventListener('click', () => {
    if (!appState.myUser.isMicOn && isMicLockedByAdmin()) {
      showToast(appState.myUser.serverDeafened ? '🎧 Um admin te ensurdeceu.' : '🔇 Um admin te mutou pra todos.', 'error');
      return;
    }
    appState.myUser.isMicOn = !appState.myUser.isMicOn;
    if (appState.myUser.isMicOn && appState.myUser.isDeafened) {
      appState.myUser.isDeafened = false;
    }

    updateMicButton();

    onMicrophoneToggle(appState.myUser.isMicOn);

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
      showToast('🎧 Um admin te ensurdeceu.', 'error');
      return;
    }
    const nextDeafened = !appState.myUser.isDeafened;
    onDeafenToggle(nextDeafened);

    updateMicButton();

    socket.emit('user-state-changed', {
      isDeafened: appState.myUser.isDeafened,
      isMicOn: appState.myUser.isMicOn
    });

    renderChannelsTree();
    updateVoiceLounge();
    showToast(appState.myUser.isDeafened ? 'Áudio desativado (Deafened)' : 'Áudio restaurado');
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
  $('#btn-share-camera')?.addEventListener('click', toggleCameraShare);

  // Settings Modal Open
  settingsBtn?.addEventListener('click', () => {
    $('#modal-settings')?.classList.remove('hidden');
  });
}

function setupChatAndReactions() {
  // Chat form
  const chatForm = $('#chat-form');
  const chatInput = $('#chat-input');

  chatForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput?.value?.trim();
    if (!text) return;

    if (appState.textView) {
      socket.emit('text-message', { channelId: appState.textView, text: text.slice(0, 2000) }, (res) => {
        if (!res?.success) showToast(`❌ ${res?.error || 'Não deu pra mandar a mensagem.'}`, 'error');
      });
    } else {
      socket.emit('chat-message', {
        text: text.slice(0, 600)
      });
    }

    chatInput.value = '';
  });

  // Toggle Chat Drawer
  $('#btn-toggle-chat')?.addEventListener('click', () => {
    const drawer = $('#chat-drawer');
    if (drawer) {
      drawer.classList.toggle('collapsed');
      $('#btn-toggle-chat')?.classList.toggle('active', !drawer.classList.contains('collapsed'));
    }
  });

  $('#btn-close-chat')?.addEventListener('click', () => {
    $('#chat-drawer')?.classList.add('collapsed');
    $('#btn-toggle-chat')?.classList.remove('active');
  });

  // Emoji Reactions
  const sendReaction = (emoji) => {
    socket.emit('reaction', { emoji });
    spawnFloatingReaction(appState.myUser.name, emoji);
    countReactionUse(emoji);
  };
  $('#quick-reactions')?.addEventListener('click', (e) => {
    const emoji = e.target.closest('[data-emoji]')?.getAttribute('data-emoji');
    if (emoji) sendReaction(emoji);
  });
  renderQuickReactions();
  setupEmojiPicker(sendReaction);

  // Copy invite link
  $('#btn-copy-invite')?.addEventListener('click', () => {
    const url = `${SERVER_URL}/?channel=${encodeURIComponent(appState.currentChannelId || 'geral')}`;
    navigator.clipboard?.writeText(url).then(() => {
      showToast('Link de convite copiado!', 'success');
    }).catch(() => {
      showToast('Link: ' + url);
    });
  });
}

// Barra de reações rápidas: começa com estes e vai virando os emojis que você mais usa.
// Cada lugar só troca quando outro emoji passa o menos usado da barra (os botões não ficam
// pulando de posição enquanto você clica).
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
  if (changed) renderQuickReactions();
}

// Botão "+" das reações: seletor com todos os emojis e busca em português.
// O seletor (e a lista de emojis) só carrega na primeira vez que abre.
function setupEmojiPicker(onPick) {
  const btn = $('#btn-more-reactions');
  const popover = $('#emoji-picker-popover');
  if (!btn || !popover) return;

  let loading = null;
  const load = () => loading ??= Promise.all([
    import('./vendor/emoji-picker/picker.js'),
    import('./vendor/emoji-picker/pt_BR.js')
  ]).then(([{ default: Picker }, { default: i18n }]) => {
    const picker = new Picker({
      locale: 'pt',
      i18n,
      dataSource: new URL('vendor/emoji-picker/data-pt.json', window.location.href).href
    });
    picker.addEventListener('emoji-click', (e) => {
      if (e.detail?.unicode) onPick(e.detail.unicode);
      close();
    });
    popover.appendChild(picker);
    return picker;
  }).catch((err) => {
    loading = null;
    throw err;
  });

  const close = () => {
    popover.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  };
  const open = async () => {
    try {
      const picker = await load();
      picker.className = document.documentElement.dataset.theme === 'claro' ? 'light' : 'dark';
      popover.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      picker.shadowRoot?.querySelector('input.search')?.focus();
    } catch (err) {
      console.error('[Reações] Seletor de emojis não carregou:', err);
      showToast('❌ Não deu pra abrir os emojis.', 'error');
    }
  };

  btn.addEventListener('click', () => {
    if (popover.classList.contains('hidden')) open();
    else close();
  });
  document.addEventListener('mousedown', (e) => {
    if (!popover.classList.contains('hidden') && !popover.contains(e.target) && !btn.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !popover.classList.contains('hidden')) close();
  });
}

function setupModals() {
  // Open create channel modal
  const openCreateModal = (type = 'voice') => {
    const radio = document.querySelector(`input[name="channel-type"][value="${type}"]`);
    if (radio) radio.checked = true;
    $('#modal-create-channel')?.classList.remove('hidden');
    $('#input-channel-name')?.focus();
  };
  $('#btn-add-text-channel')?.addEventListener('click', () => openCreateModal('text'));

  $('#btn-header-add-channel')?.addEventListener('click', () => openCreateModal());
  $('#btn-add-channel-category')?.addEventListener('click', () => openCreateModal());
  $('#btn-open-create-modal')?.addEventListener('click', () => openCreateModal());

  // Close modals on buttons with data-close-modal
  $$('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close-modal');
      if (modalId) $(`#${modalId}`)?.classList.add('hidden');
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
    if (type === 'text') {
      socket.emit('create-text-channel', { name, profileId: myProfile.id }, (response) => {
        if (response?.success) openTextChannel(response.channelId);
        else showToast(`❌ ${response?.error || 'Não deu pra criar o canal.'}`, 'error');
      });
    } else {
      socket.emit('create-channel', { name, profileId: myProfile.id }, (response) => {
        if (response && response.channelId) {
          switchChannel(response.channelId);
        }
      });
    }

    input.value = '';
    $('#modal-create-channel')?.classList.add('hidden');
  });

  // Stream volume slider (0-300% GainNode boost)
  const volInput = $('#input-stream-volume');
  const volText = $('#stream-volume-text');
  volInput?.addEventListener('input', () => {
    const pct = Math.round(Number(volInput.value) * 100);
    if (volText) volText.textContent = `${pct}%`;
    if (appState.focusedStreamUserId) setStreamVolume(appState.focusedStreamUserId, pct);
  });

  $('#btn-stage-fullscreen')?.addEventListener('click', toggleStageFullscreen);
  $('#btn-stage-pip')?.addEventListener('click', toggleStagePip);
  $('#btn-stage-stop-watching')?.addEventListener('click', () => {
    // Mosaico: para todas; uma aberta: só ela (a sua própria transmissão fica)
    const ids = isMosaicView() ? [...appState.activeStreams.keys()] : [appState.focusedStreamUserId];
    ids.forEach((id) => {
      if (id && !appState.activeStreams.get(id)?.isLocal) unwatchScreen(id);
    });
  });

  // Populate audio devices in settings modal
  const populateSettingsDevices = async () => {
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
      console.warn('[Settings] Failed to populate audio devices:', e);
    }
  };

  $('#btn-open-settings')?.addEventListener('click', async () => {
    $('#modal-settings')?.classList.remove('hidden');
    await populateSettingsDevices();
  });

  $('#select-audio-input')?.addEventListener('change', async (e) => {
    const micId = e.target.value;
    appState.audioManager?.savePreferences(null, micId, null);
    if (appState.myUser.isMicOn && (await restartMicrophone(micId))) showToast('Microfone alterado');
  });

  const noiseSelect = $('#select-noise-suppression');
  if (noiseSelect) {
    noiseSelect.value = noiseMode();
    noiseSelect.addEventListener('change', async () => {
      savePrefs({ noiseSuppression: noiseSelect.value });
      if (appState.myUser.isMicOn) await restartMicrophone();
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
    const accelerator = eventToAccelerator(e);
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
function toggleStageFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    return;
  }
  // Mosaico: todas as telas juntas; uma aberta: só ela
  const target = isMosaicView()
    ? $('#videos-grid')
    : document.getElementById(`video-tile-${appState.focusedStreamUserId}`);
  if (!target || !appState.activeStreams.size) {
    showToast('Nenhuma transmissão pra colocar em tela cheia.');
    return;
  }
  target.requestFullscreen().catch((err) => {
    console.warn('[Stage] Tela cheia recusada:', err);
    showToast('❌ Não consegui abrir em tela cheia.', 'error');
  });
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
function findUser(userId) {
  for (const ch of appState.channels.values()) {
    const u = ch.users.get(userId);
    if (u) return u;
  }
  return null;
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
  // Mutado pelo admin: ninguém ouve, mesmo que o app dele insista em mandar a voz
  appState.setUserVolume(userId, muted || u.serverMuted || u.serverDeafened ? 0 : volume);
}

let popoverUserId = null;

function openUserPopover(userId, anchorEvent) {
  const u = findUser(userId);
  const pop = $('#user-popover');
  if (!u || !pop) return;
  popoverUserId = userId;

  const avatar = $('#user-popover-avatar');
  avatar.style.backgroundColor = safeColor(u.color);
  avatar.innerHTML = avatarInnerHtml(u);
  $('#user-popover-name').textContent = u.name;
  $('#user-popover-name').style.color = nameStyle(u) ? u.nameColor : '';
  $('#user-popover-bio').textContent = u.bio || '';
  renderUserPopoverVolume();
  $('#user-popover-kick')?.classList.toggle('hidden', !appState.isAdmin || !u.channelId);
  const adminRow = $('#user-popover-admin');
  adminRow?.classList.toggle('hidden', !appState.isAdmin);
  const muteAll = $('#user-popover-server-mute');
  if (muteAll) muteAll.textContent = u.serverMuted ? '🎙️ Desmutar pra todos' : '🔇 Mutar pra todos';
  const deafAll = $('#user-popover-server-deafen');
  if (deafAll) deafAll.textContent = u.serverDeafened ? '🎧 Tirar o ensurdecer' : '🎧 Ensurdecer pra todos';

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
  muteBtn.textContent = muted ? '🔕 Silenciado' : '🔇 Silenciar pra mim';
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

function openProfileModal() {
  closeUserPopover();
  profileDraft = { ...myProfile };
  $('#input-profile-name').value = profileDraft.name;
  $('#input-profile-bio').value = profileDraft.bio;
  renderProfileDraft();
  $('#modal-profile')?.classList.remove('hidden');
  $('#input-profile-name')?.focus();
}

function renderProfileDraft() {
  const preview = $('#profile-avatar-preview');
  preview.style.backgroundColor = safeColor(profileDraft.color);
  preview.innerHTML = profileDraft.avatar
    ? `<img src="${escapeHtml(profileDraft.avatar)}" alt="" />`
    : `<span>${avatarInitials($('#input-profile-name').value || profileDraft.name)}</span>`;
  $('#btn-profile-remove-avatar').classList.toggle('hidden', !profileDraft.avatar);

  const colors = $('#profile-colors');
  colors.innerHTML = '';
  for (const color of PROFILE_COLORS) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = `profile-color-swatch ${color.toLowerCase() === profileDraft.color.toLowerCase() ? 'selected' : ''}`;
    swatch.style.backgroundColor = color;
    swatch.title = color;
    swatch.addEventListener('click', () => {
      profileDraft.color = color;
      renderProfileDraft();
    });
    colors.appendChild(swatch);
  }
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.className = 'profile-color-custom';
  custom.title = 'Outra cor';
  custom.value = safeColor(profileDraft.color);
  custom.addEventListener('change', () => {
    profileDraft.color = custom.value;
    renderProfileDraft();
  });
  colors.appendChild(custom);

  // Cor do nome: aparece pra todo mundo na lista, na call e no chat
  const nameColors = $('#profile-name-colors');
  if (nameColors) {
    nameColors.innerHTML = '';
    const current = (profileDraft.nameColor || '').toLowerCase();
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = `btn-secondary profile-name-color-reset ${current ? '' : 'selected'}`;
    reset.textContent = 'Normal';
    reset.addEventListener('click', () => {
      profileDraft.nameColor = '';
      renderProfileDraft();
    });
    nameColors.appendChild(reset);
    for (const color of NAME_COLORS) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = `profile-color-swatch ${color.toLowerCase() === current ? 'selected' : ''}`;
      swatch.style.backgroundColor = color;
      swatch.title = color;
      swatch.addEventListener('click', () => {
        profileDraft.nameColor = color;
        renderProfileDraft();
      });
      nameColors.appendChild(swatch);
    }
    const customName = document.createElement('input');
    customName.type = 'color';
    customName.className = 'profile-color-custom';
    customName.title = 'Outra cor';
    customName.value = safeColor(profileDraft.nameColor);
    customName.addEventListener('change', () => {
      profileDraft.nameColor = customName.value;
      renderProfileDraft();
    });
    nameColors.appendChild(customName);
  }
  const namePreview = $('#profile-name-preview');
  if (namePreview) {
    namePreview.textContent = $('#input-profile-name').value || profileDraft.name;
    namePreview.style.color = profileDraft.nameColor || '';
  }
}

// Corta no meio e reduz pra 128×128: a foto fica leve (~10 KB) pra mandar pra sala
// GIF vai do jeito que está (redimensionar no canvas congela a animação), até 1 MB
const MAX_GIF_AVATAR_BYTES = 1024 * 1024;

async function resizeAvatar(file) {
  if (file.type === 'image/gif') {
    if (file.size > MAX_GIF_AVATAR_BYTES) throw Object.assign(new Error('GIF grande demais'), { tooBig: true });
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    canvas.getContext('2d').drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size
    );
    const webp = canvas.toDataURL('image/webp', 0.85);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function setupProfileModal() {
  $('#user-profile')?.addEventListener('click', openProfileModal);
  $('#user-profile')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openProfileModal();
    }
  });

  $('#input-profile-name')?.addEventListener('input', () => {
    if (profileDraft) renderProfileDraft();
  });

  $('#input-profile-avatar')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !profileDraft) return;
    try {
      profileDraft.avatar = await resizeAvatar(file);
      renderProfileDraft();
    } catch (err) {
      console.warn('[Perfil] Não consegui ler a imagem:', err);
      showToast(err?.tooBig ? '❌ GIF muito grande: o máximo é 1 MB.' : '❌ Não consegui abrir essa imagem.', 'error');
    }
  });

  $('#btn-profile-remove-avatar')?.addEventListener('click', () => {
    if (!profileDraft) return;
    profileDraft.avatar = '';
    renderProfileDraft();
  });

  $('#form-profile')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#input-profile-name').value.trim().slice(0, 24);
    if (!name || !profileDraft) return;
    Object.assign(myProfile, profileDraft, {
      name,
      bio: $('#input-profile-bio').value.trim().slice(0, 140)
    });
    savePrefs({ profile: { ...myProfile } });

    appState.myUser.name = myProfile.name;
    appState.myUser.color = myProfile.color;
    socket.emit('update-profile', profilePayload());

    updateUserDockProfile();
    renderChannelsTree();
    updateVoiceLounge();
    document.activeElement?.blur();
    $('#modal-profile')?.classList.add('hidden');
    showToast('Perfil salvo!', 'success');
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
  NumpadDivide: 'numdiv', NumpadDecimal: 'numdec'
};

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
  const parts = accelerator.split('+');
  const key = parts[parts.length - 1];
  return parts.some((p) => p === 'Ctrl' || p === 'Alt' || p === 'Super') ||
    /^F([1-9]|1[0-9]|2[0-4])$/.test(key) || ['Pause', 'Scrolllock', 'Insert'].includes(key);
}

function formatHotkey(accelerator) {
  if (!accelerator) return 'Nenhum';
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

  // Captura antes de todo mundo, pra tecla nova não mutar/fechar nada
  window.addEventListener('keydown', (e) => {
    if (!hotkeyCapture) return;
    e.preventDefault();
    e.stopPropagation();
    const action = hotkeyCapture;
    if (e.key === 'Escape') {
      hotkeyCapture = null;
      renderHotkeys();
      return;
    }
    if (e.key === 'Backspace') {
      hotkeyCapture = null;
      saveHotkey(action, null);
      return;
    }
    const accelerator = eventToAccelerator(e);
    if (!accelerator) return; // só apertou Ctrl/Shift: espera a tecla
    hotkeyCapture = null;
    saveHotkey(action, accelerator);
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
    const gain = appState.micGainNode;
    if (gain) gain.gain.setTargetAtTime(micGainValue(), gain.context.currentTime, 0.02);
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

// Configurações > Admin: só aparece em sala com senha de admin (a da nuvem)
function renderAdminSettings() {
  const group = $('#admin-settings');
  if (!group) return;
  group.classList.toggle('hidden', !appState.serverHasAdmin);
  $('#admin-login-row')?.classList.toggle('hidden', appState.isAdmin);
  $('#admin-logged-row')?.classList.toggle('hidden', !appState.isAdmin);
}

function setupAdminSettings() {
  const input = $('#input-admin-key');
  const loginBtn = $('#btn-admin-login');
  const login = () => {
    const key = input?.value.trim();
    if (!key) return;
    loginBtn.disabled = true;
    adminLogin(key, (res) => {
      loginBtn.disabled = false;
      if (res.success) {
        saveAdminKey(key);
        input.value = '';
        showToast('👑 Agora você é admin nessa sala.', 'success');
      } else {
        showToast(`❌ ${res.error || 'Senha errada.'}`, 'error');
      }
    });
  };
  loginBtn?.addEventListener('click', login);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('#btn-admin-logout')?.addEventListener('click', () => {
    saveAdminKey('');
    adminLogin('', () => showToast('Você não é mais admin nessa sala.'));
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

// Novidades da versão: mostra uma vez só (quem abre o app pela primeira vez vê o perfil, não isso)
const WHATS_NEW_VERSION = '2.2';
function showWhatsNewOnce() {
  if (prefs.seenWhatsNew === WHATS_NEW_VERSION) return;
  // Mostra também as novidades das versões que a pessoa pulou (sem nada visto = veio de antes da 2.0)
  const seen = Number.parseFloat(prefs.seenWhatsNew) || 0;
  savePrefs({ seenWhatsNew: WHATS_NEW_VERSION });
  if (isFirstRun) return;
  $('#whats-new-2-1')?.classList.toggle('hidden', seen >= 2.1);
  $('#whats-new-2-0')?.classList.toggle('hidden', seen >= 2.0);
  $('#modal-whats-new')?.classList.remove('hidden');
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
      document.body.classList.remove('resizing-sidebar');
      save();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp, { once: true });
    handle.addEventListener('pointercancel', onUp, { once: true });
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
  const screenLabel = (n) => (compact ? `🔴 ${n}` : `🔴 TELA ${n}`);
  return `${u.isSharing ? badge('screen', many ? screenLabel(1) : '🔴 AO VIVO') : ''}${extras.map((n) => badge(`screen${n}`, screenLabel(n))).join('')}${u.isCameraOn ? badge('camera', compact && many ? '📷' : '📷 CÂMERA') : ''}`;
}

// "AO VIVO" da lista: começa a assistir (se ainda não assiste) e abre essa transmissão
function openStream(userId) {
  if (streamOwner(userId) === appState.myId) {
    if (appState.activeStreams.has(userId)) focusStream(userId);
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
  if (videoEl && !appState.myUser.isDeafened && videoEl.dataset.mixerOutput !== '1') {
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
  tile.addEventListener('mouseleave', () => {
    clearTimeout(timer);
    tile.classList.remove('idle');
  });
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
    video.muted = isLocal || appState.myUser.isDeafened;

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

    // Clique: abre só essa transmissão / volta pro mosaico. Duplo clique: tela cheia.
    // O clique espera um instante pra não disparar junto com o duplo clique.
    let clickTimer = null;
    video.addEventListener('click', () => {
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => toggleExpandedStream(userId), 250);
    });
    video.addEventListener('dblclick', () => {
      clearTimeout(clickTimer);
      if (!document.fullscreenElement) {
        tile.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    tile.appendChild(badge);
    tile.appendChild(video);
    tile.appendChild(unmuteBtn);
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

function updateStageLayout() {
  const grid = document.getElementById('videos-grid');
  const lounge = document.getElementById('voice-lounge');
  const watchingLabel = document.getElementById('watching-stream-label');
  const streamTabs = document.getElementById('stream-tabs');

  const count = appState.activeStreams.size;

  if (count === 0) {
    if (grid) grid.classList.add('hidden');
    if (lounge) lounge.classList.remove('hidden');
    if (watchingLabel) watchingLabel.textContent = 'Nenhuma transmissão';
    if (streamTabs) streamTabs.innerHTML = '';
    $('#stream-volume-control')?.classList.add('hidden');
    return;
  }

  if (grid) grid.classList.remove('hidden');
  if (lounge) lounge.classList.add('hidden');

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
      if (!info.isLocal) {
        const close = document.createElement('span');
        close.className = 'stream-tab-close';
        close.textContent = '✕';
        close.title = 'Parar de assistir';
        close.addEventListener('click', (e) => {
          e.stopPropagation();
          unwatchScreen(uid);
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
      if (appState.myUser.isDeafened) {
        videoEl.muted = true;
      } else {
        videoEl.volume = Math.min(1.0, vol);
        setRemoteElementMuted(videoEl, !audible || vol === 0);
      }
    }
  }

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

  updateStageLayout();
  updateVoiceLounge();
}

// -----------------------------------------------------------------------------
// CANCELAMENTO DE RUÍDO DO MICROFONE
// 'ia': RNNoise (rede neural, tira teclado/ventilador/barulho de fundo)
// 'basico': o filtro do próprio Chromium · 'off': microfone cru
// -----------------------------------------------------------------------------
const RNNOISE_DIR = '/vendor/noise-suppressor';
let rnnoiseBinary = null;

function noiseMode() {
  return ['ia', 'basico', 'off'].includes(prefs.noiseSuppression) ? prefs.noiseSuppression : 'ia';
}

// Passa o microfone pelo RNNoise e devolve um stream com o som limpo.
// Parar a faixa limpa também solta o microfone de verdade e o AudioContext.
// Ganho do microfone (Configurações): 0–300%, aplicado pelo próprio Telinha. Serve pra quem
// tem o mic baixo no sistema (ou que o Windows fica abaixando) sem mexer no PC.
function micGainValue() {
  const pct = Number(prefs.micGain ?? 100);
  return Number.isFinite(pct) ? Math.max(0, Math.min(300, pct)) / 100 : 1;
}

// Passa o microfone por: [RNNoise, se ligado] → ganho → stream novo.
// Parar a faixa nova também solta o microfone de verdade e o AudioContext.
async function processMicrophone(raw, useRnnoise) {
  let rnnoise = null;
  if (useRnnoise) {
    rnnoise = await import(`${RNNOISE_DIR}/index.js`);
    rnnoiseBinary ||= await rnnoise.loadRnnoise({
      url: `${RNNOISE_DIR}/rnnoise.wasm`,
      simdUrl: `${RNNOISE_DIR}/rnnoise_simd.wasm`
    });
  }
  // O RNNoise só funciona em 48 kHz
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  let node = null;
  try {
    const source = ctx.createMediaStreamSource(raw);
    const gain = ctx.createGain();
    gain.gain.value = micGainValue();
    if (rnnoise) {
      await ctx.audioWorklet.addModule(`${RNNOISE_DIR}/rnnoise/workletProcessor.js`);
      node = new rnnoise.RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: rnnoiseBinary });
      source.connect(node).connect(gain);
    } else {
      source.connect(gain);
    }
    const dest = ctx.createMediaStreamDestination();
    gain.connect(dest);
    await ctx.resume().catch(() => {});
    appState.micGainNode = gain;

    const track = dest.stream.getAudioTracks()[0];
    track.contentHint = 'speech';
    const stopTrack = track.stop.bind(track);
    track.stop = () => {
      stopTrack();
      raw.getTracks().forEach((t) => t.stop());
      node?.destroy();
      if (appState.micGainNode === gain) appState.micGainNode = null;
      ctx.close().catch(() => {});
    };
    return dest.stream;
  } catch (err) {
    node?.destroy();
    ctx.close().catch(() => {});
    throw err;
  }
}

async function openMicrophone(deviceId) {
  const manager = appState.audioManager;
  const mode = noiseMode();
  const raw = await manager.acquireMicrophoneStream(deviceId ?? manager.selectedMicrophoneId, {
    noiseSuppression: mode === 'basico'
  });
  if (mode === 'ia') {
    try {
      return await processMicrophone(raw, true);
    } catch (err) {
      console.warn('[Mic] RNNoise indisponível, usando o filtro básico:', err);
      showToast('⚠️ Cancelamento de ruído com IA indisponível; usando o básico.', 'error');
      raw.getTracks().forEach((t) => t.stop());
      const basic = await manager.acquireMicrophoneStream(deviceId ?? manager.selectedMicrophoneId, { noiseSuppression: true });
      return processMicrophone(basic, false).catch(() => basic);
    }
  }
  // Sem IA: só o ganho (se o Web Audio falhar, vai o microfone cru)
  return processMicrophone(raw, false).catch((err) => {
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
    return true;
  } catch (err) {
    console.warn('[Mic] Erro ao trocar o microfone:', err);
    return false;
  }
}

async function onMicrophoneToggle(isMicOn) {
  console.log(`[WebRTC] Microphone toggled: ${isMicOn ? 'ON' : 'OFF'}`);

  if (isMicOn) {
    try {
      if (!appState.localMicStream || appState.localMicStream.getAudioTracks().length === 0) {
        appState.localMicStream = await openMicrophone();
      }

      appState.localMicStream.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });

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
            if (meter) {
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

      showToast('🎙️ Microfone ativado!');
    } catch (err) {
      console.error('[WebRTC] Failed to acquire microphone:', err);
      appState.myUser.isMicOn = false;
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

    showToast('🔇 Microfone desligado.');
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
        if (videoEl) {
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
async function toggleCameraShare() {
  if (appState.myUser.isCameraOn) {
    stopCameraShare();
    return;
  }
  if (!appState.currentChannelId) {
    showToast('Entre num canal pra ligar a câmera.');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: false
    });
  } catch (err) {
    console.warn('[Câmera] Não abriu:', err);
    showToast(err.name === 'NotFoundError' ? '❌ Nenhuma câmera encontrada.' : '❌ Não consegui abrir a câmera.', 'error');
    return;
  }
  const videoTrack = stream.getVideoTracks()[0];
  videoTrack.contentHint = 'motion';
  videoTrack.onended = () => stopCameraShare();

  appState.localCameraStream = stream;
  appState.myUser.isCameraOn = true;
  document.getElementById('btn-share-camera')?.classList.add('sharing');
  showLocalPreview(streamKey(appState.myId, 'camera'), streamLabel(streamKey(appState.myId, 'camera')), stream);
  socket.emit('user-state-changed', { isCameraOn: true });

  if (appState.sfuEnabled) {
    appState.sfuCameraPublisher = new SfuSession({ ownerId: appState.myId, role: 'host', kind: 'camera', stream });
    appState.sfuCameraPublisher.start();
  }
  // Sem SFU, cada amigo pede a câmera (request-stream 'camera') quando clica no selo
  showToast('📷 Câmera ligada! Seus amigos veem clicando em "CÂMERA" do seu lado.', 'success');
  renderChannelsTree();
  updateVoiceLounge();
}

function stopCameraShare({ silent = false } = {}) {
  if (!appState.myUser.isCameraOn && !appState.localCameraStream) return;
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
  const lounge = document.getElementById('btn-lounge-start-share');
  if (lounge) lounge.textContent = live ? '🖥️ Gerenciar minhas telas' : '🖥️ Transmitir Minha Tela';
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
  initAudioSystem();
  updateUserDockProfile();
  setupDockControls();
  setupChatAndReactions();
  setupChatImages();
  setupTextChannels();
  setupModals();
  setupUserPopover();
  setupProfileModal();
  setupHotkeys();
  setupSidebarResize();
  setupMasterVolume();
  setupMicGain();
  setupThemeSelect();
  setupAdminSettings();
  setupShareMenu();
  updateMicButton();
  const hideOwnInput = $('#input-hide-own-stream');
  if (hideOwnInput) {
    hideOwnInput.checked = Boolean(prefs.hideOwnStream);
    hideOwnInput.addEventListener('change', () => setHideOwnStream(hideOwnInput.checked));
  }
  const callSoundsInput = $('#input-call-sounds');
  if (callSoundsInput) {
    callSoundsInput.checked = prefs.callSounds !== false;
    callSoundsInput.addEventListener('change', () => savePrefs({ callSounds: callSoundsInput.checked }));
  }
  renderChannelsTree();
  updateTopBar();
  updateVoiceLounge();
  if (isFirstRun) openProfileModal();
  showWhatsNewOnce();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp);
else initApp();

