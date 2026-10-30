import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const defaults = () => ({ categories: [{ id: 'voice', type: 'voice', name: 'Canais de Voz' }, { id: 'text', type: 'text', name: 'Canais de Texto' }], placements: {}, nicknames: {}, afk: { channelId: '', minutes: 15 } });
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const validName = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 30 && !/[\x00-\x1f\x7f]/.test(value);
export class ChannelExtras {
  constructor(directory) {
    this.file = directory ? path.join(directory, 'channel-extras.json') : null;
    this.data = defaults();
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(saved.categories)) {
        const seen = new Set(['voice', 'text']);
        for (const item of this.data.categories) { const stored = saved.categories.find(c => c.id === item.id); if (validName(stored?.name)) item.name = stored.name.trim(); }
        for (const c of saved.categories.slice(0, 100)) if (c && /^[a-f0-9-]{36}$/.test(c.id) && !seen.has(c.id) && ['voice', 'text'].includes(c.type) && validName(c.name)) { this.data.categories.push({ id: c.id, type: c.type, name: c.name.trim() }); seen.add(c.id); }
      }
      if (plain(saved.placements)) for (const [key,value] of Object.entries(saved.placements)) {
        if (/^(voice|text):[a-z0-9_-]{1,64}$/.test(key) && plain(value) && typeof value.categoryId === 'string' && Number.isSafeInteger(value.position) && value.position >= 0) this.data.placements[key] = { categoryId:value.categoryId, position:value.position };
      }
      if (plain(saved.nicknames)) for (const [identity,values] of Object.entries(saved.nicknames)) {
        if (!/^[a-z0-9_-]{1,128}$/i.test(identity) || identity === '__proto__' || !plain(values)) continue;
        const valid = Object.fromEntries(Object.entries(values).filter(([key,value]) => /^(call|text):[a-z0-9_-]{1,64}$/.test(key) && typeof value === 'string' && value.length <= 25 && !/[\x00-\x1f\x7f]/.test(value)));
        if (Object.keys(valid).length) this.data.nicknames[identity] = valid;
      }
      if (plain(saved.afk) && typeof saved.afk.channelId === 'string' && [5,10,15,30,60].includes(saved.afk.minutes)) this.data.afk = { channelId: saved.afk.channelId, minutes: saved.afk.minutes };
    } catch { /* Sem dados novos, os canais existentes continuam nos grupos padrão. */ }
  }
  change(action) {
    const previous = structuredClone(this.data);
    try {
      const result = action();
      if (this.file) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data), { mode: 0o600 }); fs.renameSync(this.file + '.tmp', this.file); }
      return result;
    } catch (error) { this.data = previous; throw error; }
  }
  categories(type) { return this.data.categories.filter(c => !type || c.type === type); }
  placement(type, id) {
    const stored = this.data.placements[`${type}:${id}`];
    const categoryId = this.categories(type).some(c => c.id === stored?.categoryId) ? stored.categoryId : type;
    return { categoryId, position: Number.isFinite(stored?.position) ? stored.position : 1e9 };
  }
  ordered(type, channels) {
    const cats = this.categories(type);
    return [...channels].sort((a,b) => cats.findIndex(c => c.id === this.placement(type,a.id).categoryId) - cats.findIndex(c => c.id === this.placement(type,b.id).categoryId)
      || this.placement(type,a.id).position - this.placement(type,b.id).position || (type === 'voice' ? (a.isDefault ? -1 : b.isDefault ? 1 : 0) : 0) || (a.createdAt || 0) - (b.createdAt || 0) || a.id.localeCompare(b.id));
  }
  categorySave({ id, type, name }) {
    if (!['voice','text'].includes(type) || !validName(name)) throw new Error('Escolha o tipo e um nome de 1 a 30 caracteres.');
    const current = id ? this.data.categories.find(c => c.id === id && c.type === type) : null;
    if (id && !current) throw new Error('Categoria indisponível.');
    if (!current && this.data.categories.length >= 100) throw new Error('Limite de categorias atingido.');
    return this.change(() => { if (current) current.name = name.trim(); else this.data.categories.push({ id: id = randomUUID(), type, name: name.trim() }); return id; });
  }
  nickname(identity, scope, channelId) { const item = this.data.nicknames[identity]?.[`${scope}:${channelId}`]; return typeof item === 'string' && item.length <= 25 ? item : ''; }
  setNickname(identity, scope, channelId, nickname) {
    if (!identity || typeof nickname !== 'string' || nickname.trim().length > 25 || /[\x00-\x1f\x7f]/.test(nickname)) throw new Error('Use um apelido de até 25 caracteres.');
    this.change(() => {
      const key = `${scope}:${channelId}`, current = this.data.nicknames[identity] || {};
      if (!Object.hasOwn(current, key) && Object.keys(current).length >= 1000) throw new Error('Limite de apelidos atingido.');
      if (nickname.trim()) this.data.nicknames[identity] = { ...current, [key]: nickname.trim() };
      else { delete current[key]; if (!Object.keys(current).length) delete this.data.nicknames[identity]; }
    });
  }
  removeChannel(type, id) {
    this.change(() => {
      delete this.data.placements[`${type}:${id}`];
      for (const nicknames of Object.values(this.data.nicknames)) delete nicknames[`${type === 'voice' ? 'call' : 'text'}:${id}`];
      if (type === 'voice' && this.data.afk.channelId === id) this.data.afk.channelId = '';
    });
  }
}
