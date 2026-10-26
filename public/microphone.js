const RNNOISE_DIR = '/vendor/noise-suppressor';
let rnnoiseBinary;

const safeGain = (value) => Number.isFinite(value) ? Math.max(0, Math.min(3, value)) : 1;

// O reforço fica depois do filtro: não muda a entrada que o RNNoise usa para remover ruído.
export async function createMicrophonePipeline(raw, { useRnnoise = false, gain = 1, boost = true, onStop } = {}) {
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  let denoiser;
  try {
    const source = ctx.createMediaStreamSource(raw);
    const mono = ctx.createGain();
    mono.channelCount = 1;
    mono.channelCountMode = 'explicit';
    source.connect(mono);
    let tail = mono;
    if (useRnnoise) {
      const rnnoise = await import(`${RNNOISE_DIR}/index.js`);
      rnnoiseBinary ||= await rnnoise.loadRnnoise({ url: `${RNNOISE_DIR}/rnnoise.wasm`, simdUrl: `${RNNOISE_DIR}/rnnoise_simd.wasm` });
      await ctx.audioWorklet.addModule(`${RNNOISE_DIR}/rnnoise/workletProcessor.js`);
      denoiser = new rnnoise.RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: rnnoiseBinary });
      denoiser.channelCount = 1;
      denoiser.channelCountMode = 'explicit';
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
      stream: dest.stream, stop,
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
