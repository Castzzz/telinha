// Cada dupla tem páginas de 40 mensagens fora da pasta pública. A página atual é
// substituída por rename, inclusive quando começa uma nova página após reiniciar.
import fs from 'node:fs';
import path from 'node:path';

const PAGE = 40;

function readPage(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

function savePage(file, messages) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(messages), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}

export function installDirectMessages({ socket, accounts, directory, io, limit }) {
  function participant(client) {
    if (!client.connected || client.data.accountEnding || !client.data.accountSession) return null;
    return accounts.resolveSessionMeta(client.handshake.auth?.accountToken)?.account.id;
  }

  function friendsOf(id) {
    return accounts.data.friendships.flatMap(edge => {
      if (edge.status !== 'accepted') return [];
      if (edge.from === id) return [edge.to];
      if (edge.to === id) return [edge.from];
      return [];
    });
  }

  const folderFor = (a, b) => path.join(directory, 'conversas', [a, b].sort().join('_'));
  let readingInbox = false;
  socket.on('dm-inbox', async (_, ack) => {
    if (typeof ack !== 'function') return;
    const me = participant(socket);
    if (!me || !directory || readingInbox || limit('dm-inbox:' + me, 20)) return ack({ success: false });
    readingInbox = true;
    try {
      const latest = [];
      for (const peer of friendsOf(me)) {
        try {
          const data = await fs.promises.readFile(path.join(folderFor(me, peer), 'recentes.json'), 'utf8');
          const last = JSON.parse(data).at(-1);
          if (last) latest.push({ peer, id: last.id, from: last.from, timestamp: last.timestamp });
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      if (participant(socket) !== me) return ack({ success: false });
      const allowed = new Set(friendsOf(me));
      ack({ success: true, latest: latest.filter(item => allowed.has(item.peer)) });
    } catch { ack({ success: false }); }
    finally { readingInbox = false; }
  });

  for (const action of ['history', 'send']) {
    socket.on('dm-' + action, (payload, ack) => {
      if (typeof ack !== 'function') return;
      const me = participant(socket);
      const peer = payload?.accountId;
      if (!me || typeof peer !== 'string' || !/^[a-f0-9-]{36}$/.test(peer) || !directory ||
          !friendsOf(me).includes(peer)) {
        return ack({ success: false, error: 'Esta conversa exige uma amizade aceita.' });
      }
      if (limit('dm-' + action + ':' + me, action === 'send' ? 45 : 120)) {
        return ack({ success: false, error: 'Aguarde um pouco antes de tentar de novo.' });
      }
      const folder = folderFor(me, peer);
      const head = path.join(folder, 'recentes.json');
      try {
        if (action === 'history') {
          const before = payload.before;
          if (before !== undefined && (!Number.isSafeInteger(before) || before <= 1 || (before - 1) % PAGE !== 0)) {
            return ack({ success: false, error: 'Página de conversa inválida.' });
          }
          const messages = readPage(before === undefined ? head : path.join(folder, (before - 1) + '.json'));
          return ack({ success: true, messages, before: messages[0]?.id > 1 ? messages[0].id : null });
        }
        const text = typeof payload.text === 'string' ? payload.text.trim() : '';
        if (!text || text.length > 2000) return ack({ success: false, error: 'Escreva uma mensagem de até 2000 caracteres.' });
        let messages = readPage(head);
        const last = messages.at(-1)?.id || 0;
        fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
        if (messages.length === PAGE) {
          savePage(path.join(folder, last + '.json'), messages);
          messages = [];
        }
        const message = { id: last + 1, from: me, to: peer, text, timestamp: Date.now() };
        messages.push(message);
        savePage(head, messages);
        for (const client of io.sockets.sockets.values()) {
          const id = client.data.accountSession?.account.id;
          if ((id === me || id === peer) && participant(client) === id) client.emit('dm-message', message);
        }
        ack({ success: true, message });
      } catch {
        ack({ success: false, error: 'O servidor não conseguiu acessar a conversa.' });
      }
    });
  }
}
