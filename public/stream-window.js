// O vídeo compartilha o MediaStream recebido. O áudio continua no mixer da sala.
export function createStreamWindow() {
  let player = null;
  let currentId = null;
  let currentInfo = null;
  const themeObserver = new MutationObserver(() => syncTheme());
  const isOpen = () => Boolean(player && !player.closed);

  function syncTheme() {
    if (!isOpen()) return;
    player.document.documentElement.dataset.theme = document.documentElement.dataset.theme || 'escuro';
    player.document.documentElement.dataset.platform = window.electronAPI?.platform || '';
  }

  function update(userId, info) {
    if (!isOpen() || currentId !== userId) return;
    currentInfo = info;
    const video = player.document.querySelector('video');
    if (!video) return;
    syncTheme();
    player.document.title = `${info.userName} — Teletela`;
    player.document.querySelector('#stream-name').textContent = info.userName;
    player.document.querySelector('#window-stream-name').textContent = info.userName;
    video.muted = true;
    if (video.srcObject !== info.stream) video.srcObject = info.stream;
    video.play().catch(() => {});
  }

  function close(userId = currentId) {
    if (userId !== currentId) return;
    themeObserver.disconnect();
    if (isOpen()) player.close();
    player = null;
    currentId = null;
    currentInfo = null;
  }

  function toggle(userId, info) {
    if (isOpen() && currentId === userId) { close(); return true; }
    if (isOpen()) {
      currentId = userId;
      update(userId, info);
      player.focus();
      return true;
    }
    player = window.open(new URL('./stream-window.html', import.meta.url).href,
      'teletela-stream', 'popup,width=960,height=580');
    if (!player) return false;
    currentId = userId;
    currentInfo = info;
    const opened = player;
    opened.addEventListener('DOMContentLoaded', () => {
      if (player !== opened || opened.closed) return;
      update(currentId, currentInfo);
      opened.addEventListener('pagehide', () => {
        if (player !== opened) return;
        themeObserver.disconnect();
        player = null;
        currentId = null;
        currentInfo = null;
      }, { once: true });
    }, { once: true });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return true;
  }

  window.addEventListener('pagehide', () => close());
  return { toggle, update, close };
}
