// A barra continua no caminho do Tab mesmo quando a imagem ocupa a tela inteira.
export function setupStageControls({ fullscreen, delay = 3000 }) {
  const bar = document.getElementById('stage-controls-bar');
  const stage = document.getElementById('stage-section');
  if (!bar || !stage) return;
  let timer, hovering = false, pressing = false;
  const reveal = () => {
    clearTimeout(timer);
    document.body.classList.remove('stage-controls-idle');
    if (!fullscreen()) return;
    timer = setTimeout(() => {
      if (!fullscreen()) return;
      if (hovering || pressing || bar.querySelector(':focus-visible, [aria-expanded="true"], details[open]')) return reveal();
      document.body.classList.add('stage-controls-idle');
    }, delay);
  };
  const move = event => {
    if (!fullscreen()) return;
    hovering = event.pointerType === 'mouse' && bar.contains(event.target);
    reveal();
  };
  document.addEventListener('pointermove', move, { passive: true, capture: true });
  document.addEventListener('mousemove', event => {
    if (!fullscreen()) return;
    hovering = bar.contains(event.target); reveal();
  }, { passive: true, capture: true });
  document.addEventListener('pointerdown', () => { if (fullscreen()) reveal(); }, { passive: true, capture: true });
  bar.addEventListener('pointerenter', event => { hovering = event.pointerType === 'mouse'; reveal(); });
  bar.addEventListener('pointerleave', () => { hovering = false; reveal(); });
  bar.addEventListener('pointerdown', () => { pressing = true; reveal(); });
  document.addEventListener('pointerup', () => { if (pressing) { pressing = false; reveal(); } });
  document.addEventListener('pointercancel', () => { pressing = false; reveal(); });
  bar.addEventListener('focusin', reveal);
  bar.addEventListener('focusout', reveal);
  document.addEventListener('keydown', () => { if (fullscreen()) reveal(); });
  const changed = () => { hovering = false; pressing = false; reveal(); };
  document.addEventListener('fullscreenchange', changed);
  document.addEventListener('webkitfullscreenchange', changed);
  let wasFullscreen = fullscreen();
  new MutationObserver(() => {
    const active = fullscreen();
    if (wasFullscreen !== active) { wasFullscreen = active; changed(); }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  reveal();
}
