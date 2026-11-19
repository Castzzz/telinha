export function setupScreenPreviews({ appState, socket, localStreamFor, streamKey, streamKind, streamOwner, streamLabel }) {
  const captured = new WeakMap();
  const canvas = document.createElement('canvas');
  async function capture(kind) {
    const stream = localStreamFor(kind);
    const track = stream?.getVideoTracks()[0];
    if (!socket.connected || !track || track.readyState !== 'live' || Date.now() - (captured.get(track) || 0) < 15000) return;
    captured.set(track, Date.now());
    const video = document.getElementById('video-el-' + streamKey(appState.myId, kind));
    let bitmap;
    try {
      const source = video?.videoWidth && video.srcObject === stream ? video
        : (bitmap = await new ImageCapture(track).grabFrame());
      if (localStreamFor(kind) !== stream) return;
      const width = source.videoWidth || source.width, height = source.videoHeight || source.height;
      const scale = Math.min(320 / width, 180 / height, 1);
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
      socket.volatile.emit('screen-preview-set', { kind, image: canvas.toDataURL('image/jpeg', 0.6) });
    } catch { captured.delete(track); }
    finally { bitmap?.close(); }
  }
  const image = document.createElement('img');
  image.className = 'live-thumbnail';
  let badge, requested = 0;
  function hide() { badge = null; image.remove(); }
  function request(target) {
    const key = target.dataset.streamKey, kind = streamKind(key);
    const dono = streamOwner(key);
    const protegido = [...appState.channels.values()].some(ch => ch.users.get(dono)?.protectedStreams?.includes(kind));
    if (kind === 'camera' || protegido || !socket.connected) return hide();
    badge = target;
    requested = Date.now();
    socket.timeout(4000).emit('screen-preview-get', { targetId: streamOwner(key), kind }, (err, src) => {
      if (badge !== target || !target.isConnected) return;
      if (err || !src) return image.remove();
      image.alt = 'Prévia de ' + streamLabel(key);
      image.src = src;
      document.body.append(image);
      const rect = target.getBoundingClientRect();
      image.style.left = Math.max(4, Math.min(rect.left, innerWidth - image.offsetWidth - 4)) + 'px';
      image.style.top = (rect.bottom + 148 < innerHeight ? rect.bottom + 4 : Math.max(4, rect.top - 146)) + 'px';
    });
  }
  for (const type of ['pointerover', 'focusin']) document.addEventListener(type, event => {
    const target = event.target.closest?.('.badge-live-stream');
    if (target && target !== badge) { hide(); request(target); }
  });
  for (const type of ['pointerout', 'focusout']) document.addEventListener(type, event => {
    if (badge?.contains(event.target) && !badge.contains(event.relatedTarget)) hide();
  });
  socket.on('disconnect', hide);
  document.addEventListener('scroll', event => {
    if (badge && event.target.contains?.(badge) && document.activeElement !== badge) hide();
  }, true);
  setInterval(() => {
    for (const kind of ['screen', 'screen2', 'screen3']) capture(kind);
    if (badge && !badge.isConnected) hide();
    const underPointer = document.querySelector('.badge-live-stream:hover');
    if (!badge && underPointer && streamKind(underPointer.dataset.streamKey) !== 'camera') request(underPointer);
    if (badge && Date.now() - requested >= (image.isConnected ? 15000 : 3000)) request(badge);
  }, 1000);
}
