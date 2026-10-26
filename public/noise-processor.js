import { Rnnoise, createRnnoiseProcessor } from './vendor/noise-suppressor/rnnoise/workletProcessor.js';
import { loadGtcrnModule, createGtcrnProcessor } from './vendor/noise-suppressor/gtcrn/workletProcessor.js';

// A captura só é usada depois de confirmar que o modelo terminou de carregar.
class NoiseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.destroyed = false;
    this.port.onmessage = event => { if (event.data === 'destroy') this.destroy(); };
    this.initialize(options.processorOptions).catch(() => {
      this.port.postMessage({ type: 'error' });
      this.destroy();
    });
  }
  async initialize({ filter, wasmBinary }) {
    if (sampleRate !== 48000) throw new Error('O filtro de voz precisa de 48 kHz.');
    const module = filter === 'ia'
      ? await loadGtcrnModule({ locateFile: file => file, wasmBinary })
      : await Rnnoise.loadBinary(wasmBinary);
    // Uma troca de dispositivo pode encerrar a captura antes do WASM ficar pronto.
    if (this.destroyed) return;
    this.processor = filter === 'ia'
      ? createGtcrnProcessor(module, { bufferSize: 128, maxChannels: 1, sampleRate })
      : createRnnoiseProcessor(module, { bufferSize: 128, maxChannels: 1 });
    this.port.postMessage({ type: 'ready' });
  }
  process(inputs, outputs) {
    if (this.destroyed) return false;
    if (this.processor && inputs[0]?.[0] && outputs[0]?.[0]) this.processor.process(inputs[0], outputs[0]);
    return true;
  }
  destroy() {
    this.destroyed = true;
    this.processor?.destroy();
    this.processor = null;
  }
}
registerProcessor('teletela/noise-filter', NoiseProcessor);
