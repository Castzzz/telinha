const $ = selector => document.querySelector(selector);
const audio = $('#audio');
let state = { phase: 'idle' };
let listening = false;
let generation = null;
audio.volume = 0.5;

async function post(route, body = {}) {
  const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível completar o pedido.');
  return data;
}

function message(selector, text, error = false) {
  const element = $(selector);
  element.textContent = text;
  element.classList.toggle('error', error);
}

function disconnectAudio() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  generation = null;
}

function connectAudio() {
  if (!listening || state.phase !== 'playing' || generation === state.generation) return;
  generation = state.generation;
  const attempt = generation;
  audio.src = `/api/live?generation=${encodeURIComponent(generation)}`;
  audio.play().catch(() => {
    if (generation !== attempt) return;
    listening = false;
    disconnectAudio();
    $('#listen').textContent = 'Clique para ouvir nesta janela';
    message('#broadcast-status', 'O navegador precisa de um clique para liberar o som nesta janela.');
  });
}

$('#listen').addEventListener('click', () => {
  listening = !listening;
  $('#listen').textContent = listening ? 'Desativar escuta nesta janela' : 'Ativar escuta nesta janela';
  if (listening) connectAudio();
  else disconnectAudio();
});
$('#volume').addEventListener('input', event => {
  audio.volume = Number(event.target.value) / 100;
  $('#volume-value').textContent = `${event.target.value}%`;
});
$('#theme').addEventListener('change', event => { document.documentElement.dataset.theme = event.target.value; });

$('#search-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('#search-button').disabled = true;
  $('#results').replaceChildren();
  message('#search-status', 'Identificando a faixa e procurando versões…');
  try {
    const result = await post('/api/resolve', { input: $('#music-input').value, refinement: $('#refinement').value });
    message('#search-status', `${result.source.title}. ${result.notice}${result.searchError ? ` Busca falhou: ${result.searchError}` : ''}`, Boolean(result.searchError));
    for (const track of result.candidates) {
      const card = document.createElement('article');
      card.className = 'track';
      const info = document.createElement('div');
      const title = document.createElement('a');
      title.href = track.url;
      title.target = '_blank';
      title.rel = 'noopener noreferrer';
      title.textContent = track.title;
      const description = document.createElement('p');
      const duration = Number.isFinite(track.duration) ? ` · ${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, '0')}` : '';
      description.textContent = `YouTube · ${track.author}${duration}`;
      info.append(title, description);
      const button = document.createElement('button');
      button.textContent = 'Tocar para todos';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await post('/api/play', { url: track.url, title: track.title });
          message('#search-status', 'Áudio preparado. Ative a escuta em cada janela para conferir a transmissão.');
        } catch (error) { message('#search-status', `O áudio não tocou: ${error.message}`, true); }
        finally { button.disabled = false; }
      });
      card.append(info, button);
      $('#results').append(card);
    }
  } catch (error) { message('#search-status', error.message, true); }
  finally { $('#search-button').disabled = false; }
});

$('#stop').addEventListener('click', async () => {
  try { await post('/api/stop'); } catch (error) { message('#broadcast-status', error.message, true); }
});
const events = new EventSource('/api/events');
events.onmessage = event => {
  state = JSON.parse(event.data);
  $('#listeners').textContent = `${state.listeners} ${state.listeners === 1 ? 'ouvinte' : 'ouvintes'}`;
  $('#now-playing').textContent = state.track?.title || 'Nenhuma música tocando';
  $('#stop').disabled = !['playing', 'preparing'].includes(state.phase);
  if (state.phase === 'playing') {
    message('#broadcast-status', 'O bot está transmitindo uma única reprodução para todos os ouvintes.');
    connectAudio();
  } else if (state.phase === 'ended') {
    // Deixar o navegador tocar os últimos blocos já recebidos.
    message('#broadcast-status', 'A transmissão terminou. Você pode escolher outra música.');
  } else {
    disconnectAudio();
    const text = state.phase === 'preparing' ? 'Preparando o áudio no servidor… Isso pode levar até dois minutos.'
      : state.phase === 'error' ? state.error : 'Escolha uma versão acima e clique em Tocar para todos.';
    message('#broadcast-status', text, state.phase === 'error');
  }
};
events.onerror = () => {
  disconnectAudio();
  message('#broadcast-status', 'Conexão com o laboratório perdida. Tentando reconectar…', true);
};
audio.addEventListener('error', () => {
  if (state.phase === 'playing' && listening) {
    generation = null;
    message('#broadcast-status', 'Não foi possível ouvir a transmissão. Desative e ative a escuta para tentar novamente.', true);
  }
});
fetch('/api/health').then(response => response.json()).then(data => {
  const missing = data.tools.filter(tool => !tool.ok);
  message('#tools-status', missing.length ? `Ferramentas pendentes: ${missing.map(tool => tool.name).join(', ')}. Rode npm run music:setup e confira Python e FFmpeg.`
    : 'Ferramentas prontas · yt-dlp + FFmpeg · servidor local', Boolean(missing.length));
}).catch(() => message('#tools-status', 'Não foi possível conferir as ferramentas.', true));
