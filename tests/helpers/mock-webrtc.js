// tests/helpers/mock-webrtc.js
// High-fidelity WebRTC, MediaStream, AudioContext, and Audio Pipeline simulation harness.
// Compliant with W3C WebRTC specifications, RFC 7587, and Telinha audio/signaling contracts.

import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';

/**
 * Mock MediaStreamTrack
 */
export class MockMediaStreamTrack {
  constructor({ kind = 'audio', label = 'Track', enabled = true } = {}) {
    this.id = crypto.randomUUID();
    this.kind = kind;
    this.label = label;
    this.enabled = enabled;
    this.readyState = 'live';
    this.contentHint = '';
    this._listeners = new EventEmitter();
  }

  stop() {
    this.readyState = 'ended';
    this._listeners.emit('ended');
  }

  clone() {
    const cloneTrack = new MockMediaStreamTrack({
      kind: this.kind,
      label: this.label,
      enabled: this.enabled
    });
    cloneTrack.contentHint = this.contentHint;
    return cloneTrack;
  }

  addEventListener(type, listener) {
    this._listeners.on(type, listener);
  }

  removeEventListener(type, listener) {
    this._listeners.off(type, listener);
  }
}

/**
 * Mock MediaStream
 */
export class MockMediaStream {
  constructor(tracks = []) {
    this.id = crypto.randomUUID();
    this._tracks = new Map();
    for (const t of tracks) {
      this.addTrack(t);
    }
  }

  getTracks() {
    return Array.from(this._tracks.values());
  }

  getAudioTracks() {
    return this.getTracks().filter((t) => t.kind === 'audio');
  }

  getVideoTracks() {
    return this.getTracks().filter((t) => t.kind === 'video');
  }

  addTrack(track) {
    this._tracks.set(track.id, track);
  }

  removeTrack(track) {
    this._tracks.delete(track.id);
  }

  clone() {
    return new MockMediaStream(this.getTracks().map((t) => t.clone()));
  }
}

/**
 * Mock Web Audio GainNode
 */
export class MockGainNode {
  constructor(initialGain = 1.0) {
    this.gain = {
      value: initialGain,
      setValueAtTime(val) {
        this.value = val;
      }
    };
    this._connectedTo = [];
  }

  connect(destination) {
    this._connectedTo.push(destination);
  }

  disconnect() {
    this._connectedTo = [];
  }
}

/**
 * Mock Web Audio AnalyserNode (for VAD energy metering)
 */
export class MockAnalyserNode {
  constructor() {
    this.fftSize = 512;
    this.frequencyBinCount = 256;
    this._energyLevel = 0;
  }

  setEnergy(energy) {
    this._energyLevel = energy;
  }

  getByteFrequencyData(array) {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.round(this._energyLevel * 255);
    }
  }

  connect() {}
  disconnect() {}
}

/**
 * Mock Web Audio AudioContext
 */
export class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.destination = {};
  }

  createGain(initialGain = 1.0) {
    return new MockGainNode(initialGain);
  }

  createAnalyser() {
    return new MockAnalyserNode();
  }

  createMediaStreamSource(stream) {
    return {
      stream,
      connect() {},
      disconnect() {}
    };
  }

  createMediaStreamDestination() {
    const track = new MockMediaStreamTrack({ kind: 'audio', label: 'WebAudioMixer' });
    return {
      stream: new MockMediaStream([track])
    };
  }

  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

/**
 * Mock RTCRtpSender
 */
export class MockRTCRtpSender {
  constructor(track) {
    this.track = track;
    this._parameters = {
      encodings: [{ maxBitrate: 256000 }]
    };
  }

  getParameters() {
    return JSON.parse(JSON.stringify(this._parameters));
  }

  async setParameters(params) {
    this._parameters = JSON.parse(JSON.stringify(params));
  }

  replaceTrack(newTrack) {
    this.track = newTrack;
    return Promise.resolve();
  }
}

/**
 * Mock RTCPeerConnection
 */
export class MockRTCPeerConnection extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.localDescription = null;
    this.remoteDescription = null;
    this.connectionState = 'new';
    this.iceConnectionState = 'new';
    this.signalingState = 'stable';
    this._senders = [];
  }

  addTrack(track, stream) {
    const sender = new MockRTCRtpSender(track);
    this._senders.push(sender);
    return sender;
  }

  removeTrack(sender) {
    const idx = this._senders.indexOf(sender);
    if (idx !== -1) {
      this._senders.splice(idx, 1);
    }
  }

  getSenders() {
    return [...this._senders];
  }

  async createOffer(options = {}) {
    const sdp = [
      'v=0',
      'o=- 123456789 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'c=IN IP4 0.0.0.0',
      'a=rtpmap:111 opus/48000/2',
      'a=fmtp:111 minptime=10;useinbandfec=1',
      'm=video 9 UDP/TLS/RTP/SAVPF 96',
      'c=IN IP4 0.0.0.0',
      'a=rtpmap:96 VP8/90000'
    ].join('\r\n') + '\r\n';

    return { type: 'offer', sdp };
  }

  async createAnswer(options = {}) {
    const sdp = [
      'v=0',
      'o=- 987654321 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'c=IN IP4 0.0.0.0',
      'a=rtpmap:111 opus/48000/2',
      'a=fmtp:111 minptime=10;useinbandfec=1',
      'm=video 9 UDP/TLS/RTP/SAVPF 96',
      'c=IN IP4 0.0.0.0',
      'a=rtpmap:96 VP8/90000'
    ].join('\r\n') + '\r\n';

    return { type: 'answer', sdp };
  }

  async setLocalDescription(desc) {
    this.localDescription = desc;
    this.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable';
  }

  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
    this.signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable';
    this.connectionState = 'connected';
    this.iceConnectionState = 'connected';
  }

  addIceCandidate(candidate) {
    return Promise.resolve();
  }

  close() {
    this.connectionState = 'closed';
    this.signalingState = 'closed';
    this.iceConnectionState = 'closed';
  }
}

// --------------------------------------------------------------------------
// Authoritative Audio Pipeline Functions & Oracles (survey_audio_desktop.md)
// --------------------------------------------------------------------------

/**
 * Classifies if a device label represents a system audio loopback / monitor sink.
 * Authoritative regex from survey_audio_desktop.md § 2.4.
 * @param {string} label 
 * @returns {boolean}
 */
export function isSystemAudioLabel(label) {
  if (!label || typeof label !== 'string') return false;
  return /(^monitor\s*(of|de)?\b|(\b|_)(som[ _]do[ _]pc|jogos?[ _]e[ _]v[ií]deos?|sistema|loopback|stereo mix)(\b|_))/i.test(label);
}

/**
 * Classifies if a device label represents a physical microphone input.
 * @param {string} label 
 * @returns {boolean}
 */
export function isMicrophoneLabel(label) {
  if (!label || typeof label !== 'string') return false;
  return !isSystemAudioLabel(label);
}

/**
 * Categorizes a list of audioinput devices into system loopbacks and microphones.
 * @param {Array<{ kind: string, deviceId: string, label: string }>} devices 
 */
export function detectAudioDevices(devices = []) {
  const audioInputs = devices.filter((d) => d && d.kind === 'audioinput' && d.label);
  const systemAudioDevices = audioInputs.filter((d) => isSystemAudioLabel(d.label));
  const microphoneDevices = audioInputs.filter((d) => isMicrophoneLabel(d.label));

  return {
    systemAudioDevices,
    microphoneDevices,
    defaultSystemAudio: systemAudioDevices[0] || null,
    defaultMicrophone: microphoneDevices[0] || null
  };
}

/**
 * Produces the authoritative media constraints for system audio capture.
 * @param {string} [monitorDeviceId] 
 */
export function generateSystemAudioConstraints(monitorDeviceId) {
  return {
    audio: {
      deviceId: monitorDeviceId ? { exact: monitorDeviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2, min: 2 },
      sampleRate: { ideal: 48000 },
      sampleSize: { ideal: 16 }
    },
    video: false
  };
}

/**
 * Munges SDP to enable Opus 48kHz Stereo at up to specified bitrate (default 256000 bps).
 * Authoritative implementation from survey_audio_desktop.md § 3.2.
 * @param {string} sdp 
 * @param {number} bitrate 
 * @returns {string}
 */
export function enhanceOpusStereoSdp(sdp, bitrate = 256000) {
  if (!sdp || typeof sdp !== 'string') return sdp;

  // Find dynamic payload type assigned to opus/48000/2
  const match = sdp.match(/a=rtpmap:(\d+)\s+opus\/48000\/2/i);
  if (!match) return sdp;
  const pt = match[1];

  const fmtpRegex = new RegExp(`a=fmtp:${pt}\\s+(.*)`);
  if (fmtpRegex.test(sdp)) {
    return sdp.replace(fmtpRegex, (_, existingParams) => {
      const cleaned = existingParams
        .split(';')
        .map((p) => p.trim())
        .filter((p) => !/^(stereo|sprop-stereo|maxaveragebitrate)=/i.test(p))
        .join(';');
      const prefix = cleaned ? `${cleaned};` : '';
      return `a=fmtp:${pt} ${prefix}stereo=1;sprop-stereo=1;maxaveragebitrate=${bitrate}`;
    });
  }

  // Insert fmtp line immediately following rtpmap
  return sdp.replace(
    new RegExp(`(a=rtpmap:${pt}\\s+opus\/48000\/2\r?\n)`, 'i'),
    `$1a=fmtp:${pt} stereo=1;sprop-stereo=1;maxaveragebitrate=${bitrate}\r\n`
  );
}

// --------------------------------------------------------------------------
// Simulated Client State & Signaling Hub
// --------------------------------------------------------------------------

/**
 * Simulated client node modeling Telinha's dual-mesh audio and stage state.
 */
export class SimulatedClient extends EventEmitter {
  constructor({ id, name = 'User' } = {}) {
    super();
    this.id = id || crypto.randomUUID();
    this.name = name;
    this.channelId = null;
    this.isMicOn = true;
    this.isDeafened = false;
    this.isSharing = false;
    this.isSpeaking = false;

    this.audioContext = new MockAudioContext();
    this.screenAudioTrack = null;
    this.screenVideoTrack = null;
    this.micAudioTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'Microphone Input' });

    // Mixers: Map<id, GainNode>
    this.userMixers = new Map();
    this.streamMixers = new Map();

    // Stage State
    this.stageMode = 'spotlight'; // 'spotlight' | 'mosaic'
    this.activeStreamId = null;
    this.activeStreams = new Set();
  }

  /**
   * Starts screen sharing with isolated system loopback audio track
   */
  startScreenShare({ systemAudioTrack, videoTrack } = {}) {
    this.screenAudioTrack = systemAudioTrack || new MockMediaStreamTrack({
      kind: 'audio',
      label: 'Monitor of System Audio',
      enabled: true
    });
    this.screenAudioTrack.contentHint = 'music';

    this.screenVideoTrack = videoTrack || new MockMediaStreamTrack({
      kind: 'video',
      label: 'Screen Video Display',
      enabled: true
    });
    this.screenVideoTrack.contentHint = 'motion';

    this.isSharing = true;
    this.emit('screen-started', {
      audioTrack: this.screenAudioTrack,
      videoTrack: this.screenVideoTrack
    });
  }

  /**
   * Stops active screen sharing
   */
  stopScreenShare() {
    if (this.screenAudioTrack) {
      this.screenAudioTrack.stop();
      this.screenAudioTrack = null;
    }
    if (this.screenVideoTrack) {
      this.screenVideoTrack.stop();
      this.screenVideoTrack = null;
    }
    this.isSharing = false;
    this.emit('screen-stopped');
  }

  /**
   * Toggles or sets microphone mute state.
   * Guarantees 0% interference with screenAudioTrack.
   */
  setMicMuted(muted) {
    this.isMicOn = !muted;
    if (this.micAudioTrack) {
      this.micAudioTrack.enabled = this.isMicOn;
    }
    this.emit('state-changed', { isMicOn: this.isMicOn });
  }

  /**
   * Toggles or sets deafen state.
   */
  setDeafened(deafened) {
    this.isDeafened = deafened;
    if (deafened) {
      // Deafened implies microphone muted as well
      this.isMicOn = false;
      if (this.micAudioTrack) {
        this.micAudioTrack.enabled = false;
      }
    }
    this.emit('state-changed', { isDeafened: this.isDeafened, isMicOn: this.isMicOn });
  }

  /**
   * Adjusts volume slider for a specific user (0.0 to 2.0 / 0% to 200%)
   */
  setUserVolume(userId, volumePercent) {
    const clampedGain = Math.max(0.0, Math.min(2.0, volumePercent / 100));
    let gainNode = this.userMixers.get(userId);
    if (!gainNode) {
      gainNode = this.audioContext.createGain(1.0);
      this.userMixers.set(userId, gainNode);
    }
    gainNode.gain.setValueAtTime(clampedGain);
    return clampedGain;
  }

  /**
   * Adjusts volume slider for a specific stream (0.0 to 2.0 / 0% to 200%)
   */
  setStreamVolume(streamId, volumePercent) {
    const clampedGain = Math.max(0.0, Math.min(2.0, volumePercent / 100));
    let gainNode = this.streamMixers.get(streamId);
    if (!gainNode) {
      gainNode = this.audioContext.createGain(1.0);
      this.streamMixers.set(streamId, gainNode);
    }
    gainNode.gain.setValueAtTime(clampedGain);
    return clampedGain;
  }
}

/**
 * Mock Signaling Hub simulating the channel hierarchy and event contracts of PROJECT.md.
 */
export class MockSignalingHub extends EventEmitter {
  constructor() {
    super();
    this.defaultChannels = ['Geral', 'Cinema', 'Futebol', 'Gameplay'];
    this.channels = new Map(); // channelId -> { name, users: Map<id, client>, messages: [] }

    for (const name of this.defaultChannels) {
      const id = name.toLowerCase();
      this.channels.set(id, { id, name, users: new Map(), messages: [] });
    }
  }

  getChannelsList() {
    return Array.from(this.channels.values()).map((c) => ({
      id: c.id,
      name: c.name,
      userCount: c.users.size,
      activeStreams: Array.from(c.users.values()).filter((u) => u.isSharing).length
    }));
  }

  createChannel(name) {
    if (!name || typeof name !== 'string') {
      throw new Error('Nome do canal inválido');
    }
    const cleanName = name.trim().replace(/[^\w\s-]/gi, '').slice(0, 32);
    if (!cleanName) {
      throw new Error('Nome do canal não pode ser vazio');
    }
    const id = cleanName.toLowerCase().replace(/\s+/g, '-');
    if (this.channels.has(id)) {
      return this.channels.get(id);
    }
    const channel = { id, name: cleanName, users: new Map(), messages: [] };
    this.channels.set(id, channel);
    this.emit('channel-created', { id, name: cleanName });
    return channel;
  }

  joinChannel(client, channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Canal ${channelId} não encontrado`);
    }

    // Leave current channel if any
    if (client.channelId && client.channelId !== channelId) {
      this.leaveChannel(client);
    }

    client.channelId = channelId;
    channel.users.set(client.id, client);

    // Notify peers in channel
    this.emit('user-joined', {
      channelId,
      userId: client.id,
      name: client.name
    });

    return {
      channelId,
      users: Array.from(channel.users.values()).map((u) => ({
        id: u.id,
        name: u.name,
        isSharing: u.isSharing,
        isMicOn: u.isMicOn,
        isDeafened: u.isDeafened,
        isSpeaking: u.isSpeaking
      }))
    };
  }

  leaveChannel(client) {
    if (!client.channelId) return;
    const channel = this.channels.get(client.channelId);
    if (channel) {
      channel.users.delete(client.id);
      this.emit('user-left', {
        channelId: channel.id,
        userId: client.id,
        name: client.name
      });
    }
    client.channelId = null;
    if (client.isSharing) {
      client.stopScreenShare();
    }
  }

  updateUserState(client, updates = {}) {
    Object.assign(client, updates);
    if (client.channelId) {
      this.emit('user-state-changed', {
        channelId: client.channelId,
        userId: client.id,
        ...updates
      });
    }
  }

  sendChatMessage(client, text) {
    if (!client.channelId) throw new Error('Cliente não está em um canal');
    const channel = this.channels.get(client.channelId);
    const msg = {
      id: crypto.randomUUID(),
      channelId: client.channelId,
      senderName: client.name,
      text: String(text).slice(0, 1000),
      timestamp: Date.now()
    };
    channel.messages.push(msg);
    this.emit('chat-message', msg);
    return msg;
  }
}
