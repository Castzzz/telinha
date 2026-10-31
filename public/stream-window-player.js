const stage = document.getElementById('stream-player');
const fullscreenButton = document.getElementById('fullscreen');
let idleTimer;

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await stage.requestFullscreen();
    document.getElementById('player-error').textContent = '';
  } catch {
    document.getElementById('player-error').textContent = 'Não consegui ativar a tela cheia. Tente maximizar a janela.';
  }
}

function revealControls() {
  stage.classList.remove('controls-idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    // Foco ou mouse parado no botão não devem cobrir o vídeo indefinidamente.
    stage.classList.add('controls-idle');
  }, 3000);
}

fullscreenButton.addEventListener('click', toggleFullscreen);
stage.querySelector('video').addEventListener('dblclick', toggleFullscreen);
document.getElementById('return-to-room').addEventListener('click', () => {
  window.opener?.focus();
  window.close();
});
document.addEventListener('fullscreenchange', () => {
  const active = Boolean(document.fullscreenElement);
  document.body.classList.toggle('player-fullscreen', active);
  fullscreenButton.setAttribute('aria-pressed', String(active));
  fullscreenButton.title = active ? 'Sair da tela cheia (Esc)' : 'Tela cheia (F ou F11)';
  fullscreenButton.querySelector('span').textContent = active ? 'Sair da tela cheia' : 'Tela cheia';
  fullscreenButton.setAttribute('aria-label', active ? 'Sair da tela cheia' : 'Entrar em tela cheia');
  revealControls();
});
window.addEventListener('keydown', event => {
  revealControls();
  if (!event.repeat && (event.key.toLowerCase() === 'f' || event.key === 'F11')) {
    event.preventDefault();
    toggleFullscreen();
  }
});
for (const name of ['pointermove', 'pointerdown', 'focusin', 'focusout']) stage.addEventListener(name, revealControls);
window.addEventListener('pagehide', () => {
  clearTimeout(idleTimer);
  // Libera só o player: fechar a janela não encerra a transmissão na sala.
  stage.querySelector('video').srcObject = null;
});
revealControls();
