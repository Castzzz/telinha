import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const cachedGo = path.join(os.homedir(), '.local/go/bin/go');
const go = process.env.GO_BINARY || (existsSync(cachedGo) ? cachedGo : 'go');
await mkdir(path.join(root, '.cache/music-lab'), { recursive: true });
for (const [name, source] of [['music-publisher', './cmd/music-publisher'], ['music-sfu', './sfu']]) {
  console.log(`Compilando ${name} para teste local…`);
  await promisify(execFile)(go, ['build', '-o', path.join(root, '.cache/music-lab', name), source], { cwd: root, timeout: 120000 });
}
console.log('Ponte WebRTC e SFU de teste prontos. Rode npm run music:call.');
