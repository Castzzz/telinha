export const CALL_TIME_ZONE = 'America/Sao_Paulo';
const DAY_MS = 86400000;
const dateFormat = new Intl.DateTimeFormat('en', { timeZone: CALL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const windows = new Map();
function dateKey(now) {
  const parts = Object.fromEntries(dateFormat.formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function callDay(now) {
  const day = dateKey(now);
  if (windows.has(day)) return windows.get(day);
  // Procura a virada pelo calendário do fuso, inclusive em datas com horário de verão.
  const boundary = next => {
    let low = now - 2 * DAY_MS, high = now + 2 * DAY_MS;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2), key = dateKey(middle);
      if (next ? key > day : key >= day) high = middle; else low = middle;
    }
    return high;
  };
  const value = { day, startsAt: boundary(false), endsAt: boundary(true), timeZone: CALL_TIME_ZONE };
  if (windows.size >= 8) windows.delete(windows.keys().next().value);
  windows.set(day, value); return value;
}
export function dailyCallElapsed(snapshot, age = 0) {
  const elapsed = Math.max(0, Number(snapshot.elapsedMs) || 0), delta = Math.max(0, Number(age) || 0);
  const now = snapshot.serverTime + delta;
  if (now < snapshot.dayEndsAt) return elapsed + (snapshot.running ? delta : 0);
  return snapshot.running ? Math.max(0, now - callDay(now).startsAt) : 0;
}
export function formatCallDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000)), hours = Math.floor(seconds / 3600);
  const minutes = String(Math.floor(seconds / 60) % 60).padStart(2, '0'), rest = String(seconds % 60).padStart(2, '0');
  return hours ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`;
}
export function createDailyCallClocks(now = () => performance.now()) {
  const clocks = new Map();
  const remember = (id, snapshot) => {
    if (typeof id !== 'string' || !snapshot || !Number.isFinite(snapshot.elapsedMs) || snapshot.elapsedMs < 0 || !Number.isFinite(snapshot.serverTime) || !Number.isFinite(snapshot.dayEndsAt) || typeof snapshot.running !== 'boolean') return;
    clocks.set(id, { snapshot: { ...snapshot }, receivedAt: now() });
  };
  return {
    remember,
    user(user) { if (user) remember(user.id, user.dailyCallTime); },
    replace(users) {
      const visible = new Set(users.map(user => user.id));
      for (const id of clocks.keys()) if (!visible.has(id)) clocks.delete(id);
      for (const user of users) this.user(user);
    },
    elapsed(id) { const clock = clocks.get(id); return clock ? dailyCallElapsed(clock.snapshot, now() - clock.receivedAt) : null; },
    scope(id) { return clocks.get(id)?.snapshot.scope; },
    freeze() {
      const stoppedAt = now();
      for (const clock of clocks.values()) {
        const age = Math.max(0, stoppedAt - clock.receivedAt), serverTime = clock.snapshot.serverTime + age;
        clock.snapshot = { ...clock.snapshot, ...callDay(serverTime), elapsedMs: dailyCallElapsed(clock.snapshot, age), serverTime, dayEndsAt: callDay(serverTime).endsAt, running: false };
        clock.receivedAt = stoppedAt;
      }
    }
  };
}
