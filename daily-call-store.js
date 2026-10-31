import fs from 'node:fs';
import path from 'node:path';
import { callDay, CALL_TIME_ZONE } from './public/call-time.js';

export class DailyCallStore {
  constructor(directory = '', now = () => Date.now()) {
    this.now = now; this.file = directory ? path.join(directory, 'daily-call-time.json') : null;
    this.window = callDay(now()); this.totals = new Map(); this.active = new Map(); this.sessions = new Map();
    this.byChannel = new Map(); this.sessionChannels = new Map();
    if (!this.file) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved.day === this.window.day && saved.timeZone === CALL_TIME_ZONE && saved.totals && typeof saved.totals === 'object' && !Array.isArray(saved.totals)) {
        for (const [id, value] of Object.entries(saved.totals)) if (/^[a-z0-9_-]{1,128}$/i.test(id) && Number.isFinite(value) && value >= 0) this.totals.set(id, Math.min(value, this.window.endsAt - this.window.startsAt));
        if (saved.channelTotals && typeof saved.channelTotals === 'object' && !Array.isArray(saved.channelTotals)) {
          for (const [channelId, totals] of Object.entries(saved.channelTotals)) {
            if (!/^[a-z0-9_-]{1,64}$/.test(channelId) || !totals || typeof totals !== 'object' || Array.isArray(totals)) continue;
            const channel = this.channel(channelId);
            for (const [id, value] of Object.entries(totals)) if (/^[a-z0-9_-]{1,128}$/i.test(id) && Number.isFinite(value) && value >= 0) channel.totals.set(id, Math.min(value, this.window.endsAt - this.window.startsAt));
          }
        }
      }
    } catch (error) {
      if (this.file && error.code !== 'ENOENT') console.warn('[Tempo na call] Não consegui carregar o total salvo do dia.');
    }
  }
  channel(id) {
    if (!this.byChannel.has(id)) this.byChannel.set(id, new DailyCallStore('', () => this.now()));
    return this.byChannel.get(id);
  }
  advance(now) {
    if (now >= this.window.startsAt && now < this.window.endsAt) return;
    const window = callDay(now);
    if (window.day === this.window.day) return;
    this.window = window; this.totals.clear();
    for (const entry of this.active.values()) entry.from = window.startsAt;
    for (const channel of this.byChannel.values()) channel.advance(now);
  }
  settle(id, now) {
    const entry = this.active.get(id);
    if (!entry) return;
    const total = (this.totals.get(id) || 0) + Math.max(0, now - entry.from);
    this.totals.set(id, Math.min(total, this.window.endsAt - this.window.startsAt)); entry.from = now;
  }
  join(id, session, now = this.now(), channelId = null) {
    this.advance(now);
    if (!id || this.sessions.has(session)) return;
    if (typeof channelId === 'string' && /^[a-z0-9_-]{1,64}$/.test(channelId)) {
      this.channel(channelId).join(id, session, now);
      this.sessionChannels.set(session, channelId);
    }
    let entry = this.active.get(id);
    if (!entry) { entry = { from: now, sessions: new Set() }; this.active.set(id, entry); }
    entry.sessions.add(session); this.sessions.set(session, id); this.checkpoint(now);
  }
  joinChannel(id, session, channelId, now = this.now()) {
    this.join(id, session, now, channelId);
  }
  leave(session, now = this.now()) {
    this.advance(now); const id = this.sessions.get(session); if (!id) return;
    const channelId = this.sessionChannels.get(session);
    if (channelId) { this.byChannel.get(channelId)?.leave(session, now); this.sessionChannels.delete(session); }
    this.settle(id, now); const entry = this.active.get(id);
    entry.sessions.delete(session); this.sessions.delete(session); if (!entry.sessions.size) this.active.delete(id);
    this.checkpoint(now);
  }
  snapshot(id, now = this.now()) {
    this.advance(now); const entry = this.active.get(id);
    return { day: this.window.day, timeZone: CALL_TIME_ZONE, serverTime: now, dayEndsAt: this.window.endsAt,
      elapsedMs: Math.min((this.totals.get(id) || 0) + (entry ? Math.max(0, now - entry.from) : 0), this.window.endsAt - this.window.startsAt), running: Boolean(entry) };
  }
  snapshotChannel(id, channelId, now = this.now()) {
    this.advance(now);
    const time = this.byChannel.get(channelId)?.snapshot(id, now) || {
      day: this.window.day, timeZone: CALL_TIME_ZONE, serverTime: now, dayEndsAt: this.window.endsAt, elapsedMs: 0, running: false
    };
    return { ...time, scope: 'channel', channelId };
  }
  removeChannel(channelId, now = this.now()) {
    for (const [session, id] of this.sessionChannels) if (id === channelId) this.leave(session, now);
    this.byChannel.delete(channelId); this.checkpoint(now);
  }
  merge(oldId, newId, now = this.now()) {
    this.advance(now);
    if (oldId === newId) return;
    for (const channel of this.byChannel.values()) channel.merge(oldId, newId, now);
    if (!this.totals.has(oldId) && !this.active.has(oldId)) { if (this.byChannel.size) this.checkpoint(now); return; }
    this.settle(oldId, now); if (newId) this.settle(newId, now);
    if (newId) {
      this.totals.set(newId, Math.min((this.totals.get(newId) || 0) + (this.totals.get(oldId) || 0), this.window.endsAt - this.window.startsAt));
      const old = this.active.get(oldId);
      if (old) {
        const current = this.active.get(newId) || { from: now, sessions: new Set() };
        for (const session of old.sessions) { current.sessions.add(session); this.sessions.set(session, newId); }
        this.active.set(newId, current);
      }
    }
    if (!newId) for (const session of this.active.get(oldId)?.sessions || []) { this.sessions.delete(session); this.sessionChannels.delete(session); }
    this.totals.delete(oldId); this.active.delete(oldId); this.checkpoint(now);
  }
  checkpoint(now = this.now()) {
    this.advance(now); for (const id of this.active.keys()) this.settle(id, now);
    for (const channel of this.byChannel.values()) channel.checkpoint(now);
    if (!this.file) return true;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', JSON.stringify({ version: 2, day: this.window.day, timeZone: CALL_TIME_ZONE, totals: Object.fromEntries(this.totals),
        channelTotals: Object.fromEntries([...this.byChannel].map(([id, channel]) => [id, Object.fromEntries(channel.totals)])) }), { mode: 0o600 });
      fs.renameSync(this.file + '.tmp', this.file); return true;
    } catch { console.warn('[Tempo na call] Não consegui salvar o total do dia.'); return false; }
  }
}
