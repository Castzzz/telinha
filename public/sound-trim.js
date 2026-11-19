import { voiceWav } from './voice-clips.js';

export function setupSoundTrim({ socket, readAsDataUrl, showToast }) {
  const dialog = document.querySelector('#sound-trim');
  const form = dialog.querySelector('form');
  const { start, end, soundName } = form.elements;
  const audio = dialog.querySelector('audio');
  const status = dialog.querySelector('[role=status]');
  const save = form.querySelector('button');
  const rate = 24000; // Quinze segundos em WAV mono cabem no limite de 1 MB.
  let samples, blob, generation = 0;

  function preview() {
    audio.pause();
    URL.revokeObjectURL(audio.src);
    audio.removeAttribute('src');
    audio.load();
    blob = null;
    save.disabled = true;
    const a = Math.round(start.valueAsNumber * rate), b = Math.round(end.valueAsNumber * rate);
    if (!samples) return;
    if (!(a >= 0 && b > a && b <= samples.length && b - a <= 15 * rate)) {
      status.textContent = 'Escolha um trecho de até 15 segundos dentro do clipe.';
      return;
    }
    blob = new Blob([voiceWav(samples.subarray(a, b), rate)], { type: 'audio/wav' });
    audio.src = URL.createObjectURL(blob);
    status.textContent = '';
    save.disabled = false;
  }

  async function open(url, title) {
    const current = ++generation;
    samples = null;
    preview();
    status.textContent = 'Carregando clipe…';
    soundName.value = title.slice(0, 30);
    dialog.showModal();
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error();
      const ctx = new OfflineAudioContext(1, 1, rate);
      const decoded = await ctx.decodeAudioData(await response.arrayBuffer());
      if (generation !== current) return;
      samples = decoded.getChannelData(0);
      end.max = start.max = samples.length / rate;
      start.value = 0;
      end.value = Math.min(15, samples.length / rate);
      preview();
    } catch { if (generation === current) status.textContent = 'Não deu para carregar o clipe.'; }
  }

  document.querySelector('#clip-to-sound').onclick = () => {
    const player = document.querySelector('#voice-clip-preview');
    player.pause();
    if (player.src) open(player.src, document.querySelector('[name=clipTitle]').value);
  };
  document.addEventListener('click', event => {
    const button = event.target.closest('.trim-saved-clip');
    if (button) {
      const player = button.parentElement.querySelector('audio.chat-voice-clip');
      if (player) { player.pause(); open(player.src, ''); }
    }
  });
  start.oninput = end.oninput = preview;
  dialog.querySelector('.modal-close-btn').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { generation++; samples = null; preview(); });
  form.onsubmit = async event => {
    event.preventDefault();
    if (!blob || save.disabled) return;
    const current = generation;
    form.inert = true;
    status.textContent = 'Adicionando som…';
    try {
      const result = await socket.timeout(15000).emitWithAck('soundboard-add', {
        name: soundName.value.trim(), data: await readAsDataUrl(blob)
      });
      if (!result?.success) throw new Error(result?.error || 'Falha ao adicionar o som.');
      if (current === generation) dialog.close();
      showToast('Som adicionado ao soundboard.', 'success');
    } catch (err) { if (current === generation) status.textContent = err.message === 'operation has timed out' ? 'Envio sem confirmação. Confira o soundboard.' : err.message; }
    finally { form.inert = false; }
  };
}
