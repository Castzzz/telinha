import { mkdir, writeFile } from 'node:fs/promises';
import { watchExtensionZip } from '../watch-together.js';

const directory = new URL('../dist/', import.meta.url);
await mkdir(directory, { recursive: true });
const file = new URL('Teletela-Assistir-Juntos.zip', directory);
await writeFile(file, watchExtensionZip());
console.log(`Extensão empacotada em ${file.pathname}. Instale extraindo o ZIP e carregando a pasta no navegador.`);
