import { loadRnnoise, loadGtcrn } from '/vendor/noise-suppressor/index.js';

const check = (ok, text) => { if (!ok) throw new Error(text); };
const rms = samples => Math.sqrt(samples.reduce((total, value) => total + value * value, 0) / samples.length);
const db = samples => 20 * Math.log10(Math.max(1e-10, rms(samples)));
const normalize = (samples, level) => {
  const scale = 10 ** (level / 20) / rms(samples);
  return Float32Array.from(samples, value => value * scale);
};

// Vogais com formantes e teclas impulsivas, sem gravar o microfone de ninguém.
function references() {
  const voice = new Float32Array(48000 * 6), keys = new Float32Array(voice.length);
  let phase = 0, seed = 7;
  for (let i = 0; i < voice.length; i++) {
    const time = i / 48000, pitch = 150 + 15 * Math.sin(2 * Math.PI * 1.7 * time);
    phase += 2 * Math.PI * pitch / 48000;
    let sample = 0;
    for (let harmonic = 1; harmonic < 30; harmonic++) {
      const hz = harmonic * pitch;
      const formant = Math.exp(-(((hz - 600) / 200) ** 2)) + .7 * Math.exp(-(((hz - 1100) / 250) ** 2)) + .3 * Math.exp(-(((hz - 2400) / 400) ** 2));
      sample += Math.sin(phase * harmonic) * (.2 + formant) / harmonic;
    }
    voice[i] = sample * (.1 + .9 * Math.sin(Math.PI * 3 * time) ** 2);
    const sinceKey = time % .16;
    seed = (1664525 * seed + 1013904223) >>> 0;
    keys[i] = Math.exp(-sinceKey / .008) * (seed / 2 ** 31 - 1) * .7
      + Math.exp(-sinceKey / .015) * Math.sin(2 * Math.PI * 1800 * sinceKey) * .25;
  }
  return { voice: normalize(voice, -30), keys: normalize(keys, -30) };
}

// Alinha o atraso de cada filtro e separa energia de voz de distorção/ruído residual.
// Assim um filtro que simplesmente baixar ou mutar tudo não ganha a comparação.
function quality(output, reference) {
  let best = { correlation: -1 };
  const compare = lag => {
    let cross = 0, clean = 0, processed = 0;
    for (let i = 4096; i < reference.length - 4096; i += 8) {
      const a = reference[i], b = output[i + lag];
      cross += a * b; clean += a * a; processed += b * b;
    }
    const correlation = cross / Math.sqrt(clean * processed);
    if (correlation > best.correlation) best = { lag, correlation, voiceGain: 20 * Math.log10(Math.abs(cross / clean)),
      snr: 10 * Math.log10((cross * cross / clean) / (processed - cross * cross / clean)) };
  };
  for (let lag = 0; lag < 4096; lag += 16) compare(lag);
  const coarse = best.lag;
  for (let lag = Math.max(0, coarse - 15); lag <= coarse + 15; lag++) compare(lag);
  return best;
}

async function render(filter, binary, samples) {
  const ctx = new OfflineAudioContext(1, samples.length, 48000);
  await ctx.audioWorklet.addModule('/noise-processor.js');
  const node = new AudioWorkletNode(ctx, 'teletela/noise-filter', { channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1], processorOptions: { filter, wasmBinary: binary } });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('O modelo de IA não ficou pronto.')), 5000);
    node.port.onmessage = event => {
      clearTimeout(timeout);
      event.data.type === 'ready' ? resolve() : reject(new Error('Falha ao carregar o modelo.'));
    };
    node.onprocessorerror = () => { clearTimeout(timeout); reject(new Error('Falha no processador de IA.')); };
  });
  const buffer = ctx.createBuffer(1, samples.length, 48000); buffer.getChannelData(0).set(samples);
  const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(node).connect(ctx.destination); source.start();
  const started = performance.now();
  const output = (await ctx.startRendering()).getChannelData(0);
  node.port.postMessage('destroy'); node.port.close(); node.disconnect();
  return { output, renderMs: performance.now() - started };
}

export async function runNoiseComparison() {
  const { voice, keys } = references();
  const mixed = Float32Array.from(voice, (value, i) => value + keys[i]);
  const binaries = {
    rnnoise: await loadRnnoise({ url: '/vendor/noise-suppressor/rnnoise.wasm', simdUrl: '/vendor/noise-suppressor/rnnoise_simd.wasm' }),
    ia: await loadGtcrn({ url: '/vendor/noise-suppressor/gtcrn.wasm' })
  };
  const results = {};
  for (const filter of ['rnnoise', 'ia']) {
    const row = {};
    for (const [name, samples] of [['voice', voice], ['quietVoice', normalize(voice, -42)], ['keys', keys], ['mixed', mixed]]) {
      const { output, renderMs } = await render(filter, binaries[filter], samples);
      row[name] = { inputDb: db(samples), outputDb: db(output), renderMs, ...(name === 'keys' ? {} : quality(output, name === 'quietVoice' ? normalize(voice, -42) : voice)) };
    }
    results[filter] = row;
  }
  check(results.ia.keys.outputDb < results.rnnoise.keys.outputDb - 20, 'A IA forte precisa reduzir muito mais as teclas isoladas');
  check(results.ia.mixed.snr > results.rnnoise.mixed.snr + 4, 'A IA forte precisa melhorar a separação das teclas durante a fala');
  check(results.ia.mixed.voiceGain > -3, 'A melhora não pode vir de abaixar a voz junto');
  check(results.ia.voice.correlation > .95 && results.ia.voice.voiceGain > -2, 'A voz limpa precisa ser preservada');
  check(results.ia.quietVoice.voiceGain > -3, 'Voz baixa não pode ser tratada como ruído');
  console.log(JSON.stringify({ comparacaoIA: results }));
  return results;
}
