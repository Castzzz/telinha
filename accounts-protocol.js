import { AccountError, accountClientAddress, createAccountLimiter } from './account-store.js';
import express from 'express';

const fallbackLimit = createAccountLimiter();

// Login e recuperação precisam funcionar antes da senha da sala, em um aparelho novo.
export function installAccountHttp({ app, store, limit = fallbackLimit, onRevoke = () => {} }) {
  const headers = (req, res, next) => {
    res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  };
  app.use('/api/account', headers);
  app.get('/api/account', (req, res) => res.json({ supported: store.available }));
  const json = express.json({ limit: '8kb', strict: true });
  const route = action => async (req, res) => {
    const payload = req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return res.status(400).json({ success: false, error: 'Pedido de conta inválido.' });
    const address = accountClientAddress(req.socket.remoteAddress, req.headers['x-forwarded-for']);
    if (limit(`address:${address}`, 12) || limit(`username:${String(payload.username || '').trim().toLowerCase().slice(0, 80)}`, 10)) return res.status(429).json({ success: false, error: 'Muitas tentativas. Espere um minuto e tente de novo.' });
    if (!store.available) return res.status(503).json({ success: false, error: 'Contas indisponíveis nesta sala. Você pode continuar sem conta.' });
    if (Object.keys(payload).some(key => !['username', 'password', 'recoveryCode', 'token'].includes(key))
      || Object.entries(payload).some(([key, value]) => typeof value !== 'string' || value.length > (key === 'password' ? 128 : 100))) return res.status(400).json({ success: false, error: 'Pedido de conta inválido.' });
    try {
      const result = await action(payload);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(error instanceof AccountError ? 400 : 500).json({ success: false,
        error: error instanceof AccountError ? error.message : 'Não deu para salvar a conta. Tente de novo.',
        code: error instanceof AccountError ? error.code : 'account-error' });
    }
  };
  app.post('/api/account/login', json, route(async payload => {
    const result = await store.login(payload.username, payload.password);
    onRevoke({ accountId: result.account.id, kind: 'prune' });
    return result;
  }));
  app.post('/api/account/recover', json, route(async payload => {
    const result = await store.recover(payload.username, payload.recoveryCode, payload.password);
    onRevoke({ accountId: result.account.id, kind: 'recover' });
    return result;
  }));
  app.post('/api/account/logout', json, route(async payload => {
    const session = store.resolveSessionMeta(payload.token);
    if (!session) throw new AccountError('Sua sessão já terminou.', 'session-expired');
    await store.logout(payload.token);
    onRevoke({ accountId: session.account.id, kind: 'prune' });
    return {};
  }));
  app.use('/api/account', (error, req, res, next) => {
    if (!error) return next();
    res.status(error.type === 'entity.too.large' ? 413 : 400).json({ success: false, error: 'Pedido de conta inválido ou grande demais.' });
  });
}

export function sendAccountState(socket, store) {
  const token = socket.handshake.auth?.accountToken;
  const session = store.resolveSession(token);
  socket.emit('account-state', { supported: store.available, account: session?.account || null,
    profile: session?.profile || null, sessionExpired: Boolean(token && !session) });
}

// O servidor continua sendo o responsável pela identidade no handshake e pela revogação do SFU.
export function installAccountHandlers({ socket, store, getProfile, user, limit = fallbackLimit, onRevoke = () => {}, onFriendsChanged = () => {}, isOnline = () => false }) {
  const address = accountClientAddress(socket.handshake.address, socket.handshake.headers?.['x-forwarded-for']);
  let pending = false;
  const token = () => socket.handshake.auth?.accountToken || '';
  const session = () => store.resolveSession(token());
  const handler = action => async (raw, callback) => {
    if (typeof callback !== 'function') return;
    if (pending) return callback({ success: false, error: 'Espere o pedido anterior terminar.' });
    const payload = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    if (limit(`address:${address}`, 12) || limit(`username:${String(payload.username || '').trim().toLowerCase().slice(0, 80)}`, 10)) return callback({ success: false, error: 'Muitas tentativas. Espere um minuto e tente de novo.' });
    if (!store.available) return callback({ success: false, error: 'Contas indisponíveis nesta sala. Você pode continuar sem conta.' });
    if (token() && !session()) return callback({ success: false, error: 'Sua sessão terminou. Entre de novo.', code: 'session-expired' });
    pending = true;
    try {
      const result = await action(payload);
      callback({ success: true, ...result });
    } catch (error) {
      callback({ success: false, error: error instanceof AccountError ? error.message : 'Não deu para salvar a conta. Tente de novo.', code: error instanceof AccountError ? error.code : 'account-error' });
    } finally { pending = false; }
  };
  socket.on('account-register', handler(async payload => {
    if (session()) throw new AccountError('Saia da conta atual antes de criar outra.');
    const result = await store.register(payload.username, payload.password, { accessId: user.accessId, profile: getProfile(user) });
    onRevoke({ accountId: result.account.id, accessId: result.account.accessId, kind: 'register', exceptSocketId: socket.id });
    return result;
  }));
  socket.on('account-login', handler(async payload => {
    if (session()) throw new AccountError('Saia da conta atual antes de entrar em outra.');
    const result = await store.login(payload.username, payload.password);
    onRevoke({ accountId: result.account.id, kind: 'prune', exceptSocketId: socket.id });
    return result;
  }));
  socket.on('account-recover', handler(async payload => {
    const result = await store.recover(payload.username, payload.recoveryCode, payload.password);
    onRevoke({ accountId: result.account.id, kind: 'recover', exceptSocketId: socket.id });
    return result;
  }));
  socket.on('account-logout', handler(async () => {
    const current = session();
    if (!current) throw new AccountError('Você já está sem conta.');
    await store.logout(token());
    onRevoke({ accountId: current.account.id, kind: 'prune', exceptSocketId: socket.id });
    // O cliente desconecta só depois de salvar o perfil de visitante no aparelho.
    return {};
  }));
  let friendPending = false;
  for (const action of ['list', 'request', 'accept', 'reject', 'cancel', 'remove']) {
    socket.on(`friend-${action}`, async (payload, callback) => {
      if (typeof callback !== 'function') return;
      const current = store.resolveSessionMeta(token());
      if (!current) return callback({ success: false, error: 'Entre numa conta para usar os amigos.' });
      if (friendPending || limit(`friends:${current.account.id}`, 60)) return callback({ success: false, error: 'Espere alguns segundos e tente de novo.' });
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || Object.keys(payload).some(key => !['username', 'accountId'].includes(key))
        || Object.values(payload).some(value => typeof value !== 'string' || value.length > 64)) return callback({ success: false, error: 'Pedido de amizade inválido.' });
      friendPending = true;
      try {
        if (action !== 'list') {
          await store.changeFriend(current.account.id, action, payload);
          onFriendsChanged();
        }
        callback({ success: true, ...store.friends(current.account.id, isOnline) });
      } catch (error) {
        callback({ success: false, error: error instanceof AccountError ? error.message : 'Não deu para salvar a amizade. Tente de novo.' });
      } finally { friendPending = false; }
    });
  }
  sendAccountState(socket, store);
  socket.emit('friends-state', { supported: store.available, ...store.friends(session()?.account.id, isOnline) });
}
