import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { ChannelExtras } from '../channel-extras.js';
import previewModule from '../electron/launcher-preview.cjs';

test('imagem do servidor exige permissão, persiste, preserva após falha e chega ao início sem conta', { timeout: 20000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-marca-'));
  process.env.TELINHA_DATA_DIR = dir; process.env.OWNER_KEY = 'dono-marca'; process.env.TELINHA_MUSIC = '0'; process.env.SFU_SECRET = '';
  const backend = await import('../server.js');
  const server = await backend.startServer(0, '127.0.0.1'), url = `http://127.0.0.1:${server.address().port}`, clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await new Promise(resolve => backend.io.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  async function connect() {
    const s = io(url, { transports: ['websocket'], autoConnect: false, reconnection: false }); clients.push(s);
    const ready = once(s, 'connect'); s.connect(); await ready;
    await s.timeout(5000).emitWithAck('update-profile', { profileId: randomUUID(), name: 'Pessoa' }); return s;
  }
  const emit = (s, event, payload = {}) => s.timeout(5000).emitWithAck(event, payload);
  const owner = await connect(), guest = await connect(); await emit(owner, 'owner-claim', { key: 'dono-marca' });
  const initial = await (await fetch(url + '/api/server-info')).json();
  assert.deepEqual(initial, { name: 'Colheita Fartus', iconVersion: 0 });
  const bytes = fs.readFileSync(new URL('../public/icon.png', import.meta.url));
  const icon = `data:image/png;base64,${bytes.toString('base64')}`;
  assert.equal((await emit(guest, 'server-icon-set', { icon })).success, false);
  for (const bad of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,bmFvLWltYWdlbQ==', `data:image/png;base64,${'A'.repeat(800000)}`]) assert.equal((await emit(owner, 'server-icon-set', { icon: bad })).success, false);
  const result = await emit(owner, 'server-icon-set', { icon }); assert.equal(result.success, true); assert.ok(result.server.iconVersion);
  assert.equal(new ChannelExtras(dir).data.server.icon, icon);
  const image = await fetch(url + '/api/server-icon'); assert.equal(image.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes);
  const preview = previewModule.createLauncherPreview({ serverUrl: url, getPrefs: () => ({}), fetch, thumbnail: async value => { assert.deepEqual(value, bytes); return icon; } });
  const state = await preview(); assert.equal(state.status, 'guest'); assert.equal(state.server.name, 'Colheita Fartus'); assert.equal(state.server.icon, icon);
  const file = path.join(dir, 'channel-extras.json'), backup = file + '.backup'; fs.renameSync(file, backup); fs.mkdirSync(file);
  try {
    assert.equal((await emit(owner, 'server-icon-set', { icon: '' })).success, false);
    assert.equal(backend.channelExtras.data.server.icon, icon);
    assert.equal((await (await fetch(url + '/api/server-info')).json()).iconVersion, result.server.iconVersion);
  } finally { fs.rmdirSync(file); fs.renameSync(backup, file); }
  assert.equal((await emit(owner, 'server-icon-set', { icon: '' })).success, true);
  assert.equal(new ChannelExtras(dir).data.server.icon, '');
  assert.equal((await fetch(url + '/api/server-icon')).status, 404);
});
