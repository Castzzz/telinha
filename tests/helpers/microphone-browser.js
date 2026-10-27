import { createMicrophonePipeline } from '/microphone.js';
import { enhanceOpusVoiceSdp, VolumeMixerManager } from '/audio-manager.js';

const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const check = (ok, message) => { if (!ok) throw new Error(message); };
const db = (value) => 20 * Math.log10(Math.max(1e-7, value));

async function measure(ctx, stream, duration = 350) {
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const silent = ctx.createGain(); silent.gain.value = 0;
  analyser.connect(silent).connect(ctx.destination);
  const frame = new Float32Array(analyser.fftSize);
  let energy = 0, count = 0, peak = 0;
  const end = performance.now() + duration;
  while (performance.now() < end) {
    analyser.getFloatTimeDomainData(frame);
    for (const x of frame) { energy += x * x; count++; peak = Math.max(peak, Math.abs(x)); }
    await pause(20);
  }
  source.disconnect(); analyser.disconnect(); silent.disconnect();
  return { db: db(Math.sqrt(energy / count)), peak };
}

async function fixture({ noise = false, speech = false, useRnnoise = false, noiseFilter = useRnnoise ? 'rnnoise' : 'off', level = -38, gain = 1 } = {}) {
  const ctx = new AudioContext({ sampleRate: 48000 });
  let source;
  if (speech) {
    // Vogal sintética com harmônicos e sílabas; uma senoide pura pode ser removida pelo RNNoise.
    const buffer = ctx.createBuffer(1, 96000, 48000);
    const samples = buffer.getChannelData(0);
    let phase = 0, energy = 0;
    for (let i = 0; i < samples.length; i++) {
      const time = i / 48000;
      const pitch = 150 + 15 * Math.sin(2 * Math.PI * 1.7 * time);
      phase += 2 * Math.PI * pitch / 48000;
      let sample = 0;
      for (let harmonic = 1; harmonic < 30; harmonic++) {
        const hz = harmonic * pitch;
        const formant = Math.exp(-(((hz - 600) / 200) ** 2)) + .7 * Math.exp(-(((hz - 1100) / 250) ** 2)) + .3 * Math.exp(-(((hz - 2400) / 400) ** 2));
        sample += Math.sin(phase * harmonic) * (0.2 + formant) / harmonic;
      }
      samples[i] = sample * (0.1 + 0.9 * Math.sin(Math.PI * 3 * time) ** 2);
      energy += samples[i] ** 2;
    }
    const rms = Math.sqrt(energy / samples.length);
    for (let i = 0; i < samples.length; i++) samples[i] /= rms;
    source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
  } else if (noise) {
    const buffer = ctx.createBuffer(1, 48000, 48000);
    const samples = buffer.getChannelData(0);
    let seed = 42, previous = 0, energy = 0;
    // Ruído grave contínuo, como ventilação, sem gravar áudio de ninguém.
    for (let i = 0; i < samples.length; i++) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      previous = .97 * previous + .03 * (seed / 2 ** 31 - 1);
      samples[i] = previous; energy += previous * previous;
    }
    const rms = Math.sqrt(energy / samples.length);
    for (let i = 0; i < samples.length; i++) samples[i] /= rms;
    source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
  } else {
    source = ctx.createOscillator(); source.frequency.value = 220;
  }
  const volume = ctx.createGain(); volume.gain.value = 10 ** (level / 20) * (speech || noise ? 1 : Math.sqrt(2));
  const dest = ctx.createMediaStreamDestination(); dest.channelCount = 1;
  source.connect(volume).connect(dest); source.start();
  await ctx.resume();
  let stops = 0;
  const pipeline = await createMicrophonePipeline(dest.stream, { noiseFilter, gain, onStop: () => stops++ });
  await pause(1400);
  return { ctx, pipeline, volume, raw: dest.stream, get stops() { return stops; },
    async close() { pipeline.stop(); source.stop(); await ctx.close(); } };
}

async function peerStream(stream) {
  const a = new RTCPeerConnection({ iceServers: [] });
  const b = new RTCPeerConnection({ iceServers: [] });
  a.onicecandidate = e => { if (e.candidate) b.addIceCandidate(e.candidate).catch(() => {}); };
  b.onicecandidate = e => { if (e.candidate) a.addIceCandidate(e.candidate).catch(() => {}); };
  const received = new Promise(resolve => { b.ontrack = e => resolve(e.streams[0]); });
  a.addTrack(stream.getAudioTracks()[0], stream);
  const offer = await a.createOffer(); offer.sdp = enhanceOpusVoiceSdp(offer.sdp);
  await a.setLocalDescription(offer); await b.setRemoteDescription(offer);
  const answer = await b.createAnswer(); answer.sdp = enhanceOpusVoiceSdp(answer.sdp);
  await b.setLocalDescription(answer); await a.setRemoteDescription(answer);
  const remote = await received;
  const audio = new Audio(); audio.srcObject = remote; audio.muted = true;
  await audio.play();
  const deadline = performance.now() + 5000;
  while (a.connectionState !== 'connected' || b.connectionState !== 'connected') {
    check(performance.now() < deadline, `A chamada local não conectou: ${a.connectionState}/${b.connectionState}`);
    await pause(30);
  }
  return { stream: remote, close() { audio.pause(); audio.srcObject = null; a.close(); b.close(); } };
}

// Reproduz o envio da 3.7.0 para comparar o mesmo sinal, sem alterar a captura.
async function previousPipeline(raw, useRnnoise) {
  const ctx = new AudioContext({ sampleRate: 48000 });
  const source = ctx.createMediaStreamSource(raw);
  const gain = ctx.createGain();
  let denoiser;
  if (useRnnoise) {
    const rnnoise = await import('/vendor/noise-suppressor/index.js');
    const wasmBinary = await rnnoise.loadRnnoise({ url: '/vendor/noise-suppressor/rnnoise.wasm', simdUrl: '/vendor/noise-suppressor/rnnoise_simd.wasm' });
    await ctx.audioWorklet.addModule('/vendor/noise-suppressor/rnnoise/workletProcessor.js');
    denoiser = new rnnoise.RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary });
    source.connect(denoiser).connect(gain);
  } else source.connect(gain);
  const dest = ctx.createMediaStreamDestination();
  gain.connect(dest);
  await ctx.resume();
  return { stream: dest.stream, async close() { denoiser?.destroy(); source.disconnect(); gain.disconnect(); dest.stream.getTracks().forEach(t => t.stop()); await ctx.close(); } };
}

export async function run() {
  const results = {};
  const f = await fixture();
  try {
    const previous = await previousPipeline(f.raw, false);
    try {
      await pause(250);
      results.raw = await measure(f.ctx, f.raw);
      results.current = await measure(f.ctx, f.pipeline.stream);
      results.previous = await measure(f.ctx, previous.stream);
      check(Math.abs(results.current.db - results.previous.db) < 0.5, 'Sem IA, o nível precisa ser igual ao da 3.7');
      check(Math.abs(results.current.db - results.raw.db) < 0.5, '100% não deve adicionar reforço automático');
    } finally { await previous.close(); }
    const track = f.pipeline.stream.getAudioTracks()[0];
    f.pipeline.setGain(2); await pause(250);
    results.manual200 = await measure(f.ctx, f.pipeline.stream);
    check(Math.abs(results.manual200.db - results.current.db - 6.02) < 0.6, '200% deve dobrar a amplitude');
    check(f.pipeline.stream.getAudioTracks()[0] === track, 'Ajustar ganho não pode substituir a faixa');
    f.pipeline.setGain(0); await pause(250);
    check((await measure(f.ctx, f.pipeline.stream)).peak < 1e-5, '0% deve enviar silêncio');
    f.pipeline.setGain(1); await pause(250);
    const peer = await peerStream(f.pipeline.stream);
    try {
      await pause(800);
      results.received = await measure(f.ctx, peer.stream);
      check(Math.abs(results.received.db - results.current.db) < 2, 'O envio Opus deve preservar o sinal sem IA');
      const mixer = new VolumeMixerManager({ audioContext: f.ctx });
      mixer.outputGain.disconnect();
      const output = f.ctx.createMediaStreamDestination();
      output.channelCount = 1;
      mixer.outputGain.connect(output);
      mixer.setMasterVolume(100);
      mixer.attachUserStream('voz-de-teste', peer.stream, 'Teste');
      mixer.setUserVolume('voz-de-teste', 100);
      await pause(200);
      results.mixer = await measure(f.ctx, output.stream);
      check(Math.abs(results.mixer.db - results.received.db) < 1, 'Volume geral e individual em 100% devem preservar a voz');
      track.enabled = false; await pause(500);
      check((await measure(f.ctx, peer.stream)).peak < 0.001, 'Mute deve silenciar o áudio recebido');
      check((await measure(f.ctx, output.stream)).peak < 0.001, 'Mute deve silenciar também o mixer');
      mixer.detachUserStream('voz-de-teste'); mixer.outputGain.disconnect();
      output.stream.getTracks().forEach(track => track.stop());
    } finally { peer.close(); }
    f.pipeline.stop(); f.pipeline.stop();
    check(f.raw.getAudioTracks()[0].readyState === 'ended' && f.stops === 1, 'Parar deve liberar a captura uma vez só');
  } finally { await f.close(); }

  const filtered = await fixture({ speech: true, useRnnoise: true, level: -30 });
  try {
    const previous = await previousPipeline(filtered.raw, true);
    try {
      await pause(1500);
      const [oldLevel, newLevel] = await Promise.all([
        measure(filtered.ctx, previous.stream, 1600), measure(filtered.ctx, filtered.pipeline.stream, 1600)
      ]);
      results.previousRNNoise = oldLevel; results.rnnoise = newLevel;
      check(Math.abs(newLevel.db - oldLevel.db) < 0.5, 'RNNoise deve preservar o processamento e nível da 3.7');
      check(newLevel.peak > 0.001, 'RNNoise precisa preservar a voz de referência');
    } finally { await previous.close(); }
    filtered.raw.getAudioTracks()[0].dispatchEvent(new Event('ended'));
    check(filtered.pipeline.stream.getAudioTracks()[0].readyState === 'ended', 'Perder a captura deve encerrar a saída');
  } finally { await filtered.close(); }
  const noisy = await fixture({ noise: true, useRnnoise: true, level: -20 });
  try {
    results.noiseRaw = await measure(noisy.ctx, noisy.raw);
    results.noiseFiltered = await measure(noisy.ctx, noisy.pipeline.stream);
    check(results.noiseRaw.db - results.noiseFiltered.db > 15, 'RNNoise deve reduzir o ruído grave de referência');
  } finally { await noisy.close(); }
  console.log('Microfone: comparação com 3.7, ganho manual, Opus, mute, mixer, RNNoise e liberação passaram.');
  return results;
}
