// Confere a interface e áudio de dois ouvintes usando o Electron do sistema.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'teletela-music-ui-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});
let lab;
const windows = [];
async function waitFor(check, message, seconds = 15) {
  for (let count = 0; count < seconds * 5; count++) {
    if (await check()) return;
    await pause(200);
  }
  throw new Error(message);
}

app.whenReady().then(async () => {
  const { startMusicLab } = await import('../scripts/music-lab/server.mjs');
  const real = process.env.MUSIC_LAB_REAL === '1';
  const video = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  const options = { port: 0 };
  if (!real) {
    const fixture = path.join(profile, 'tom.mp3');
    await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=18', '-y', fixture]);
    options.resolve = async () => ({ source: { title: 'Tom de teste 440 Hz' }, notice: 'Fonte de áudio gerada para conferir a transmissão.',
      candidates: [{ url: video, title: 'Tom de teste 440 Hz', author: 'Teste local', duration: 18 }] });
    options.prepare = async (_url, folder) => {
      const file = path.join(folder, 'faixa.mp3');
      await fs.copyFile(fixture, file);
      return file;
    };
  }
  lab = await startMusicLab(options);
  console.log('Laboratório iniciado; conferindo a interface.');
  const createWindow = async () => {
    const win = new BrowserWindow({ width: 1100, height: 1000, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
    windows.push(win);
    win.webContents.setAudioMuted(true);
    await win.loadURL(lab.url);
    await win.webContents.executeJavaScript(`
      window.musicContext = new AudioContext();
      window.musicAnalyser = musicContext.createAnalyser();
      musicContext.createMediaElementSource(document.querySelector('#audio')).connect(musicAnalyser);
      musicAnalyser.connect(musicContext.destination);
      musicContext.resume();
      document.querySelector('#listen').click();
    `);
    return win;
  };
  const first = await createWindow();
  const input = real ? 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT' : video;
  await first.webContents.executeJavaScript(`
    document.querySelector('#music-input').value = ${JSON.stringify(input)};
    document.querySelector('#search-form').requestSubmit();
  `);
  await waitFor(() => first.webContents.executeJavaScript("Boolean(document.querySelector('.track button'))"), 'A busca não mostrou versões.', 60);
  console.log('Versão encontrada; preparando o áudio.');
  await first.webContents.executeJavaScript("document.querySelector('.track button').click()");
  await waitFor(() => {
    if (lab.broadcast.state.phase === 'error') throw new Error(lab.broadcast.state.error);
    return lab.broadcast.state.phase === 'playing';
  }, 'O servidor não iniciou a transmissão.', 130);
  console.log('Transmissão iniciada; conferindo a escuta.');
  const pid = lab.broadcast.child.pid;
  await waitFor(() => first.webContents.executeJavaScript("document.querySelector('#audio').currentTime > 1"), 'O primeiro ouvinte não reproduziu o áudio.');
  const second = await createWindow();
  await waitFor(() => second.webContents.executeJavaScript("document.querySelector('#audio').currentTime > 1"), 'O ouvinte que entrou depois não reproduziu o áudio.');
  if (lab.broadcast.child.pid !== pid || lab.broadcast.state.listeners !== 2) throw new Error('Os ouvintes não compartilham um único processo.');
  const levels = [];
  for (const win of [first, second]) {
    levels.push(await win.webContents.executeJavaScript(`(async () => {
      let peak = 0;
      for (let index = 0; index < 12; index++) {
        const data = new Uint8Array(musicAnalyser.fftSize);
        musicAnalyser.getByteTimeDomainData(data);
        peak = Math.max(peak, ...data.map(value => Math.abs(value - 128)));
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return peak;
    })()`));
  }
  if (levels.some(level => level < 2)) throw new Error('Um ouvinte recebeu silêncio: ' + levels.join(', '));
  await first.webContents.executeJavaScript("document.querySelector('#volume').value = 20; document.querySelector('#volume').dispatchEvent(new Event('input'))");
  const secondVolume = await second.webContents.executeJavaScript("document.querySelector('#audio').volume");
  if (secondVolume !== .5) throw new Error('Volume local alterou o segundo ouvinte.');
  for (const theme of ['escuro', 'preto', 'claro']) {
    await first.webContents.executeJavaScript(`document.querySelector('#theme').value = '${theme}'; document.querySelector('#theme').dispatchEvent(new Event('change'))`);
    await first.webContents.executeJavaScript('window.scrollTo(0, 0)');
    const screenshot = await first.webContents.capturePage();
    await fs.writeFile(`/tmp/teletela-musica-${theme}.png`, screenshot.toPNG());
    await first.webContents.executeJavaScript("document.querySelector('.broadcast').scrollIntoView({block: 'center'})");
    await fs.writeFile(`/tmp/teletela-musica-transmissao-${theme}.png`, (await first.webContents.capturePage()).toPNG());
  }
  first.setSize(390, 844);
  await first.webContents.executeJavaScript('window.scrollTo(0, 0)');
  await pause(150);
  if (await first.webContents.executeJavaScript('document.documentElement.scrollWidth > innerWidth')) throw new Error('A tela transborda no celular.');
  await fs.writeFile('/tmp/teletela-musica-celular.png', (await first.webContents.capturePage()).toPNG());
  await second.webContents.executeJavaScript("document.querySelector('#stop').click()");
  await waitFor(() => lab.broadcast.state.phase === 'idle', 'Parar não interrompeu a transmissão.');
  await waitFor(() => first.webContents.executeJavaScript("!document.querySelector('#audio').getAttribute('src')"), 'Parar não interrompeu o outro ouvinte.');
  console.log(JSON.stringify({ ok: true, fonteReal: real, ouvintes: 2, processoUnico: true, entradaTardia: true, volumeIndividual: true, picosDeAudio: levels, temas: 3, celular: true }));
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const win of windows) if (!win.isDestroyed()) win.destroy();
  if (lab) await lab.close();
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  app.exit(process.exitCode || 0);
});
