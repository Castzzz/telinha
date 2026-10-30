const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Caminhos vêm do processo principal; a página só pode escolher ligado/desligado.
function createAutostart({ app, platform = process.platform, env = process.env, executable = process.execPath, home = os.homedir(), entryPath = path.join(__dirname, 'main.cjs') }) {
  const file = path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'autostart', 'telinha.desktop');
  const binary = env.APPIMAGE || executable;
  const args = app.isPackaged ? [] : [entryPath];
  const supported = ['linux', 'win32'].includes(platform) && !env.PORTABLE_EXECUTABLE_FILE;
  const options = { path: binary, args: platform === 'win32' ? args.map(value => '"' + value + '"') : args };
  const get = () => {
    if (!supported) return { supported: false, enabled: false, error: 'Use o app instalado ou o AppImage para iniciar com o PC.' };
    try {
      const enabled = platform === 'win32'
        ? (() => { const state = app.getLoginItemSettings(options); return state.openAtLogin && state.executableWillLaunchAtLogin !== false; })()
        : fs.existsSync(file) && !/^Hidden=true$/m.test(fs.readFileSync(file, 'utf8'));
      return { supported: true, enabled };
    } catch { return { supported: true, enabled: false, error: 'Não consegui consultar a inicialização automática.' }; }
  };
  const set = enabled => {
    if (typeof enabled !== 'boolean') return { ...get(), error: 'Opção inválida.' };
    if (!supported) return get();
    try {
      if (platform === 'win32') app.setLoginItemSettings({ ...options, openAtLogin: enabled, enabled });
      else if (enabled) {
        // Exec de .desktop não é shell: aspas, caracteres reservados e códigos % têm escape próprio.
        const quote = value => '"' + value.replace(/[%]/g, '%%').replace(/[\\"`$]/g, '\\$&').replace(/\\/g, '\\\\') + '"';
        if ([binary, ...args].some(value => /[\n\r]/.test(value))) throw new Error('Caminho inválido');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file + '.tmp', '[Desktop Entry]\nType=Application\nName=Teletela\nExec=' + [binary, ...args].map(quote).join(' ') + '\nTerminal=false\nX-GNOME-Autostart-enabled=true\n', { mode: 0o600 });
        fs.renameSync(file + '.tmp', file);
      } else fs.rmSync(file, { force: true });
      return get();
    } catch { return { ...get(), error: 'Não consegui alterar a inicialização automática neste PC.' }; }
  };
  return { get, set };
}
module.exports = { createAutostart };
