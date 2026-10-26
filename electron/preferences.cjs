const fs = require('node:fs');
const path = require('node:path');

// A identidade fica também num arquivo pequeno, independente de fotos e banners.
function createPreferences(directory) {
  const file = path.join(directory, 'prefs.json');
  const identityFile = path.join(directory, 'identities.json');
  const read = name => {
    try {
      const data = JSON.parse(fs.readFileSync(name, 'utf8'));
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch { return {}; }
  };
  const atomic = (name, value) => {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(name + '.tmp', value, { mode: 0o600 });
    fs.renameSync(name + '.tmp', name);
  };
  const load = () => {
    const prefs = read(file);
    const backup = read(identityFile);
    if (!prefs.profile?.id && backup.profileId) prefs.profile = { ...prefs.profile, id: backup.profileId };
    prefs.profileCredentials = { ...backup.profileCredentials, ...prefs.profileCredentials };
    const access = { ...backup.roomAccess };
    for (const [server, value] of Object.entries(prefs.roomAccess || {})) access[server] = { ...access[server], ...value };
    prefs.roomAccess = access;
    return prefs;
  };
  const save = patch => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
    const prefs = { ...load(), ...patch };
    const next = JSON.stringify(prefs);
    if (Buffer.byteLength(next) > 30 * 1024 * 1024) return false;
    try {
      const roomAccess = Object.fromEntries(Object.entries(prefs.roomAccess || {}).map(([server, value]) => [server, { permissionToken: value.permissionToken }]));
      atomic(identityFile, JSON.stringify({ profileId: prefs.profile?.id, profileCredentials: prefs.profileCredentials, roomAccess }));
      atomic(file, next);
      return true;
    } catch (err) { console.warn('[Electron] Não foi possível salvar preferências:', err.message); return false; }
  };
  return { load, save };
}
module.exports = { createPreferences };
