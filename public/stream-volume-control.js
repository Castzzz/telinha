const rememberedVolumes = new Map();
const speaker = '<path d="M11 5 6 9H3v6h3l5 4V5Z"/>';
const icon = muted => `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${speaker}${muted ? '<path d="m16 9 6 6m0-6-6 6"/>' : '<path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>'}</svg>`;

export function setupStreamVolumeControl(root, onChange) {
  if (!root) return;
  const input = root.querySelector('input');
  root.querySelector('[data-volume-mute]').innerHTML = icon(false);
  input.addEventListener('input', () => onChange(Number(input.value)));
  root.querySelector('[data-volume-mute]').addEventListener('click', () => {
    onChange(Number(input.value) > 0 ? 0 : rememberedVolumes.get(root.dataset.volumeKey) || 100);
  });
  root.querySelector('[data-volume-reset]').addEventListener('click', () => onChange(100));
}

export function syncStreamVolumeControl(root, percent, key) {
  if (!root) return;
  root.dataset.volumeKey = key;
  if (percent > 0) rememberedVolumes.set(key, percent);
  const input = root.querySelector('input');
  input.value = String(percent);
  input.style.setProperty('--volume-progress', `${percent / 3}%`);
  input.setAttribute('aria-valuetext', percent === 0 ? 'Silenciado' : `${percent}%`);
  root.classList.toggle('is-muted', percent === 0);
  root.classList.toggle('is-boosted', percent > 100);
  const mute = root.querySelector('[data-volume-mute]');
  mute.innerHTML = icon(percent === 0);
  mute.title = percent === 0 ? 'Ativar som da transmissão' : 'Silenciar transmissão';
  mute.setAttribute('aria-label', mute.title);
  mute.setAttribute('aria-pressed', String(percent === 0));
  root.querySelector('[data-volume-reset]').textContent = `${percent}%`;
}

export function forgetStreamVolumeControl(key) {
  rememberedVolumes.delete(key);
}
