export function activityElapsed(startedAt, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - startedAt) / 60000));
  if (minutes < 1) return 'há menos de 1 min';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `há ${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}
