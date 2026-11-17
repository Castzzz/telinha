// A saída fica silenciosa. Só os microfones ligados à entrada alimentam o histórico.
class VoiceClipProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(60 * 16000);
    this.written = 0;
    this.phase = this.sum = this.count = 0;
    this.active = true;
    this.port.onmessage = ({ data }) => {
      if (data === 'parar') {
        this.active = false;
        this.samples = null;
        return;
      }
      if (!this.active) return;
      if (data === 'limpar') {
        this.written = this.phase = this.sum = this.count = 0;
        return;
      }
      const length = Math.min(this.written, this.samples.length);
      const start = (this.written - length) % this.samples.length;
      const result = new Int16Array(length);
      const first = Math.min(length, this.samples.length - start);
      result.set(this.samples.subarray(start, start + first));
      result.set(this.samples.subarray(0, length - first), first);
      this.port.postMessage(result, [result.buffer]);
    };
  }

  process(inputs, outputs) {
    if (!this.active) return false;
    const input = inputs[0][0];
    for (let i = 0; i < outputs[0][0].length; i++) {
      this.sum += input?.[i] || 0;
      this.count++;
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const sample = Math.min(1, Math.max(-1, this.sum / this.count));
        this.samples[this.written++ % this.samples.length] = Math.round(sample * 32767);
        this.sum = this.count = 0;
      }
    }
    return true;
  }
}
registerProcessor('vozes-da-call', VoiceClipProcessor);
