// Executar com o Electron do sistema: testa Web Audio e Opus de verdade, sem microfone físico.
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.on('window-all-closed', () => {});
const profile = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'teletela-mic-teste-'));
app.setPath('userData', profile);
let server;
async function finish(code) {
  clearTimeout(timeout);
  BrowserWindow.getAllWindows().forEach(win => win.destroy());
  server?.closeAllConnections(); server?.close();
  await fs.rm(profile, { recursive: true, force: true });
  app.exit(code);
}
const timeout = setTimeout(() => { console.error('O teste do microfone excedeu 60 segundos.'); finish(1); }, 60000);
app.whenReady().then(async () => {
  const root = path.resolve(__dirname, '..');
  const types = { '.js': 'text/javascript', '.html': 'text/html', '.wasm': 'application/wasm', '.css': 'text/css' };
  server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === '/') { res.end('<!doctype html><title>Teste do microfone</title>'); return; }
      const file = pathname === '/__test.js' ? path.join(root, 'tests/helpers/microphone-browser.js') : path.resolve(root, 'public', '.' + pathname);
      if (!file.startsWith(root + path.sep)) throw new Error('Caminho inválido');
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.on('console-message', (event) => console.log(event.message));
  await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
  const result = await win.webContents.executeJavaScript("import('/__test.js').then(m => m.run())");
  console.log(JSON.stringify(result, null, 2));
  await finish(0);
}).catch(async err => { console.error(err); await finish(1); });
