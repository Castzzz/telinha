// Avança 65 s de áudio sintético sem esperar o relógio da máquina.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('o histórico de 60 segundos descarta o início e mantém a ordem na volta do anel', () => {
  let processor, snapshot;
  const context = {
    sampleRate: 44100,
    AudioWorkletProcessor: class { port = { postMessage: data => { snapshot = data; } }; },
    registerProcessor: (_, Type) => { processor = new Type(); }
  };
  vm.runInNewContext(fs.readFileSync(new URL('../public/voice-clip-worklet.js', import.meta.url), 'utf8'), context);
  const block = new Float32Array(441);
  for (let second = 0; second < 65; second++) {
    block.fill(second / 100);
    for (let i = 0; i < 100; i++) processor.process([[block]], [[block]]);
  }
  processor.port.onmessage({ data: 'clipar' });
  assert.equal(snapshot.length, 16000 * 60);
  for (let second = 0; second < 60; second++) {
    assert.ok(Math.abs(snapshot[16000 * second + 8000] / 32767 - (second + 5) / 100) < 0.001);
  }
  processor.port.onmessage({ data: 'parar' });
  assert.equal(processor.process([], []), false);
});
