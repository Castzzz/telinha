export const PRESENCE_LABELS = { online: 'Online', away: 'Ausente', dnd: 'Não perturbe', offline: 'Offline' };
export const PRESENCE_IDLE_MS = 5 * 60000;
export function normalizePresence(value) { return Object.hasOwn(PRESENCE_LABELS, value) ? value : 'online'; }
export function savedPresence(prefs) { return normalizePresence(prefs.presence ?? (prefs.invisible ? 'offline' : 'online')); }
export function effectivePresence(user) {
  const selected = normalizePresence(user?.presence ?? (user?.invisible ? 'offline' : 'online'));
  return selected === 'online' && user?.automaticAway ? 'away' : selected;
}
export function presencePriority(value) { return ({ offline: 0, away: 1, online: 2, dnd: 3 })[value] ?? 0; }
