const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Caminhos vêm do processo principal; a página só pode escolher ligado/desligado.
function createAutostart({ app, platform = process.platform, env = process.env, executable = process.execPath, home = os.homedir(), entryPath = path.join(__dirname, 'main.cjs') }) {
  const file = path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'autostart', 'telinha.desktop');
  const binary = env.APPIMAGE || executable;
  const hyprland = platform === 'linux' && /hyprland/i.test(env.XDG_CURRENT_DESKTOP || '');
  const hyprConfig = path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'hypr', 'hyprland.conf');
  const script = path.join(path.dirname(file), 'telinha-hyprland.sh');
  const blockStart = '# >>> Teletela: início automático >>>';
  const blockEnd = '# <<< Teletela: início automático <<<';
  const removeBlock = value => {
    const start = value.indexOf('\n' + blockStart + '\n');
    if (start < 0) return value;
    const end = value.indexOf('\n' + blockEnd + '\n', start);
    if (end < 0) throw new Error('Bloco de inicialização incompleto');
    return value.slice(0, start) + value.slice(end + blockEnd.length + 2);
  };
  const writeAtomic = (name, value, mode = 0o600) => {
    fs.writeFileSync(name + '.tmp', value, { mode }); fs.renameSync(name + '.tmp', name);
  };
  function configureHyprland(enabled) {
    // A configuração pode ser um symlink do usuário: preserva o link e o restante do arquivo.
    const real = fs.realpathSync(hyprConfig), original = fs.readFileSync(real, 'utf8');
    const clean = removeBlock(original);
    if (enabled) {
      if (/[#\$\n\r]/.test(script)) throw new Error('Caminho incompatível com o Hyprland');
      const quote = value => "'" + value.replace(/'/g, "'\"'\"'") + "'";
      writeAtomic(script, '#!/bin/sh\nexec ' + [binary, ...args].map(quote).join(' ') + '\n');
      if (!fs.existsSync(real + '.teletela-backup')) fs.copyFileSync(real, real + '.teletela-backup', fs.constants.COPYFILE_EXCL);
      const block = '\n' + blockStart + '\nexec-once = /bin/sh ' + quote(script) + '\n' + blockEnd + '\n';
      writeAtomic(real, clean + block, fs.statSync(real).mode & 0o777);
    } else {
      if (original !== clean) writeAtomic(real, clean, fs.statSync(real).mode & 0o777);
      fs.rmSync(script, { force: true });
    }
  }
  const args = app.isPackaged ? [] : [entryPath];
  const supported = ['linux', 'win32'].includes(platform) && !env.PORTABLE_EXECUTABLE_FILE;
  const options = { path: binary, args: platform === 'win32' ? args.map(value => '"' + value + '"') : args };
  const get = () => {
    if (!supported) return { supported: false, enabled: false, error: 'Use o app instalado ou o AppImage para iniciar com o PC.' };
    try {
      let enabled = platform === 'win32'
        ? (() => { const state = app.getLoginItemSettings(options); return state.openAtLogin && state.executableWillLaunchAtLogin !== false; })()
        : fs.existsSync(file) && !/^(Hidden=true|X-GNOME-Autostart-enabled=false)$/m.test(fs.readFileSync(file, 'utf8'));
      if (hyprland) {
        if (!fs.existsSync(hyprConfig)) return { supported: false, enabled: false, error: 'Não encontrei a configuração padrão do Hyprland para configurar o início automático.' };
        enabled = enabled && fs.existsSync(script) && fs.readFileSync(hyprConfig, 'utf8').includes(blockStart);
      }
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
        if (hyprland) {
          try { configureHyprland(true); }
          catch (error) { fs.rmSync(file, { force: true }); throw error; }
        }
      } else {
        if (hyprland && fs.existsSync(hyprConfig)) configureHyprland(false);
        fs.rmSync(file, { force: true });
      }
      return get();
    } catch { return { ...get(), error: 'Não consegui alterar a inicialização automática neste PC.' }; }
  };
  return { get, set };
}
module.exports = { createAutostart };
