import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

test('Electron real: atualizar 3.7 por cima, reabrir, mudar URL e recuperar prefs danificado', { timeout: 120000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-atualizacao-'));
  const oldRoot = path.join(directory, 'app-3.7');
  fs.mkdirSync(oldRoot);
  try {
    const archive = spawnSync('git', ['archive', '61809d90235521a14b4666fbd339f1b942a099bc', 'electron', 'public', 'package.json'], { cwd: root, maxBuffer: 40 * 1024 * 1024 });
    assert.equal(archive.status, 0, archive.stderr?.toString());
    const extracted = spawnSync('tar', ['-x', '-C', oldRoot], { input: archive.stdout });
    assert.equal(extracted.status, 0, extracted.stderr?.toString());
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(oldRoot, 'node_modules'));
    const runtime = path.join(directory, 'runtime'); fs.mkdirSync(runtime, { mode: 0o700 });
    const electron = process.env.ELECTRON_PATH || '/usr/lib/electron42/electron';
    for (const stage of [0, 1, 2, 3]) {
      const output = await new Promise((resolve, reject) => {
        const child = spawn(electron, ['--ozone-platform=x11', '--disable-gpu', 'tests/identity-desktop.cjs'], { cwd: root, env: { ...process.env,
          XDG_RUNTIME_DIR: runtime, TELETELA_IDENTITY_STAGE: String(stage), TELETELA_IDENTITY_TEST_DIR: directory, TELETELA_IDENTITY_OLD_ROOT: oldRoot,
          TELINHA_DATA_DIR: path.join(directory, 'servidor'), ADMIN_KEY: 'admin-antigo-identidade-teste', OWNER_KEY: 'propriedade-identidade-teste' } });
        let logs = '';
        child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
        child.on('error', reject); child.on('exit', code => code === 0 ? resolve(logs) : reject(new Error(`Etapa ${stage}: ${logs}`)));
      });
      console.log(output.split('\n').filter(line => line.startsWith('Identidade desktop:')).join('\n'));
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
