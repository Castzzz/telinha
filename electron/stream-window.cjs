const path = require('node:path');

const players = new WeakMap();

function updateStreamWindowTheme(mainWindow, colors) {
  for (const child of players.get(mainWindow) || []) {
    if (child.isDestroyed()) continue;
    child.setBackgroundColor(colors.color);
    if (process.platform !== 'darwin') child.setTitleBarOverlay({ ...colors, height: 44 });
  }
}

// Só o player local pode abrir uma janela do app; links continuam no navegador.
function setupStreamWindow(mainWindow, shell, { getTitleBarColors = () => ({ color: '#1e1f22', symbolColor: '#dbdee1' }) } = {}) {
  const children = new Set();
  players.set(mainWindow, children);
  const playerUrl = 'telinha://app/stream-window.html';
  mainWindow.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (url === playerUrl && frameName === 'teletela-stream') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 960, height: 580, minWidth: 360, minHeight: 240,
          title: 'Transmissão — Teletela',
          icon: path.join(__dirname, '..', 'public', 'icon.png'),
          frame: true, backgroundColor: getTitleBarColors().color,
          ...(process.platform === 'darwin'
            ? { titleBarStyle: 'hiddenInset' }
            : { titleBarStyle: 'hidden', titleBarOverlay: { ...getTitleBarColors(), height: 44 } }),
          autoHideMenuBar: true, resizable: true, maximizable: true,
          fullscreenable: true,
          webPreferences: {
            contextIsolation: true, nodeIntegration: false,
            backgroundThrottling: false
          }
        }
      };
    }
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('did-create-window', child => {
    children.add(child);
    child.on('closed', () => children.delete(child));
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    child.webContents.on('will-navigate', (event, url) => {
      if (url !== playerUrl) event.preventDefault();
    });
  });
}

module.exports = { setupStreamWindow, updateStreamWindowTheme };
