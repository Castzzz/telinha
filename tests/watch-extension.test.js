import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/watch-extension/background.js', import.meta.url), 'utf8');

// Exercita a ponte inteira nos dois namespaces, sem depender de contas dos serviços.
for (const namespace of ['browser', 'chrome']) {
  test(`extensão ${namespace}: conexão, isolamento da aba e desconexão`, async () => {
    let listener, stored = {}, calls = 0;
    const base = namespace === 'browser' ? 'moz-extension://teste/' : 'chrome-extension://teste/';
    const api = {
      runtime: { getURL: name => base + name, onMessage: { addListener: fn => { listener = fn; } } },
      storage: { session: {
        get: async () => structuredClone(stored),
        set: async value => { stored = structuredClone(value); },
        remove: async key => { delete stored[key]; }
      } },
      permissions: { contains: async () => true },
      tabs: {
        get: async id => ({ id, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
        sendMessage: async () => ({}), onRemoved: { addListener: () => {} }
      }
    };
    const session = { id: 'sessao', hostId: 'pessoa', members: [{ id: 'pessoa' }] };
    vm.runInNewContext(source, {
      [namespace]: api, URL, AbortSignal,
      fetch: async (url, options) => {
        calls++;
        const pairing = url.endsWith('/pair');
        assert.equal(options.credentials, 'omit');
        if (!pairing) assert.equal(options.headers.Authorization, 'Bearer token-local');
        return { ok: true, json: async () => ({
          userId: 'pessoa', session, ...(pairing ? { token: 'token-local' } : {})
        }) };
      }
    });
    const popup = { url: base + 'popup.html' };
    const send = (message, sender = popup) => new Promise(resolve => {
      assert.equal(listener(message, sender, resolve), true);
    });
    assert((await send({ type: 'watch:connect', server: 'https://sala.test', code: 'a'.repeat(43) })).success);
    const status = await send({ type: 'watch:status' });
    assert.equal(status.connection.userId, 'pessoa');
    assert.equal(status.connection.token, undefined);
    assert((await send({ type: 'watch:bind', tabId: 7 })).success);

    const before = calls;
    for (const sender of [
      { tab: { id: 8 }, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      { tab: { id: 7 }, url: 'https://outro.test/' }
    ]) assert((await send({ type: 'watch:sync' }, sender)).inactive);
    assert.equal(calls, before, 'Abas fora da seleção não podem consultar a sessão');
    assert.equal((await send({ type: 'watch:sync' }, {
      tab: { id: 7 }, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    })).userId, 'pessoa');
    assert((await send({ type: 'watch:disconnect' }, { url: 'https://outro.test/' })).error);
    assert((await send({ type: 'watch:disconnect' })).success);
    assert.equal((await send({ type: 'watch:status' })).connection, null);
    assert.equal(stored.watchConnection, undefined);
  });
}
