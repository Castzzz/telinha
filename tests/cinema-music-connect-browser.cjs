// Teste de navegador (Electron offscreen) para:
// 1. Miniplayer discreto de música no palco (#video-stage) em public/music.js + public/music.css
// 2. Modo Cinema (faixa recolhível de participantes, bot de música e reações) em public/stage-social.js + public/stage-social.css
// 3. Redesign da tela inicial em electron/connect.html

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-cinema-music-connect-'));
app.setPath('userData', path.join(tmpDir, 'userdata'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});

const publicDir = path.resolve(__dirname, '..', 'public');
const connectHtmlPath = path.resolve(__dirname, '..', 'electron', 'connect.html');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function startStaticServer() {
  const testHarnessHtml = `<!DOCTYPE html>
<html lang="pt-BR" data-theme="escuro">
<head>
  <meta charset="UTF-8" />
  <link rel="stylesheet" href="/style.css" />
  <link rel="stylesheet" href="/redesign.css" />
  <link rel="stylesheet" href="/mobile.css" />
  <link rel="stylesheet" href="/music.css" />
  <link rel="stylesheet" href="/stage-social.css" />
</head>
<body>
  <div id="channels-tree">
    <li class="channel-item" data-channel-id="geral">
      <ul class="channel-users"></ul>
    </li>
  </div>
  <main id="stage-section" class="stage-section" style="position:relative; width:100vw; height:100vh;">
    <div id="voice-lounge" class="voice-lounge">
      <div id="lounge-users-grid" class="lounge-users-grid"></div>
    </div>
    <section id="videos-grid" class="videos-grid hidden">
      <div class="video-tile" id="tile-stream-1" style="width:800px;height:450px;position:relative;">
        <video id="video-el-1"></video>
      </div>
    </section>
    <div id="reactions-layer" class="reactions-layer"></div>
    <footer id="stage-controls-bar" class="stage-controls-bar">
      <button type="button" id="btn-music" class="hidden">Música</button>
    </footer>
  </main>

  <div id="modal-music" class="modal-backdrop hidden">
    <div class="modal-card music-modal">
      <button type="button" id="btn-close-music">Fechar</button>
      <strong id="music-now-title">Nenhuma música tocando</strong>
      <p id="music-now-meta"></p>
      <div class="music-controls">
        <button type="button" id="music-pause" disabled>Pausar</button>
        <button type="button" id="music-skip" disabled>Pular</button>
        <button type="button" id="music-shuffle" disabled>Embaralhar</button>
        <button type="button" id="music-stop" disabled>Parar</button>
        <select id="music-repeat"><option value="off">Não</option><option value="one">Uma</option><option value="all">Fila</option></select>
        <input id="music-volume" type="range" min="0" max="200" value="50" />
        <output id="music-volume-text">50%</output>
      </div>
      <form id="music-form">
        <input id="music-input" type="text" />
        <button type="submit" id="music-search-btn">Buscar</button>
      </form>
      <p id="music-search-status"></p>
      <div id="music-results"></div>
      <h3 class="music-queue-title">Fila (<span id="music-queue-count">0</span>)</h3>
      <ul id="music-queue" class="music-queue"></ul>
    </div>
  </div>
</body>
</html>`;

  const server = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    if (urlPath === '/' || urlPath === '/test-stage.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(testHarnessHtml);
      return;
    }
    const safeRel = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, '').replace(/^[/\\]+/, '');
    const filePath = path.join(publicDir, safeRel);
    if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(fs.readFileSync(filePath));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`
      });
    });
  });
}

async function runStageAndMusicTests(baseUrl) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false
    }
  });

  const consoleErrors = [];
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') consoleErrors.push(e.message);
  });

  await win.loadURL(`${baseUrl}/test-stage.html`);

  const stageResult = await win.webContents.executeJavaScript(`(async () => {
    const { setupMusic } = await import('/music.js');
    const { setupStageSocial } = await import('/stage-social.js');

    const emittedEvents = [];
    const socketHandlers = new Map();
    const fakeSocket = {
      connected: true,
      on(event, fn) { socketHandlers.set(event, fn); },
      timeout() {
        return {
          emitWithAck: async (event, payload = {}) => {
            emittedEvents.push({ event, payload });
            if (event === 'music-get') {
              return {
                success: true,
                state: {
                  channelId: 'geral',
                  phase: 'playing',
                  generation: 1,
                  position: 12,
                  repeat: 'off',
                  track: { id: 'trk-1', title: 'Daft Punk - One More Time', author: 'Daft Punk', requestedBy: { id: 'u-alice', name: 'Alice' } },
                  queue: [{ id: 'q-1', title: 'Justice - D.A.N.C.E.', requestedBy: { id: 'u-bob', name: 'Bob' } }]
                }
              };
            }
            if (event === 'music-subscribe') {
              return { success: true };
            }
            if (event === 'music-control') {
              const isPause = payload.action === 'pause';
              const isSkip = payload.action === 'skip';
              const nextState = {
                channelId: 'geral',
                phase: isPause ? 'paused' : 'playing',
                generation: isSkip ? 2 : 1,
                position: isSkip ? 0 : 14,
                repeat: 'off',
                track: isSkip
                  ? { id: 'trk-2', title: 'Justice - D.A.N.C.E.', author: 'Justice', requestedBy: { id: 'u-bob', name: 'Bob' } }
                  : { id: 'trk-1', title: 'Daft Punk - One More Time', author: 'Daft Punk', requestedBy: { id: 'u-alice', name: 'Alice' } },
                queue: []
              };
              socketHandlers.get('music-state')?.(nextState);
              return { success: true, state: nextState };
            }
            return { success: true };
          }
        };
      }
    };

    const channelUsers = new Map([
      ['u-alice', { id: 'u-alice', name: 'Alice', color: '#eb459e', avatarV: 1, isMicOn: true, isDeafened: false, isSpeaking: false, isSharing: true }],
      ['u-bob', { id: 'u-bob', name: 'Bob', color: '#57f287', avatarV: 0, isMicOn: false, isDeafened: false, isSpeaking: false }]
    ]);

    const channelRecord = {
      id: 'geral',
      name: 'Geral',
      canWrite: true,
      users: channelUsers
    };

    const appState = {
      myId: 'u-alice',
      musicEnabled: true,
      currentChannelId: 'geral',
      myUser: { name: 'Alice', isDeafened: false, serverMuted: false, serverDeafened: false },
      channels: new Map([['geral', channelRecord]]),
      activeStreams: new Map()
    };

    const savedPrefs = {};
    const prefs = { musicVolume: 50 };
    const savePrefs = (patch) => Object.assign(savedPrefs, patch);

    let avatarCalls = 0;
    const avatarInnerHtml = (u) => {
      avatarCalls++;
      return \`<span class="avatar-photo profile-image-window" data-test-avatar="\${u.id}"><span>\${(u.name || 'AM').slice(0, 2).toUpperCase()}</span></span>\`;
    };

    let lastPopoverUser = null;
    const openUserPopover = (userId) => { lastPopoverUser = userId; };

    let receivedMusicSnapshots = [];
    window.addEventListener('teletela:music-state', (e) => {
      receivedMusicSnapshots.push(e.detail);
    });

    const musicUI = setupMusic({
      socket: fakeSocket,
      appState,
      prefs,
      savePrefs,
      showToast: () => {}
    });

    const stageSocial = setupStageSocial({
      appState,
      prefs,
      savePrefs,
      avatarInnerHtml,
      openUserPopover
    });

    // 1. Entra no canal mas ainda sem transmissão aberta no palco: miniplayer e faixa cinema devem ficar ocultos
    musicUI.syncChannel();
    await new Promise((r) => setTimeout(r, 20));
    stageSocial.update();

    const miniBeforeStream = document.getElementById('music-stage-miniplayer');
    const cinemaBar = document.getElementById('stage-cinema-bar');
    const hiddenBeforeStream = (!miniBeforeStream || miniBeforeStream.classList.contains('hidden')) && cinemaBar.classList.contains('hidden');

    // Confere snapshot seguro congelado emitido por music.js
    const lastSnap = receivedMusicSnapshots.at(-1);
    const snapshotFrozenAndSafe = Boolean(lastSnap && Object.isFrozen(lastSnap) && Object.isFrozen(lastSnap.current) && lastSnap.current.title === 'Daft Punk - One More Time');

    // 2. Abre transmissão no palco (#videos-grid visível e activeStreams > 0)
    document.getElementById('voice-lounge').classList.add('hidden');
    document.getElementById('videos-grid').classList.remove('hidden');
    appState.activeStreams.set('u-alice', { userName: 'Alice', isLocal: true });

    stageSocial.update();

    const miniEl = document.getElementById('music-stage-miniplayer');
    const visibleDuringStream = Boolean(miniEl && !miniEl.classList.contains('hidden')) && !cinemaBar.classList.contains('hidden');
    const miniTrackText = document.getElementById('music-mini-track')?.textContent;
    const miniIsPlaying = miniEl.classList.contains('is-playing');
    const miniBarsCount = miniEl.querySelectorAll('.music-mini-bar').length;

    // 3. Confere participantes e bot de música na faixa cinema
    const participantEls = [...cinemaBar.querySelectorAll('.stage-cinema-participant[data-user-id]')];
    const botInStrip = Boolean(cinemaBar.querySelector('[data-stage-music-bot="true"]'));
    const aliceAvatarNodeBefore = cinemaBar.querySelector('.stage-cinema-participant[data-user-id="u-alice"] .stage-cinema-avatar [data-test-avatar="u-alice"]');
    const avatarCallsBeforeSpeak = avatarCalls;

    // 4. Borda ao falar: alternar isSpeaking não deve recriar o avatar DOM
    channelUsers.get('u-alice').isSpeaking = true;
    stageSocial.updateSpeaking('u-alice', true);
    const aliceCard = cinemaBar.querySelector('.stage-cinema-participant[data-user-id="u-alice"]');
    const speakingClassApplied = aliceCard.classList.contains('is-speaking') && aliceCard.querySelector('.stage-cinema-avatar-wrap').classList.contains('is-speaking');
    const aliceAvatarNodeAfter = cinemaBar.querySelector('.stage-cinema-participant[data-user-id="u-alice"] .stage-cinema-avatar [data-test-avatar="u-alice"]');
    const preservedAvatarDom = aliceAvatarNodeBefore === aliceAvatarNodeAfter && avatarCalls === avatarCallsBeforeSpeak;

    // 5. Clique no participante abre popover
    aliceCard.click();
    const popoverOpenedForAlice = lastPopoverUser === 'u-alice';

    // 6. Recolher / expandir a faixa cinema
    const toggleBtn = document.getElementById('stage-cinema-toggle');
    toggleBtn.click();
    const collapsedState = stageSocial.isCollapsed() && cinemaBar.classList.contains('is-collapsed') && toggleBtn.getAttribute('aria-expanded') === 'false' && savedPrefs.stageCinemaCollapsed === true;
    const speakingPillText = document.getElementById('stage-cinema-speaking-pill')?.textContent;
    toggleBtn.click();
    const expandedAgain = !stageSocial.isCollapsed() && toggleBtn.getAttribute('aria-expanded') === 'true';

    // 7. Reações emoji no palco e bloqueio quando em background pausado
    const reacted = stageSocial.reaction({ channelId: 'geral', userId: 'u-alice', userName: 'Alice', emoji: '🔥' });
    const floatingReactionCount = document.querySelectorAll('#stage-cinema-reactions .stage-cinema-floating-reaction').length;
    const cardPopCount = aliceCard.querySelectorAll('.stage-cinema-reaction-pop').length;

    document.documentElement.classList.add('pause-in-background', 'app-unfocused');
    const reactedWhilePausedBg = stageSocial.reaction({ channelId: 'geral', userId: 'u-bob', userName: 'Bob', emoji: '👏' });
    document.documentElement.classList.remove('pause-in-background', 'app-unfocused');

    // 8. Ações do miniplayer de música (pausar/continuar e pular) e respeito às permissões
    const pauseBtn = miniEl.querySelector('.music-mini-pause');
    const skipBtn = miniEl.querySelector('.music-mini-skip');
    pauseBtn.click();
    await new Promise((r) => setTimeout(r, 15));
    const pausedAfterClick = !miniEl.classList.contains('is-playing') && emittedEvents.some((x) => x.event === 'music-control' && x.payload.action === 'pause');

    skipBtn.click();
    await new Promise((r) => setTimeout(r, 15));
    const skippedTrackTitle = document.getElementById('music-mini-track')?.textContent;

    // Bloqueia permissões (serverMuted e depois canWrite=false)
    appState.myUser.serverMuted = true;
    musicUI.renderStageMiniplayer();
    const disabledWhenServerMuted = pauseBtn.disabled && skipBtn.disabled;
    const eventsCountBeforeBlockedClick = emittedEvents.length;
    pauseBtn.click();
    skipBtn.click();
    const noEmitsWhenBlocked = emittedEvents.length === eventsCountBeforeBlockedClick;

    appState.myUser.serverMuted = false;
    channelRecord.canWrite = false;
    musicUI.renderStageMiniplayer();
    const disabledWhenNoWritePerm = pauseBtn.disabled && skipBtn.disabled;
    channelRecord.canWrite = true;
    musicUI.renderStageMiniplayer();

    // 9. Clicar no título do miniplayer abre o modal completo (#modal-music)
    miniEl.querySelector('.music-mini-title-btn').click();
    const modalOpenedByTitle = !document.getElementById('modal-music').classList.contains('hidden');
    document.getElementById('btn-close-music').click();

    // 10. Fullscreen CSS (body.stage-fullscreen) mantém miniplayer e faixa cinema visíveis dentro do palco
    document.body.classList.add('stage-fullscreen');
    stageSocial.update();
    const videoStageEl = document.getElementById('video-stage');
    const videoStageStyle = getComputedStyle(videoStageEl);
    const fullscreenOverlayFixed = videoStageStyle.position === 'fixed' && Number(videoStageStyle.zIndex) >= 1510;
    document.body.classList.remove('stage-fullscreen');

    // 11. Temas (escuro, preto, claro) e modo leve (light-mode)
    const themeBackgrounds = {};
    for (const t of ['escuro', 'preto', 'claro']) {
      document.documentElement.dataset.theme = t;
      themeBackgrounds[t] = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim();
    }
    document.documentElement.classList.add('light-mode');
    const lightModeBarAnimation = getComputedStyle(miniEl.querySelector('.music-mini-bar')).animationName;
    document.documentElement.classList.remove('light-mode');

    return {
      hiddenBeforeStream,
      snapshotFrozenAndSafe,
      visibleDuringStream,
      miniTrackText,
      miniIsPlaying,
      miniBarsCount,
      participantCount: participantEls.length,
      botInStrip,
      speakingClassApplied,
      preservedAvatarDom,
      popoverOpenedForAlice,
      collapsedState,
      speakingPillText,
      expandedAgain,
      reacted,
      floatingReactionCount,
      cardPopCount,
      reactedWhilePausedBg,
      pausedAfterClick,
      skippedTrackTitle,
      disabledWhenServerMuted,
      noEmitsWhenBlocked,
      disabledWhenNoWritePerm,
      modalOpenedByTitle,
      fullscreenOverlayFixed,
      themeBackgrounds,
      lightModeBarAnimation
    };
  })()`);

  assert.equal(stageResult.hiddenBeforeStream, true, 'Miniplayer e faixa cinema devem ficar ocultos fora de transmissões');
  assert.equal(stageResult.snapshotFrozenAndSafe, true, 'music.js deve emitir snapshot congelado seguro via CustomEvent');
  assert.equal(stageResult.visibleDuringStream, true, 'Miniplayer e faixa cinema devem aparecer quando há transmissão no palco');
  assert.equal(stageResult.miniTrackText, 'Daft Punk - One More Time');
  assert.equal(stageResult.miniIsPlaying, true);
  assert.equal(stageResult.miniBarsCount, 4);
  assert.equal(stageResult.participantCount, 2);
  assert.equal(stageResult.botInStrip, true, 'Bot de música deve aparecer na faixa cinema quando ativo');
  assert.equal(stageResult.speakingClassApplied, true, 'Participante falando deve receber borda verde (.is-speaking)');
  assert.equal(stageResult.preservedAvatarDom, true, 'Alternar fala não deve recriar o DOM do avatar');
  assert.equal(stageResult.popoverOpenedForAlice, true, 'Clicar no participante deve acionar openUserPopover');
  assert.equal(stageResult.collapsedState, true, 'Botão da faixa cinema deve recolher e salvar preferência');
  assert.match(stageResult.speakingPillText, /Alice falando/);
  assert.equal(stageResult.expandedAgain, true, 'Botão da faixa cinema deve expandir novamente');
  assert.equal(stageResult.reacted, true);
  assert.equal(stageResult.floatingReactionCount, 1);
  assert.equal(stageResult.cardPopCount, 1);
  assert.equal(stageResult.reactedWhilePausedBg, false, 'Reações devem ser ignoradas em segundo plano quando pause-in-background está ativo');
  assert.equal(stageResult.pausedAfterClick, true, 'Botão de pausa do miniplayer deve pausar a música');
  assert.equal(stageResult.skippedTrackTitle, 'Justice - D.A.N.C.E.', 'Botão de pular do miniplayer deve avançar a faixa');
  assert.equal(stageResult.disabledWhenServerMuted, true, 'Miniplayer deve desabilitar controles quando serverMuted');
  assert.equal(stageResult.noEmitsWhenBlocked, true, 'Miniplayer bloqueado não deve emitir eventos');
  assert.equal(stageResult.disabledWhenNoWritePerm, true, 'Miniplayer deve respeitar canWrite === false do canal');
  assert.equal(stageResult.modalOpenedByTitle, true, 'Clicar no título do miniplayer deve abrir o modal completo');
  assert.equal(stageResult.fullscreenOverlayFixed, true, 'Em fullscreen o palco deve manter miniplayer e faixa visíveis com z-index elevado');
  assert.notEqual(stageResult.themeBackgrounds.escuro, stageResult.themeBackgrounds.claro, 'Tokens de tema devem responder à troca de tema');
  assert.equal(stageResult.lightModeBarAnimation, 'none', 'Modo leve deve desativar animação contínua do visualizador');

  // Teste de responsividade mobile (390x844)
  win.setSize(390, 844);
  await new Promise((r) => setTimeout(r, 80));
  const fitsMobile = await win.webContents.executeJavaScript(`(() => {
    const mini = document.getElementById('music-stage-miniplayer').getBoundingClientRect();
    const bar = document.getElementById('stage-cinema-bar').getBoundingClientRect();
    return mini.left >= 0 && mini.right <= window.innerWidth && bar.left >= 0 && bar.right <= window.innerWidth;
  })()`);
  assert.equal(fitsMobile, true, 'Miniplayer e faixa cinema devem caber na largura da tela no mobile');
  assert.deepEqual(consoleErrors, [], 'Não deve haver erros no console durante os testes de palco e música');

  win.destroy();
}

async function runConnectHtmlTests() {
  const win = new BrowserWindow({
    width: 900,
    height: 680,
    show: false,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false
    }
  });

  await win.loadFile(connectHtmlPath);

  const connectResult = await win.webContents.executeJavaScript(`(async () => {
    const requiredIds = [
      'btn-server-room',
      'btn-host',
      'link-box',
      'public-link',
      'btn-copy',
      'btn-enter-host',
      'server-url',
      'btn-join',
      'msg'
    ];
    const missingIds = requiredIds.filter((id) => !document.getElementById(id));
    const svgCount = document.querySelectorAll('svg.icon-svg').length;

    // Testa alternância dos 3 temas por tokens CSS
    const btnTheme = document.getElementById('btn-theme');
    const initialTheme = document.documentElement.dataset.theme;
    btnTheme.click();
    const secondTheme = document.documentElement.dataset.theme;
    btnTheme.click();
    const thirdTheme = document.documentElement.dataset.theme;

    // Simula os métodos de window.telinhaLauncher (que no connect.html real vêm do preload)
    // Como connect.html captura const api = window.telinhaLauncher no carregamento, vamos testar recarregando com mock injetado
    return {
      missingIds,
      svgCount,
      themesVisited: [initialTheme, secondTheme, thirdTheme]
    };
  })()`);

  assert.deepEqual(connectResult.missingIds, [], 'Todos os IDs existentes em connect.html devem ser preservados');
  assert.ok(connectResult.svgCount >= 6, 'connect.html deve usar ícones SVG (.icon-svg) no estilo do app');
  assert.deepEqual(connectResult.themesVisited, ['escuro', 'preto', 'claro']);

  // Agora injeta um preload temporário para testar todos os fluxos interativos do connect.html
  const preloadMockPath = path.join(tmpDir, 'preload-connect-mock.cjs');
  fs.writeFileSync(preloadMockPath, `
    const { contextBridge } = require('electron');
    const calls = { joined: [], opened: [], copied: [], hostCount: 0 };
    contextBridge.exposeInMainWorld('__testCalls', {
      get: () => calls
    });
    contextBridge.exposeInMainWorld('electronAPI', {
      getPrefs: async () => ({ theme: 'preto' }),
      setPrefs: async () => true
    });
    contextBridge.exposeInMainWorld('telinhaLauncher', {
      getState: async () => ({
        lastServerUrl: 'https://amigo-antigo.trycloudflare.com',
        serverRoomUrl: 'https://colheitafartus.duckdns.org',
        error: null
      }),
      join: async (url) => {
        calls.joined.push(url);
        if (url.includes('falha')) return { ok: false, error: 'Não foi possível abrir essa sala.' };
        return { ok: true };
      },
      host: async () => {
        calls.hostCount++;
        if (calls.hostCount === 1) {
          return {
            ok: true,
            localUrl: 'http://localhost:8080',
            publicUrl: 'https://minha-sala.trycloudflare.com',
            lanUrls: ['http://192.168.1.10:8080']
          };
        }
        return {
          ok: true,
          localUrl: 'http://localhost:8080',
          publicUrl: null,
          lanUrls: ['http://192.168.1.10:8080'],
          tunnelError: 'Túnel indisponível no momento.'
        };
      },
      copy: async (txt) => {
        calls.copied.push(txt);
      },
      open: async (url) => {
        calls.opened.push(url);
      }
    });
  `);

  const winFlow = new BrowserWindow({
    width: 900,
    height: 680,
    show: false,
    webPreferences: {
      offscreen: true,
      preload: preloadMockPath,
      contextIsolation: true
    }
  });

  await winFlow.loadFile(connectHtmlPath);
  await new Promise((r) => setTimeout(r, 80));

  await fs.promises.writeFile('/tmp/teletela-tela-inicial.png', (await winFlow.webContents.capturePage()).toPNG());
  const flowResult = await winFlow.webContents.executeJavaScript(`(async () => {
    const $ = (id) => document.getElementById(id);
    const initialInputVal = $('server-url').value;
    const themeFromPrefs = document.documentElement.dataset.theme;

    // 1. Validação de link de amigo vazio
    $('server-url').value = '   ';
    $('btn-join').click();
    const emptyUrlError = $('msg').textContent;
    const emptyUrlHasErrorClass = $('msg').classList.contains('error');

    // 2. Entrar na sala do servidor
    $('btn-server-room').click();
    await new Promise((r) => setTimeout(r, 30));

    // 3. Entrar na sala de um amigo com falha e depois com sucesso
    $('server-url').value = 'https://sala-falha.trycloudflare.com';
    $('btn-join').click();
    await new Promise((r) => setTimeout(r, 30));
    const joinFailMsg = $('msg').textContent;

    $('server-url').value = 'https://sala-ok.trycloudflare.com';
    $('btn-join').click();
    await new Promise((r) => setTimeout(r, 30));

    // 4. Hospedar com link público + copiar + entrar
    $('btn-host').click();
    await new Promise((r) => setTimeout(r, 40));
    const publicLinkText = $('public-link').textContent;
    const linkBoxVisible = getComputedStyle($('link-box')).display !== 'none';
    $('btn-copy').click();
    await new Promise((r) => setTimeout(r, 20));
    const copyFeedbackText = $('btn-copy').textContent.trim();
    $('btn-enter-host').click();

    // 5. Hospedar quando túnel falha (fallback LAN)
    $('btn-host').click();
    await new Promise((r) => setTimeout(r, 40));
    const lanFallbackText = $('public-link').textContent;
    const copyHiddenOnLan = getComputedStyle($('btn-copy')).display === 'none';
    const tunnelErrorMsg = $('msg').textContent;

    const calls = window.__testCalls.get();
    return {
      initialInputVal,
      themeFromPrefs,
      emptyUrlError,
      emptyUrlHasErrorClass,
      joinFailMsg,
      publicLinkText,
      linkBoxVisible,
      copyFeedbackText,
      lanFallbackText,
      copyHiddenOnLan,
      tunnelErrorMsg,
      calls
    };
  })()`);

  assert.equal(flowResult.initialInputVal, 'https://amigo-antigo.trycloudflare.com');
  assert.equal(flowResult.themeFromPrefs, 'preto', 'Deve sincronizar tema inicial com electronAPI.getPrefs()');
  assert.equal(flowResult.emptyUrlError, 'Cole o link que seu amigo mandou.');
  assert.equal(flowResult.emptyUrlHasErrorClass, true);
  assert.equal(flowResult.joinFailMsg, 'Não foi possível abrir essa sala.');
  assert.equal(flowResult.publicLinkText, 'https://minha-sala.trycloudflare.com');
  assert.equal(flowResult.linkBoxVisible, true);
  assert.match(flowResult.copyFeedbackText, /Copiado/i);
  assert.deepEqual(flowResult.calls.copied, ['https://minha-sala.trycloudflare.com']);
  assert.deepEqual(flowResult.calls.opened, ['http://localhost:8080']);
  assert.deepEqual(flowResult.calls.joined, [
    'https://colheitafartus.duckdns.org',
    'https://sala-falha.trycloudflare.com',
    'https://sala-ok.trycloudflare.com'
  ]);
  assert.match(flowResult.lanFallbackText, /Só na rede local: http:\/\/192\.168\.1\.10:8080/);
  assert.equal(flowResult.copyHiddenOnLan, true);
  assert.equal(flowResult.tunnelErrorMsg, 'Túnel indisponível no momento.');

  winFlow.destroy();
  win.destroy();
}

app.whenReady().then(async () => {
  const { server, baseUrl } = await startStaticServer();
  try {
    await runStageAndMusicTests(baseUrl);
    await runConnectHtmlTests();
    console.log('✅ Testes de miniplayer de música, modo cinema e connect.html passaram no Electron.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  app.quit();
}).catch((err) => {
  console.error('❌ Falha nos testes de navegador:', err);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  app.exit(1);
});
