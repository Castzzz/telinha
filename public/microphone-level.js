// Ajuste só da voz: compensa entradas fracas sem alterar o volume do microfone no sistema.
export class MicrophoneLevelProcessor {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.targetRms = 10 ** (-22 / 20);
    this.floorRms = 10 ** (-55 / 20);
    this.ceiling = 10 ** (-1 / 20);
    this.maxGain = 12;
    this.autoGain = 1;
    this.manualGain = 1;
    this.limiterGain = 1;
    this.energy = 0;
    this.silentSamples = 0;
    this.lastLevel = { inputDb: -100, outputDb: -100, gainDb: 0, limited: false };
    this.autoRise = 1 - Math.exp(-1 / (sampleRate * 0.2));
    this.autoFall = 1 - Math.exp(-1 / (sampleRate * 0.04));
    this.manualRate = 1 - Math.exp(-1 / (sampleRate * 0.01));
    this.limitRelease = 1 - Math.exp(-1 / (sampleRate * 0.12));
  }

  process(input, output, { gain = 1, automatic = true } = {}) {
    const manual = Number.isFinite(gain) ? Math.max(0, Math.min(3, gain)) : 1;
    let sum = 0;
    for (const value of input) if (Number.isFinite(value)) sum += value * value;
    const frameEnergy = sum / Math.max(1, input.length);
    const smoothing = 1 - Math.exp(-input.length / (this.sampleRate * 0.03));
    this.energy += (frameEnergy - this.energy) * smoothing;
    const rms = Math.sqrt(Math.max(0, this.energy));
    const speech = Math.sqrt(frameEnergy) >= this.floorRms;
    this.silentSamples = speech ? 0 : this.silentSamples + input.length;
    // Não aumenta o ganho durante silêncio; uma pausa curta não muda o volume entre sílabas.
    let desired = this.autoGain;
    if (!automatic || this.silentSamples > this.sampleRate * 0.4) desired = 1;
    else if (speech) desired = Math.max(1, Math.min(this.maxGain, this.targetRms / Math.max(rms, this.floorRms)));
    let outSum = 0, limited = false;
    for (let i = 0; i < output.length; i++) {
      this.autoGain += (desired - this.autoGain) * (desired > this.autoGain ? this.autoRise : this.autoFall);
      this.manualGain += (manual - this.manualGain) * this.manualRate;
      const sample = Number.isFinite(input[i]) ? input[i] : 0;
      const amplified = sample * this.autoGain * this.manualGain;
      const limit = Math.abs(amplified) > this.ceiling ? this.ceiling / Math.abs(amplified) : 1;
      if (limit < this.limiterGain) this.limiterGain = limit;
      else this.limiterGain += (1 - this.limiterGain) * this.limitRelease;
      const value = Math.max(-this.ceiling, Math.min(this.ceiling, amplified * this.limiterGain));
      output[i] = value;
      outSum += value * value;
      limited ||= this.limiterGain < 0.98;
    }
    const db = (value) => Math.max(-100, 20 * Math.log10(Math.max(value, 1e-5)));
    this.lastLevel = { inputDb: db(Math.sqrt(frameEnergy)), outputDb: db(Math.sqrt(outSum / Math.max(1, output.length))), gainDb: db(this.autoGain), limited };
    return this.lastLevel;
  }
}
