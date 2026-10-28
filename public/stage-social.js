// Modo Cinema: faixa recolhível de participantes da call, bot de música e reações dentro do palco (#video-stage)

const CHEVRON_DOWN_SVG = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
const CHEVRON_UP_SVG = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>';
const USERS_ICON_SVG = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
const MIC_OFF_SVG = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8"/><path d="M3 3l18 18"/></svg>';
const HEADPHONES_OFF_SVG = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/><path d="M3 3l18 18"/></svg>';
const SCREEN_SVG = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></svg>';
const MUSIC_BOT_SVG = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const NAME_COLLATOR = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function defaultSafeColor(color) {
  return HEX_COLOR_RE.test(color || '') ? color : '#5865f2';
}

function defaultAvatarInnerHtml(user) {
  const name = String(user?.name || 'AM').trim();
  const initials = escapeHtml(name.slice(0, 2).toUpperCase() || 'AM');
  const src = user?.avatarUrl || user?.photo || user?.avatar || '';
  if (typeof src === 'string' && src) {
    return `<span class="avatar-photo profile-image-window"><img class="avatar-animated" src="${escapeHtml(src)}" alt="" data-initials="${initials}" /></span>`;
  }
  return `<span>${initials}</span>`;
}

function isBackgroundPaused() {
  const root = document.documentElement;
  if (!root) return false;
  if (document.visibilityState === 'hidden') return true;
  if (root.classList.contains('pause-in-background') && (root.classList.contains('app-hidden') || root.classList.contains('app-unfocused'))) {
    return true;
  }
  return false;
}

export function setupStageSocial(deps = {}) {
  const getState = () => (typeof deps.getState === 'function' ? deps.getState() : deps.appState || deps.state || {});
  const prefs = deps.prefs || {};
  const savePrefs = typeof deps.savePrefs === 'function' ? deps.savePrefs : null;
  const renderAvatar = deps.avatarInnerHtml || deps.renderAvatar || deps.getAvatarHtml || defaultAvatarInnerHtml;
  const getSafeColor = typeof deps.safeColor === 'function' ? deps.safeColor : defaultSafeColor;
  const getFrameClass = typeof deps.frameClass === 'function' ? deps.frameClass : () => '';
  const getFrameStyle = typeof deps.frameStyle === 'function' ? deps.frameStyle : () => '';
  const getNameStyle = typeof deps.nameStyle === 'function' ? deps.nameStyle : () => '';
  const openUserPopover = deps.openUserPopover || deps.onUserClick || null;

  let collapsed = Boolean(prefs.stageCinemaCollapsed);
  let musicState = null;
  let idleTimer = null;
  let stageVisible = false;

  function revealParticipants() {
    clearTimeout(idleTimer);
    const bar = document.getElementById('stage-cinema-bar');
    if (!bar) return;
    bar.classList.remove('is-idle');
    if (!collapsed || !stageVisible) return;
    idleTimer = setTimeout(() => {
      // O foco de teclado e o mouse sobre a faixa mantêm o controle acessível.
      if (bar.matches(':hover') || bar.querySelector(':focus-visible')) {
        revealParticipants();
        return;
      }
      bar.classList.add('is-idle');
    }, 3000);
  }

  function onStageInteraction(event) {
    if (event.type === 'keydown' || event.target?.closest?.('#stage-section, :fullscreen')) revealParticipants();
  }

  function resolveStageContainer() {
    let stage = deps.stageElement || deps.container || document.getElementById('video-stage');
    if (!stage) {
      const stageSection = document.getElementById('stage-section');
      if (!stageSection) return null;
      stage = document.createElement('div');
      stage.id = 'video-stage';
      stage.className = 'video-stage-overlay';
      stage.dataset.autoCreated = 'true';
      const controlsBar = document.getElementById('stage-controls-bar');
      if (controlsBar && controlsBar.parentElement === stageSection) {
        stageSection.insertBefore(stage, controlsBar);
      } else {
        stageSection.appendChild(stage);
      }
    }
    const fsEl = document.fullscreenElement;
    if (stage.dataset?.autoCreated === 'true') {
      if (fsEl && fsEl !== stage && (fsEl.id === 'videos-grid' || fsEl.classList?.contains('video-tile'))) {
        if (stage.parentElement !== fsEl) fsEl.appendChild(stage);
      } else {
        const stageSection = document.getElementById('stage-section');
        if (stageSection && stage.parentElement !== stageSection) {
          const controlsBar = document.getElementById('stage-controls-bar');
          if (controlsBar && controlsBar.parentElement === stageSection) {
            stageSection.insertBefore(stage, controlsBar);
          } else {
            stageSection.appendChild(stage);
          }
        }
      }
    }
    return stage;
  }

  function isWatchingStage() {
    if (typeof deps.isWatching === 'function') return Boolean(deps.isWatching());
    const st = getState();
    const explicitStage = document.getElementById('video-stage');
    if (explicitStage && explicitStage.dataset?.autoCreated !== 'true') {
      if (explicitStage.classList.contains('hidden')) return false;
      if (explicitStage.dataset?.active === 'false') return false;
      if (explicitStage.dataset?.active === 'true') return true;
      if (explicitStage.querySelector('video, .video-tile, [data-stream-tile]')) return true;
      if (st?.activeStreams instanceof Map) return st.activeStreams.size > 0;
      return true;
    }
    const videosGrid = document.getElementById('videos-grid');
    if (videosGrid) {
      if (videosGrid.classList.contains('hidden')) return false;
      if (videosGrid.querySelectorAll('.video-tile, video').length > 0) return true;
    }
    if (st?.activeStreams instanceof Map && st.activeStreams.size > 0) {
      return !videosGrid || !videosGrid.classList.contains('hidden');
    }
    return false;
  }

  function currentChannel(st = getState()) {
    if (!st) return null;
    if (st.currentChannel && typeof st.currentChannel === 'object') return st.currentChannel;
    const chId = st.currentChannelId;
    if (!chId) return null;
    if (st.channels instanceof Map) return st.channels.get(chId) || null;
    if (Array.isArray(st.channels)) return st.channels.find((c) => c?.id === chId) || null;
    if (st.channels && typeof st.channels === 'object') return st.channels[chId] || null;
    return null;
  }

  function channelUsers(st = getState()) {
    if (Array.isArray(deps.users)) return deps.users;
    if (typeof deps.getUsers === 'function') return deps.getUsers() || [];
    const ch = currentChannel(st);
    const raw = ch?.users ?? st?.users;
    let list = [];
    if (raw instanceof Map) list = [...raw.values()];
    else if (Array.isArray(raw)) list = [...raw];
    else if (raw && typeof raw === 'object') list = Object.values(raw);
    if (typeof deps.sortedUsers === 'function' && ch) {
      try {
        return deps.sortedUsers(ch);
      } catch (_) {
        // Usa ordenação padrão abaixo se sortedUsers falhar
      }
    }
    return list.sort((a, b) => NAME_COLLATOR.compare(a?.name || '', b?.name || ''));
  }

  function isUserSpeaking(user, st = getState()) {
    if (!user) return false;
    if (user.isSpeaking) return true;
    if (st?.speakingUsers instanceof Set && st.speakingUsers.has(user.id)) return true;
    if (st?.speakingUsers instanceof Map && st.speakingUsers.get(user.id)) return true;
    return false;
  }

  function readMusicState() {
    if (musicState && typeof musicState === 'object') return musicState;
    if (typeof deps.getMusicState === 'function') return deps.getMusicState();
    if (deps.music && typeof deps.music.getSnapshot === 'function') return deps.music.getSnapshot();
    return null;
  }

  function isMusicBotVisible(st = getState()) {
    const m = readMusicState();
    if (!m || !m.active) return false;
    if (m.channelId && st?.currentChannelId && m.channelId !== st.currentChannelId) return false;
    return true;
  }

  function openMusicModal() {
    if (typeof deps.openMusic === 'function') {
      deps.openMusic();
      return;
    }
    if (deps.music && typeof deps.music.open === 'function') {
      deps.music.open();
      return;
    }
    window.dispatchEvent(new CustomEvent('teletela:music-action', { detail: { action: 'open' } }));
  }

  function ensureElements() {
    const stage = resolveStageContainer();
    if (!stage) return {};

    let bar = document.getElementById('stage-cinema-bar');
    if (!bar) {
      bar = document.createElement('section');
      bar.id = 'stage-cinema-bar';
      bar.className = 'stage-cinema-bar hidden';
      bar.setAttribute('aria-label', 'Participantes da call no palco');
      bar.innerHTML = `
        <div class="stage-cinema-header">
          <button type="button" id="stage-cinema-toggle" class="stage-cinema-toggle" aria-expanded="true" aria-controls="stage-cinema-strip">
            <span class="stage-cinema-toggle-icon">${USERS_ICON_SVG}</span>
            <span class="stage-cinema-toggle-label">Participantes</span>
            <span id="stage-cinema-count" class="stage-cinema-count">0</span>
            <span id="stage-cinema-chevron" class="stage-cinema-chevron">${CHEVRON_DOWN_SVG}</span>
          </button>
        </div>
        <div id="stage-cinema-strip" class="stage-cinema-strip" role="group" aria-label="Pessoas e música na call"></div>
      `;
      stage.appendChild(bar);

      const toggleBtn = bar.querySelector('#stage-cinema-toggle');
      toggleBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        setCollapsed(!collapsed);
      });
    } else if (bar.parentElement !== stage) {
      stage.appendChild(bar);
    }

    let reactionsLayer = document.getElementById('stage-cinema-reactions');
    if (!reactionsLayer) {
      reactionsLayer = document.createElement('div');
      reactionsLayer.id = 'stage-cinema-reactions';
      reactionsLayer.className = 'stage-cinema-reactions';
      reactionsLayer.setAttribute('aria-hidden', 'true');
      stage.appendChild(reactionsLayer);
    } else if (reactionsLayer.parentElement !== stage) {
      stage.appendChild(reactionsLayer);
    }

    return { stage, bar, reactionsLayer };
  }

  function syncControlsOffset(bar) {
    if (!bar) return;
    const controlsBar = document.getElementById('stage-controls-bar');
    const hasVisibleControls = Boolean(controlsBar && !controlsBar.classList.contains('hidden'));
    bar.classList.toggle('has-stage-controls', hasVisibleControls);
  }

  function syncCollapsedUI(bar, users, st) {
    if (!bar) return;
    bar.classList.toggle('is-collapsed', collapsed);
    const toggleBtn = bar.querySelector('#stage-cinema-toggle');
    const chevron = bar.querySelector('#stage-cinema-chevron');
    const strip = bar.querySelector('#stage-cinema-strip');

    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggleBtn.title = collapsed ? 'Mostrar participantes da call' : 'Recolher participantes da call';
    }
    if (chevron) {
      chevron.innerHTML = collapsed ? CHEVRON_UP_SVG : CHEVRON_DOWN_SVG;
    }
    if (strip) {
      strip.classList.toggle('hidden', collapsed);
    }
  }

  function avatarSignature(u) {
    return JSON.stringify([
      u?.id || '',
      u?.name || '',
      u?.color || '',
      u?.avatarV || '',
      u?.avatar || u?.photo || u?.avatarUrl || '',
      u?.avatarCrop || null,
      u?.frame || '',
      u?.frameColor || ''
    ]);
  }

  function updateParticipantElement(el, u, st) {
    const isMe = Boolean(st?.myId && u.id === st.myId);
    const speaking = isUserSpeaking(u, st);
    const muted = Boolean(u.serverMuted || u.isMicOn === false);
    const deafened = Boolean(u.serverDeafened || u.isDeafened);
    const live = Boolean(u.isSharing || u.isCameraOn);

    el.classList.toggle('is-speaking', speaking);
    el.classList.toggle('is-me', isMe);
    el.classList.toggle('is-muted', muted);
    el.classList.toggle('is-deafened', deafened);
    el.title = isMe ? `${u.name || 'Você'} (Você)` : `${u.name || 'Participante'} · clique para perfil e volume`;

    const wrap = el.querySelector('.stage-cinema-avatar-wrap');
    if (wrap) wrap.classList.toggle('is-speaking', speaking);

    const avatarEl = el.querySelector('.stage-cinema-avatar');
    const nextSig = avatarSignature(u);
    if (avatarEl && avatarEl.dataset.avatarSig !== nextSig) {
      avatarEl.dataset.avatarSig = nextSig;
      const frameCls = getFrameClass(u) || '';
      const frameCss = getFrameStyle(u) || '';
      avatarEl.className = `user-avatar stage-cinema-avatar${frameCls}`;
      avatarEl.setAttribute('style', `background-color: ${getSafeColor(u.color)};${frameCss}`);
      avatarEl.innerHTML = renderAvatar(u);
      if (avatarEl.querySelector('.avatar-photo')) {
        avatarEl.classList.add('has-photo');
      }
    }

    const badgesEl = el.querySelector('.stage-cinema-badges');
    if (badgesEl) {
      const badgeSig = `${muted ? 1 : 0}:${deafened ? 1 : 0}:${live ? 1 : 0}`;
      if (badgesEl.dataset.badgeSig !== badgeSig) {
        badgesEl.dataset.badgeSig = badgeSig;
        let badgesHtml = '';
        if (deafened) {
          badgesHtml += `<span class="stage-cinema-badge is-danger" title="${u.serverDeafened ? 'Ensurdecido pela moderação' : 'Ensurdecido'}">${HEADPHONES_OFF_SVG}</span>`;
        } else if (muted) {
          badgesHtml += `<span class="stage-cinema-badge is-muted" title="${u.serverMuted ? 'Mutado pela moderação' : 'Microfone desligado'}">${MIC_OFF_SVG}</span>`;
        }
        if (live) {
          badgesHtml += `<span class="stage-cinema-badge is-live" title="Transmitindo">${SCREEN_SVG}</span>`;
        }
        badgesEl.innerHTML = badgesHtml;
      }
    }

    const nameEl = el.querySelector('.stage-cinema-name');
    if (nameEl) {
      const displayName = u.name || 'Amigo';
      const nameSig = `${displayName}:${u.nameColor || ''}:${u.nameColor2 || ''}:${isMe ? 1 : 0}`;
      if (nameEl.dataset.nameSig !== nameSig) {
        nameEl.dataset.nameSig = nameSig;
        nameEl.innerHTML = `<span class="user-name-text"${getNameStyle(u)}>${escapeHtml(displayName)}</span><small class="stage-cinema-you">${isMe ? 'Você' : 'Na call'}</small>`;
      }
    }
  }

  function createParticipantElement(u, st) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'stage-cinema-participant';
    el.dataset.userId = String(u.id);
    el.innerHTML = `
      <div class="user-avatar-wrap stage-cinema-avatar-wrap">
        <div class="user-avatar stage-cinema-avatar"></div>
        <span class="speaking-halo"></span>
      </div>
      <span class="stage-cinema-name"></span>
      <span class="stage-cinema-badges"></span>
    `;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof openUserPopover === 'function') {
        openUserPopover(u.id, e);
      }
    });
    updateParticipantElement(el, u, st);
    return el;
  }

  function updateMusicBotElement(strip, st) {
    let botEl = strip.querySelector('[data-stage-music-bot="true"]');
    if (!isMusicBotVisible(st)) {
      botEl?.remove();
      return false;
    }
    const m = readMusicState();
    const isPlaying = Boolean(m?.isPlaying || m?.phase === 'playing');
    const isPaused = Boolean(m?.isPaused || m?.paused || m?.phase === 'paused');
    const isPreparing = Boolean(m?.isPreparing || m?.loading || m?.phase === 'preparing');
    const trackObj = m?.track || m?.current || null;
    const title = trackObj?.title || (isPreparing ? 'Buscando música…' : 'Bot de Música');
    const status = isPreparing ? 'Carregando…' : isPaused ? 'Pausado' : isPlaying ? 'Tocando' : 'Na fila';

    if (!botEl) {
      botEl = document.createElement('button');
      botEl.type = 'button';
      botEl.className = 'stage-cinema-participant stage-cinema-music-bot';
      botEl.dataset.stageMusicBot = 'true';
      botEl.innerHTML = `
        <div class="user-avatar-wrap stage-cinema-avatar-wrap">
          <div class="user-avatar stage-cinema-avatar music-bot-avatar">${MUSIC_BOT_SVG}</div>
          <span class="speaking-halo"></span>
        </div>
        <span class="stage-cinema-name">
          <span class="stage-cinema-bot-title"></span>
          <small class="stage-cinema-bot-status"></small>
        </span>
      `;
      botEl.addEventListener('click', (e) => {
        e.stopPropagation();
        openMusicModal();
      });
    }

    botEl.classList.remove('is-speaking');
    botEl.classList.toggle('is-playing', isPlaying);
    botEl.classList.toggle('is-paused', isPaused);
    botEl.title = `Bot de Música · ${title} (${status}) — clique para abrir`;

    const wrap = botEl.querySelector('.stage-cinema-avatar-wrap');
    if (wrap) wrap.classList.toggle('is-speaking', isPlaying);

    const titleEl = botEl.querySelector('.stage-cinema-bot-title');
    if (titleEl && titleEl.textContent !== title) titleEl.textContent = title;

    const statusEl = botEl.querySelector('.stage-cinema-bot-status');
    if (statusEl && statusEl.textContent !== status) statusEl.textContent = status;

    strip.appendChild(botEl);
    return true;
  }

  function update() {
    const watching = isWatchingStage();
    window.dispatchEvent(new CustomEvent('teletela:stage-change', { detail: { watching } }));

    const { bar } = ensureElements();
    if (!bar) return;

    const st = getState();
    const users = channelUsers(st);
    const botVisible = isMusicBotVisible(st);
    const shouldShow = watching && (users.length > 0 || botVisible);

    bar.classList.toggle('hidden', !shouldShow);
    const becameVisible = shouldShow && !stageVisible;
    stageVisible = shouldShow;
    if (!shouldShow) { clearTimeout(idleTimer); return; }
    if (becameVisible) revealParticipants();

    syncControlsOffset(bar);

    const countEl = bar.querySelector('#stage-cinema-count');
    if (countEl) {
      countEl.textContent = String(users.length);
    }

    const strip = bar.querySelector('#stage-cinema-strip');
    if (strip) {
      const existingById = new Map();
      strip.querySelectorAll('.stage-cinema-participant[data-user-id]').forEach((el) => {
        existingById.set(el.dataset.userId, el);
      });

      const seenIds = new Set();
      users.forEach((u) => {
        if (!u || u.id === undefined || u.id === null) return;
        const idStr = String(u.id);
        seenIds.add(idStr);
        let el = existingById.get(idStr);
        if (!el) {
          el = createParticipantElement(u, st);
        } else {
          updateParticipantElement(el, u, st);
        }
        strip.appendChild(el);
      });

      existingById.forEach((el, idStr) => {
        if (!seenIds.has(idStr)) el.remove();
      });

      updateMusicBotElement(strip, st);
    }

    syncCollapsedUI(bar, users, st);
  }

  function updateSpeaking(userId, isSpeaking) {
    const bar = document.getElementById('stage-cinema-bar');
    if (!bar || bar.classList.contains('hidden')) return;
    const st = getState();
    const users = channelUsers(st);
    if (userId !== undefined && userId !== null) {
      const card = bar.querySelector(`.stage-cinema-participant[data-user-id="${CSS.escape(String(userId))}"]`);
      if (card) {
        const speaking = typeof isSpeaking === 'boolean'
          ? isSpeaking
          : isUserSpeaking(users.find((u) => String(u.id) === String(userId)), st);
        card.classList.toggle('is-speaking', speaking);
        card.querySelector('.stage-cinema-avatar-wrap')?.classList.toggle('is-speaking', speaking);
      }
    }
    syncCollapsedUI(bar, users, st);
  }

  function reaction(input, maybeEmoji) {
    const payload = typeof input === 'object' && input !== null
      ? input
      : { userName: String(input || ''), emoji: String(maybeEmoji || '') };

    const emoji = String(payload.emoji || '').trim();
    if (!emoji) return false;

    const st = getState();
    if (payload.channelId && st?.currentChannelId && payload.channelId !== st.currentChannelId) {
      return false;
    }

    if (!isWatchingStage() || isBackgroundPaused()) return false;

    const { bar, reactionsLayer } = ensureElements();
    if (!reactionsLayer) return false;

    const users = channelUsers(st);
    const matchedUser = users.find((u) => (
      (payload.userId && String(u.id) === String(payload.userId))
      || (payload.userName && String(u.name || '').toLowerCase() === String(payload.userName).toLowerCase())
    ));
    const senderName = payload.userName || matchedUser?.name || 'Amigo';

    // Se o participante estiver na faixa, destaca o card dele com um pop do emoji
    let anchorLeftPct = null;
    if (bar && !bar.classList.contains('hidden') && matchedUser) {
      const card = bar.querySelector(`.stage-cinema-participant[data-user-id="${CSS.escape(String(matchedUser.id))}"]`);
      if (card) {
        card.querySelectorAll('.stage-cinema-reaction-pop').forEach((n) => n.remove());
        const pop = document.createElement('span');
        pop.className = 'stage-cinema-reaction-pop';
        pop.textContent = emoji;
        card.appendChild(pop);
        const cleanupPop = () => pop.remove();
        pop.addEventListener('animationend', cleanupPop, { once: true });
        setTimeout(cleanupPop, 1800);

        const stageRect = reactionsLayer.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        if (stageRect.width > 0 && cardRect.width > 0) {
          const centerPct = ((cardRect.left + cardRect.width / 2 - stageRect.left) / stageRect.width) * 100;
          if (Number.isFinite(centerPct)) {
            anchorLeftPct = Math.min(88, Math.max(12, centerPct));
          }
        }
      }
    }

    while (reactionsLayer.childElementCount >= 24) {
      reactionsLayer.firstElementChild?.remove();
    }

    const bubble = document.createElement('div');
    bubble.className = 'stage-cinema-floating-reaction';
    if (payload.userId || matchedUser?.id) {
      bubble.dataset.userId = String(payload.userId || matchedUser.id);
    }
    const leftPct = anchorLeftPct !== null ? anchorLeftPct : (18 + Math.random() * 64);
    bubble.style.left = `${leftPct}%`;
    bubble.innerHTML = `
      <span class="stage-cinema-reaction-emoji">${escapeHtml(emoji)}</span>
      <span class="stage-cinema-reaction-sender">${escapeHtml(senderName)}</span>
    `;
    reactionsLayer.appendChild(bubble);

    const cleanupBubble = () => bubble.remove();
    bubble.addEventListener('animationend', cleanupBubble, { once: true });
    setTimeout(cleanupBubble, 2600);
    return true;
  }

  function setCollapsed(next) {
    collapsed = Boolean(next);
    if (savePrefs) {
      savePrefs({ stageCinemaCollapsed: collapsed });
    } else {
      prefs.stageCinemaCollapsed = collapsed;
    }
    const bar = document.getElementById('stage-cinema-bar');
    const st = getState();
    syncCollapsedUI(bar, channelUsers(st), st);
    revealParticipants();
    return collapsed;
  }

  function toggleCollapsed() {
    return setCollapsed(!collapsed);
  }

  function setMusicState(snapshot) {
    musicState = snapshot && typeof snapshot === 'object' ? { ...snapshot } : null;
    update();
  }

  const onMusicStateEvent = (e) => {
    if (e?.detail && typeof e.detail === 'object') {
      musicState = { ...e.detail };
      update();
    }
  };

  const onFullscreenChange = () => {
    update();
  };

  for (const type of ['pointermove', 'pointerdown', 'keydown', 'focusin']) document.addEventListener(type, onStageInteraction, true);
  window.addEventListener('teletela:music-state', onMusicStateEvent);
  document.addEventListener('fullscreenchange', onFullscreenChange);

  // Pede o snapshot atual para music.js caso já tenha inicializado
  window.dispatchEvent(new CustomEvent('teletela:music-request-state'));
  update();

  function destroy() {
    clearTimeout(idleTimer);
    for (const type of ['pointermove', 'pointerdown', 'keydown', 'focusin']) document.removeEventListener(type, onStageInteraction, true);
    window.removeEventListener('teletela:music-state', onMusicStateEvent);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.getElementById('stage-cinema-bar')?.remove();
    document.getElementById('stage-cinema-reactions')?.remove();
  }

  return {
    update,
    render: update,
    sync: update,
    updateSpeaking,
    reaction,
    spawnReaction: reaction,
    setMusicState,
    setCollapsed,
    toggleCollapsed,
    isCollapsed: () => collapsed,
    destroy
  };
}
