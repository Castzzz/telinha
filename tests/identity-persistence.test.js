import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PermissionStore } from '../permission-store.js';
import { profileIdentity } from '../public/profile-identity.js';
const { createPreferences } = createRequire(import.meta.url)('../electron/preferences.cjs');

test('migra identificação 3.7 sem perder cargos e recupera por prova privada', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-identidade-'));
  try {
    const old = new PermissionStore(directory), alice = old.identity();
    const role = old.saveRole({ name: 'Amigos', position: 10, permissions: ['manageChannels'] });
    old.assign(alice.id, [role.id]); old.setOwner(alice.id);
    const credential = 'a'.repeat(64);
    const migrated = new PermissionStore(directory);
    assert.equal(migrated.identity(alice.token, credential, 'perfil-alice').id, alice.id);
    const updated = new PermissionStore(directory);
    assert.equal(updated.identity('', credential, 'perfil-alice').id, alice.id);
    assert.equal(updated.isOwner({ accessId: alice.id }), true);
    assert.deepEqual(updated.roles({ accessId: alice.id }).map(r => r.id), [role.id]);
    const copiedPublicId = updated.identity('', 'b'.repeat(64), 'perfil-alice');
    assert.notEqual(copiedPublicId.id, alice.id);
    assert.equal(updated.has({ accessId: copiedPublicId.id, isAdmin: true }, 'manageChannels'), false);
    assert.ok(!JSON.stringify(updated.snapshot()).includes(credential));
    assert.ok(!JSON.stringify(updated.snapshot()).includes('credentialHash'));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('preferências do desktop preservam identidade na atualização e se o arquivo principal ficar ilegível', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'teletela-prefs-'));
  const oldPrefs = { profile: { id: 'perfil-antigo', name: 'Pessoa' }, micOn: true,
    roomAccess: { 'https://sala.test': { permissionToken: 'credencial-antiga', password: 'privada' } } };
  try {
    fs.writeFileSync(path.join(directory, 'prefs.json'), JSON.stringify(oldPrefs));
    const updated = createPreferences(directory);
    assert.equal(updated.load().profile.id, oldPrefs.profile.id);
    assert.equal(updated.save({ profileCredentials: { 'perfil-antigo': 'a'.repeat(64) } }), true);
    const restarted = createPreferences(directory);
    assert.equal(restarted.load().micOn, true);
    assert.equal(restarted.load().roomAccess['https://sala.test'].permissionToken, 'credencial-antiga');
    const identityFile = path.join(directory, 'identities.json');
    assert.equal(fs.statSync(identityFile).mode & 0o777, 0o600);
    assert.ok(!fs.readFileSync(identityFile, 'utf8').includes('privada'));
    fs.writeFileSync(path.join(directory, 'prefs.json'), '{interrompido');
    const recovered = createPreferences(directory).load();
    assert.equal(recovered.profile.id, 'perfil-antigo');
    assert.equal(recovered.profileCredentials['perfil-antigo'], 'a'.repeat(64));
    assert.equal(recovered.roomAccess['https://sala.test'].permissionToken, 'credencial-antiga');
    assert.equal(restarted.save({ roomAccess: {} }), true);
    assert.deepEqual(createPreferences(directory).load().roomAccess, {});
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('chave do perfil persiste antes de conectar e pode ser recuperada da cópia local', async () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const prefs = {};
  let saved = false;
  const credential = await profileIdentity(prefs, 'perfil-teste', async patch => { await Promise.resolve(); Object.assign(prefs, patch); saved = true; return true; }, storage);
  assert.equal(saved, true);
  assert.match(credential, /^[a-f0-9]{64}$/);
  assert.equal(await profileIdentity({}, 'perfil-teste', async () => true, storage), credential);
  assert.notEqual(await profileIdentity({}, 'outro-perfil', async () => true, storage), credential);
  await assert.rejects(profileIdentity({}, 'sem-espaco', async () => false, storage), /guardar a identidade/);
});
