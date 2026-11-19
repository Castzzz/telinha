// Os limites são os mesmos no texto clicável e no cartão, inclusive em links entre parênteses.
export function* messageLinks(text) {
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"']+/gi)) {
    let label = match[0].replace(/[.,!?;:]+$/, '');
    for (const [open, close] of [['(', ')'], ['[', ']']]) {
      const extra = label.split(close).length - label.split(open).length;
      for (let i = 0; i < extra && label.endsWith(close); i++) label = label.slice(0, -1);
    }
    try {
      const url = new URL(label);
      yield { index: match.index, label, url };
    } catch { /* Endereço incompleto continua como texto. */ }
  }
}

export function youtubeVideoId(url) {
  if (url.port || url.username || url.password) return null;
  const host = url.hostname;
  let id;
  if (host === 'youtu.be') id = url.pathname.slice(1);
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v')
      : /^\/(?:shorts|live|embed)\/([\w-]+)\/?$/.exec(url.pathname)?.[1];
  }
  return /^[\w-]{11}$/.test(id || '') ? id : null;
}

export function medalClipId(url) {
  if (!['http:', 'https:'].includes(url.protocol) || url.port || url.username || url.password
    || !['medal.tv', 'www.medal.tv'].includes(url.hostname)) return null;
  return /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:games\/[\w-]+\/)?clips?\/([\w-]{1,128})\/?$/i.exec(url.pathname)?.[1] || null;
}
