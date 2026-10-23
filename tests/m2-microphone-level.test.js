import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MicrophoneLevelProcessor } from '../public/microphone-level.js';

const rate = 48000;
function render(db, { seconds = 3, gain = 1, automatic = true, processor = new MicrophoneLevelProcessor(rate) } = {}) {
  const input = new Float32Array(128), output = new Float32Array(128);
  let energy = 0, count = 0, peak = 0;
  const amplitude = 10 ** (db / 20) * Math.SQRT2;
  const length = Math.floor(rate * seconds / 128) * 128;
  for (let offset = 0; offset < length; offset += 128) {
    for (let i = 0; i < 128; i++) input[i] = amplitude * Math.sin(2 * Math.PI * 220 * (offset + i) / rate);
    processor.process(input, output, { gain, automatic });
    for (const value of output) {
      assert.ok(Number.isFinite(value));
      peak = Math.max(peak, Math.abs(value));
      if (offset >= rate) { energy += value * value; count++; }
    }
  }
  return { db: 20 * Math.log10(Math.sqrt(energy / Math.max(1, count)) || 1e-10), peak, processor };
}

test('voz baixa chega perto do nível alvo sem precisar de ganho manual alto', () => {
  const quiet = render(-40);
  assert.ok(quiet.db > -24 && quiet.db < -20, `nível enviado: ${quiet.db} dB`);
  const veryQuiet = render(-48);
  assert.ok(veryQuiet.db > -28 && veryQuiet.db < -25, 'compensação respeita o teto de 12 vezes');
});

test('desligar o ajuste preserva o volume e o ganho manual continua independente', () => {
  const unchanged = render(-38, { automatic: false });
  const manual = render(-38, { automatic: false, gain: 3 });
  assert.ok(Math.abs(unchanged.db - -38) < 0.1);
  assert.ok(Math.abs(manual.db - (-38 + 20 * Math.log10(3))) < 0.1);
  const auto = render(-38);
  const autoManual = render(-38, { gain: 2 });
  assert.ok(Math.abs(autoManual.db - auto.db - 20 * Math.log10(2)) < 0.1, 'a normalização não anula a escolha manual');
});

test('microfone forte e gritos ficam limitados, inclusive em 300%', () => {
  const normal = render(-18);
  assert.ok(Math.abs(normal.db - -18) < 0.2);
  const loud = render(-3, { gain: 3 });
  assert.ok(loud.peak <= 0.892, `pico limitado: ${loud.peak}`);
  assert.ok(loud.processor.lastLevel.limited);
});

test('silêncio e ruído abaixo do limiar não fazem o ganho aumentar', () => {
  const silence = render(-200);
  const background = render(-70);
  assert.ok(silence.peak < 1e-8);
  assert.equal(silence.processor.autoGain, 1);
  assert.equal(background.processor.autoGain, 1);
  const voiced = render(-40).processor;
  render(-200, { processor: voiced });
  assert.ok(voiced.autoGain < 1.01, 'depois da pausa, devolve o ganho para a base');
});

test('volume zero e dados inválidos não vazam áudio nem geram NaN', () => {
  const muted = render(-20, { gain: 0 });
  assert.ok(muted.db < -100);
  const processor = new MicrophoneLevelProcessor();
  const input = new Float32Array([NaN, Infinity, -Infinity, 100, -100, 0]);
  const output = new Float32Array(input.length);
  processor.process(input, output, { gain: NaN });
  assert.ok([...output].every((value) => Number.isFinite(value) && Math.abs(value) <= 0.892));
});
