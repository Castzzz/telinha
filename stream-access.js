// Cada tela mantém seus convites e suas sessões de mídia só durante a transmissão.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const kinds = ['screen', 'screen2', 'screen3', 'camera'];
const secret = randomBytes(32);
const digest = password => createHmac('sha256', secret).update(password).digest();
const live = (owner, kind) => kind === 'screen' ? owner.isSharing : kind === 'camera' ? owner.isCameraOn : owner.extraScreens?.includes(Number(kind.slice(-1)));

export function createStreamAccess({ io, revoke, limit, changed }) {
  const streams = new Map();
  const key = (owner, kind) => owner.id + ':' + kind;
  function get(owner, kind) { return streams.get(key(owner, kind)); }
  function ensure(owner, kind) {
    const id = key(owner, kind);
    if (!streams.has(id)) streams.set(id, { owner, kind, mode: 'open', allowed: new Set(), blocked: new Set(), grants: new Set(), media: new Map(), suffix: '' });
    return streams.get(id);
  }
  function permits(owner, kind, viewer) {
    const s = get(owner, kind);
    if (!viewer || !kinds.includes(kind)) return false;
    if (!s || owner.id === viewer.id) return true;
    if (s.blocked.has(viewer.accessId)) return false;
    return s.mode === 'open' || (owner.channelId === viewer.channelId && (s.mode === 'invite' ? s.allowed.has(viewer.accessId) : s.grants.has(viewer.id)));
  }
  function forget(s, id) {
    const tokenId = s.media.get(id);
    if (tokenId) revoke(tokenId);
    s.media.delete(id);
    s.grants.delete(id);
  }
  function enforce(s) {
    for (const socketId of io.sockets.adapter.rooms.get(s.owner.channelId) || []) {
      const peer = io.sockets.sockets.get(socketId)?.data.user;
      if (!peer || permits(s.owner, s.kind, peer)) continue;
      forget(s, peer.id);
      io.to(s.owner.id).emit('stream-access-cut', { kind: s.kind, viewerId: peer.id });
      io.to(peer.id).emit('stream-access-ended', { kind: s.kind, ownerId: s.owner.id });
    }
  }
  function end(owner, kind) {
    const s = get(owner, kind);
    if (!s) return;
    for (const id of s.media.keys()) forget(s, id);
    streams.delete(key(owner, kind));
  }
  function leave(user) {
    for (const s of streams.values()) {
      if (s.owner === user) end(user, s.kind);
      else forget(s, user.id);
    }
  }
  function setup(socket, user, wrap) {
    socket.on('stream-access', wrap((p, cb) => {
      if (typeof cb !== 'function') return;
      const fail = error => cb({ success: false, error });
      if (!user.channelId || p?.channelId !== user.channelId || !kinds.includes(p.kind)) return fail('Entre na call desta transmissão.');
      const { kind } = p;
      if (p.action === 'join') {
        const owner = io.sockets.sockets.get(p.ownerId)?.data.user;
        if (!owner || owner.channelId !== user.channelId || !live(owner, kind)) return fail('A transmissão já terminou.');
        if (permits(owner, kind, user)) return cb({ success: true });
        const s = get(owner, kind);
        if (s.blocked.has(user.accessId) || s.mode !== 'password') return fail('Você não tem acesso a esta transmissão.');
        if (p.password == null) return cb({ passwordRequired: true });
        if (limit('stream-password:' + user.accessId, 8) || typeof p.password !== 'string' || p.password.length > 128) return fail('Espere um pouco antes de tentar de novo.');
        if (!timingSafeEqual(digest(p.password), s.hash)) return cb({ passwordRequired: true, error: 'Senha incorreta.' });
        s.grants.add(user.id);
        return cb({ success: true });
      }
      if (p.action !== 'get' && limit('stream-settings:' + user.accessId, 60)) return fail('Espere um pouco antes de mudar o acesso novamente.');
      const s = ensure(user, kind);
      if (p.action === 'save') {
        if (!['open', 'invite', 'password'].includes(p.mode)) return fail('Escolha o acesso.');
        const manterSenha = p.mode === 'password' && s.mode === 'password' && p.password === '';
        const changedPassword = p.mode === 'password' && !manterSenha;
        if (changedPassword && (typeof p.password !== 'string' || !p.password.trim() || p.password.length > 128)) return fail('Informe uma senha de até 128 caracteres.');
        if (!Array.isArray(p.allowed) || p.allowed.length > 500 || p.allowed.some(id => typeof id !== 'string' || id.length > 128)) return fail('Seleção inválida.');
        if (s.mode !== p.mode || changedPassword) s.grants.clear();
        s.hash = p.mode !== 'password' ? null : changedPassword ? digest(p.password) : s.hash;
        s.allowed = new Set(p.allowed);
        const changedMode = s.mode !== p.mode;
        s.mode = p.mode;
        if (!live(user, kind) && s.mode !== 'open' && !s.suffix) s.suffix = '__' + randomBytes(8).toString('hex');
        enforce(s);
        if (changedMode) {
          socket.data.screenPreviews?.delete(kind);
          if (live(user, kind)) changed();
        }
      } else if (p.action === 'block' || p.action === 'unblock') {
        if (p.action === 'block') {
          const peer = io.sockets.sockets.get(p.viewerId)?.data.user;
          if (!peer || peer.channelId !== user.channelId || peer.accessId === user.accessId) return fail('Essa pessoa já saiu da call.');
          s.blocked.add(peer.accessId);
          enforce(s);
        } else s.blocked.delete(p.memberId);
      } else if (p.action !== 'get') return fail('Ação inválida.');
      cb({ success: true, mode: s.mode, allowed: [...s.allowed], blocked: [...s.blocked] });
    }));
  }
  return { setup, permits, end, leave, live, mode: (owner, kind) => get(owner, kind)?.mode || 'open', suffix: (owner, kind) => get(owner, kind)?.suffix || '',
    mediaId(owner, kind, viewer) {
      const s = ensure(owner, kind);
      if (!s.media.has(viewer.id)) s.media.set(viewer.id, randomBytes(16).toString('hex'));
      return s.media.get(viewer.id);
    }
  };
}
