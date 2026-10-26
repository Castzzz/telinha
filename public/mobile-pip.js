// O PiP nativo mostra a mesma faixa de vídeo e mantém o mixer e o microfone intactos.
let active = false, selected = null, lastState = '';

export function syncMobilePip(state) {
  if (!window.TeletelaAndroid?.setPipState) return;
  const candidates = [state.expandedStreamUserId, state.focusedStreamUserId, ...state.activeStreams.keys()];
  selected = state.currentChannelId ? candidates.find(key => {
    const info = state.activeStreams.get(key);
    return info && !info.isLocal && info.stream.getVideoTracks().some(track => track.readyState === 'live');
  }) || null : null;
  const video = selected && document.getElementById(`video-el-${selected}`);
  const ready = Boolean(video && video.readyState >= 2);
  document.querySelectorAll('.android-pip-tile').forEach(tile => tile.classList.remove('android-pip-tile'));
  if (selected) document.getElementById(`video-tile-${selected}`)?.classList.add('android-pip-tile');
  const rect = video?.getBoundingClientRect();
  const detail = JSON.stringify({
    ready, key: selected, width: video?.videoWidth || 16, height: video?.videoHeight || 9,
    left: rect?.left || 0, top: rect?.top || 0, right: rect?.right || 0, bottom: rect?.bottom || 0,
    viewportWidth: window.innerWidth
  });
  if (detail !== lastState) {
    lastState = detail;
    window.TeletelaAndroid.setPipState(detail);
  }
}

export function setupMobilePip(getState) {
  if (!window.TeletelaAndroid?.setPipState) return;
  window.teletelaPipChanged = enabled => {
    active = Boolean(enabled);
    document.documentElement.classList.toggle('android-pip', active);
    if (active) {
      document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
      // Não altera muted, volume, faixa de áudio ou o estado do microfone.
      const video = selected && document.getElementById(`video-el-${selected}`);
      video?.play().catch(() => {});
    }
    syncMobilePip(getState());
  };
  for (const event of ['loadeddata', 'resize', 'emptied', 'ended']) document.addEventListener(event, e => {
    if (e.target.tagName === 'VIDEO') syncMobilePip(getState());
  }, true);
  window.addEventListener('resize', () => syncMobilePip(getState()));
  syncMobilePip(getState());
}
