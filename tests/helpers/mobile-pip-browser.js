export async function run() {
  const { setupMobilePip, syncMobilePip } = await import(new URL('mobile-pip.js', window.location.href));
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const states = [];
  window.TeletelaAndroid.setPipState = json => states.push(JSON.parse(json));
  const state = { currentChannelId: 'geral', activeStreams: new Map(), focusedStreamUserId: 'pip-a', myUser: { isMicOn: false, isDeafened: false } };
  setupMobilePip(() => state);
  check(!states.at(-1).ready, 'Sem transmissão não deve ativar PiP');
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#6554db'; ctx.fillRect(0, 0, 640, 360);
  const stream = canvas.captureStream(10);
  for (const key of ['pip-a', 'pip-b']) {
    const tile = document.createElement('div'); tile.id = `video-tile-${key}`; tile.className = 'video-tile';
    const video = document.createElement('video'); video.id = `video-el-${key}`; video.muted = true; video.autoplay = true; video.srcObject = stream;
    tile.appendChild(video); document.querySelector('#videos-grid').appendChild(tile);
    state.activeStreams.set(key, { stream, isLocal: false });
    await video.play();
  }
  syncMobilePip(state);
  check(states.at(-1).ready && states.at(-1).key === 'pip-a', 'PiP precisa selecionar a transmissão aberta');
  const video = document.getElementById('video-el-pip-a');
  window.teletelaPipChanged(true);
  check(document.documentElement.classList.contains('android-pip'), 'Entrar no PiP deve aplicar a apresentação compacta');
  check(getComputedStyle(document.querySelector('#mobile-header')).display === 'none', 'PiP não deve mostrar menus');
  check(video.muted && !state.myUser.isMicOn, 'PiP não pode desmutar vídeo nem microfone');
  state.myUser.isDeafened = true; syncMobilePip(state);
  check(video.muted && state.myUser.isDeafened, 'PiP precisa respeitar o áudio desativado');
  state.focusedStreamUserId = 'pip-b'; syncMobilePip(state);
  check(states.at(-1).key === 'pip-b' && document.getElementById('video-tile-pip-b').classList.contains('android-pip-tile'), 'Trocar transmissão deve atualizar a janelinha');
  state.activeStreams.delete('pip-b'); syncMobilePip(state);
  check(states.at(-1).key === 'pip-a', 'Parar a transmissão aberta deve selecionar a restante');
  state.currentChannelId = null; syncMobilePip(state);
  check(!states.at(-1).ready, 'Sair da call deve desativar PiP');
  window.teletelaPipChanged(false);
  check(!document.documentElement.classList.contains('android-pip'), 'Voltar ao app deve restaurar a interface');
  stream.getTracks().forEach(track => track.stop());
  for (const key of ['pip-a', 'pip-b']) document.getElementById(`video-tile-${key}`).remove();
  return { pipSelection: true, pipAudioPreserved: true, pipReturn: true };
}
