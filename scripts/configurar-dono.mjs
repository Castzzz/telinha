import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PermissionStore } from '../permission-store.js';

// Ferramenta do operador: a identidade é comprovada pela credencial, nunca pelo nome/UUID.
export function configureOwner(directory, token) {
  if (!directory || !fs.existsSync(path.join(directory, 'permissions.json'))) throw new Error('Não há dados de permissões para migrar.');
  const store = new PermissionStore(directory);
  const id = store.authenticatedId(token);
  if (!id) throw new Error('A credencial não comprova um perfil existente nesta sala.');
  store.setOwner(id);
  return id;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 2048) throw new Error('Solicitação de migração inválida.');
    }
    const { permissionToken } = JSON.parse(input);
    configureOwner(process.env.TELINHA_DATA_DIR, permissionToken);
    console.log('Propriedade vinculada ao perfil confirmado; cargos e canais preservados.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
