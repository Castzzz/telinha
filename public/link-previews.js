import { medalClipId, youtubeVideoId } from './chat-links.js';

const cache = new Map();
let socket, supported = false;

export function setupLinkPreviews(connection) {
  if (!customElements.get('chat-link-preview')) registerCards();
  socket = connection;
  socket.on('room-info', info => { supported = info?.linkPreviews === true; });
  socket.on('disconnect', () => { supported = false; cache.clear(); });
}

function metadata(url) {
  if (!supported || !socket?.connected) return null;
  const key = url.href;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.request;
  const request = socket.timeout(7500).emitWithAck('link-preview', key).catch(() => null);
  if (cache.size >= 64) cache.delete(cache.keys().next().value);
  cache.set(key, { request, until: Date.now() + 5 * 60_000 });
  return request;
}

function registerCards() {
  const visible = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      visible.unobserve(target);
      target.load();
    }
  }, { rootMargin: '120px' });

  class ChatLinkPreview extends HTMLElement {
    connectedCallback() { visible.observe(this); }
    disconnectedCallback() { visible.unobserve(this); }

    async load() {
      const link = this.querySelector('a.link-preview-card');
      const url = new URL(link.href);
      const id = youtubeVideoId(url);
      const medal = medalClipId(url);
      const video = this.querySelector('video');
      if (medal && !video.hasAttribute('src')) {
        video.src = 'https://medal.tv/api/content/' + medal + '/socialVideoUrl';
      }
      if (id && !this.querySelector('img')) this.showImage('https://i.ytimg.com/vi/' + id + '/hqdefault.jpg');
      const destino = medal ? new URL('https://medal.tv/clips/' + medal) : url;
      const data = await metadata(id ? new URL('https://www.youtube.com/watch?v=' + id) : destino);
      if (!data || !this.isConnected) return;
      const log = this.closest('#chat-messages, #dm-log');
      const atEnd = log && log.scrollHeight - log.clientHeight - log.scrollTop < 8;
      if (typeof data.title === 'string' && data.title) link.querySelector('strong').textContent = data.title;
      if (typeof data.description === 'string' && data.description) {
        link.querySelector('.link-preview-detail').textContent = data.description;
      }
      if (!id && typeof data.image === 'string' && data.image.length < 360_000
        && /^data:image\/(?:png|jpeg|webp|gif);base64,/.test(data.image)) {
        if (video) video.poster = data.image;
        else this.showImage(data.image);
      }
      if (atEnd) log.scrollTop = log.scrollHeight;
    }

    showImage(src) {
      const frame = this.querySelector('.link-preview-media');
      const img = document.createElement('img');
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => { frame.hidden = true; };
      frame.replaceChildren(img);
      frame.hidden = false;
      img.src = src;
    }
  }
  customElements.define('chat-link-preview', ChatLinkPreview);
}

export function attachLinkPreview(body) {
  const source = body?.querySelector('a.chat-link');
  if (!source) return;
  const url = new URL(source.href);
  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return;
  const id = youtubeVideoId(url);
  const medal = medalClipId(url);
  const card = document.createElement('chat-link-preview');
  const link = source.cloneNode(false);
  link.className = 'link-preview-card';
  link.innerHTML = `<span class="link-preview-media" hidden></span>
    <span class="link-preview-copy"><small></small><strong></strong><span class="link-preview-detail"></span></span>
    <svg class="icon-svg link-preview-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>`;
  const host = url.host.replace(/^www\./, '');
  link.querySelector('small').textContent = medal ? 'Medal' : id ? 'YouTube' : host;
  let path = url.pathname.split('/').filter(Boolean).at(-1) || '';
  try { path = decodeURIComponent(path); } catch { /* Mantém o caminho como foi enviado. */ }
  link.querySelector('strong').textContent = medal ? 'Abrir clipe no Medal' : id ? 'Assistir no YouTube' : (path || 'Abrir site');
  if (id) {
    card.classList.add('link-preview-video');
    link.querySelector('.link-preview-media').hidden = false;
  }
  if (medal) {
    card.classList.add('link-preview-medal');
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.setAttribute('aria-label', 'Reproduzir clipe do Medal');
    video.addEventListener('error', () => {
      video.hidden = true;
      const aviso = document.createElement('span');
      aviso.className = 'link-preview-error';
      aviso.textContent = 'Não deu para carregar o vídeo. Abra o clipe no Medal.';
      video.after(aviso);
    }, { once: true });
    card.append(video);
  }
  card.append(link);
  body.after(card);
}
