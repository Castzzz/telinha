import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { AccountStore, createAccountLimiter, accountClientAddress } from '../account-store.js';
const require = createRequire(import.meta.url);
const { createAccountSessionVault } = require('../electron/account-sessions.cjs');

test('contas: validação, colisão concorrente, expiração e falha de gravação', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-account-store-'));
  let now = Date.now();
  try {
    const store = new AccountStore(dir, { now: () => now });
    for (const username of ['', 'ab', 'a'.repeat(25), '../a', '<script>', {}, []]) await assert.rejects(store.register(username, 'senha-valida-123', {}));
    for (const password of [null, 12345678, 'curta', 'x'.repeat(129)]) await assert.rejects(store.register('usuario', password, {}));
    const collision = await Promise.allSettled([store.register('Mesmo', 'senha-valida-123', { name: 'Um' }), store.register('mesmo', 'senha-valida-123', { name: 'Dois' })]);
    assert.equal(collision.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(store.data.accounts.length, 1);
    const session = collision.find((r) => r.status === 'fulfilled').value;
    assert.ok(store.resolve(session.token));
    assert.equal(store.resolve(session.token + 'x'), null);
    now += 31 * 24 * 3600000;
    assert.equal(store.resolve(session.token), null, 'sessão expira mesmo depois de reiniciar');
    assert.equal(new AccountStore(dir, { now: () => now }).resolve(session.token), null);
    const previous = JSON.stringify(store.data);
    store.atomicWrite = async () => { throw new Error('Disco indisponível'); };
    await assert.rejects(store.register('outra', 'senha-valida-123', {}));
    assert.equal(JSON.stringify(store.data), previous, 'não confirma cadastro que não foi salvo');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('contas indisponíveis sem persistência ou com arquivo inválido, sem sobrescrever dados', () => {
  assert.equal(new AccountStore('').available, false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-account-corrupt-'));
  try {
    fs.mkdirSync(path.join(dir, 'accounts'));
    const file = path.join(dir, 'accounts', 'accounts.json');
    fs.writeFileSync(file, '{corrompido');
    assert.equal(new AccountStore(dir).available, false);
    assert.equal(fs.readFileSync(file, 'utf8'), '{corrompido');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('limite de tentativas continua valendo ao reconectar e libera depois da janela', () => {
  let now = 0;
  const limited = createAccountLimiter(() => now);
  for (let i = 0; i < 10; i++) assert.equal(limited('ip:um'), false);
  assert.equal(limited('ip:um'), true);
  assert.equal(limited('ip:outro'), false);
  now = 60001;
  assert.equal(limited('ip:um'), false);
  assert.equal(accountClientAddress('127.0.0.1', '198.51.100.10, 203.0.113.5'), '203.0.113.5');
  assert.equal(accountClientAddress('203.0.113.5', '198.51.100.10'), '203.0.113.5', 'cliente remoto não escolhe o endereço usado pelo limite');
  assert.equal(accountClientAddress('::1', 'inválido'), '::1');
});

test('sessões no Electron usam o cofre; sem criptografia segura ficam só na memória', () => {
  const token = 'ab'.repeat(32);
  const crypto = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (text) => Buffer.from([...text].reverse().join('')),
    decryptString: (buffer) => [...buffer.toString()].reverse().join('')
  };
  const vault = createAccountSessionVault(crypto);
  const saved = vault.prepare({ profile: { name: 'Pessoa' }, accountSessions: { 'https://sala.test': token } });
  assert.equal(saved.accountSessions, undefined);
  assert.ok(saved.accountSessionsEncrypted);
  assert.equal(createAccountSessionVault(crypto).restore(saved).accountSessions['https://sala.test'], token);
  const loggedOut = vault.prepare({ ...vault.restore(saved), accountSessions: {} });
  assert.deepEqual(vault.restore(loggedOut).accountSessions, {});
  assert.equal(loggedOut.accountSessionsEncrypted, undefined);
  const fallback = createAccountSessionVault({ ...crypto, getSelectedStorageBackend: () => 'basic_text' });
  const temporary = fallback.prepare({ accountSessions: { 'https://sala.test': token } });
  assert.ok(!JSON.stringify(temporary).includes(token));
  assert.equal(fallback.restore(temporary).accountSessions['https://sala.test'], token);
  assert.deepEqual(createAccountSessionVault({ isEncryptionAvailable: () => false }).restore(temporary).accountSessions, {});
});
