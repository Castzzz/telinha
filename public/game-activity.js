export function activityElapsed(startedAt, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - startedAt) / 60000));
  if (minutes < 1) return 'há menos de 1 min';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `há ${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}

const ACTIVITY_LABELS = { playing: 'Jogando', studying: 'Estudando', working: 'Trabalhando', watching: 'Assistindo', listening: 'Ouvindo', custom: '' };

export function activityLabel(activity) {
  const prefix = ACTIVITY_LABELS[activity?.type || 'playing'] || '';
  const name = activity?.name || '';
  return name === prefix ? name : [prefix, name].filter(Boolean).join(' ');
}

export function manualActivityFor(type, text = '', startedAt = Date.now()) {
  if (!Object.hasOwn(ACTIVITY_LABELS, type)) return null;
  const name = type === 'custom' ? text.trim().slice(0, 80) : ACTIVITY_LABELS[type];
  return name ? { id: 'manual', type, name, startedAt } : null;
}
