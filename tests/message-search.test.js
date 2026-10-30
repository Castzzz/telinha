import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { io as client } from 'socket.io-client';

test('busca no disco além do cache, pagina, aplica edições/exclusões e bloqueia canais privados inclusive para o dono', async t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-search-'));
  process.env.TELINHA_DATA_DIR = data; process.env.OWNER_KEY = 'dono-busca-teste'; process.env.SFU_SECRET = ''; process.env.TELINHA_MUSIC = '0';
  fs.mkdirSync(path.join(data, 'text'));
  fs.writeFileSync(path.join(data, 'channels.json'), JSON.stringify({ channels: [], textChannels: [
    { id: 'arquivo', name: 'Arquivo' }, { id: 'cofre', name: 'Cofre', access: { private: true, members: [], roles: [] } }
  ] }));
  const messages = Array.from({ length: 320 }, (_, i) => ({ id: 'm-' + i, channelId: 'arquivo', userName: i % 2 ? 'Bia' : 'João', text: i < 40 ? 'Café antigo ' + i : 'Recente ' + i, timestamp: Date.UTC(2026, 0, 1) + i * 1000 }));
  fs.writeFileSync(path.join(data, 'text', 'arquivo.jsonl'), [...messages,
    { op: 'edit', id: 'm-0', text: 'Texto corrigido' }, { op: 'delete', id: 'm-1' }
  ].map(m => JSON.stringify(m)).join('\n') + '\n');
  fs.writeFileSync(path.join(data, 'text', 'cofre.jsonl'), JSON.stringify({ ...messages[0], text: 'Segredo' }) + '\n');
  const backend = await import('../server.js');
  const server = await backend.startServer(0, '127.0.0.1');
  const socket = client('http://127.0.0.1:' + server.address().port, { transports: ['websocket'], reconnection: false });
  t.after(async () => { socket.disconnect(); await new Promise(resolve => backend.io.close(resolve)); fs.rmSync(data, { recursive: true, force: true }); });
  await new Promise(resolve => socket.once('connect', resolve));
  const emit = (event, payload) => socket.timeout(3000).emitWithAck(event, payload);
  const wait = () => new Promise(resolve => setTimeout(resolve, 720));
  const target = { scope: 'text', channelId: 'arquivo', query: 'cafe' };
  const history = await emit('text-history', { channelId: 'arquivo' });
  assert(!history.messages.some(m => m.id === 'm-2'), 'antiga não está no cache recente');
  const first = await emit('message-search', target);
  assert.equal(first.messages.length, 30); assert.equal(first.messages[0].id, 'm-39'); assert.equal(first.hasMore, true);
  assert.equal((await emit('message-search', target)).success, false, 'limita consultas repetidas');
  await wait(); const second = await emit('message-search', { ...target, before: first.messages.at(-1).id });
  assert.equal(second.messages.length, 8); assert.equal(second.messages.at(-1).id, 'm-2'); assert.equal(second.hasMore, false);
  await wait(); const author = await emit('message-search', { ...target, author: 'joao' });
  assert(author.messages.every(m => m.userName === 'João')); assert.equal(author.messages.length, 19);
  await wait(); const edited = await emit('message-search', { ...target, query: 'corrigido' }); assert.equal(edited.messages[0].id, 'm-0');
  await wait(); const context = await emit('message-context', { ...target, messageId: 'm-2' });
  assert(context.messages.some(m => m.id === 'm-0' && m.text === 'Texto corrigido')); assert(!context.messages.some(m => m.id === 'm-1'));
  await wait(); assert.equal((await emit('message-search', { ...target, since: '2026-02-01' })).messages.length, 0);
  assert.equal((await emit('owner-claim', { key: process.env.OWNER_KEY })).success, true);
  for (const channelId of ['cofre', '../../arquivo', 'inexistente']) {
    assert.equal((await emit('message-search', { ...target, channelId })).success, false);
    assert.equal((await emit('message-context', { ...target, channelId, messageId: 'm-0' })).success, false);
  }
  assert.equal((await emit('message-search', { scope: 'call', channelId: 'geral', query: 'x' })).success, false);
});
