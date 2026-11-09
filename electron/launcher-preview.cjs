// Consulta sem Socket.IO: abrir o início não anuncia presença nem entra na call.
function createLauncherPreview({ serverUrl, getPrefs, fetch, thumbnail = async () => '', now = Date.now }) {
  let cached, pending, pendingToken;
  const pictures = new Map();
  function remember(key, value) {
    if (pictures.size >= 16) pictures.delete(pictures.keys().next().value);
    pictures.set(key, value);
  }
  return async function preview() {
    const saved = getPrefs().accountSessions?.[serverUrl];
    const token = /^[a-f0-9]{64}$/.test(saved?.token || '') ? saved.token : '';
    if (cached?.token === token && now() - cached.at < 10000) return cached.value;
    if (pending && pendingToken === token) return pending;
    pendingToken = token;
    const request = (pathname, publicAsset = false) => fetch(`${serverUrl}${pathname}`, {
      headers: token && !publicAsset ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000)
    });
    async function serverInfo() {
      const server = { name: 'Colheita Fartus', icon: '' };
      try {
        const response = await request('/api/server-info', true);
        if (!response.ok) return server;
        const data = await response.json();
        if (!Number.isSafeInteger(data.iconVersion) || data.iconVersion <= 0) return server;
        const key = `server:${data.iconVersion}`;
        server.icon = pictures.get(key) || '';
        if (!server.icon) {
          const image = await request(`/api/server-icon?v=${data.iconVersion}`, true);
          if (image.ok && Number(image.headers.get('content-length')) <= 512 * 1024) {
            server.icon = await thumbnail(Buffer.from(await image.arrayBuffer()));
            if (server.icon) remember(key, server.icon);
          }
        }
      } catch { /* O ícone padrão continua disponível sem a prévia. */ }
      return server;
    }
    async function friendsInfo() {
      try {
        if (!token) {
          const health = await request('/api/health');
          return { status: health.ok ? 'guest' : 'offline', friends: [] };
        }
        const response = await request('/api/launcher/friends');
        if (response.status === 401) return { status: 'expired', friends: [] };
        if (response.status === 404) return { status: 'unsupported', friends: [] };
        if (!response.ok) return { status: 'offline', friends: [] };
        const data = await response.json();
        if (data.supported !== true || !Array.isArray(data.friends)) return { status: 'unsupported', friends: [] };
        const online = data.friends.filter(person => person.online === true).slice(0, 8);
        const friends = await Promise.all(online.map(async person => {
          const friend = { id: String(person.id), name: String(person.name || person.username || 'Amigo').slice(0, 80),
            presence: ['online', 'away', 'dnd'].includes(person.presence) ? person.presence : 'online',
            color: /^#[0-9a-f]{6}$/i.test(person.color) ? person.color : '#5865f2', avatar: '' };
          if (!/^[a-f0-9-]{36}$/.test(friend.id) || !person.avatarV) return friend;
          const key = `${token}:${friend.id}:${person.avatarV}`;
          friend.avatar = pictures.get(key) || '';
          if (!friend.avatar) try {
            const photo = await request(`/api/launcher/friend-avatar/${encodeURIComponent(friend.id)}`);
            if (photo.ok && Number(photo.headers.get('content-length')) <= 10 * 1024 * 1024) {
              friend.avatar = await thumbnail(Buffer.from(await photo.arrayBuffer()), person.avatarCrop);
              if (friend.avatar) remember(key, friend.avatar);
            }
          } catch { /* Foto indisponível mantém as iniciais. */ }
          return friend;
        }));
        return { status: 'ready', name: String(data.name || saved.profile?.name || '').slice(0, 80), friends,
          onlineCount: data.friends.filter(person => person.online === true).length };
      } catch { return { status: 'offline', friends: [] }; }
    }
    const run = Promise.all([friendsInfo(), serverInfo()]).then(([value, server]) => ({ ...value, server }));
    pending = run;
    const value = await run;
    // Uma consulta de outra conta não reaproveita nomes ou fotos da anterior.
    if (pending === run) { cached = { token, at: now(), value }; pending = null; }
    return value;
  };
}
module.exports = { createLauncherPreview };
