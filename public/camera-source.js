// Mantém a mesma MediaStream ao trocar a lente: a call e os espectadores continuam conectados.
const stopTracks = stream => stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
const cameraError = message => Object.assign(new Error(message), { name: 'NotFoundError' });
export class CameraSource {
  constructor({ mediaDevices = navigator.mediaDevices, onStream, onState = () => {}, onLost = () => {} }) {
    this.mediaDevices = mediaDevices;
    this.onStream = onStream;
    this.onState = onState;
    this.onLost = onLost;
    this.stream = null;
    this.facing = 'user';
    this.busy = false;
    this.generation = 0;
    this.switchingTrack = null;
  }
  notify() { this.onState({ busy: this.busy, facing: this.facing }); }
  async capture(facing, { exact = false, previousDevice = '', active } = {}) {
    const open = async selector => {
      if (!active()) return null;
      const stream = await this.mediaDevices.getUserMedia({ audio: false, video: {
        width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, ...selector
      } });
      if (!active()) { stopTracks(stream); return null; }
      const track = stream.getVideoTracks()[0], settings = track?.getSettings?.() || {};
      if (!track || (exact && ((settings.facingMode && settings.facingMode !== facing)
        || (!settings.facingMode && previousDevice && settings.deviceId === previousDevice)))) {
        stopTracks(stream);
        throw cameraError('A outra câmera não está disponível neste aparelho.');
      }
      return stream;
    };
    try { return await open({ facingMode: { [exact ? 'exact' : 'ideal']: facing } }); }
    catch (error) {
      if (!active()) return null;
      if (!exact || !['OverconstrainedError', 'NotFoundError'].includes(error.name)) throw error;
      // Algumas WebViews expõem as lentes por deviceId em vez de facingMode.
      const devices = await this.mediaDevices.enumerateDevices?.().catch(() => []) || [];
      if (!active()) return null;
      const candidates = devices.filter(d => d.kind === 'videoinput' && d.deviceId && d.deviceId !== previousDevice);
      const orientation = facing === 'environment' ? /back|rear|environment|traseir|facing\s*back/i : /front|user|selfie|frontal|facing\s*front/i;
      const device = candidates.find(d => orientation.test(d.label)) || candidates[0];
      if (!device) throw error;
      return open({ deviceId: { exact: device.deviceId } });
    }
  }
  async install(capture, previous, active) {
    if (!capture || !active()) { stopTracks(capture); return false; }
    const track = capture.getVideoTracks()[0];
    track.contentHint = 'motion';
    if (previous) {
      this.stream.addTrack(track);
      for (const old of this.stream.getVideoTracks()) if (old !== track) this.stream.removeTrack(old);
    } else this.stream = capture;
    const facing = track.getSettings?.().facingMode;
    this.facing = ['user', 'environment'].includes(facing) ? facing : this.requestedFacing;
    const stream = this.stream;
    track.onended = () => {
      // O Android pode encerrar a lente antiga ao abrir a nova. A troca cuida da recuperação.
      if (this.switchingTrack === track) return;
      if (this.stream === stream && stream.getVideoTracks().includes(track)) { this.stop(); this.onLost(); }
    };
    await this.onStream(stream, previous, active);
    if (!active()) { stopTracks(capture); return false; }
    if (previous) { previous.onended = null; previous.stop(); }
    return true;
  }
  async start() {
    if (this.busy || this.stream) return false;
    const generation = ++this.generation, active = () => generation === this.generation;
    this.busy = true; this.notify(); this.requestedFacing = this.facing;
    try { return await this.install(await this.capture(this.facing, { active }), null, active); }
    finally { if (active()) { this.busy = false; this.notify(); } }
  }
  async flip() {
    if (this.busy || !this.stream) return false;
    const stream = this.stream, previous = stream.getVideoTracks()[0], settings = previous.getSettings?.() || {};
    const before = this.facing, target = before === 'user' ? 'environment' : 'user';
    const generation = ++this.generation, active = () => generation === this.generation && this.stream === stream;
    this.switchingTrack = previous;
    this.busy = true; this.notify(); this.requestedFacing = target;
    try {
      let capture;
      try { capture = await this.capture(target, { exact: true, previousDevice: settings.deviceId, active }); }
      catch (error) {
        if (!active()) return false;
        if (!['NotReadableError', 'AbortError'].includes(error.name)) throw error;
        // Há celulares que só abrem uma lente por vez. Libera só o vídeo, nunca o microfone.
        previous.onended = null; previous.stop();
        capture = await this.capture(target, { exact: true, previousDevice: settings.deviceId, active });
      }
      return await this.install(capture, previous, active);
    } catch (error) {
      if (!active()) return false;
      if (previous.readyState === 'ended') {
        try {
          this.requestedFacing = before;
          const restored = await this.capture(before, { active });
          if (!await this.install(restored, previous, active)) return false;
        } catch {
          if (!active()) return false;
          this.stop(); this.onLost();
          throw new Error('Não consegui reabrir a câmera. Ligue novamente para tentar outra vez.');
        }
      }
      throw error;
    } finally {
      if (this.switchingTrack === previous) this.switchingTrack = null;
      if (active()) { this.busy = false; this.notify(); }
    }
  }
  stop() {
    this.generation++;
    stopTracks(this.stream); this.stream = null; this.switchingTrack = null; this.busy = false; this.notify();
  }
}
