import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { isIP } from 'node:net';

const deriveKey = promisify(scrypt);
const SCRYPT = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const ACCOUNT_ID_RE = /^conta-[a-f0-9-]{36}$/;
const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const usernameKey = (value) => typeof value === 'string' ? value.trim().replace(/^@/, '').toLowerCase() : '';

export class AccountError extends Error {
  constructor(message, code = 'account-error') { super(message); this.code = code; }
}

// JSON pequeno para credenciais/amizades; fotos e GIFs ficam num arquivo por perfil.
// As gravações são serializadas e só alteram a memória depois de confirmar o arquivo.
export class AccountStore {
  constructor(dataDir, { now = Date.now } = {}) {
    this.now = now;
    this.available = false;
    this.busyHashes = 0;
    this.queue = Promise.resolve();
    this.data = { version: 1, accounts: [], sessions: [], relationships: [] };
    if (!dataDir) return;
    this.dir = path.join(dataDir, 'accounts');
    this.file = path.join(this.dir, 'accounts.json');
    try {
      fs.mkdirSync(path.join(this.dir, 'profiles'), { recursive: true, mode: 0o700 });
      let saved;
      try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
      catch (err) { if (err.code !== 'ENOENT') throw err; }
      if (saved) {
        if (saved.version !== 1 || !Array.isArray(saved.accounts) || !Array.isArray(saved.sessions) || !Array.isArray(saved.relationships)) throw new Error('Formato das contas inválido.');
        const ids = new Set(), names = new Set();
        for (const account of saved.accounts) {
          if (!ACCOUNT_ID_RE.test(account.id) || !USERNAME_RE.test(account.username) || !/^[a-f0-9]{32}$/.test(account.salt)
            || !/^[a-f0-9]{64}$/.test(account.hash) || ids.has(account.id) || names.has(account.username)) throw new Error('Conta salva inválida.');
          ids.add(account.id); names.add(account.username);
        }
        if (saved.sessions.some((s) => !ids.has(s.accountId) || !/^[a-f0-9]{64}$/.test(s.hash) || !Number.isFinite(s.expiresAt))) throw new Error('Sessão salva inválida.');
        const pairs = new Set();
        for (const relation of saved.relationships) {
          const key = [relation.a, relation.b].sort().join(':');
          if (!ids.has(relation.a) || !ids.has(relation.b) || relation.a === relation.b || ![relation.a, relation.b].includes(relation.requestedBy)
            || !['pending', 'accepted'].includes(relation.status) || pairs.has(key)) throw new Error('Amizade salva inválida.');
          pairs.add(key);
        }
        this.data = saved;
      }
      this.available = true;
    } catch (err) {
      // Um arquivo quebrado nunca é substituído por uma base vazia.
      console.error('⚠️ [Contas] Contas indisponíveis; os visitantes podem continuar usando a sala:', err.message);
    }
  }

  async atomicWrite(file, data) {
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.promises.writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
      await fs.promises.rename(tmp, file);
    } finally { await fs.promises.unlink(tmp).catch(() => {}); }
  }

  transaction(change) {
    const operation = this.queue.then(async () => {
      if (!this.available) throw new AccountError('Contas indisponíveis nesta sala. Você pode continuar como visitante.');
      const next = structuredClone(this.data);
      const result = await change(next);
      await this.atomicWrite(this.file, next);
      this.data = next;
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  publicAccount(account) {
    return account ? { id: account.id, username: account.username, createdAt: account.createdAt } : null;
  }

  resolve(token) {
    if (!this.available || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const hash = tokenHash(token);
    const session = this.data.sessions.find((s) => s.hash === hash && s.expiresAt > this.now());
    const account = session && this.data.accounts.find((a) => a.id === session.accountId);
    return account ? { account, expiresAt: session.expiresAt } : null;
  }

  async hashPassword(password, salt) {
    // Não ocupa o event loop da voz nem deixa pedidos simultâneos consumirem toda a RAM.
    if (this.busyHashes >= 2) throw new AccountError('Muita gente entrando agora. Tente de novo em alguns segundos.');
    this.busyHashes++;
    try { return (await deriveKey(password, Buffer.from(salt, 'hex'), 32, SCRYPT)).toString('hex'); }
    finally { this.busyHashes--; }
  }

  addSession(data, accountId) {
    data.sessions = data.sessions.filter((s) => s.expiresAt > this.now());
    const own = data.sessions.filter((s) => s.accountId === accountId);
    if (own.length >= 8) {
      const oldest = own.sort((a, b) => a.expiresAt - b.expiresAt)[0];
      data.sessions = data.sessions.filter((s) => s !== oldest);
    }
    const token = randomBytes(32).toString('hex');
    const expiresAt = this.now() + SESSION_MS;
    data.sessions.push({ hash: tokenHash(token), accountId, expiresAt });
    return { token, expiresAt };
  }

  async register(rawUsername, password, profile) {
    const username = usernameKey(rawUsername);
    if (!USERNAME_RE.test(username)) throw new AccountError('Use de 3 a 24 letras, números ou _ no usuário.');
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new AccountError('A senha precisa ter de 8 a 128 caracteres.');
    if (!this.available) throw new AccountError('Contas indisponíveis nesta sala.');
    if (this.data.accounts.some((a) => a.username === username)) throw new AccountError('Esse usuário já está em uso. Escolha outro.');
    const salt = randomBytes(16).toString('hex');
    const hash = await this.hashPassword(password, salt);
    return this.transaction(async (next) => {
      if (next.accounts.length >= 5000) throw new AccountError('Esta sala atingiu o limite de contas.');
      if (next.accounts.some((a) => a.username === username)) throw new AccountError('Esse usuário já está em uso. Escolha outro.');
      const account = { id: `conta-${randomUUID()}`, username, salt, hash, name: profile.name || username, createdAt: this.now() };
      const savedProfile = { ...profile, id: account.id };
      await this.atomicWrite(path.join(this.dir, 'profiles', `${account.id}.json`), savedProfile);
      next.accounts.push(account);
      return { account: this.publicAccount(account), profile: savedProfile, ...this.addSession(next, account.id) };
    });
  }

  async login(rawUsername, password) {
    const username = usernameKey(rawUsername);
    if (!USERNAME_RE.test(username) || typeof password !== 'string' || !password || password.length > 128) throw new AccountError('Usuário ou senha incorretos.');
    const account = this.data.accounts.find((a) => a.username === username);
    // Usuário desconhecido tem o mesmo custo de verificação de uma senha errada.
    const hash = await this.hashPassword(password, account?.salt || '00'.repeat(16));
    if (!account || !timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(account.hash, 'hex'))) throw new AccountError('Usuário ou senha incorretos.');
    const profile = await this.readProfile(account.id);
    return this.transaction((next) => ({ account: this.publicAccount(account), profile, ...this.addSession(next, account.id) }));
  }

  async readProfile(accountId) {
    if (!ACCOUNT_ID_RE.test(accountId)) throw new AccountError('Conta inválida.');
    const profile = JSON.parse(await fs.promises.readFile(path.join(this.dir, 'profiles', `${accountId}.json`), 'utf8'));
    return { ...profile, id: accountId };
  }

  saveProfile(accountId, profile) {
    return this.transaction(async (next) => {
      const account = next.accounts.find((a) => a.id === accountId);
      if (!account) throw new AccountError('Entre na conta de novo.', 'session-expired');
      await this.atomicWrite(path.join(this.dir, 'profiles', `${accountId}.json`), { ...profile, id: accountId });
      account.name = profile.name;
    });
  }

  logout(token) {
    return this.transaction((next) => { next.sessions = next.sessions.filter((s) => s.hash !== tokenHash(token)); });
  }

  contacts(accountId) {
    return this.data.relationships.filter((r) => r.a === accountId || r.b === accountId)
      .map((r) => r.a === accountId ? r.b : r.a);
  }

  friendState(accountId, isOnline) {
    const result = { friends: [], incoming: [], outgoing: [] };
    for (const relation of this.data.relationships) {
      if (relation.a !== accountId && relation.b !== accountId) continue;
      const other = this.data.accounts.find((a) => a.id === (relation.a === accountId ? relation.b : relation.a));
      if (!other) continue;
      const entry = { id: other.id, username: other.username, name: other.name || other.username };
      if (relation.status === 'accepted') result.friends.push({ ...entry, online: Boolean(isOnline(other.id)) });
      else result[relation.requestedBy === accountId ? 'outgoing' : 'incoming'].push(entry);
    }
    for (const list of Object.values(result)) list.sort((a, b) => a.username.localeCompare(b.username));
    return result;
  }

  friendAction(accountId, action, { username: rawUsername, userId } = {}) {
    return this.transaction((next) => {
      if (!next.accounts.some((a) => a.id === accountId)) throw new AccountError('Entre na conta de novo.', 'session-expired');
      const target = action === 'request' ? next.accounts.find((a) => a.username === usernameKey(rawUsername)) : next.accounts.find((a) => a.id === userId);
      if (!target) throw new AccountError('Esse usuário não foi encontrado. Confira o @usuário.');
      if (target.id === accountId) throw new AccountError('Você não pode adicionar a si mesmo.');
      const relation = next.relationships.find((r) => (r.a === accountId && r.b === target.id) || (r.b === accountId && r.a === target.id));
      if (action === 'request') {
        if (relation) throw new AccountError(relation.status === 'accepted' ? 'Vocês já são amigos.' : relation.requestedBy === accountId ? 'Você já enviou um pedido.' : 'Essa pessoa já te enviou um pedido. Aceite na lista de recebidos.');
        if ([accountId, target.id].some((id) => next.relationships.filter((r) => r.a === id || r.b === id).length >= 500)) throw new AccountError('Limite de amigos e pedidos atingido.');
        next.relationships.push({ a: accountId, b: target.id, requestedBy: accountId, status: 'pending', createdAt: this.now() });
      } else if (action === 'accept' && relation?.status === 'pending' && relation.requestedBy === target.id) relation.status = 'accepted';
      else if ((action === 'reject' && relation?.status === 'pending' && relation.requestedBy === target.id)
        || (action === 'cancel' && relation?.status === 'pending' && relation.requestedBy === accountId)
        || (action === 'remove' && relation?.status === 'accepted')) next.relationships = next.relationships.filter((r) => r !== relation);
      else throw new AccountError('Esse pedido ou amizade não está mais disponível.');
      return target.id;
    });
  }
}

// O limite por endereço sobrevive a reconexões. O limite por usuário dificulta tentativas distribuídas.
export function createAccountLimiter(now = Date.now) {
  const buckets = new Map();
  return (key, max = 10, windowMs = 60000) => {
    const at = now();
    for (const [id, bucket] of buckets) if (at >= bucket.until) buckets.delete(id);
    const bucket = buckets.get(key) || { count: 0, until: at + windowMs };
    if (bucket.count >= max || (buckets.size >= 10000 && !buckets.has(key))) return true;
    bucket.count++;
    buckets.set(key, bucket);
    return false;
  };
}

export function accountClientAddress(address, forwarded) {
  // Só o proxy local pode informar o IP público; Caddy acrescenta o cliente no fim.
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) && typeof forwarded === 'string') {
    const client = forwarded.split(',').at(-1).trim();
    if (isIP(client)) return client;
  }
  return address;
}
