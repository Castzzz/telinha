// A saída fica silenciosa. Só os microfones ligados à entrada alimentam o histórico.
class VoiceClipProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(60 * sampleRate);
    this.written = 0;
    this.active = true;
    this.port.onmessage = ({ data }) => {
      if (data === 'parar') {
        this.active = false;
        this.samples = null;
        return;
      }
      if (!this.active) return;
      if (data === 'limpar') {
        this.written = 0;
        return;
      }
      const length = Math.min(this.written, this.samples.length);
      const start = (this.written - length) % this.samples.length;
      const result = new Float32Array(length);
      const first = Math.min(length, this.samples.length - start);
      result.set(this.samples.subarray(start, start + first));
      result.set(this.samples.subarray(0, length - first), first);
      this.port.postMessage(result, [result.buffer]);
    };
  }

  process(inputs, outputs) {
    if (!this.active) return false;
    const input = inputs[0][0];
    const length = outputs[0][0].length;
    const start = this.written % this.samples.length;
    const first = Math.min(length, this.samples.length - start);
    if (input) {
      if (first === length) this.samples.set(input, start);
      else {
        this.samples.set(input.subarray(0, first), start);
        this.samples.set(input.subarray(first));
      }
    } else {
      this.samples.fill(0, start, start + first);
      if (first < length) this.samples.fill(0, 0, length - first);
    }
    this.written += length;
    return true;
  }
}
registerProcessor('vozes-da-call', VoiceClipProcessor);
