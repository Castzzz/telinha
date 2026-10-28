import fs from 'node:fs';
import path from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';

export const DICE_HISTORY_LIMIT = 30;
export function parseDice(input) {
  const match = typeof input === 'string' && /^(\d{1,3})?d(\d{1,5})([+-]\d{1,5})?$/i.exec(input.trim());
  if (!match) throw new Error('Use uma rolagem como 1d20, 2d6 ou 1d15+3.');
  const count = Number(match[1] || 1), sides = Number(match[2]), modifier = Number(match[3] || 0);
  if (count < 1 || count > 100 || sides < 2 || sides > 10000 || Math.abs(modifier) > 10000) {
    throw new Error('Use de 1 a 100 dados, de 2 a 10.000 lados e modificador de até 10.000.');
  }
  return { count, sides, modifier, notation: `${count}d${sides}${modifier ? `${modifier > 0 ? '+' : ''}${modifier}` : ''}` };
}

export class DiceStore {
  constructor(directory = '') {
    this.file = directory ? path.join(directory, 'dice.json') : null;
    this.histories = new Map();
    if (this.file && fs.existsSync(this.file)) {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.histories)) throw new Error('Histórico de dados inválido. Restaure o backup.');
      for (const [key, rolls] of data.histories) {
        if (!/^(text|voice):[a-z0-9_-]{1,64}$/.test(key) || !Array.isArray(rolls)) continue;
        this.histories.set(key, rolls.filter(roll => {
          try {
            const { count, sides, modifier } = parseDice(roll.notation);
            return typeof roll.id === 'string' && typeof roll.userName === 'string' && Number.isSafeInteger(roll.timestamp)
              && Array.isArray(roll.values) && roll.values.length === count && roll.values.every(v => Number.isInteger(v) && v >= 1 && v <= sides)
              && roll.total === roll.values.reduce((a, b) => a + b, modifier);
          } catch { return false; }
        }).slice(-DICE_HISTORY_LIMIT));
      }
    }
  }
  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify({ version: 1, histories: [...this.histories] }), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }
  history(key) { return structuredClone(this.histories.get(key) || []); }
  roll(key, input, user) {
    const dice = parseDice(input);
    const values = Array.from({ length: dice.count }, () => randomInt(1, dice.sides + 1));
    const roll = { id: randomUUID(), ...dice, values, total: values.reduce((a, b) => a + b, dice.modifier),
      userName: user.name, timestamp: Date.now() };
    const previous = this.histories.get(key);
    this.histories.set(key, [...(previous || []), roll].slice(-DICE_HISTORY_LIMIT));
    try { this.save(); }
    catch { if (previous) this.histories.set(key, previous); else this.histories.delete(key); throw new Error('Não deu para guardar a rolagem. Tente de novo.'); }
    return structuredClone(roll);
  }
  prune(keys) {
    let changed = false;
    for (const key of this.histories.keys()) if (!keys.has(key)) { this.histories.delete(key); changed = true; }
    if (changed) this.save();
  }
}

export function installDice({ io, store, permissions, channels, textChannels }) {
  const attempts = new Map();
  const context = (user, raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !['text', 'voice'].includes(raw.type)) return null;
    const ch = (raw.type === 'text' ? textChannels : channels).get(raw.channelId);
    return ch && permissions.visible(user, ch) && (raw.type === 'text' || user.channelId === ch.id)
      ? { ch, key: `${raw.type}:${ch.id}`, type: raw.type, channelId: ch.id } : null;
  };
  return socket => {
    const user = socket.data.user;
    socket.on('dice-history', (raw, callback) => {
      if (typeof callback !== 'function') return;
      const target = context(user, raw);
      callback(target ? { success: true, rolls: store.history(target.key), limit: DICE_HISTORY_LIMIT }
        : { success: false, error: 'Canal indisponível.', rolls: [] });
    });
    socket.on('dice-roll', (raw, callback) => {
      if (typeof callback !== 'function') return;
      const target = context(user, raw);
      if (!target || !permissions.canWrite(user, target.ch)) return callback({ success: false, error: 'Você não pode rolar dados neste canal.' });
      const now = Date.now(), recent = (attempts.get(user.accessId) || []).filter(time => now - time < 60000);
      if (recent.length >= 20 || (recent.length && now - recent.at(-1) < 500)) return callback({ success: false, error: 'Espere um pouco antes de rolar de novo.' });
      // Também limita entradas inválidas, antes de interpretar ou sortear.
      recent.push(now); attempts.set(user.accessId, recent);
      if (attempts.size > 1000) for (const [id, times] of attempts) if (now - times.at(-1) > 60000) attempts.delete(id);
      try {
        const roll = store.roll(target.key, raw.notation, user);
        for (const client of io.sockets.sockets.values()) {
          if (permissions.visible(client.data.user, target.ch) && (target.type === 'text' || client.data.user.channelId === target.ch.id)) {
            client.emit('dice-rolled', { type: target.type, channelId: target.channelId, roll });
          }
        }
        callback({ success: true, roll });
      } catch (err) { callback({ success: false, error: err.message }); }
    });
  };
}
