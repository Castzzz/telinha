import { createMicrophonePipeline } from '/microphone.js';
import { enhanceOpusVoiceSdp, VolumeMixerManager } from '/audio-manager.js';
import { runNoiseComparison } from '/__noise-test.js';

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

async function fixture({ noise = false, speech = false, useRnnoise = false, noiseFilter = useRnnoise ? 'rnnoise' : 'off', boost = true, level = -38, gain = 1 } = {}) {
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
  const pipeline = await createMicrophonePipeline(dest.stream, { noiseFilter, boost, gain, onStop: () => stops++ });
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
    check(f.pipeline.stream.getAudioTracks()[0].getSettings().channelCount === 1, 'A saída precisa ser mono');
    results.weak = await measure(f.ctx, f.pipeline.stream);
    check(results.weak.db > -29 && results.weak.db < -22, 'A voz baixa deve subir sem ficar excessiva');
    const previous = await previousPipeline(f.raw, false);
    try {
      await pause(250);
      results.previousWithoutAI = await measure(f.ctx, previous.stream);
      check(results.weak.db - results.previousWithoutAI.db > 10, 'Sem IA, o novo reforço precisa melhorar a entrada baixa em relação à 3.7.0');
    } finally { await previous.close(); }
    f.pipeline.setBoost(false); await pause(800);
    results.withoutBoost = await measure(f.ctx, f.pipeline.stream);
    check(results.weak.db - results.withoutBoost.db > 8, 'O reforço precisa aumentar entradas fracas');
    f.pipeline.setBoost(true); f.pipeline.setGain(2); await pause(800);
    results.manual200 = await measure(f.ctx, f.pipeline.stream);
    check(Math.abs(results.manual200.db - results.weak.db - 6.02) < 0.6, '200% deve dobrar a amplitude sem o reforço anular o ajuste');
    f.pipeline.setGain(0); await pause(500);
    check((await measure(f.ctx, f.pipeline.stream)).peak < 1e-5, '0% deve enviar silêncio');
    f.pipeline.setGain(3); f.volume.gain.value = 1; await pause(500);
    results.loud = await measure(f.ctx, f.pipeline.stream);
    check(results.loud.peak <= 0.951, 'Picos precisam ficar abaixo do teto digital');
    f.pipeline.setGain(1); f.volume.gain.value = 10 ** (-38 / 20) * Math.sqrt(2); await pause(1000);
    const peer = await peerStream(f.pipeline.stream);
    try {
      await pause(800);
      results.received = await measure(f.ctx, peer.stream);
      console.log(JSON.stringify({ weak: results.weak, received: results.received }));
      check(Math.abs(results.received.db - results.weak.db) < 2, 'Opus mono deve preservar o nível no receptor em 100%');
      const mixer = new VolumeMixerManager({ audioContext: f.ctx });
      mixer.outputGain.disconnect();
      const receivedOutput = f.ctx.createMediaStreamDestination();
      receivedOutput.channelCount = 1;
      mixer.outputGain.connect(receivedOutput);
      mixer.setMasterVolume(100);
      mixer.attachUserStream('voz-de-teste', peer.stream, 'Teste');
      mixer.setUserVolume('voz-de-teste', 100);
      await pause(200);
      results.receivedAt100 = await measure(f.ctx, receivedOutput.stream);
      check(Math.abs(results.receivedAt100.db - results.received.db) < 1, 'Volume geral e individual em 100% não podem atenuar a voz');
      f.pipeline.stream.getAudioTracks()[0].enabled = false; await pause(500);
      check((await measure(f.ctx, peer.stream)).peak < 0.001, 'Mute deve silenciar o áudio recebido');
      check((await measure(f.ctx, receivedOutput.stream)).peak < 0.001, 'Mute deve silenciar também a saída do mixer');
      f.pipeline.stream.getAudioTracks()[0].enabled = true;
      mixer.detachUserStream('voz-de-teste');
      mixer.outputGain.disconnect();
      receivedOutput.stream.getTracks().forEach(track => track.stop());
    } finally { peer.close(); }
    f.pipeline.stop(); f.pipeline.stop();
    check(f.raw.getAudioTracks()[0].readyState === 'ended' && f.stops === 1, 'Parar precisa liberar a captura uma vez só');
  } finally { await f.close(); }

  const filtered = await fixture({ speech: true, useRnnoise: true, boost: false, level: -30 });
  try {
    check(filtered.pipeline.stream.getAudioTracks()[0].getSettings().channelCount === 1, 'RNNoise também deve sair em mono');
    results.rnnoise = await measure(filtered.ctx, filtered.pipeline.stream);
    const previous = await previousPipeline(filtered.raw, true);
    try {
      await pause(1500);
      const [oldLevel, newLevel] = await Promise.all([measure(filtered.ctx, previous.stream, 1200), measure(filtered.ctx, filtered.pipeline.stream, 1200)]);
      results.previousRNNoise = oldLevel;
      results.monoRNNoise = newLevel;
      check(newLevel.db - oldLevel.db > 4, 'Mono explícito precisa corrigir a perda de nível do grafo antigo com RNNoise');
    } finally { await previous.close(); }
    console.log(JSON.stringify({ rnnoise: results.rnnoise }));
    check(results.rnnoise.db > -45, 'RNNoise deve preservar a voz de referência');
    const peer = await peerStream(filtered.pipeline.stream);
    try {
      await pause(800);
      results.rnnoiseReceived = await measure(filtered.ctx, peer.stream, 1200);
      const local = await measure(filtered.ctx, filtered.pipeline.stream, 1200);
      check(Math.abs(results.rnnoiseReceived.db - local.db) < 3, 'RNNoise não pode perder mais 6 dB no envio mono');
    } finally { peer.close(); }
    filtered.raw.getAudioTracks()[0].dispatchEvent(new Event('ended'));
    check(filtered.pipeline.stream.getAudioTracks()[0].readyState === 'ended', 'Perder a captura precisa encerrar a saída');
  } finally { await filtered.close(); }

  const noisy = await fixture({ noise: true, useRnnoise: true, boost: true, level: -20 });
  try {
    results.noiseRaw = await measure(noisy.ctx, noisy.raw);
    results.noiseFiltered = await measure(noisy.ctx, noisy.pipeline.stream);
    console.log(JSON.stringify({ noiseRaw: results.noiseRaw, noiseFiltered: results.noiseFiltered }));
    check(results.noiseRaw.db - results.noiseFiltered.db > 15, 'RNNoise deve remover o ruído grave mesmo com reforço ligado');
  } finally { await noisy.close(); }
  const strong = await fixture({ speech: true, noiseFilter: 'ia', boost: true, level: -38 });
  try {
    check(strong.pipeline.noiseFilter === 'ia', 'A IA forte precisa carregar, sem cair silenciosamente na IA leve');
    results.strongAI = await measure(strong.ctx, strong.pipeline.stream, 800);
    check(results.strongAI.db > -33 && results.strongAI.db < -20, 'A IA forte precisa preservar e reforçar a voz baixa');
    const peer = await peerStream(strong.pipeline.stream);
    try {
      await pause(500);
      results.strongAIReceived = await measure(strong.ctx, peer.stream, 800);
      check(Math.abs(results.strongAIReceived.db - results.strongAI.db) < 3, 'A voz da IA forte precisa chegar ao receptor sem perder volume');
    } finally { peer.close(); }
    const originalFetch = window.fetch;
    let fallback, fallbacks = 0;
    try {
      window.fetch = (url, init) => String(url).endsWith('/gtcrn.wasm')
        ? Promise.resolve(new Response(new Uint8Array([0, 1, 2, 3]))) : originalFetch(url, init);
      const { createMicrophonePipeline: createWithFailedModel } = await import('/microphone.js?modelo-invalido');
      fallback = await createWithFailedModel(strong.raw.clone(), { noiseFilter: 'ia', onFallback: () => fallbacks++ });
      check(fallback.noiseFilter === 'rnnoise' && fallbacks === 1, 'Falhar ao iniciar o modelo forte precisa avisar e carregar a IA leve');
      await pause(700);
      check((await measure(strong.ctx, fallback.stream, 800)).db > -45, 'O fallback não pode deixar uma faixa viva enviando silêncio');
    } finally { window.fetch = originalFetch; fallback?.stop(); }
  } finally { await strong.close(); }
  results.noiseComparison = await runNoiseComparison();
  console.log('Microfone: mono, reforço, ganho, picos, Opus, mute, IA forte/leve, teclas durante a fala e liberação passaram.');
  return results;
}
