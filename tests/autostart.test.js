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
