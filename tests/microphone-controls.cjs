// Exercita os controles reais e a atualização de fala sem reabrir a captura ou recriar fotos.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { registerAppScheme, handleAppProtocol, roomUrl } = require('../electron/app-protocol.cjs');
registerAppScheme();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
const profile = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'teletela-mic-controles-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
let io;
app.whenReady().then(async () => {
  const backend = await import('../server.js'); io = backend.io;
  const server = await backend.startServer(0, '127.0.0.1'); handleAppProtocol();
  const win = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  await win.loadURL(roomUrl(`http://127.0.0.1:${server.address().port}`));
  await win.webContents.executeJavaScript(`(async () => {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const until = async predicate => {
      for (let i = 0; i < 100; i++) { if (predicate()) return; await pause(40); }
      check(predicate(), 'A captura não chegou ao estado esperado.');
    };
    await until(() => window.appState && document.querySelector('#channel-geral .channel-row'));
    document.querySelectorAll('.modal-backdrop').forEach(el => el.classList.add('hidden'));
    const noise = document.querySelector('#select-noise-suppression');
    noise.value = 'off'; noise.dispatchEvent(new Event('change'));
    document.querySelector('#channel-geral .channel-row').click();
    await until(() => appState.currentChannelId === 'geral');
    document.querySelector('#btn-toggle-mic').click();
    await until(() => appState.micProcessor && appState.localMicStream?.getAudioTracks()[0].enabled);
    const track = appState.localMicStream.getAudioTracks()[0];
    const boost = document.querySelector('#input-mic-voice-boost');
    check(!boost, 'O reforço automático da 3.8 deve ter sido removido');
    document.querySelector('#modal-settings').classList.remove('hidden');
    document.querySelector('[data-settings-tab="microfone"]').click();
    const gain = document.querySelector('#input-mic-gain');
    for (const value of [200, 0, 100]) {
      gain.value = value; gain.dispatchEvent(new Event('input')); gain.dispatchEvent(new Event('change'));
      check(document.querySelector('#mic-gain-text').textContent === value + '%', 'O volume precisa refletir o ajuste manual');
      check(appState.localMicStream.getAudioTracks()[0] === track, 'Ajustar ganho não pode trocar a faixa enviada');
    }
    const avatar = document.querySelector('.lounge-user-card .user-avatar');
    check(avatar, 'A call precisa manter o avatar visível');
    for (let i = 0; i < 8; i++) { appState.vadDetector.onSpeakingChange(i % 2 === 0); await pause(80); }
    check(document.querySelector('.lounge-user-card .user-avatar') === avatar, 'Atualizar a fala não pode recriar o avatar');
    document.querySelector('#btn-toggle-mic').click();
    for (const mode of ['ia', 'basico', 'off']) {
      const oldTrack = appState.localMicStream.getAudioTracks()[0];
      noise.value = mode; noise.dispatchEvent(new Event('change'));
      await until(() => appState.localMicStream.getAudioTracks()[0] !== oldTrack);
      check(oldTrack.readyState === 'ended', 'Trocar filtro deve liberar a captura anterior');
      check(!appState.localMicStream.getAudioTracks()[0].enabled && !appState.myUser.isMicOn, 'Trocar filtro precisa manter o mute');
      check(appState.micProcessor, 'O ganho manual deve existir com qualquer filtro');
      check(appState.micProcessor.noiseFilter === (mode === 'ia' ? 'rnnoise' : 'off'), 'O filtro escolhido precisa carregar de verdade');
    }
  })()`);
  for (const theme of ['escuro', 'preto', 'claro']) {
    await win.webContents.executeJavaScript(`document.querySelector('#select-theme').value='${theme}';document.querySelector('#select-theme').dispatchEvent(new Event('change'));void 0`);
    await new Promise(resolve => setTimeout(resolve, 100));
    await fs.writeFile(path.join(os.tmpdir(), `teletela-mic-controles-${theme}.png`), (await win.webContents.capturePage()).toPNG());
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Controles passaram: três temas, filtros IA/básico/desligado, ganho, mute e avatar estável durante fala.');
  await finish(0);
}).catch(async err => { console.error(err); await finish(1); });
const timeout = setTimeout(() => { console.error('Teste dos controles excedeu 45 segundos.'); finish(1); }, 45000);
async function finish(code) {
  clearTimeout(timeout);
  BrowserWindow.getAllWindows().forEach(win => win.destroy());
  await new Promise(resolve => io ? io.close(resolve) : resolve());
  await fs.rm(profile, { recursive: true, force: true }); app.exit(code);
}
