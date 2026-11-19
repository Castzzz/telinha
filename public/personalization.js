const DEFAULTS = { themeColor: '', accent: '', secondary: '', wallpaper: '', intensity: 15 };
const COLOR = /^#[0-9a-f]{6}$/i;
const IMAGE = /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i;
export function normalizeAppearance(value = {}) {
  return { themeColor: COLOR.test(value?.themeColor) ? value.themeColor : '',
    accent: COLOR.test(value?.accent) ? value.accent : '',
    secondary: COLOR.test(value?.secondary) ? value.secondary : '',
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
export function applyAppearanceColors(state) {
  const root = document.documentElement;
  const themeColor = COLOR.test(state?.themeColor) ? state.themeColor : '';
  root.classList.toggle('has-theme-color', Boolean(themeColor));
  const primary = readableAccent(state?.accent) || readableAccent(themeColor);
  const secondary = COLOR.test(state?.secondary) ? state.secondary : '';
  const tokens = {
    '--theme-color': themeColor,
    '--accent-brand': primary,
    '--accent-brand-hover': primary && `color-mix(in srgb, ${primary} 85%, black)`,
    '--interface-ink': secondary && `color-mix(in srgb, ${secondary} 52%, var(--text-header))`,
    '--interface-line': secondary && `color-mix(in srgb, ${secondary} 50%, var(--border-medium))`,
    '--interface-tint': secondary && `color-mix(in srgb, ${secondary} 16%, var(--bg-secondary))`,
    '--accent-soft': secondary && `color-mix(in srgb, ${secondary} 20%, transparent)`,
    '--accent-softer': secondary && `color-mix(in srgb, ${secondary} 12%, transparent)`
  };
  for (const [name, color] of Object.entries(tokens)) {
    if (color) root.style.setProperty(name, color);
    else root.style.removeProperty(name);
  }
}
export function applyAppearance(value) {
  const state = normalizeAppearance(value), root = document.documentElement;
  applyAppearanceColors(state);
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
  const secondary = $('personal-secondary');
  const themePicker = $('personal-theme-color'), clearTheme = $('personal-clear-theme-color');
  const themeSwatches = document.querySelectorAll('[data-theme-swatch]');
  function sync() {
    const root = document.documentElement;
    const roda = root.dataset.visual === 'roda';
    const paleta = getComputedStyle(root);
    themePicker.value = state.themeColor || (roda ? paleta.getPropertyValue('--bg-primary').trim() : '#8951b5');
    clearTheme.disabled = !state.themeColor;
    for (const button of themeSwatches) button.setAttribute('aria-pressed', String(state.themeColor.toLowerCase() === button.dataset.themeSwatch));
    const tintaPadrao = roda ? paleta.getPropertyValue('--accent-brand').trim() : '#7c3aed';
    secondary.value = state.secondary || (root.dataset.visual === 'terminal' ? '#b3e89e' : tintaPadrao);
    color.value = state.accent || (roda ? tintaPadrao : '#5865f2'); intensity.value = state.intensity;
    $('personal-wallpaper-value').textContent = state.intensity + '%';
    $('personal-remove-wallpaper').disabled = !state.wallpaper;
    $('personal-wallpaper-name').textContent = state.wallpaper ? 'Fundo salvo neste aparelho' : 'Nenhuma imagem escolhida';
    intensity.disabled = !state.wallpaper;
    for (const button of document.querySelectorAll('[data-personal-accent]')) button.setAttribute('aria-pressed', String(state.accent.toLowerCase() === button.dataset.personalAccent));
  }
  let saving = Promise.resolve(), ultimaEscolha;
  function commit(next) {
    const desired = normalizeAppearance(next);
    ultimaEscolha = desired;
    state = applyAppearance(desired);
    saving = saving.then(async () => {
      const previous = normalizeAppearance(prefs.appearanceExperiment);
      if (await savePrefs({ appearanceExperiment: desired })) {
        if (desired !== ultimaEscolha) return;
        status.textContent = 'Personalização salva só neste aparelho.';
      } else {
        prefs.appearanceExperiment = previous;
        if (desired !== ultimaEscolha) return;
        state = applyAppearance(previous);
        status.textContent = 'Não consegui salvar. A aparência anterior foi restaurada.'; showToast(status.textContent, 'error');
      }
      sync();
    });
    return saving;
  }
  for (const button of document.querySelectorAll('[data-personal-accent]')) button.addEventListener('click', () => commit({ ...state, accent: button.dataset.personalAccent }));
  for (const button of themeSwatches) button.addEventListener('click', () => commit({ ...state, themeColor: button.dataset.themeSwatch }));
  clearTheme.addEventListener('click', () => commit({ ...state, themeColor: '' }));
  themePicker.addEventListener('input', () => { state = applyAppearance({ ...state, themeColor: themePicker.value }); });
  themePicker.addEventListener('change', () => commit(state));
  color.addEventListener('input', () => { state = applyAppearance({ ...state, accent: color.value }); });
  color.addEventListener('change', () => commit(state));
  secondary.addEventListener('input', () => { state = applyAppearance({ ...state, secondary: secondary.value }); });
  secondary.addEventListener('change', () => commit(state));
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
  for (const controle of document.querySelectorAll('.visual-choice input, #select-theme')) controle.addEventListener('change', sync);
  sync();
}
