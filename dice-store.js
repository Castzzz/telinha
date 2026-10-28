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
    this.rolls = [];
    if (!this.file || !fs.existsSync(this.file)) return;
    const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (data.version === 1 && Array.isArray(data.histories)) {
      // O histórico antigo podia ser privado: preserva a cópia sem publicá-lo na sala.
      const backup = this.file + '.por-canal-v1';
      if (!fs.existsSync(backup)) fs.copyFileSync(this.file, backup, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(backup, 0o600);
      this.save();
      return;
    }
    if (data.version !== 2 || !Array.isArray(data.rolls)) throw new Error('Histórico de dados inválido. Restaure o backup.');
    this.rolls = data.rolls.filter(roll => {
      try {
        const { count, sides, modifier } = parseDice(roll.notation);
        return typeof roll.id === 'string' && typeof roll.userName === 'string' && Number.isSafeInteger(roll.timestamp)
          && Array.isArray(roll.values) && roll.values.length === count && roll.values.every(v => Number.isInteger(v) && v >= 1 && v <= sides)
          && roll.total === roll.values.reduce((a, b) => a + b, modifier);
      } catch { return false; }
    }).slice(-DICE_HISTORY_LIMIT);
  }
  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify({ version: 2, rolls: this.rolls }), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }
  history() { return structuredClone(this.rolls); }
  roll(input, user) {
    const dice = parseDice(input);
    const values = Array.from({ length: dice.count }, () => randomInt(1, dice.sides + 1));
    const roll = { id: randomUUID(), ...dice, values, total: values.reduce((a, b) => a + b, dice.modifier),
      userName: user.name, timestamp: Date.now() };
    const previous = this.rolls;
    this.rolls = [...previous, roll].slice(-DICE_HISTORY_LIMIT);
    try { this.save(); }
    catch { this.rolls = previous; throw new Error('Não deu para guardar a rolagem. Tente de novo.'); }
    return structuredClone(roll);
  }
}

export function installDice({ io, store }) {
  const attempts = new Map();
  return socket => {
    const user = socket.data.user;
    socket.on('dice-history', (_raw, callback) => {
      if (typeof callback === 'function') callback({ success: true, scope: 'server', rolls: store.history(), limit: DICE_HISTORY_LIMIT });
    });
    socket.on('dice-roll', (raw, callback) => {
      if (typeof callback !== 'function') return;
      const now = Date.now(), recent = (attempts.get(user.accessId) || []).filter(time => now - time < 60000);
      if (recent.length >= 20 || (recent.length && now - recent.at(-1) < 500)) return callback({ success: false, error: 'Espere um pouco antes de rolar de novo.' });
      recent.push(now); attempts.set(user.accessId, recent);
      if (attempts.size > 1000) for (const [id, times] of attempts) if (now - times.at(-1) > 60000) attempts.delete(id);
      try {
        const roll = store.roll(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.notation : null, user);
        // Só nome, dado e resultado: nenhuma referência ao canal privado de origem.
        io.emit('dice-rolled', { scope: 'server', roll });
        callback({ success: true, scope: 'server', roll });
      } catch (err) { callback({ success: false, error: err.message }); }
    });
  };
}
