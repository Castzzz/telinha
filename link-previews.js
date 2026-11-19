import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Parser } from 'htmlparser2';
import { youtubeVideoId } from './public/chat-links.js';

const CACHE_MS = 15 * 60_000;
const MAX_IMAGE = 256 * 1024;
const MAX_HTML = 128 * 1024;
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const cache = new Map(), pending = new Map();

function publicUrl(raw, base) {
  const url = new URL(raw, base);
  if (!['https:', 'http:'].includes(url.protocol) || url.port || url.username || url.password
    || !/^[a-z\d.-]+\.[a-z]{2,63}$/i.test(url.hostname) || isIP(url.hostname)
    || url.href.length > 2048) throw new Error('Endereço indisponível');
  url.hash = '';
  return url;
}

// A conexão usa o próprio endereço conferido, inclusive após um redirecionamento.
function lookupPublic(host, options, callback) {
  lookup(host + '.', { family: 4 }, (err, address) => {
    if (err || ipaddr.parse(address).range() !== 'unicast') return callback(err || new Error('Endereço reservado'));
    callback(null, address, 4);
  });
}

async function readResource(url, signal, accepted, redirects = 0) {
  const transport = url.protocol === 'https:' ? https : http;
  const res = await new Promise((resolve, reject) => {
    transport.get(url, { agent: false, family: 4, lookup: lookupPublic, signal,
      headers: { Accept: accepted.join(', '), 'User-Agent': 'Teletela-LinkPreview/1.0' }
    }, resolve).on('error', reject);
  });
  try {
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && redirects < 3 && res.headers.location) {
      return readResource(publicUrl(res.headers.location, url), signal, accepted, redirects + 1);
    }
    const type = (res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (res.statusCode !== 200 || !accepted.includes(type)) return null;
    const image = imageTypes.has(type), limit = image ? MAX_IMAGE : MAX_HTML;
    if (image && Number(res.headers['content-length']) > limit) return null;
    const chunks = [];
    let size = 0;
    for await (const chunk of res) {
      const remaining = limit - size;
      if (image && chunk.length > remaining) return null;
      chunks.push(chunk.subarray(0, remaining));
      size += chunk.length;
      if (!image && size >= limit) break;
    }
    return { url, type, buffer: Buffer.concat(chunks) };
  } finally { res.destroy(); }
}

function pageMetadata(html) {
  const meta = new Map();
  let title = '', inTitle = false;
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === 'body') parser.pause();
      if (name === 'title') inTitle = true;
      const key = (attrs.property || attrs.name || '').toLowerCase();
      if (name === 'meta' && attrs.content && !meta.has(key)) meta.set(key, attrs.content.trim());
    },
    ontext(text) { if (inTitle) title += text; },
    onclosetag(name) {
      if (name === 'title') inTitle = false;
      if (name === 'head') parser.pause();
    }
  });
  parser.end(html);
  return {
    title: meta.get('og:title') || meta.get('twitter:title') || title,
    description: meta.get('og:description') || meta.get('description') || meta.get('twitter:description'),
    image: meta.get('og:image') || meta.get('twitter:image')
  };
}

function imageData(resource) {
  return resource && `data:${resource.type};base64,${resource.buffer.toString('base64')}`;
}

const shortText = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

async function load(url) {
  const signal = AbortSignal.timeout(5500);
  const id = youtubeVideoId(url);
  if (id) {
    const endpoint = new URL('https://www.youtube.com/oembed');
    endpoint.searchParams.set('url', 'https://www.youtube.com/watch?v=' + id);
    endpoint.searchParams.set('format', 'json');
    const result = await readResource(endpoint, signal, ['application/json']);
    if (!result) return null;
    const data = JSON.parse(result.buffer.toString());
    return { title: shortText(data.title, 180), description: shortText(data.author_name, 100) };
  }
  const result = await readResource(url, signal, ['text/html', 'application/xhtml+xml', ...imageTypes]);
  if (!result) return null;
  if (imageTypes.has(result.type)) return { image: imageData(result) };
  const meta = pageMetadata(result.buffer.toString());
  let image = null;
  if (meta.image) {
    try { image = imageData(await readResource(publicUrl(meta.image, result.url), signal, [...imageTypes])); }
    catch { /* O título continua disponível se a capa falhar. */ }
  }
  return { title: shortText(meta.title, 180), description: shortText(meta.description, 280), image };
}

export async function getLinkPreview(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let url;
  try { url = publicUrl(raw); } catch { return null; }
  const key = url.href;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  if (pending.has(key)) return pending.get(key);
  if (pending.size >= 8) return null;
  const request = load(url).catch(() => null).then(value => {
    if (cache.size >= 64) cache.delete(cache.keys().next().value);
    cache.set(key, { value, until: Date.now() + (value ? CACHE_MS : 60_000) });
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
