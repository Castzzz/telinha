const RNNOISE_DIR = '/vendor/noise-suppressor';
let rnnoiseBinary;

const safeGain = value => Number.isFinite(value) ? Math.max(0, Math.min(3, value)) : 1;

// RNNoise opcional → ganho manual → saída mono, sem reforço automático.
export async function createMicrophonePipeline(raw, { noiseFilter = 'off', gain = 1, onStop } = {}) {
  let rnnoise;
  if (noiseFilter === 'rnnoise') {
    rnnoise = await import(`${RNNOISE_DIR}/index.js`);
    rnnoiseBinary ||= await rnnoise.loadRnnoise({
      url: `${RNNOISE_DIR}/rnnoise.wasm`, simdUrl: `${RNNOISE_DIR}/rnnoise_simd.wasm`
    });
  }
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  let denoiser;
  try {
    const source = ctx.createMediaStreamSource(raw);
    const manual = ctx.createGain();
    manual.channelCount = 1;
    manual.channelCountMode = 'explicit';
    manual.gain.value = safeGain(gain);
    if (rnnoise) {
      await ctx.audioWorklet.addModule(`${RNNOISE_DIR}/rnnoise/workletProcessor.js`);
      denoiser = new rnnoise.RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: rnnoiseBinary });
      // O filtro processa só um canal; saída estéreo deixava o outro vazio e perdia 6 dB.
      denoiser.channelCount = 1;
      denoiser.channelCountMode = 'explicit';
      source.connect(denoiser).connect(manual);
    } else source.connect(manual);
    const dest = ctx.createMediaStreamDestination();
    dest.channelCount = 1;
    dest.channelCountMode = 'explicit';
    manual.connect(dest);
    await ctx.resume();

    const track = dest.stream.getAudioTracks()[0];
    track.contentHint = 'speech';
    const stopTrack = track.stop.bind(track);
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      stopTrack();
      raw.getTracks().forEach(input => {
        input.removeEventListener('ended', stop);
        input.stop();
      });
      denoiser?.destroy();
      source.disconnect(); manual.disconnect();
      ctx.close().catch(() => {});
      onStop?.();
    };
    track.stop = stop;
    raw.getAudioTracks().forEach(input => input.addEventListener('ended', stop, { once: true }));
    return {
      stream: dest.stream, stop, noiseFilter,
      setGain(value) { if (!stopped) manual.gain.value = safeGain(value); }
    };
  } catch (error) {
    denoiser?.destroy();
    ctx.close().catch(() => {});
    throw error;
  }
}
