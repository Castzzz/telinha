(() => {
  let active = false, host = false, running = false, pending = false, nextProbe = 0;
  let boundVideo = null, lastGood = null, navigatedTo = '', lastSeekAt = 0;
  let lastControl = null, lastPlaying = null;
  const netflix = location.hostname === 'www.netflix.com';
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;max-width:320px';
  const shadow = box.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>:host{color-scheme:dark light}div{--watch-bg:light-dark(#fff,#232428);--watch-text:light-dark(#202127,#eee);background:var(--watch-bg);color:var(--watch-text);border:1px solid light-dark(#ddd,#50525c);border-radius:10px;padding:10px 14px;font:13px/1.5 system-ui,sans-serif;box-shadow:0 3px 18px #0003}p{margin:0}button{font:inherit;border:0;border-radius:6px;padding:6px 10px;margin-top:8px;background:#5865f2;color:white;cursor:pointer}button[hidden]{display:none}</style><div><p></p><button type="button" hidden>Ativar reprodução</button></div>`;
  const label = shadow.querySelector('p'), activate = shadow.querySelector('button');
  const status = (text, blocked = false) => {
    if (!box.isConnected) document.documentElement.append(box);
    label.textContent = `Teletela · ${text}`; activate.hidden = !blocked;
  };
  function canonical(raw) {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:') return null;
      if (url.hostname === 'www.netflix.com') {
        const id = url.pathname.match(/^\/watch\/(\d{1,20})\/?$/)?.[1];
        return id ? `https://www.netflix.com/watch/${id}` : null;
      }
      if (url.hostname === 'www.youtube.com') {
        const id = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/shorts\/([^/]+)$/)?.[1];
        return /^[\w-]{11}$/.test(id || '') ? `https://www.youtube.com/watch?v=${id}` : null;
      }
    } catch {}
    return null;
  }
  const isAd = () => !netflix && Boolean(document.querySelector('.html5-video-player.ad-showing'));
  function bridge(command, target) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('O player da Netflix não respondeu. Recarregue a página.')); }, 1800);
      function receive(event) {
        if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'teletela:netflix-result' || event.data.id !== id) return;
        clearTimeout(timer); window.removeEventListener('message', receive);
        if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result);
      }
      window.addEventListener('message', receive);
      window.postMessage({ type: 'teletela:netflix-command', id, command, target }, location.origin);
    });
  }
  async function read() {
    const video = document.querySelector('video');
    if (video !== boundVideo) {
      for (const event of ['play', 'pause', 'seeked', 'ratechange', 'playing', 'waiting', 'ended']) {
        boundVideo?.removeEventListener(event, onChange); video?.addEventListener(event, onChange);
      }
      boundVideo = video;
    }
    const url = canonical(location.href);
    if (!video || !url) return null;
    if (isAd()) return { url, position: lastGood?.url === url ? lastGood.position : 0, rate: 1, playing: false, waiting: true, ad: true };
    const state = netflix ? await bridge('read') : { position: video.currentTime, playing: !video.paused && !video.ended,
      rate: video.playbackRate, waiting: video.readyState < 3, duration: video.duration };
    if (!Number.isFinite(state.position) || !Number.isFinite(state.duration)) return null;
    lastGood = { ...state, url, playing: state.playing && !state.waiting };
    return lastGood;
  }
  function onChange() { if (active && host) tick(); }
  async function tick() {
    if (!chrome.runtime?.id || (!active && Date.now() < nextProbe)) return;
    if (running) { pending = true; return; }
    running = true;
    try {
      const report = await read();
      const result = await chrome.runtime.sendMessage({ type: 'watch:sync', report });
      if (result?.inactive) { active = false; host = false; nextProbe = Date.now() + 5000; box.remove(); return; }
      if (result?.skipped) return;
      if (result?.error) { active = true; status(result.error); return; }
      const session = result?.session;
      if (!session) { active = false; box.remove(); return; }
      active = true; host = session.hostId === result.userId;
      if (host) {
        status(!report ? 'você guia · abra um vídeo ou episódio (vídeos ao vivo não são suportados)'
          : report.ad ? 'você guia · aguardando o anúncio terminar' : report.waiting ? 'você guia · carregando vídeo' : 'você guia esta sessão');
        return;
      }
      if (!session.url) { status('aguardando quem guia escolher o vídeo'); return; }
      const targetUrl = canonical(session.url);
      if (!targetUrl) { status('link da sessão indisponível'); return; }
      if (canonical(location.href) !== targetUrl) {
        status('outro vídeo na sessão · abra pela extensão');
        // Só a aba já escolhida e com um vídeo aberto acompanha a troca de episódio.
        if (report && navigatedTo !== targetUrl) { navigatedTo = targetUrl; location.assign(targetUrl); }
        return;
      }
      navigatedTo = '';
      if (!report) { status('espere o vídeo carregar; entre na sua conta se necessário'); return; }
      if (report.ad) { status('aguardando seu anúncio terminar'); return; }
      if (report.waiting) { status('carregando seu vídeo; a sincronização retoma em seguida'); return; }
      const elapsed = Math.max(0, Math.min(7, result.roundTrip / 2000));
      const position = session.position + (session.playing ? Math.max(0, (session.serverTime - session.updatedAt) / 1000 + elapsed) * session.rate : 0);
      const control = `${session.id}:${session.controlRevision}`;
      const target = { position: Math.min(position, Math.max(0, report.duration - .1)), playing: session.playing, rate: session.rate,
        forceSeek: control !== lastControl || session.playing !== lastPlaying };
      try {
        if (netflix) await bridge('apply', target);
        else if (boundVideo) {
          const difference = Math.abs(boundVideo.currentTime - target.position);
          if ((target.forceSeek && difference > .12) || (difference > 1.25 && Date.now() - lastSeekAt > 1800)) {
            lastSeekAt = Date.now(); boundVideo.currentTime = target.position;
          }
          if (Math.abs(boundVideo.playbackRate - target.rate) > .01) boundVideo.playbackRate = target.rate;
          if (target.playing && boundVideo.paused) await boundVideo.play();
          else if (!target.playing && !boundVideo.paused) boundVideo.pause();
        }
        lastControl = control; lastPlaying = session.playing;
        status(session.waiting ? 'aguardando o navegador de quem guia' : `seguindo ${session.hostName}`);
      } catch { status('clique para permitir a reprodução neste navegador', true); }
    } catch (error) {
      if (active) status(error.message || 'sem conexão com o Teletela');
    } finally {
      running = false;
      if (pending) { pending = false; setTimeout(tick, 150); }
    }
  }
  activate.addEventListener('click', async () => {
    try {
      if (netflix) await bridge('activate'); else await document.querySelector('video')?.play();
      tick();
    } catch { status('use o botão de play do próprio vídeo para liberar a reprodução', true); }
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'watch:attach') { active = true; nextProbe = 0; tick(); }
    if (message?.type === 'watch:detach') { active = false; host = false; box.remove(); }
  });
  const timer = setInterval(tick, 1000);
  window.addEventListener('pagehide', () => { clearInterval(timer); box.remove(); }, { once: true });
  tick();
})();
