// Sem cofre do sistema, a sessão dura só enquanto o app está aberto.
// Nunca grava o token em texto puro junto das preferências.
function createAccountSessionVault(safeStorage) {
  let memory = {};
  const canEncrypt = () => {
    try {
      return safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
    } catch { return false; }
  };
  const valid = (sessions) => Object.fromEntries(Object.entries(sessions || {})
    .filter(([server, token]) => /^https?:\/\//.test(server) && typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)).slice(0, 100));
  return {
    restore(prefs) {
      if (prefs.accountSessionsEncrypted && canEncrypt()) {
        try { memory = valid(JSON.parse(safeStorage.decryptString(Buffer.from(prefs.accountSessionsEncrypted, 'base64')))); }
        catch { /* Cofre trocado: o login pode ser feito de novo. */ }
      }
      const next = { ...prefs, accountSessions: { ...memory } };
      delete next.accountSessionsEncrypted;
      return next;
    },
    prepare(prefs) {
      memory = valid(prefs.accountSessions);
      const next = { ...prefs };
      delete next.accountSessions;
      delete next.accountSessionsEncrypted;
      if (Object.keys(memory).length && canEncrypt()) next.accountSessionsEncrypted = safeStorage.encryptString(JSON.stringify(memory)).toString('base64');
      return next;
    }
  };
}
module.exports = { createAccountSessionVault };
