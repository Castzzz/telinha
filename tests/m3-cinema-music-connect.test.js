import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(import.meta.dirname, '..');

function resolveElectronBinary() {
  const candidates = [
    '/usr/bin/electron',
    '/usr/lib/electron42/electron',
    '/usr/lib/electron/electron'
  ];
  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  return 'electron';
}

test('integração no navegador (Electron): miniplayer no #video-stage, modo cinema e fluxos de connect.html', { timeout: 30000 }, async () => {
  const electronBin = resolveElectronBinary();
  const browserScript = path.join(rootDir, 'tests', 'cinema-music-connect-browser.cjs');
  const { stdout } = await execFileAsync(electronBin, [browserScript], {
    cwd: rootDir,
    timeout: 25000
  });
  assert.match(stdout, /Testes de miniplayer de música, modo cinema e connect\.html passaram/);
});
