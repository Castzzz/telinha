const RNNOISE_DIR = '/vendor/noise-suppressor';
let rnnoiseBinary;
let gtcrnBinary;

const safeGain = (value) => Number.isFinite(value) ? Math.max(0, Math.min(3, value)) : 1;

async function createDenoiser(ctx, filter, wasmBinary) {
  const node = new AudioWorkletNode(ctx, 'teletela/noise-filter', {
    channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1],
    processorOptions: { filter, wasmBinary }
  });
  node.destroy = () => { node.port.postMessage('destroy'); node.port.close(); node.disconnect(); };
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('A IA demorou para carregar.')), 5000);
      const finish = error => {
        clearTimeout(timeout); node.port.onmessage = null; node.onprocessorerror = null;
        error ? reject(error) : resolve();
      };
      node.port.onmessage = event => {
        if (event.data?.type === 'ready') finish();
        else if (event.data?.type === 'error') finish(new Error('Não foi possível iniciar a IA.'));
      };
      node.onprocessorerror = () => finish(new Error('Não foi possível iniciar o filtro de voz.'));
    });
    return node;
  } catch (error) { node.destroy(); throw error; }
}

// O reforço fica depois do filtro: não amplia as teclas antes da separação da voz.
export async function createMicrophonePipeline(raw, { noiseFilter = 'off', gain = 1, boost = true, onStop, onFallback } = {}) {
  const requestedFilter = noiseFilter;
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  let denoiser;
  try {
    const source = ctx.createMediaStreamSource(raw);
    const mono = ctx.createGain();
    mono.channelCount = 1;
    mono.channelCountMode = 'explicit';
    source.connect(mono);
    let tail = mono;
    if (noiseFilter === 'ia' || noiseFilter === 'rnnoise') {
      const rnnoise = await import(`${RNNOISE_DIR}/index.js`);
      await ctx.audioWorklet.addModule('/noise-processor.js');
      if (noiseFilter === 'ia') {
        try {
          gtcrnBinary ||= await rnnoise.loadGtcrn({ url: `${RNNOISE_DIR}/gtcrn.wasm` });
          denoiser = await createDenoiser(ctx, 'ia', gtcrnBinary);
        } catch (error) {
          gtcrnBinary = undefined;
          console.warn('[Mic] IA forte indisponível; tentando a IA leve:', error);
          noiseFilter = 'rnnoise';
        }
      }
      if (noiseFilter === 'rnnoise') {
        rnnoiseBinary ||= await rnnoise.loadRnnoise({ url: `${RNNOISE_DIR}/rnnoise.wasm`, simdUrl: `${RNNOISE_DIR}/rnnoise_simd.wasm` });
        try { denoiser = await createDenoiser(ctx, 'rnnoise', rnnoiseBinary); }
        catch (error) { rnnoiseBinary = undefined; throw error; }
        if (requestedFilter === 'ia') onFallback?.();
      }
      tail.connect(denoiser);
      tail = denoiser;
    }

    // Compressão nativa: reforça entradas fracas e contém as fortes, sem AGC do sistema.
    const voice = ctx.createDynamicsCompressor();
    voice.channelCount = 1;
    voice.channelCountMode = 'explicit';
    voice.threshold.value = boost ? -30 : 0;
    voice.knee.value = 12;
    voice.ratio.value = boost ? 4 : 1;
    voice.attack.value = 0.005;
    voice.release.value = 0.25;
    const manual = ctx.createGain();
    manual.gain.value = safeGain(gain);

    const peaks = ctx.createDynamicsCompressor();
    peaks.channelCount = 1;
    peaks.channelCountMode = 'explicit';
    peaks.threshold.value = -3;
    peaks.knee.value = 0;
    peaks.ratio.value = 20;
    peaks.attack.value = 0;
    peaks.release.value = 0.1;
    // Segura também transientes que escapem da compressão, principalmente em 300%.
    const ceiling = ctx.createWaveShaper();
    ceiling.curve = Float32Array.from({ length: 4097 }, (_, i) => Math.max(-0.95, Math.min(0.95, i / 2048 - 1)));
    const dest = ctx.createMediaStreamDestination();
    // RNNoise mono em destino estéreo deixava R vazio: o Opus mono perdia mais 6 dB.
    dest.channelCount = 1;
    dest.channelCountMode = 'explicit';
    tail.connect(voice).connect(manual).connect(peaks).connect(ceiling).connect(dest);
    await ctx.resume();

    const track = dest.stream.getAudioTracks()[0];
    track.contentHint = 'speech';
    const stopTrack = track.stop.bind(track);
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      stopTrack();
      raw.getTracks().forEach((input) => {
        input.removeEventListener('ended', stop);
        input.stop();
      });
      denoiser?.destroy();
      [source, mono, denoiser, voice, manual, peaks, ceiling].forEach((node) => node?.disconnect());
      ctx.close().catch(() => {});
      onStop?.();
    };
    track.stop = stop;
    raw.getAudioTracks().forEach((input) => input.addEventListener('ended', stop, { once: true }));
    return {
      stream: dest.stream, stop, noiseFilter,
      setGain(value) { if (!stopped) manual.gain.setTargetAtTime(safeGain(value), ctx.currentTime, 0.02); },
      setBoost(enabled) {
        if (stopped) return;
        voice.threshold.setTargetAtTime(enabled ? -30 : 0, ctx.currentTime, 0.02);
        voice.ratio.setTargetAtTime(enabled ? 4 : 1, ctx.currentTime, 0.02);
      }
    };
  } catch (err) {
    denoiser?.destroy();
    ctx.close().catch(() => {});
    throw err;
  }
}
