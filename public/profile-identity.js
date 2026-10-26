// Só o ID público não prova quem é o perfil. Esta chave nunca vai no perfil enviado aos amigos.
export async function profileIdentity(prefs, profileId, savePrefs, storage = localStorage) {
  const key = `teletela_identity_${profileId}`;
  let backup;
  try { backup = storage.getItem(key); } catch {}
  let credential = prefs.profileCredentials?.[profileId] || backup;
  if (!/^[a-f0-9]{64}$/.test(credential || '')) {
    credential = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  }
  try { storage.setItem(key, credential); } catch {}
  const saved = await savePrefs({ profileCredentials: { ...prefs.profileCredentials, [profileId]: credential } });
  if (saved === false) throw new Error('Não foi possível guardar a identidade. Libere espaço e abra o app de novo.');
  return credential;
}

export async function profileProof(credential, serverUrl, challenge) {
  const hex = '302e020100300506032b657004220420' + credential;
  const bytes = Uint8Array.from(hex.match(/../g), pair => parseInt(pair, 16));
  const key = await crypto.subtle.importKey('pkcs8', bytes, 'Ed25519', true, ['sign']);
  const { x } = await crypto.subtle.exportKey('jwk', key);
  const host = new URL(serverUrl).host.toLowerCase();
  const signature = await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(`teletela-profile|${host}|${challenge}`));
  return { publicKey: x, challenge, signature: Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, '0')).join('') };
}
