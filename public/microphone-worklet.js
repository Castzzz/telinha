import { MicrophoneLevelProcessor } from './microphone-level.js';

class MicrophoneWorklet extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'gain', defaultValue: 1, minValue: 0, maxValue: 3, automationRate: 'k-rate' },
      { name: 'automatic', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.processor = new MicrophoneLevelProcessor(sampleRate);
    this.reportSamples = 0;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    const input = inputs[0]?.[0];
    if (!input) { output.fill(0); return true; }
    const level = this.processor.process(input, output, { gain: parameters.gain[0], automatic: parameters.automatic[0] >= 0.5 });
    this.reportSamples += output.length;
    if (this.reportSamples >= sampleRate / 10) {
      this.reportSamples = 0;
      this.port.postMessage(level);
    }
    return true;
  }
}

registerProcessor('teletela-microphone', MicrophoneWorklet);
