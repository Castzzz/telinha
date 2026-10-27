import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Instala só a ferramenta de teste, sem alterar Python ou pacotes do sistema.
const directory = new URL('../../.cache/music-lab/', import.meta.url);
const base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';

try {
  console.log('Baixando yt-dlp e conferindo SHA-256 da publicação oficial…');
  const responses = await Promise.all(['yt-dlp', 'SHA2-256SUMS'].map(async name => {
    const response = await fetch(base + name, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Não foi possível baixar ${name}: HTTP ${response.status}.`);
    return response;
  }));
  const [binary, checksums] = await Promise.all([responses[0].arrayBuffer(), responses[1].text()]);
  const expected = checksums.split('\n').find(line => /\s\*?yt-dlp\r?$/.test(line))?.split(/\s+/)[0];
  if (!expected || createHash('sha256').update(Buffer.from(binary)).digest('hex') !== expected) {
    throw new Error('A verificação do download falhou; a ferramenta não foi instalada.');
  }
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('yt-dlp.tmp', directory), Buffer.from(binary), { mode: 0o700 });
  await rename(new URL('yt-dlp.tmp', directory), new URL('yt-dlp', directory));
  console.log(`Ferramenta instalada em ${fileURLToPath(directory)}. Requer Python 3.10+, Node 22+ e FFmpeg.`);
  console.log('Agora rode npm run music:lab.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
