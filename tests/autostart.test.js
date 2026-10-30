import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { createAutostart } = createRequire(import.meta.url)('../electron/autostart.cjs');

test('Linux: cria e remove apenas a entrada do Teletela, preserva caminhos e usa AppImage fora do mount temporário', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-autostart-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const manager = createAutostart({ app: { isPackaged: true }, platform: 'linux', env: { APPIMAGE: '/home/Amigo/Meu App 100%.AppImage', XDG_CONFIG_HOME: home }, executable: '/tmp/.mount-x/AppRun', home });
  assert.equal(manager.get().enabled, false);
  assert.equal(manager.set(true).enabled, true);
  const file = path.join(home, 'autostart', 'telinha.desktop');
  assert.match(fs.readFileSync(file, 'utf8'), /Exec="\/home\/Amigo\/Meu App 100%%.AppImage"/);
  fs.writeFileSync(path.join(home, 'autostart', 'outro.desktop'), 'outro');
  assert.equal(manager.set(false).enabled, false);
  assert(fs.existsSync(path.join(home, 'autostart', 'outro.desktop')));
  assert.equal(manager.set('true').error, 'Opção inválida.');
});

test('Windows: consulta e altera o mesmo executável e respeita bloqueio pelo sistema', () => {
  let state = false, approved = true, options;
  const manager = createAutostart({ platform: 'win32', env: {}, executable: 'C:\\Teletela\\Teletela.exe', app: { isPackaged: true,
    getLoginItemSettings(input) { assert.equal(input.path, 'C:\\Teletela\\Teletela.exe'); return { openAtLogin: state, executableWillLaunchAtLogin: approved }; },
    setLoginItemSettings(input) { options = input; state = input.openAtLogin; approved = input.enabled; }
  } });
  assert.equal(manager.set(true).enabled, true); assert.deepEqual(options.args, []);
  approved = false; assert.equal(manager.get().enabled, false);
  assert.equal(manager.set(false).enabled, false);
});

test('falha ao gravar retorna o estado real; versão portátil não altera o sistema', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-autostart-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, 'arquivo'); fs.writeFileSync(file, 'x');
  const manager = createAutostart({ app: { isPackaged: true }, platform: 'linux', env: { XDG_CONFIG_HOME: file }, home });
  assert.equal(manager.set(true).enabled, false); assert(manager.set(true).error);
  const portable = createAutostart({ app: { isPackaged: true }, platform: 'win32', env: { PORTABLE_EXECUTABLE_FILE: '/tmp/app.exe' } });
  assert.equal(portable.set(true).supported, false);
});

test('Hyprland: instala exec-once reversível, preserva symlink e configuração e escapa argumentos do shell', t => {
  const { execFileSync } = createRequire(import.meta.url)('node:child_process');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-hyprland-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, 'hypr'));
  const original = 'monitor = ,preferred,auto,1\nexec-once = waybar\n', real = path.join(home, 'original.conf'), link = path.join(home, 'hypr/hyprland.conf');
  fs.writeFileSync(real, original); fs.symlinkSync(real, link);
  const output = path.join(home, 'argumento'), executable = path.join(home, "app ' teste");
  fs.writeFileSync(executable, '#!/bin/sh\nprintf "%s" "$1" > ' + "'" + output + "'\n", { mode: 0o700 });
  const entryPath = 'nome com espaço e $HOME e `comando`';
  const manager = createAutostart({ app: { isPackaged: false }, platform: 'linux', env: { XDG_CURRENT_DESKTOP: 'Hyprland', XDG_CONFIG_HOME: home }, executable, home, entryPath });
  assert.equal(manager.set(true).enabled, true); assert(fs.lstatSync(link).isSymbolicLink());
  assert.match(fs.readFileSync(real, 'utf8'), /exec-once = \/bin\/sh/);
  assert.equal(fs.readFileSync(real + '.teletela-backup', 'utf8'), original);
  execFileSync('/bin/sh', [path.join(home, 'autostart/telinha-hyprland.sh')]);
  assert.equal(fs.readFileSync(output, 'utf8'), entryPath, 'shell não expande conteúdo dos caminhos');
  manager.set(true); assert.equal(fs.readFileSync(real, 'utf8').split('# >>> Teletela').length, 2, 'não duplica blocos');
  fs.appendFileSync(real, 'general { border_size = 2 }\n');
  assert.equal(manager.set(false).enabled, false);
  assert.equal(fs.readFileSync(real, 'utf8'), original + 'general { border_size = 2 }\n');
  assert(fs.lstatSync(link).isSymbolicLink());
});
