// Emulador já aberto: valida a captura real de outro app, sem tocar na sala oficial.
const { app, BrowserWindow } = require('electron');
const { execFileSync, spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { registerAppScheme, handleAppProtocol, roomUrl } = require('../electron/app-protocol.cjs');
registerAppScheme(); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-captura-real-'));
app.setPath('userData', path.join(dir, 'electron'));
process.env.TELINHA_DATA_DIR = path.join(dir, 'data'); process.env.SFU_SECRET = ''; process.env.TELINHA_MUSIC = '0';
const sdk = process.env.ANDROID_HOME || path.join(os.homedir(), 'Android/Sdk');
const adbPath = path.join(sdk, 'platform-tools/adb'), serial = process.env.ANDROID_TEST_SERIAL || 'emulator-5554';
assert(serial.startsWith('emulator-'), 'Este teste só pode instalar apps num emulador.');
const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8', timeout: 20000 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, ms = 20000) { for (let i = 0; i < ms / 100; i++) { if (await fn()) return; await pause(100); } throw new Error(label); }
let backend, win, cdp, sfu;
const useSfu = process.env.ANDROID_TEST_SFU === '1';
const timeout = setTimeout(() => { console.error('Tempo esgotado'); finish(1); }, 180000);
function buildToneApp() {
  const tools = path.join(sdk, 'build-tools/36.0.0');
  const jdk = process.env.JAVA_HOME || path.join(os.homedir(), '.jdks/jbr-21.0.11');
  const javaEnv = { ...process.env, JAVA_HOME: jdk, PATH: path.join(jdk, 'bin') + path.delimiter + process.env.PATH };
  const androidJar = path.join(sdk, 'platforms/android-35/android.jar');
  fs.writeFileSync(path.join(dir, 'AndroidManifest.xml'), `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.castzin.teletela.capturetest"><uses-sdk android:minSdkVersion="26" android:targetSdkVersion="35"/><application android:label="Teste de captura" android:allowAudioPlaybackCapture="true" android:theme="@android:style/Theme.Material.Light.NoActionBar"><activity android:name=".PlaybackActivity" android:exported="true"/></application></manifest>`);
  fs.writeFileSync(path.join(dir, 'PlaybackActivity.java'), `package com.castzin.teletela.capturetest;
import android.app.Activity;import android.os.Bundle;import android.os.Handler;import android.graphics.Color;import android.widget.TextView;import android.media.*;
public class PlaybackActivity extends Activity {
 private AudioTrack tone;private final Handler handler=new Handler();private TextView text;private int frames;
 public void onCreate(Bundle state){super.onCreate(state);text=new TextView(this);text.setTextColor(Color.WHITE);text.setTextSize(28);setContentView(text);
 short[] samples=new short[96000];for(int i=0;i<48000;i++){short value=(short)(Math.sin(i*2*Math.PI*440/48000)*9000);samples[2*i]=value;samples[2*i+1]=value;}
 tone=new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).setAllowedCapturePolicy(AudioAttributes.ALLOW_CAPTURE_BY_ALL).build()).setAudioFormat(new AudioFormat.Builder().setSampleRate(48000).setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build()).setTransferMode(AudioTrack.MODE_STATIC).setBufferSizeInBytes(samples.length*2).build();tone.write(samples,0,samples.length);tone.setLoopPoints(0,48000,-1);tone.play();
 handler.post(new Runnable(){public void run(){text.setBackgroundColor(frames%2==0?Color.rgb(30,70,220):Color.rgb(200,40,50));text.setText("Teste de tela e áudio · "+frames++);handler.postDelayed(this,500);}});}
 public void onDestroy(){handler.removeCallbacksAndMessages(null);tone.stop();tone.release();super.onDestroy();}}
`);
  fs.mkdirSync(path.join(dir, 'classes')); fs.mkdirSync(path.join(dir, 'dex'));
  execFileSync(path.join(jdk, 'bin/javac'), ['-source', '17', '-target', '17', '-classpath', androidJar, '-d', path.join(dir, 'classes'), path.join(dir, 'PlaybackActivity.java')]);
  const classes = fs.readdirSync(path.join(dir, 'classes/com/castzin/teletela/capturetest')).map(file => path.join(dir, 'classes/com/castzin/teletela/capturetest', file));
  execFileSync(path.join(tools, 'd8'), ['--lib', androidJar, '--output', path.join(dir, 'dex'), ...classes], { env: javaEnv });
  const apk = path.join(dir, 'tone.apk');
  execFileSync(path.join(tools, 'aapt2'), ['link', '-I', androidJar, '--manifest', path.join(dir, 'AndroidManifest.xml'), '-o', apk]);
  execFileSync(path.join(jdk, 'bin/jar'), ['uf', apk, '-C', path.join(dir, 'dex'), 'classes.dex']);
  execFileSync(path.join(tools, 'apksigner'), ['sign', '--ks', path.join(os.homedir(), '.android/debug.keystore'), '--ks-pass', 'pass:android', '--key-pass', 'pass:android', apk], { env: javaEnv });
  adb('install', '-r', apk);
}
async function attachWebView() {
  let pid;
  await until(() => { try { pid = adb('shell', 'pidof', 'com.castzin.teletela.mobile').trim(); return Boolean(pid); } catch { return false; } }, 'O processo Android não abriu');
  adb('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`);
  let pages;
  await until(async () => { try { pages = await fetch('http://127.0.0.1:9223/json').then(r => r.json()); return pages.length; } catch { return false; } }, 'WebView não abriu o depurador');
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl); let index = 0; const pending = new Map();
  ws.onmessage = message => { const data = JSON.parse(message.data); if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); } };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  return { close: () => ws.close(), js: async expression => {
    const id = ++index;
    let timer;
    const result = new Promise((resolve, reject) => {
      timer = setTimeout(() => { pending.delete(id); reject(new Error('WebView não respondeu: ' + expression)); }, 10000);
      pending.set(id, resolve);
    });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true, userGesture: true } }));
    const response = await result.finally(() => clearTimeout(timer));
    if (response.result?.exceptionDetails || response.error) throw new Error(JSON.stringify(response));
    return response.result?.result?.value;
  } };
}
async function acceptProjection() {
  // O consentimento é o diálogo do próprio Android; não é substituído por uma permissão salva.
  const dialog = adb('shell', 'uiautomator', 'dump', '/sdcard/teletela-consent.xml');
  const xml = adb('shell', 'cat', '/sdcard/teletela-consent.xml'); fs.writeFileSync('/tmp/teletela-consentimento.xml', xml);
  console.log('Consentimento Android:', xml.replace(/<node/g, '\n<node').match(/text="[^"]*"/g)?.filter(value => !value.endsWith('=""')).join(' '));
  // Seleciona tela inteira se o Android oferecer captura de um único app.
  const dropdown = xml.match(/resource-id="com.android.systemui:id\/(?:screen_share_mode_spinner|screen_share_mode_options)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (dropdown) {
    adb('shell', 'input', 'tap', String((+dropdown[1] + +dropdown[3]) / 2), String((+dropdown[2] + +dropdown[4]) / 2)); await pause(250);
    adb('shell', 'uiautomator', 'dump', '/sdcard/teletela-consent.xml'); const choices = adb('shell', 'cat', '/sdcard/teletela-consent.xml');
    const full = choices.match(/text="(?:Entire screen|Share entire screen|Tela inteira|Compartilhar tela inteira)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    assert(full, 'Opção de tela inteira não encontrada: ' + choices);
    if (full) adb('shell', 'input', 'tap', String((+full[1] + +full[3]) / 2), String((+full[2] + +full[4]) / 2));
  }
  adb('shell', 'uiautomator', 'dump', '/sdcard/teletela-consent.xml');
  const prompt = adb('shell', 'cat', '/sdcard/teletela-consent.xml');
  const accept = prompt.match(/resource-id="android:id\/button1"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  assert(accept, 'Botão de aceitar captura não encontrado');
  adb('shell', 'input', 'tap', String((+accept[1] + +accept[3]) / 2), String((+accept[2] + +accept[4]) / 2));
}
app.whenReady().then(async () => {
  buildToneApp();
  if (useSfu) {
    const host = process.env.ANDROID_TEST_HOST || Object.entries(os.networkInterfaces()).filter(([name]) => !/docker|br-|tun|veth/.test(name)).flatMap(([, addresses]) => addresses).find(info => info.family === 'IPv4' && !info.internal)?.address;
    assert(host, 'Defina ANDROID_TEST_HOST com o IP deste PC na rede.');
    const reservation = require('node:net').createServer();
    await new Promise(resolve => reservation.listen(0, '0.0.0.0', resolve)); const sfuPort = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    const udp = require('node:dgram').createSocket('udp4'); await new Promise(resolve => udp.bind(0, '0.0.0.0', resolve)); const mediaPort = udp.address().port; await new Promise(resolve => udp.close(resolve));
    process.env.SFU_SECRET = randomBytes(32).toString('hex');
    process.env.SFU_INTERNAL_URL = `http://127.0.0.1:${sfuPort}`;
    process.env.SFU_PATH = `ws://${host}:${sfuPort}/ws`;
    sfu = spawn(path.resolve(__dirname, '../.cache/music-lab/music-sfu'), [], { env: { ...process.env, PORT: String(sfuPort), MEDIA_PORT: String(mediaPort), SFU_HOST: '0.0.0.0', PUBLIC_IP: host, ICE_SERVERS: '[]' }, stdio: ['ignore', 'ignore', 'pipe'] });
    sfu.stderr.on('data', chunk => fs.appendFileSync('/tmp/teletela-android-sfu.log', chunk));
    await until(async () => { try { return (await fetch(process.env.SFU_INTERNAL_URL + '/health')).ok; } catch { return false; } }, 'SFU local não iniciou');
  }
  backend = await import('../server.js'); const server = await backend.startServer(0, '0.0.0.0');
  const port = server.address().port;
  adb('shell', 'am', 'force-stop', 'com.castzin.teletela.mobile');
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  adb('shell', 'pm', 'grant', 'com.castzin.teletela.mobile', 'android.permission.RECORD_AUDIO');
  adb('shell', 'pm', 'grant', 'com.castzin.teletela.mobile', 'android.permission.POST_NOTIFICATIONS');
  adb('shell', 'am', 'start', '-n', 'com.castzin.teletela.mobile/.MainActivity', '--es', 'serverUrl', `http://10.0.2.2:${port}`);
  cdp = await attachWebView(); await until(() => cdp.js('Boolean(window.appState?.myId)'), 'Android não conectou');
  await cdp.js(`document.querySelectorAll('.modal-backdrop').forEach(el=>el.classList.add('hidden'));if(appState.myUser.isMicOn)document.querySelector('#btn-toggle-mic').click();document.querySelector('#channel-geral .channel-row').click();void 0`);
  await until(() => cdp.js('Boolean(appState.currentChannelId)'), 'Android não entrou na call');
  // Começar mutado prova que o áudio da transmissão independe da captura do microfone.
  await cdp.js(`if(appState.myUser.isMicOn)document.querySelector('#btn-toggle-mic').click();document.querySelector('#mobile-call-more').click();document.querySelector('#btn-mobile-screen').click();void 0`);
  await until(() => cdp.js("!document.querySelector('#modal-share-quality').classList.contains('hidden')"), 'Seletor de qualidade não abriu');
  await cdp.js(`document.querySelector('[data-quality="720p30"]').click();document.querySelector('#btn-share-quality-go').click();void 0`);
  await pause(800);
  await acceptProjection();
  await until(() => cdp.js('Boolean(appState.localScreenStream)'), 'A captura não entregou faixas à WebView', 30000);
  console.log('Captura nativa conectada à WebView.');
  const androidId = await cdp.js('appState.myId');
  assert(await cdp.js('appState.localScreenStream.getAudioTracks().length === 1 && !appState.localMicStream && !appState.myUser.isMicOn'));
  win = new BrowserWindow({ width: 1100, height: 800, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  handleAppProtocol(win.webContents.session); await win.loadURL(roomUrl(`http://127.0.0.1:${port}`));
  const js = code => win.webContents.executeJavaScript(code, true);
  await until(() => js('Boolean(window.appState?.myId)'), 'Desktop não conectou');
  await js(`document.querySelectorAll('.modal-backdrop').forEach(el=>el.classList.add('hidden'));document.querySelector('#channel-geral .channel-row').click();void 0`);
  await until(() => js('Boolean(appState.currentChannelId)'), 'Desktop não entrou na call');
  await until(() => js(`Boolean(document.querySelector('[data-user-id="${androidId}"] .badge-live-stream'))`), 'Selo ao vivo do Android não apareceu');
  await js(`document.querySelector('[data-user-id="${androidId}"] .badge-live-stream').click();void 0`);
  await until(() => js(`Boolean(appState.activeStreams.get('${androidId}')?.stream.getVideoTracks().length)`), 'Desktop não recebeu o vídeo');
  console.log('Vídeo Android recebido no desktop.');
  adb('shell', 'am', 'start', '-n', 'com.castzin.teletela.capturetest/.PlaybackActivity'); await pause(2500);
  // Diálogos de uma execução que caiu podem sobreviver no processo da SystemUI.
  adb('shell', 'uiautomator', 'dump', '/sdcard/teletela-consent.xml');
  const leftover = adb('shell', 'cat', '/sdcard/teletela-consent.xml');
  if (leftover.includes('screen_share_permission_dialog')) {
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await pause(300);
  }
  await until(() => js(`(()=>{
    const video=document.querySelector('#video-el-${androidId}');
    if(!video || video.readyState<2)return false;
    const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;
    const ctx=canvas.getContext('2d');ctx.drawImage(video,video.videoWidth/2,video.videoHeight*.85,1,1,0,0,1,1);
    const p=ctx.getImageData(0,0,1,1).data;return (p[0]>120 && p[2]<100) || (p[2]>120 && p[0]<100);
  })()`), 'Os pixels de outro app não chegaram ao desktop');
  console.log('Pixels do app de teste recebidos no desktop.');
  await js(`(async()=>{
    const stream=appState.activeStreams.get('${androidId}').stream;
    window.captureTestAudio=new AudioContext();await captureTestAudio.resume();window.captureAnalyser=captureTestAudio.createAnalyser();captureAnalyser.fftSize=8192;
    captureTestAudio.createMediaStreamSource(stream).connect(captureAnalyser);
  })()`);
  let peak = 0;
  await until(async () => { peak = await js(`(()=>{const samples=new Float32Array(captureAnalyser.fftSize);captureAnalyser.getFloatTimeDomainData(samples);return Math.max(...samples.map(Math.abs))})()`); return peak > .02; }, 'O áudio de outro app não chegou ao desktop');
  const frequency = await js(`(()=>{const data=new Float32Array(captureAnalyser.frequencyBinCount);captureAnalyser.getFloatFrequencyData(data);let bin=0;for(let i=1;i<data.length;i++)if(data[i]>data[bin])bin=i;return bin*captureTestAudio.sampleRate/captureAnalyser.fftSize})()`);
  assert(Math.abs(frequency - 440) < 20, `Esperava tom de 440 Hz, recebeu ${frequency}`);
  await pause(300); fs.writeFileSync('/tmp/teletela-android-tela-recebida.png', (await win.webContents.capturePage()).toPNG());
  const state = await cdp.js('({sharing:appState.myUser.isSharing,muted:!appState.myUser.isMicOn,voice:!!appState.currentChannelId,tracks:appState.localScreenStream.getTracks().map(t=>t.kind)})');
  assert(state.sharing && state.muted && state.voice); console.log('Android em segundo plano:', state, 'Pico recebido:', peak, 'Frequência:', frequency);
  adb('shell', 'am', 'start', '-n', 'com.castzin.teletela.mobile/.MainActivity');
  await cdp.js("document.querySelector('#btn-toggle-mic').click();void 0");
  await until(() => cdp.js('Boolean(appState.localMicStream?.getAudioTracks()[0]?.enabled)'), 'Microfone não abriu junto da captura de áudio interno');
  await cdp.js('window.captureTestMic=appState.localMicStream;void 0');
  // Encerrar a tela pelo app não deve derrubar a chamada de voz.
  await cdp.js("document.querySelector('#mobile-call-more').click();document.querySelector('#btn-mobile-screen').click();void 0");
  await until(() => cdp.js('!appState.myUser.isSharing && !appState.localScreenStream'), 'Parar não encerrou a captura');
  assert(await cdp.js('Boolean(appState.currentChannelId) && appState.myUser.isMicOn && appState.localMicStream === captureTestMic && captureTestMic.getAudioTracks()[0].readyState === "live"'));
  await cdp.js("document.querySelector('#btn-toggle-mic').click();void 0");
  adb('shell', 'am', 'start', '-n', 'com.castzin.teletela.mobile/.MainActivity');
  async function requestAgain() {
    await cdp.js("document.querySelector('#mobile-call-more').click();document.querySelector('#btn-mobile-screen').click();void 0");
    await until(() => cdp.js("!document.querySelector('#modal-share-quality').classList.contains('hidden')"), 'Qualidade não abriu novamente');
    await cdp.js("document.querySelector('#btn-share-quality-go').click();void 0");
    await pause(700);
  }
  await requestAgain();
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await until(() => cdp.js('!appState.myUser.isSharing && !appState.localScreenStream'), 'Cancelar o consentimento não limpou a captura');
  assert(await cdp.js('Boolean(appState.currentChannelId)'));
  await requestAgain();
  await cdp.js("document.querySelector('#btn-dock-leave').click();void 0");
  await acceptProjection();
  await pause(700);
  assert(await cdp.js('!appState.currentChannelId && !appState.myUser.isSharing && !appState.localScreenStream && !appState.localMicStream'));
  await until(() => !/\.(?:ScreenCaptureService|CallService)\b/.test(adb('shell', 'dumpsys', 'activity', 'services', 'com.castzin.teletela.mobile')), 'Um serviço de captura/chamada ficou ativo após sair');
  console.log('Cancelar a autorização e sair da call antes de aceitar não deixam captura nem serviço ativos.');
  console.log(`Tela e áudio reais entre Android e desktop (${useSfu ? 'SFU' : 'P2P'}), mic mutado, captura em segundo plano e encerramento independente da voz passaram.`);
}).then(() => finish(0)).catch(async error => {
  console.error(error);
  try {
    if (win && !win.isDestroyed()) {
      console.log('Diagnóstico do receptor:', await win.webContents.executeJavaScript(`(async()=>{
        const video=document.querySelector('#videos-grid video');const stats=[];
        for(const peer of appState.screenPeersIn.values())for(const s of (await peer.getStats()).values())if(s.type==='inbound-rtp')stats.push(s);
        return {video:video&&{ready:video.readyState,paused:video.paused,width:video.videoWidth,height:video.videoHeight,frames:video.getVideoPlaybackQuality().totalVideoFrames},stats};
      })()`));
      fs.writeFileSync('/tmp/teletela-android-captura-falha.png', (await win.webContents.capturePage()).toPNG());
    }
    if (cdp) console.log('Diagnóstico do emissor:', await cdp.js(`(async()=>{const stats=[];for(const peer of appState.screenPeersOut.values())for(const s of (await peer.getStats()).values())if(s.type==='outbound-rtp'||s.type==='media-source')stats.push(s);return {sharing:appState.myUser.isSharing,tracks:appState.localScreenStream?.getTracks().map(t=>({kind:t.kind,muted:t.muted,enabled:t.enabled,settings:t.getSettings()})),stats};})()`));
  } catch (diagnostic) { console.error('Diagnóstico indisponível:', diagnostic.message); }
  await finish(1);
});
async function finish(code) {
  clearTimeout(timeout); cdp?.close(); win?.destroy();
  try { adb('shell', 'am', 'force-stop', 'com.castzin.teletela.mobile'); adb('uninstall', 'com.castzin.teletela.capturetest'); adb('forward', '--remove', 'tcp:9223'); } catch {}
  if (backend) await new Promise(resolve => backend.io.close(resolve));
  if (sfu && sfu.exitCode === null) { const stopped = once(sfu, 'exit'); sfu.kill(); await stopped; }
  fs.rmSync(dir, { recursive: true, force: true }); app.exit(code);
}
