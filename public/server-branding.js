export const SERVER_NAME = 'Colheita Fartus';
export const MAX_SERVER_ICON_BYTES = 512 * 1024;
export const SERVER_ICON_RE = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i;
export function validServerIcon(value) {
  return typeof value === 'string' && value.length <= Math.ceil(MAX_SERVER_ICON_BYTES / 3) * 4 + 50 && SERVER_ICON_RE.test(value);
}

export function setupServerBranding({ socket, state, serverUrl, canManage, showToast }) {
  const $ = id => document.getElementById(id);
  const fallback = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12H2v8h5v-8H4zm16 0h2v8h-5v-8h3z"/></svg>';
  let supported = false, busy = false;
  function render() {
    $('server-identity-settings').classList.toggle('hidden', !canManage());
    for (const button of $('server-identity-settings').querySelectorAll('button')) button.disabled = busy || !supported || !socket.connected;
    for (const node of document.querySelectorAll('[data-server-icon]')) {
      node.innerHTML = fallback;
      if (state.serverInfo?.iconVersion) {
        const image = document.createElement('img'); image.alt = '';
        image.src = `${serverUrl}/api/server-icon?v=${state.serverInfo.iconVersion}`;
        image.addEventListener('error', () => { node.innerHTML = fallback; }, { once: true });
        node.replaceChildren(image);
      }
    }
  }
  async function save(icon) {
    if (busy || !supported || !socket.connected) return;
    busy = true; render();
    try {
      const result = await socket.timeout(10000).emitWithAck('server-icon-set', { icon });
      if (!result?.success) throw new Error(result?.error || 'Não consegui salvar a imagem.');
      state.serverInfo = result.server;
      $('server-icon-status').textContent = icon ? 'Imagem do servidor atualizada.' : 'Ícone padrão restaurado.';
    } catch (error) { $('server-icon-status').textContent = error.message; showToast(error.message, 'error'); }
    finally { busy = false; render(); }
  }
  $('btn-server-icon-choose').addEventListener('click', () => $('input-server-icon').click());
  $('btn-server-icon-reset').addEventListener('click', () => save(''));
  $('input-server-icon').addEventListener('change', async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) return showToast('Escolha PNG, JPG ou WebP de até 2 MB.', 'error');
    let image;
    try {
      image = await createImageBitmap(file);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
      const side = Math.min(image.width, image.height);
      canvas.getContext('2d').drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 256, 256);
      await save(canvas.toDataURL('image/png'));
    } catch { showToast('Não consegui abrir essa imagem.', 'error'); }
    finally { image?.close(); }
  });
  socket.on('room-info', info => {
    if (!info.assetKey && !Object.hasOwn(info, 'brandingVersion')) return;
    supported = info.brandingVersion === 1;
    if (info.server) state.serverInfo = info.server;
    $('server-icon-status').textContent = supported ? '' : 'Atualize o servidor para personalizar a imagem.';
    render();
  });
  socket.on('server-info', info => { state.serverInfo = info; render(); });
  socket.on('permissions-state', () => queueMicrotask(render));
  socket.on('disconnect', render);
  render();
}
