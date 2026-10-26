import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';

export const PERMISSIONS = ['kickMembers', 'moveMembers', 'muteMembers', 'deafenMembers', 'manageChannels'];
const ID = /^[a-f0-9-]{36}$/;
export class PermissionStore {
  constructor(directory = '') {
    this.file = directory ? path.join(directory, 'permissions.json') : null;
    this.data = { secret: randomBytes(32).toString('hex'), roles: [], members: {} };
    if (this.file && fs.existsSync(this.file)) {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!/^[a-f0-9]{64}$/.test(data.secret) || !Array.isArray(data.roles) || !data.members || typeof data.members !== 'object') throw new Error('Arquivo de permissões inválido. Restaure o backup antes de iniciar.');
      this.data = data;
    } else this.save();
  }
  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }
  change(fn) {
    const previous = structuredClone(this.data);
    try { const result = fn(); this.save(); return result; }
    catch (err) { this.data = previous; throw err; }
  }
  signature(id) { return createHmac('sha256', this.data.secret).update(id).digest('hex'); }
  identity(token) {
    if (typeof token === 'string' && token.length === 101) {
      const [id, proof] = token.split('.');
      if (ID.test(id) && /^[a-f0-9]{64}$/.test(proof) && this.data.members[id]
        && timingSafeEqual(Buffer.from(proof), Buffer.from(this.signature(id)))) return { id, token };
    }
    const id = randomUUID();
    this.change(() => { this.data.members[id] = { name: 'Visitante', roles: [] }; });
    return { id, token: `${id}.${this.signature(id)}` };
  }
  remember(id, name) {
    const member = this.data.members[id];
    if (member && typeof name === 'string' && member.name !== name) this.change(() => { member.name = name.slice(0, 25); });
  }
  roles(user) {
    const ids = this.data.members[user?.accessId]?.roles || [];
    return this.data.roles.filter(role => ids.includes(role.id));
  }
  has(user, permission) { return Boolean(user?.isAdmin || this.roles(user).some(role => role.permissions.includes(permission))); }
  rank(user) { return user?.isAdmin ? 1000 : Math.max(0, ...this.roles(user).map(role => role.position)); }
  canModerate(actor, target, permission) {
    return Boolean(target && actor.id !== target.id && this.has(actor, permission)
      && (actor.isAdmin || this.rank(actor) > this.rank(target)));
  }
  visible(user, channel) {
    if (!channel?.access?.private || user?.isAdmin) return true;
    return Boolean(user?.accessId && (channel.access.members.includes(user.accessId)
      || this.roles(user).some(role => channel.access.roles.includes(role.id))));
  }
  access(raw, stored = false) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.private !== 'boolean') throw new Error('Escolha a visibilidade do canal.');
    const list = (value, valid) => {
      if (!Array.isArray(value) || value.length > 500 || value.some(id => typeof id !== 'string' || !valid(id))) throw new Error('Lista de acesso inválida.');
      return [...new Set(value)];
    };
    return { private: raw.private,
      roles: list(raw.roles, id => stored ? ID.test(id) : this.data.roles.some(role => role.id === id)),
      members: list(raw.members, id => stored ? ID.test(id) : Boolean(this.data.members[id])) };
  }
  saveRole(raw) {
    if (!raw || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 30) throw new Error('O cargo precisa de um nome de até 30 caracteres.');
    if (!Array.isArray(raw.permissions) || raw.permissions.some(p => !PERMISSIONS.includes(p))) throw new Error('Permissões inválidas.');
    if (!Number.isInteger(raw.position) || raw.position < 1 || raw.position > 99) throw new Error('A hierarquia precisa ser de 1 a 99.');
    const existing = raw.id && this.data.roles.find(role => role.id === raw.id);
    if (raw.id && !existing) throw new Error('Esse cargo não existe mais.');
    if (!existing && this.data.roles.length >= 50) throw new Error('A sala já tem 50 cargos.');
    return this.change(() => {
      const role = { id: existing?.id || randomUUID(), name: raw.name.trim(), position: raw.position, permissions: [...new Set(raw.permissions)] };
      if (existing) Object.assign(existing, role); else this.data.roles.push(role);
      return role;
    });
  }
  deleteRole(id) {
    if (!this.data.roles.some(role => role.id === id)) throw new Error('Esse cargo não existe mais.');
    this.change(() => {
      this.data.roles = this.data.roles.filter(role => role.id !== id);
      for (const member of Object.values(this.data.members)) member.roles = member.roles.filter(role => role !== id);
    });
  }
  assign(id, roles) {
    if (!this.data.members[id] || !Array.isArray(roles) || roles.length > 50 || roles.some(role => !this.data.roles.some(r => r.id === role))) throw new Error('Pessoa ou cargos inválidos.');
    this.change(() => { this.data.members[id].roles = [...new Set(roles)]; });
  }
  snapshot() {
    return { roles: this.data.roles, members: Object.entries(this.data.members).map(([id, member]) => ({ id, ...member })) };
  }
}
