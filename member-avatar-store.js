import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeImageCrop } from './public/image-crop.js';

const ID = /^[a-f0-9-]{36}$/;
const MIME = /^image\/(png|jpeg|webp|gif)$/;
const MAX_FILE = 15 * 1024 * 1024;
const MAX_TOTAL = 256 * 1024 * 1024;

// Última foto por identidade; o histórico guarda só a referência, inclusive para visitantes.
export class MemberAvatarStore {
  constructor(directory) {
    this.directory = directory ? path.join(directory, 'member-avatars') : null;
    this.entries = new Map();
    this.media = new Map();
    if (!this.directory) return;
    try {
      for (const file of fs.readdirSync(this.directory)) {
        const id = file.replace(/\.json$/, '');
        if (!ID.test(id) || file !== `${id}.json`) continue;
        try {
          const size = fs.statSync(this.file(id)).size;
          if (size > MAX_FILE) continue;
          const saved = JSON.parse(fs.readFileSync(this.file(id), 'utf8'));
          if (typeof saved.profileId !== 'string' || !Number.isSafeInteger(saved.version) || (saved.mime && !MIME.test(saved.mime))) continue;
          const { data, ...metadata } = saved;
          this.entries.set(id, { ...metadata, size });
        } catch { /* Um arquivo inválido não impede ler as outras fotos. */ }
      }
    } catch { /* A pasta só é criada quando o primeiro perfil envia uma foto. */ }
  }
  file(id) { return path.join(this.directory, `${id}.json`); }
  info(id) { return this.entries.get(id) || null; }
  memberForProfile(profileId) {
    const matches = [...this.entries].filter(([, item]) => item.profileId === profileId);
    return matches.length === 1 ? matches[0][0] : null;
  }
  set(user) {
    const id = user.accessId;
    if (!ID.test(id) || !user.profileId) return;
    const crop = normalizeImageCrop(user.avatarCrop), previous = this.info(id);
    const bytes = user.avatar?.data;
    const hash = bytes ? createHash('sha256').update(bytes).update(JSON.stringify(crop)).digest('hex') : '';
    if (previous?.hash === hash && previous.profileId === user.profileId) return;
    const record = { profileId: user.profileId, crop, hash, mime: user.avatar?.mime || '',
      version: bytes ? Math.max(Date.now(), (previous?.version || 0) + 1) : 0, data: bytes?.toString('base64') || '' };
    const serialized = JSON.stringify(record), size = Buffer.byteLength(serialized);
    const total = [...this.entries.values()].reduce((sum, item) => sum + item.size, 0);
    if (size > MAX_FILE || total - (previous?.size || 0) + size > MAX_TOTAL) throw new Error('Limite do arquivo de avatares atingido.');
    if (this.directory) {
      fs.mkdirSync(this.directory, { recursive: true });
      fs.writeFileSync(this.file(id) + '.tmp', serialized, { mode: 0o600 });
      fs.renameSync(this.file(id) + '.tmp', this.file(id));
    }
    const { data, ...metadata } = record;
    this.entries.set(id, { ...metadata, size, ...(this.directory ? {} : { data }) });
    this.media.delete(id);
  }
  read(id) {
    const info = this.info(id);
    if (!info?.mime) return null;
    const cached = this.media.get(id);
    if (cached) { this.media.delete(id); this.media.set(id, cached); return cached; }
    try {
      const record = this.directory ? JSON.parse(fs.readFileSync(this.file(id), 'utf8')) : info;
      const result = { mime: info.mime, data: Buffer.from(record.data, 'base64') };
      let used = [...this.media.values()].reduce((sum, item) => sum + item.data.length, 0);
      while (used + result.data.length > 32 * 1024 * 1024 && this.media.size) { const key = this.media.keys().next().value; used -= this.media.get(key).data.length; this.media.delete(key); }
      this.media.set(id, result);
      return result;
    } catch { return null; }
  }
}
