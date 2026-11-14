// A API interna da Netflix pode mudar. Nenhuma credencial do Teletela entra nesta página.
(() => {
  let lastSeekAt = 0;
  function player() {
    try {
      const api = window.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
      const ids = api?.getAllPlayerSessionIds?.() || [];
      const id = ids.find(value => String(value).includes('watch')) || ids[0];
      return id ? api.getVideoPlayerBySessionId(id) : null;
    } catch { return null; }
  }
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'teletela:netflix-command') return;
    const { id, command, target } = event.data;
    if (typeof id !== 'string' || !['read', 'apply', 'activate'].includes(command)) return;
    try {
      const video = document.querySelector('video');
      if (!video) throw new Error('Abra o episódio e espere o player carregar.');
      const native = player();
      if (command === 'activate') await (native?.play ? native.play() : video.play());
      if (command === 'apply' && target && Number.isFinite(target.position) && target.position >= 0
        && target.position <= 7 * 86400 && typeof target.playing === 'boolean' && Number.isFinite(target.rate) && target.rate >= .25 && target.rate <= 4) {
        const position = native?.getCurrentTime ? native.getCurrentTime() / 1000 : video.currentTime;
        const difference = Math.abs(position - target.position);
        if ((target.forceSeek === true && difference > .12) || (difference > 1.25 && Date.now() - lastSeekAt > 1800)) {
          lastSeekAt = Date.now();
          if (native?.seek) native.seek(target.position * 1000); else video.currentTime = target.position;
        }
        if (Math.abs(video.playbackRate - target.rate) > .01) video.playbackRate = target.rate;
        const paused = native?.isPaused ? native.isPaused() : video.paused;
        if (target.playing && paused) await (native?.play ? native.play() : video.play());
        else if (!target.playing && !paused) { if (native?.pause) native.pause(); else video.pause(); }
      }
      const position = native?.getCurrentTime ? native.getCurrentTime() / 1000 : video.currentTime;
      const paused = native?.isPaused ? native.isPaused() : video.paused;
      window.postMessage({ type: 'teletela:netflix-result', id, result: { position, playing: !paused && !video.ended,
        rate: video.playbackRate, waiting: video.readyState < 3, duration: video.duration } }, location.origin);
    } catch (error) {
      window.postMessage({ type: 'teletela:netflix-result', id, error: error.message }, location.origin);
    }
  });
})();
