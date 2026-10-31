// A captura nativa chega como faixas WebRTC; o envio P2P/SFU continua no fluxo do app.
export class MobileScreenSource {
  constructor({ bridge = window.TeletelaAndroid, onEnded = () => {} } = {}) {
    this.bridge = bridge; this.onEnded = onEnded;
    window.teletelaScreenCaptureEvent = event => this.receive(event);
  }
  start(preset) {
    this.stop();
    return new Promise((resolve, reject) => {
      const session = { id: crypto.randomUUID(), resolve, reject, stream: new MediaStream(), ready: false };
      this.session = session;
      session.timer = setTimeout(() => this.end(session, 'A captura demorou para iniciar. Tente novamente.'), 120000);
      try { this.bridge.startScreenCapture(JSON.stringify({ id: session.id, width: Math.max(preset.width, preset.height), fps: preset.frameRate })); }
      catch (error) { this.end(session, error.message); }
    });
  }
  async receive(event) {
    const session = this.session;
    if (!session || event?.id !== session.id) return;
    if (['cancelled', 'stopped', 'error'].includes(event.type)) {
      this.end(session, event.value, event.type !== 'error'); return;
    }
    if (event.type !== 'offer' || session.peer) return;
    try {
      const peer = session.peer = new RTCPeerConnection({ iceServers: [] });
      peer.ontrack = ({ track }) => {
        session.stream.addTrack(track);
        track.onended = () => this.end(session, '', true);
      };
      peer.onconnectionstatechange = () => {
        if (this.session !== session) return;
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed') return this.end(session, 'A captura da tela foi interrompida.');
        if (peer.connectionState === 'connected' && session.stream.getVideoTracks().length && !session.ready) {
          clearTimeout(session.timer); session.ready = true; session.resolve(session.stream);
        }
      };
      await peer.setRemoteDescription({ type: 'offer', sdp: event.value });
      if (this.session !== session) return;
      await peer.setLocalDescription(await peer.createAnswer());
      // Sem STUN/TURN: esta conexão fica entre o serviço e a WebView do mesmo aparelho.
      if (peer.iceGatheringState !== 'complete') await new Promise(resolve => {
        const timer = setTimeout(done, 3000);
        function done() { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', changed); resolve(); }
        function changed() { if (peer.iceGatheringState === 'complete') done(); }
        peer.addEventListener('icegatheringstatechange', changed);
      });
      if (this.session === session) this.bridge.answerScreenCapture(session.id, peer.localDescription.sdp);
    } catch (error) { if (this.session === session) this.end(session, error.message); }
  }
  end(session, message = '', cancelled = false) {
    if (this.session !== session) return;
    const ready = session.ready;
    this.stop(false);
    if (ready) this.onEnded(message);
    else session.reject(new DOMException(message || 'Captura cancelada.', cancelled ? 'NotAllowedError' : 'NotReadableError'));
  }
  stop(cancelled = true) {
    const session = this.session;
    if (!session) return;
    this.session = null;
    clearTimeout(session.timer);
    session.peer?.close();
    session.stream.getTracks().forEach(track => track.stop());
    this.bridge.stopScreenCapture(session.id);
    if (cancelled && !session.ready) session.reject(new DOMException('Captura cancelada.', 'NotAllowedError'));
  }
}
