import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import { normalizeImageCrop } from './public/image-crop.js';

const derive = promisify(scrypt);
const SCRYPT = { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const ID = /^[a-f0-9-]{36}$/;
const PROFILE_ID = /^[a-z0-9-]{8,64}$/i;
const USERNAME = /^[a-z0-9_]{3,24}$/;
const TOKEN = /^[a-f0-9]{64}$/;
const SESSION_MS = 30 * 86400000;
const digest = value => createHash('sha256').update(value).digest('hex');
const usernameKey = value => typeof value === 'string' ? value.trim().replace(/^@/, '').toLowerCase() : '';
const recoveryKey = value => typeof value === 'string' ? value.replace(/[\s-]/g, '').toLowerCase() : '';
const equal = (a, b) => TOKEN.test(a || '') && TOKEN.test(b || '') && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

export class AccountError extends Error {
  constructor(message, code = 'account-error') { super(message); this.code = code; }
}

function profileSnapshot(raw) {
  if (!raw || !PROFILE_ID.test(raw.id || raw.profileId || '')) throw new AccountError('Espere seu perfil carregar e tente de novo.');
  const result = { id: raw.id || raw.profileId };
  const fields = { name: 25, bio: 140, color: 7, nameColor: 7, nameColor2: 7, frame: 20,
    frameColor: 7, bannerColor: 7, displayRoleId: 36, avatar: 14 * 1024 * 1024,
    banner: 14 * 1024 * 1024, joinSound: 2 * 1024 * 1024 };
  for (const [field, max] of Object.entries(fields)) {
    if (typeof raw[field] !== 'string' || raw[field].length > max) {
      if (raw[field] == null) result[field] = '';
      else throw new AccountError('O perfil ultrapassou o tamanho permitido.');
    } else result[field] = raw[field];
  }
  result.avatarCrop = normalizeImageCrop(raw.avatarCrop);
  result.bannerCrop = normalizeImageCrop(raw.bannerCrop);
  return result;
}

// Um único arquivo atômico confirma perfil, vínculo e sessão juntos.
export class AccountStore {
  constructor(directory, { now = Date.now } = {}) {
    this.now = now;
    this.available = false;
    this.busyHashes = 0;
    this.pending = 0;
    this.queue = Promise.resolve();
    this.data = { version: 2, accounts: [], sessions: [], friendships: [] };
    if (!directory) return;
    this.file = path.join(directory, 'accounts.json');
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (fs.existsSync(this.file)) {
        const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (data.version !== 2 || !Array.isArray(data.accounts) || !Array.isArray(data.sessions)) throw new Error('Formato das contas inválido.');
        const ids = new Set(), names = new Set(), members = new Set(), profiles = new Set();
        for (const account of data.accounts) {
          if (!ID.test(account.id) || !ID.test(account.accessId) || !USERNAME.test(account.username)
            || !/^[a-f0-9]{32}$/.test(account.salt) || !TOKEN.test(account.hash) || !TOKEN.test(account.recoveryHash)
            || ids.has(account.id) || names.has(account.username) || members.has(account.accessId) || profiles.has(account.profile?.id)) throw new Error('Conta salva inválida.');
          profileSnapshot(account.profile);
          ids.add(account.id); names.add(account.username); members.add(account.accessId); profiles.add(account.profile.id);
        }
        if (data.sessions.some(session => !ids.has(session.accountId) || !TOKEN.test(session.hash) || !Number.isFinite(session.expiresAt))) throw new Error('Sessão salva inválida.');
        if (data.friendships === undefined) data.friendships = [];
        const pairs = new Set();
        if (!Array.isArray(data.friendships) || data.friendships.length > 25000) throw new Error('Lista de amigos inválida.');
        for (const edge of data.friendships) {
          const pair = [edge.from, edge.to].sort().join(':');
          if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to
            || !['pending', 'accepted'].includes(edge.status) || pairs.has(pair)) throw new Error('Amizade salva inválida.');
          pairs.add(pair);
        }
        this.data = data;
      }
      this.available = true;
    } catch (error) {
      // Falhar antes de aceitar visitantes impede reutilizar vínculos de contas revogadas.
      throw new Error(`Não foi possível abrir as contas. Restaure accounts.json do backup: ${error.message}`);
    }
  }

  publicAccount(account) {
    return account ? { id: account.id, username: account.username, accessId: account.accessId,
      profileId: account.profile.id, createdAt: account.createdAt } : null;
  }
  referencedAccessIds() { return new Set(this.data.accounts.map(account => account.accessId)); }
  accountForAccessId(id) { return this.publicAccount(this.data.accounts.find(account => account.accessId === id)); }
  accountForProfileId(id) { return this.publicAccount(this.data.accounts.find(account => account.profile.id === id)); }
  resolveSessionMeta(token) {
    if (!this.available || typeof token !== 'string' || !TOKEN.test(token)) return null;
    const hash = digest(token);
    const session = this.data.sessions.find(item => item.hash === hash && item.expiresAt > this.now());
    const account = session && this.data.accounts.find(item => item.id === session.accountId);
    return account ? { account: this.publicAccount(account), expiresAt: session.expiresAt } : null;
  }
  resolveSession(token) {
    const session = this.resolveSessionMeta(token);
    const account = session && this.data.accounts.find(item => item.id === session.account.id);
    return account ? { ...session, profile: structuredClone(account.profile) } : null;
  }
  async transaction(change) {
    if (!this.available) throw new AccountError('Contas indisponíveis nesta sala. Você pode continuar sem conta.');
    if (this.pending >= 32) throw new AccountError('Muitos pedidos agora. Espere alguns segundos.');
    this.pending++;
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.data);
      const result = change(next);
      const temporary = `${this.file}.${randomBytes(8).toString('hex')}.tmp`;
      try {
        await fs.promises.writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
        await fs.promises.rename(temporary, this.file);
      } finally { await fs.promises.unlink(temporary).catch(() => {}); }
      this.data = next;
      return result;
    });
    this.queue = operation.catch(() => {});
    try { return await operation; } finally { this.pending--; }
  }
  async passwordHash(password, salt) {
    if (this.busyHashes >= 2) throw new AccountError('Muita gente entrando agora. Tente de novo em alguns segundos.');
    this.busyHashes++;
    try { return (await derive(password, Buffer.from(salt, 'hex'), 32, SCRYPT)).toString('hex'); }
    finally { this.busyHashes--; }
  }
  session(next, account) {
    next.sessions = next.sessions.filter(item => item.expiresAt > this.now());
    const own = next.sessions.filter(item => item.accountId === account.id).sort((a, b) => a.expiresAt - b.expiresAt);
    if (own.length >= 8) next.sessions = next.sessions.filter(item => !own.slice(0, own.length - 7).includes(item));
    const token = randomBytes(32).toString('hex'), expiresAt = this.now() + SESSION_MS;
    next.sessions.push({ accountId: account.id, hash: digest(token), expiresAt });
    return { account: this.publicAccount(account), profile: structuredClone(account.profile), token, expiresAt };
  }
  async register(rawUsername, password, { accessId, profile } = {}) {
    const username = usernameKey(rawUsername);
    if (!USERNAME.test(username)) throw new AccountError('Use de 3 a 24 letras, números ou _ no usuário.');
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new AccountError('A senha precisa ter de 8 a 128 caracteres.');
    if (!ID.test(accessId || '')) throw new AccountError('Não foi possível comprovar seu perfil. Reconecte e tente de novo.');
    const snapshot = profileSnapshot(profile);
    const salt = randomBytes(16).toString('hex'), hash = await this.passwordHash(password, salt);
    const recoveryCode = randomBytes(24).toString('hex').match(/.{8}/g).join('-');
    return this.transaction(next => {
      if (next.accounts.length >= 5000) throw new AccountError('Esta sala atingiu o limite de contas.');
      if (next.accounts.some(account => account.username === username)) throw new AccountError('Esse usuário já está em uso. Escolha outro.');
      if (next.accounts.some(account => account.accessId === accessId)) throw new AccountError('Esse perfil já está vinculado a uma conta. Entre nela para continuar.');
      // O ID público não comprova posse; uma cópia dele não pode impedir o cadastro real.
      const savedProfile = { ...snapshot, id: next.accounts.some(account => account.profile.id === snapshot.id) ? randomUUID() : snapshot.id };
      const account = { id: randomUUID(), username, accessId, salt, hash, recoveryHash: digest(recoveryKey(recoveryCode)), profile: savedProfile, createdAt: this.now() };
      next.accounts.push(account);
      return { ...this.session(next, account), recoveryCode };
    });
  }
  async login(rawUsername, password) {
    const username = usernameKey(rawUsername);
    if (!USERNAME.test(username) || typeof password !== 'string' || !password || password.length > 128) throw new AccountError('Usuário ou senha incorretos.');
    const account = this.data.accounts.find(item => item.username === username);
    const hash = await this.passwordHash(password, account?.salt || '00'.repeat(16));
    if (!account || !equal(hash, account.hash)) throw new AccountError('Usuário ou senha incorretos.');
    return this.transaction(next => {
      const current = next.accounts.find(item => item.id === account.id);
      // Uma recuperação concorrente não pode emitir sessão pela senha anterior.
      if (!current || current.hash !== account.hash) throw new AccountError('Usuário ou senha incorretos.');
      return this.session(next, current);
    });
  }
  async recover(rawUsername, rawCode, password) {
    const username = usernameKey(rawUsername), code = recoveryKey(rawCode);
    const account = this.data.accounts.find(item => item.username === username);
    if (!USERNAME.test(username) || !/^[a-f0-9]{48}$/.test(code) || !account || !equal(digest(code), account.recoveryHash)) throw new AccountError('Usuário ou código de recuperação incorretos.');
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new AccountError('A nova senha precisa ter de 8 a 128 caracteres.');
    const salt = randomBytes(16).toString('hex'), hash = await this.passwordHash(password, salt);
    const recoveryCode = randomBytes(24).toString('hex').match(/.{8}/g).join('-');
    return this.transaction(next => {
      const current = next.accounts.find(item => item.id === account.id);
      if (!current || current.recoveryHash !== account.recoveryHash) throw new AccountError('Usuário ou código de recuperação incorretos.');
      current.salt = salt; current.hash = hash; current.recoveryHash = digest(recoveryKey(recoveryCode));
      next.sessions = next.sessions.filter(item => item.accountId !== current.id);
      return { ...this.session(next, current), recoveryCode };
    });
  }
  saveProfile(accountId, profile) {
    const snapshot = profileSnapshot(profile);
    return this.transaction(next => {
      const account = next.accounts.find(item => item.id === accountId);
      if (!account) throw new AccountError('Entre na conta de novo.', 'session-expired');
      if (snapshot.id !== account.profile.id) throw new AccountError('A conta mantém a identificação original do perfil.');
      account.profile = snapshot;
      account.profileUpdatedAt = this.now();
    });
  }
  logout(token) {
    const hash = typeof token === 'string' ? digest(token) : '';
    return this.transaction(next => { next.sessions = next.sessions.filter(item => item.hash !== hash); });
  }

  friends(accountId, online = () => false) {
    const result = { friends: [], incoming: [], outgoing: [] };
    for (const edge of this.data.friendships) {
      if (edge.from !== accountId && edge.to !== accountId) continue;
      const other = this.data.accounts.find(account => account.id === (edge.from === accountId ? edge.to : edge.from));
      if (!other) continue;
      const kind = edge.status === 'accepted' ? 'friends' : edge.to === accountId ? 'incoming' : 'outgoing';
      result[kind].push({ id: other.id, username: other.username, name: other.profile.name,
        ...(kind === 'friends' ? { online: online(other.id) } : {}) });
    }
    return result;
  }

  changeFriend(accountId, action, payload = {}) {
    return this.transaction(next => {
      if (!next.accounts.some(account => account.id === accountId)) throw new AccountError('Entre na conta de novo.');
      const other = action === 'request'
        ? next.accounts.find(account => account.username === usernameKey(payload.username))
        : next.accounts.find(account => account.id === payload.accountId);
      if (!other) throw new AccountError('Não encontrei essa conta nesta sala. Confira o @usuário.');
      if (other.id === accountId) throw new AccountError('Você não pode adicionar a própria conta.');
      const edge = next.friendships.find(item => (item.from === accountId && item.to === other.id) || (item.to === accountId && item.from === other.id));
      if (action === 'request') {
        if (edge) throw new AccountError(edge.status === 'accepted' ? 'Vocês já são amigos.' : 'Já existe um pedido entre vocês. Confira os pedidos recebidos e enviados.');
        if (next.friendships.length >= 25000 || [accountId, other.id].some(id => next.friendships.filter(item => item.from === id || item.to === id).length >= 500)) throw new AccountError('Limite de amigos e pedidos atingido. Remova ou cancele pedidos antes.');
        next.friendships.push({ from: accountId, to: other.id, status: 'pending' });
      } else if (action === 'accept' || action === 'reject') {
        if (!edge || edge.status !== 'pending' || edge.to !== accountId) throw new AccountError('Esse pedido não está mais disponível.');
        if (action === 'accept') edge.status = 'accepted';
        else next.friendships = next.friendships.filter(item => item !== edge);
      } else if (action === 'cancel' || action === 'remove') {
        if (!edge || (action === 'cancel' ? edge.status !== 'pending' || edge.from !== accountId : edge.status !== 'accepted')) throw new AccountError('Essa amizade ou pedido não está mais disponível.');
        next.friendships = next.friendships.filter(item => item !== edge);
      } else throw new AccountError('Ação de amizade inválida.');
    });
  }
}

// Os limites sobrevivem à troca de socket e separam endereço e usuário.
export function createAccountLimiter(now = Date.now) {
  const buckets = new Map();
  return (key, maximum = 10, windowMs = 60000) => {
    const at = now();
    for (const [id, bucket] of buckets) if (at >= bucket.until) buckets.delete(id);
    const bucket = buckets.get(key) || { count: 0, until: at + windowMs };
    if (bucket.count >= maximum || (buckets.size >= 10000 && !buckets.has(key))) return true;
    bucket.count++; buckets.set(key, bucket); return false;
  };
}

export function accountClientAddress(address, forwarded) {
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) && typeof forwarded === 'string') {
    const client = forwarded.split(',').at(-1).trim();
    if (isIP(client)) return client;
  }
  return address;
}
