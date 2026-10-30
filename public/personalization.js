const DEFAULTS = { accent: '', wallpaper: '', intensity: 15 };
const COLOR = /^#[0-9a-f]{6}$/i;
const IMAGE = /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i;
export function normalizeAppearance(value = {}) {
  return { accent: COLOR.test(value?.accent) ? value.accent : '',
    wallpaper: typeof value?.wallpaper === 'string' && value.wallpaper.length <= 3 * 1024 * 1024 && IMAGE.test(value.wallpaper) ? value.wallpaper : '',
    intensity: Number.isFinite(value?.intensity) ? Math.max(5, Math.min(30, Math.round(value.intensity))) : DEFAULTS.intensity };
}
// Mantém contraste nos botões que usam texto branco, inclusive ao escolher cores claras.
export function readableAccent(color) {
  if (!COLOR.test(color)) return '';
  let rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
  const luminance = channels => channels.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  while (1.05 / (luminance(rgb) + .05) < 4.5) rgb = rgb.map(value => Math.floor(value * .95));
  return '#' + rgb.map(value => value.toString(16).padStart(2, '0')).join('');
}
export function applyAppearance(value) {
  const state = normalizeAppearance(value), root = document.documentElement;
  for (const name of ['--accent-brand', '--accent-brand-hover']) root.style.removeProperty(name);
  if (state.accent) {
    root.style.setProperty('--accent-brand', readableAccent(state.accent));
    root.style.setProperty('--accent-brand-hover', `color-mix(in srgb, ${readableAccent(state.accent)} 85%, black)`);
  }
  root.classList.toggle('has-personal-wallpaper', Boolean(state.wallpaper));
  root.style.setProperty('--personal-wallpaper-strength', state.intensity + '%');
  if (state.wallpaper) root.style.setProperty('--personal-wallpaper', `url("${state.wallpaper}")`);
  else root.style.removeProperty('--personal-wallpaper');
  return state;
}

export function setupPersonalization({ prefs, savePrefs, showToast }) {
  const $ = id => document.getElementById(id);
  let state = applyAppearance(prefs.appearanceExperiment), imageRequest = 0;
  const color = $('personal-accent'), intensity = $('personal-wallpaper-intensity'), status = $('personal-status');
  function sync() {
    color.value = state.accent || '#5865f2'; intensity.value = state.intensity;
    $('personal-wallpaper-value').textContent = state.intensity + '%';
    $('personal-remove-wallpaper').disabled = !state.wallpaper;
    $('personal-wallpaper-name').textContent = state.wallpaper ? 'Fundo salvo neste aparelho' : 'Nenhuma imagem escolhida';
    intensity.disabled = !state.wallpaper;
    for (const button of document.querySelectorAll('[data-personal-accent]')) button.setAttribute('aria-pressed', String(state.accent.toLowerCase() === button.dataset.personalAccent));
  }
  let saving = Promise.resolve();
  function commit(next) {
    const desired = normalizeAppearance(next);
    saving = saving.then(async () => {
      const previous = normalizeAppearance(prefs.appearanceExperiment);
      if (await savePrefs({ appearanceExperiment: desired })) {
        state = applyAppearance(desired); status.textContent = 'Personalização salva só neste aparelho.';
      } else {
        prefs.appearanceExperiment = previous; state = applyAppearance(previous);
        status.textContent = 'Não consegui salvar. A aparência anterior foi restaurada.'; showToast(status.textContent, 'error');
      }
      sync();
    });
    return saving;
  }
  for (const button of document.querySelectorAll('[data-personal-accent]')) button.addEventListener('click', () => commit({ ...state, accent: button.dataset.personalAccent }));
  color.addEventListener('input', () => { state = applyAppearance({ ...state, accent: color.value }); });
  color.addEventListener('change', () => commit(state));
  intensity.addEventListener('input', () => { state = applyAppearance({ ...state, intensity: Number(intensity.value) }); $('personal-wallpaper-value').textContent = state.intensity + '%'; });
  intensity.addEventListener('change', () => commit(state));
  $('personal-remove-wallpaper').addEventListener('click', () => { imageRequest++; commit({ ...state, wallpaper: '' }); });
  $('personal-reset').addEventListener('click', () => { imageRequest++; commit(DEFAULTS); });
  $('personal-choose-wallpaper').addEventListener('click', () => $('personal-wallpaper-file').click());
  $('personal-wallpaper-file').addEventListener('change', async event => {
    const file = event.target.files[0], version = ++imageRequest; event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      status.textContent = 'Escolha PNG, JPG ou WebP com até 2 MB.'; return;
    }
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      if (version !== imageRequest) return;
      const scale = Math.min(1, 1920 / bitmap.width, 1080 / bitmap.height);
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const wallpaper = canvas.toDataURL('image/webp', .82);
      if (wallpaper.length > 3 * 1024 * 1024) throw new Error('Imagem grande demais');
      await commit({ ...state, wallpaper });
    } catch { status.textContent = 'Não consegui abrir essa imagem. Tente outro arquivo.'; }
    finally { bitmap?.close(); }
  });
  sync();
}
