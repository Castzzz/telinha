import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createHmac, createHash, timingSafeEqual } from 'node:crypto';

export const PERMISSIONS = ['kickMembers', 'moveMembers', 'muteMembers', 'deafenMembers', 'manageChannels', 'manageRoles', 'manageServer', 'manageMessages'];
const ID = /^[a-f0-9-]{36}$/;
export class PermissionStore {
  constructor(directory = '') {
    this.file = directory ? path.join(directory, 'permissions.json') : null;
    this.data = { secret: randomBytes(32).toString('hex'), roles: [], members: {} };
    if (this.file && fs.existsSync(this.file)) {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!/^[a-f0-9]{64}$/.test(data.secret) || !Array.isArray(data.roles) || !data.members || typeof data.members !== 'object') throw new Error('Arquivo de permissões inválido. Restaure o backup antes de iniciar.');
      if (data.ownerId != null && (!ID.test(data.ownerId) || !data.members[data.ownerId])) throw new Error('Proprietário inválido no arquivo de permissões. Restaure o backup antes de iniciar.');
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
  authenticatedId(token, credential) {
    if (typeof credential === 'string' && /^[a-f0-9]{64}$/.test(credential)) {
      const hash = createHash('sha256').update(credential).digest('hex');
      const member = Object.entries(this.data.members).find(([, value]) => value.credentialHash === hash);
      if (member) return member[0];
    }
    if (typeof token !== 'string' || token.length !== 101) return null;
    const [id, proof] = token.split('.');
    return ID.test(id) && /^[a-f0-9]{64}$/.test(proof) && this.data.members[id]
      && timingSafeEqual(Buffer.from(proof), Buffer.from(this.signature(id))) ? id : null;
  }
  identity(token, credential, profileId) {
    const credentialHash = typeof credential === 'string' && /^[a-f0-9]{64}$/.test(credential)
      ? createHash('sha256').update(credential).digest('hex') : null;
    // A prova privada recupera o vínculo mesmo se mudar o endereço da sala.
    const known = credentialHash && Object.entries(this.data.members).find(([, member]) => member.credentialHash === credentialHash);
    if (known) return { id: known[0], token: `${known[0]}.${this.signature(known[0])}` };
    const bind = id => {
      if (credentialHash && !this.data.members[id].credentialHash) this.change(() => {
        Object.assign(this.data.members[id], { credentialHash, profileId });
      });
      return { id, token: `${id}.${this.signature(id)}` };
    };
    if (typeof token === 'string' && token.length === 101) {
      const [id, proof] = token.split('.');
      if (ID.test(id) && /^[a-f0-9]{64}$/.test(proof) && this.data.members[id]
        && timingSafeEqual(Buffer.from(proof), Buffer.from(this.signature(id)))) return bind(id);
    }
    const id = randomUUID();
    this.change(() => { this.data.members[id] = { name: 'Visitante', roles: [] }; });
    return bind(id);
  }
  isOwner(user) { return Boolean(user?.accessId && this.data.ownerId === user.accessId); }
  setOwner(id) {
    if (!this.data.members[id]) throw new Error('Esse perfil ainda não entrou no servidor.');
    this.change(() => { this.data.ownerId = id; });
  }
  remember(id, name) {
    const member = this.data.members[id];
    if (member && typeof name === 'string' && member.name !== name) this.change(() => { member.name = name.slice(0, 25); });
  }
  roles(user) {
    const ids = this.data.members[user?.accessId]?.roles || [];
    return this.data.roles.filter(role => ids.includes(role.id));
  }
  has(user, permission) { return Boolean(this.isOwner(user) || this.roles(user).some(role => role.permissions.includes(permission))); }
  rank(user) { return this.isOwner(user) ? 1000 : Math.max(0, ...this.roles(user).map(role => role.position)); }
  canModerate(actor, target, permission) {
    return Boolean(target && actor.id !== target.id && this.has(actor, permission)
      && this.rank(actor) > this.rank(target));
  }
  visible(user, channel) {
    if (!channel?.access?.private) return true;
    return Boolean(user?.accessId && (channel.access.members.includes(user.accessId)
      || this.roles(user).some(role => channel.access.roles.includes(role.id))));
  }
  canWrite(user, channel) { return this.visible(user, channel) && this.visible(user, { access: channel?.writeAccess }); }
  checkAssignment(actor, id, roles, channels) {
    const before = this.data.members[id]?.roles || [];
    for (const channel of channels) {
      for (const access of [channel.access, channel.writeAccess]) {
        if (!access?.private || access.members.includes(id)) continue;
        const hadAccess = before.some(role => access.roles.includes(role));
        const getsAccess = roles.some(role => access.roles.includes(role));
        if (getsAccess !== hadAccess && !this.visible(actor, channel)) {
          throw new Error('Essa alteração afeta o acesso a um canal privado. Peça a alguém autorizado no canal.');
        }
      }
    }
  }
  checkRole(actor, role) {
    if (!role || !Number.isInteger(role.position) || !Array.isArray(role.permissions)) throw new Error('Cargo inválido.');
    if (!this.isOwner(actor) && (role.position >= this.rank(actor) || role.permissions.some(p => !this.has(actor, p)))) throw new Error('Você só pode gerenciar cargos abaixo do seu, com permissões que já possui.');
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
  pruneVisitor(id, activeIds = new Set(), referencedIds = new Set()) {
    const member = this.data.members[id];
    if (!member || id === this.data.ownerId || activeIds.has(id) || referencedIds.has(id)) return false;
    if ((member.roles?.length || 0) === 0 && !member.credentialHash && (!member.name || member.name === 'Visitante')) {
      this.change(() => { delete this.data.members[id]; });
      return true;
    }
    return false;
  }
  cleanMembers({ activeIds = new Set(), referencedIds = new Set(), mode = 'dedup', onMerge = null } = {}) {
    let removed = 0;
    let merged = 0;
    this.change(() => {
      const score = (id, m) => (id === this.data.ownerId ? 1000 : 0)
        + (activeIds.has(id) ? 100 : 0)
        + (m.credentialHash ? 20 : 0)
        + ((m.roles?.length || 0) > 0 ? 5 : 0);

      // Nome público não comprova identidade nem pode transferir acesso privado.
      const byName = new Map();
      for (const [id, member] of Object.entries(this.data.members)) {
        const key = (member.name || '').trim().toLowerCase();
        if (!key || key === 'visitante') continue;
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push([id, member]);
      }
      for (const group of byName.values()) {
        if (group.length < 2) continue;
        group.sort((a, b) => score(b[0], b[1]) - score(a[0], a[1]));
        const [keepId, keepMember] = group[0];
        for (let i = 1; i < group.length; i++) {
          const [dupId, dupMember] = group[i];
          if (dupId === this.data.ownerId || activeIds.has(dupId)) continue;
          const sameCred = Boolean(keepMember.credentialHash && dupMember.credentialHash === keepMember.credentialHash);
          if (sameCred) {
            keepMember.roles = [...new Set([...(keepMember.roles || []), ...(dupMember.roles || [])])];
            onMerge?.(dupId, keepId);
            delete this.data.members[dupId];
            merged++;
          }
        }
      }

      // 2. Remove visitantes sem credencial ou aplica reset mantendo dono e quem está online
      for (const [id, member] of Object.entries(this.data.members)) {
        if (id === this.data.ownerId || activeIds.has(id)) continue;
        const hasRoles = (member.roles?.length || 0) > 0;
        const isReferenced = referencedIds.has(id);
        if (mode === 'reset' && !isReferenced) {
          onMerge?.(id, null);
          delete this.data.members[id];
          removed++;
        } else if (!hasRoles && !isReferenced && !member.credentialHash) {
          delete this.data.members[id];
          removed++;
        }
      }
    });
    return { removed, merged };
  }
  snapshot() {
    return { roles: this.data.roles, ownerId: this.data.ownerId || null,
      members: Object.entries(this.data.members).map(([id, member]) => ({ id, name: member.name, roles: member.roles })) };
  }
}
