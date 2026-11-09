import { generateMicrophoneConstraints } from './audio-manager.js';
import { createMicrophonePipeline } from './microphone.js';

// A captura de teste é independente: não abre voz nem substitui a faixa enviada na call.
export function setupMicrophoneTest({ getOptions }) {
  const button = document.getElementById('btn-mic-test'), status = document.getElementById('mic-test-status');
  const meter = document.getElementById('mic-test-level');
  let generation = 0, phase = 'idle', raw, pipeline, recorder, context, player, url, timer, frame;
  const setPhase = (value, message) => {
    phase = value; button.dataset.phase = value;
    button.textContent = value === 'idle' ? 'Testar microfone' : value === 'loading' ? 'Cancelar' : 'Parar teste';
    status.textContent = message;
  };
  const stopCapture = () => {
    clearTimeout(timer); cancelAnimationFrame(frame);
    if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch {} }
    recorder = null;
    pipeline?.stop(); pipeline = null;
    raw?.getTracks().forEach(track => track.stop()); raw = null;
    context?.close().catch(() => {}); context = null;
    meter.style.width = '0%'; meter.parentElement.setAttribute('aria-valuenow', '0');
  };
  function stop(message = 'Teste encerrado.') {
    ++generation; stopCapture();
    if (player) { player.pause(); player.src = ''; player = null; }
    if (url) { URL.revokeObjectURL(url); url = null; }
    setPhase('idle', message);
  }
  async function start() {
    const run = ++generation;
    setPhase('loading', 'Aguardando o microfone…');
    const options = getOptions(), constraints = generateMicrophoneConstraints(options.deviceId);
    constraints.audio.noiseSuppression = options.noiseMode === 'basico';
    try {
      const captured = await navigator.mediaDevices.getUserMedia(constraints);
      if (run !== generation) { captured.getTracks().forEach(track => track.stop()); return; }
      raw = captured;
      const processed = await createMicrophonePipeline(captured, { noiseFilter: options.noiseMode === 'ia' ? 'rnnoise' : 'off', gain: options.gain });
      if (run !== generation) { processed.stop(); return; }
      pipeline = processed;
      context = new AudioContext(); await context.resume();
      if (run !== generation) return;
      const source = context.createMediaStreamSource(processed.stream), analyser = context.createAnalyser();
      analyser.fftSize = 512;
      const silent = context.createGain(); silent.gain.value = 0;
      source.connect(analyser).connect(silent).connect(context.destination);
      const samples = new Float32Array(analyser.fftSize), began = performance.now();
      const update = () => {
        if (run !== generation || phase !== 'recording') return;
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        const level = Math.max(0, Math.min(100, (20 * Math.log10(Math.max(rms, .00001)) + 60) / 60 * 100));
        meter.style.width = `${level}%`; meter.parentElement.setAttribute('aria-valuenow', String(Math.round(level)));
        const message = `Gravando… ${Math.max(1, Math.ceil(4 - (performance.now() - began) / 1000))} s`;
        if (status.textContent !== message) status.textContent = message;
        frame = requestAnimationFrame(update);
      };
      const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      const current = new MediaRecorder(processed.stream, mime ? { mimeType: mime } : undefined), chunks = [];
      recorder = current;
      current.ondataavailable = event => { if (run === generation && event.data.size) chunks.push(event.data); };
      current.onerror = () => { if (run === generation) stop('Não consegui gravar. Tente novamente.'); };
      current.onstop = async () => {
        if (run !== generation) return;
        const blob = new Blob(chunks, { type: current.mimeType });
        stopCapture();
        if (!blob.size) return stop('Não consegui gravar. Tente novamente.');
        url = URL.createObjectURL(blob); player = new Audio(url); player.volume = options.playbackVolume ?? .7;
        const audio = player;
        audio.onended = () => { if (run === generation) stop('Teste concluído.'); };
        audio.onerror = () => { if (run === generation) stop('Não consegui reproduzir o teste.'); };
        setPhase('playing', 'Reproduzindo só para você…');
        try {
          if (options.outputId && audio.setSinkId) await audio.setSinkId(options.outputId);
          if (run === generation) await audio.play();
        } catch { if (run === generation) stop('Não consegui reproduzir na saída escolhida.'); }
      };
      setPhase('recording', 'Gravando…'); current.start(); update();
      timer = setTimeout(() => { if (run === generation && current.state === 'recording') current.stop(); }, 4000);
    } catch (error) {
      if (run === generation) stop(error.name === 'NotAllowedError' ? 'Permita o microfone para fazer o teste.' : 'Não consegui abrir o microfone com esse filtro. Confira o dispositivo e tente novamente.');
    }
  }
  button.addEventListener('click', () => { if (phase === 'idle') start(); else stop(); });
  for (const id of ['select-audio-input', 'select-audio-output', 'select-noise-suppression']) document.getElementById(id)?.addEventListener('change', () => {
    if (phase !== 'idle') stop('Configuração alterada. Inicie outro teste.');
  });
  document.getElementById('input-mic-gain')?.addEventListener('input', () => pipeline?.setGain(getOptions().gain));
  document.getElementById('input-master-volume')?.addEventListener('input', () => { if (player) player.volume = getOptions().playbackVolume ?? .7; });
  const modal = document.getElementById('modal-settings'), section = document.querySelector('[data-settings-section="microfone"]');
  const closeIfHidden = () => { if (phase !== 'idle' && (modal.classList.contains('hidden') || section.classList.contains('hidden'))) stop(); };
  new MutationObserver(closeIfHidden).observe(modal, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(closeIfHidden).observe(section, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => { if (document.hidden && phase !== 'idle') stop(); });
  window.addEventListener('pagehide', () => stop());
  return { stop };
}
