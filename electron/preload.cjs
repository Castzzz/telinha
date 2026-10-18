const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  // No Wayland quem escolhe a tela é o seletor do sistema (portal), não o do app
  isWayland: process.platform === 'linux' && Boolean(process.env.WAYLAND_DISPLAY),
  getDesktopSources: (options) => ipcRenderer.invoke('get-desktop-sources', options),
  selectDesktopSource: (sourceId) => ipcRenderer.invoke('select-desktop-source', sourceId),
  // Som de um app só (Linux)
  listAudioApps: () => ipcRenderer.invoke('list-audio-apps'),
  routeAppAudio: (key) => ipcRenderer.invoke('route-app-audio', key),
  unrouteAppAudio: () => ipcRenderer.invoke('unroute-app-audio'),
  // Som de um app só (Windows): PCM 16-bit 48 kHz estéreo vindo do telinha-audio.exe
  startWinAudio: (sourceId) => ipcRenderer.invoke('start-win-audio', sourceId),
  stopWinAudio: () => ipcRenderer.invoke('stop-win-audio'),
  // Preferências (perfil, volumes por pessoa, atalhos) guardadas no app, não no link da sala
  getPrefs: () => ipcRenderer.invoke('prefs-get'),
  setPrefs: (patch) => ipcRenderer.invoke('prefs-set', patch),
  setGlobalHotkeys: (hotkeys) => ipcRenderer.invoke('set-global-hotkeys', hotkeys),
  onGlobalHotkey: (callback) => {
    ipcRenderer.removeAllListeners('global-hotkey');
    ipcRenderer.on('global-hotkey', (_event, action) => callback(action));
  },
  onWinAudioData: (callback) => {
    const listener = (_event, chunk) => callback(chunk);
    ipcRenderer.on('win-audio-data', listener);
    return () => ipcRenderer.removeListener('win-audio-data', listener);
  }
});

// Tela inicial (hospedar / entrar na sala de um amigo)
contextBridge.exposeInMainWorld('telinhaLauncher', {
  getState: () => ipcRenderer.invoke('launcher-state'),
  host: () => ipcRenderer.invoke('launcher-host'),
  join: (url) => ipcRenderer.invoke('launcher-join', url),
  open: (url) => ipcRenderer.invoke('launcher-open', url),
  copy: (text) => ipcRenderer.invoke('launcher-copy', text)
});
