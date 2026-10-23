const RNNOISE_DIR = '/vendor/noise-suppressor';
let rnnoiseBinary;

// A faixa inteira é mono. Um worklet estéreo com só o canal esquerdo perde 6 dB ao virar mono.
export async function createMicrophonePipeline(raw, { useRnnoise = false, gain = 1, automatic = true, onLevel, onStop } = {}) {
  const safeGain = (value) => Number.isFinite(value) ? Math.max(0, Math.min(3, value)) : 1;
  gain = safeGain(gain);
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  let denoiser, processor, fallbackGain;
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
    let automaticAvailable = true;
    try {
      await ctx.audioWorklet.addModule(new URL('./microphone-worklet.js', import.meta.url));
      processor = new AudioWorkletNode(ctx, 'teletela-microphone', {
        channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1],
        parameterData: { gain, automatic: automatic ? 1 : 0 }
      });
      processor.port.onmessage = (event) => onLevel?.(event.data);
      tail.connect(processor);
      tail = processor;
    } catch (err) {
      console.warn('[Mic] Ajuste automático indisponível; usando ganho manual em mono:', err);
      automaticAvailable = false;
      fallbackGain = ctx.createGain();
      fallbackGain.gain.value = gain;
      const limiter = ctx.createWaveShaper();
      const curve = new Float32Array(4097);
      const ceiling = 10 ** (-1 / 20);
      for (let i = 0; i < curve.length; i++) curve[i] = Math.max(-ceiling, Math.min(ceiling, i * 2 / (curve.length - 1) - 1));
      limiter.curve = curve;
      tail.connect(fallbackGain).connect(limiter);
      tail = limiter;
    }
    const dest = ctx.createMediaStreamDestination();
    dest.channelCount = 1;
    dest.channelCountMode = 'explicit';
    tail.connect(dest);
    await ctx.resume();
    const track = dest.stream.getAudioTracks()[0];
    track.contentHint = 'speech';
    let stopped = false;
    const stopTrack = track.stop.bind(track);
    const stop = () => {
      if (stopped) return;
      stopped = true;
      stopTrack();
      raw.getTracks().forEach((input) => input.stop());
      denoiser?.destroy();
      if (processor) { processor.port.onmessage = null; processor.disconnect(); processor.port.close(); }
      source.disconnect();
      ctx.close().catch(() => {});
      onStop?.();
    };
    track.stop = stop;
    raw.getAudioTracks().forEach((input) => input.addEventListener('ended', stop, { once: true }));
    return {
      stream: dest.stream, automaticAvailable, stop,
      setGain(value) { (processor?.parameters.get('gain') || fallbackGain.gain).setTargetAtTime(safeGain(value), ctx.currentTime, 0.02); },
      setAutomatic(value) { processor?.parameters.get('automatic').setValueAtTime(value ? 1 : 0, ctx.currentTime); }
    };
  } catch (err) {
    denoiser?.destroy();
    ctx.close().catch(() => {});
    throw err;
  }
}
