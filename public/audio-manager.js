/**
 * public/audio-manager.js - Telinha Audio Pipeline & Linux Loopback Subsystem
 * Milestone 2: System Audio Loopback, High-Fidelity WebRTC Stereo Opus & Voice Isolation
 */

/**
 * Classifies if a device label represents a system audio loopback / monitor sink.
 * Matches: "Monitor of ...", "som_do_pc", "Som_do_PC_Jogos_e_Videos", "System Loopback", "Stereo Mix", etc.
 * @param {string} label
 * @returns {boolean}
 */
export function isSystemAudioLabel(label) {
  if (!label || typeof label !== 'string') return false;
  return /(^monitor\s*(of|de)?\b|(\b|_)(som[ _]do[ _]pc|jogos?[ _]e[ _]v[ií]deos?|sistema|loopback|stereo mix)(\b|_))/i.test(label);
}

/**
 * Classifies if a device label represents a physical microphone voice input.
 * @param {string} label
 * @returns {boolean}
 */
export function isMicrophoneLabel(label) {
  if (!label || typeof label !== 'string') return false;
  return !isSystemAudioLabel(label);
}

/**
 * Mutes/unmutes a remote <audio>/<video> element. Elements whose sound is played through
 * the Web Audio mixer stay muted forever: playing both doubles the audio (metallic/robotic voice).
 * @param {HTMLMediaElement} el
 * @param {boolean} muted
 */
export function setRemoteElementMuted(el, muted) {
  if (!el) return;
  el.muted = el.dataset && el.dataset.mixerOutput === '1' ? true : Boolean(muted);
}

/**
 * Categorizes a list of MediaDeviceInfo objects into system loopback sinks, microphones, and outputs.
 * @param {Array<MediaDeviceInfo>} devices
 */
export function detectAudioDevices(devices = []) {
  if (!Array.isArray(devices)) {
    return {
      systemAudioDevices: [],
      microphoneDevices: [],
      audioOutputs: [],
      defaultSystemAudio: null,
      defaultMicrophone: null
    };
  }

  const audioInputs = devices.filter((d) => d && d.kind === 'audioinput' && d.label);
  const audioOutputs = devices.filter((d) => d && d.kind === 'audiooutput' && d.label);

  const systemAudioDevices = audioInputs.filter((d) => isSystemAudioLabel(d.label));
  const microphoneDevices = audioInputs.filter((d) => isMicrophoneLabel(d.label));

  // Prioritize dedicated loopback sink ("som_do_pc" / "jogos"), otherwise default output monitor
  let defaultSystemAudio =
    systemAudioDevices.find((d) => /som[ _]do[ _]pc|jogos/i.test(d.label)) ||
    systemAudioDevices[0] ||
    null;

  // Prioritize USB microphone or standalone headset mic
  let defaultMicrophone =
    microphoneDevices.find((d) => /fifine|usb|headset/i.test(d.label)) ||
    microphoneDevices[0] ||
    null;

  return {
    systemAudioDevices,
    microphoneDevices,
    audioOutputs,
    defaultSystemAudio,
    defaultMicrophone
  };
}

/**
 * Enumerates audio devices, prompting for permission if labels are not yet populated.
 * @param {boolean} [promptIfNeeded=false]
 */
export async function refreshAudioDevices(promptIfNeeded = false) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return detectAudioDevices([]);
  }

  let devices = await navigator.mediaDevices.enumerateDevices();
  const hasLabels = devices.some((d) => d.kind === 'audioinput' && d.label.length > 0);

  if (!hasLabels && promptIfNeeded && navigator.mediaDevices.getUserMedia) {
    try {
      const streamProbe = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamProbe.getTracks().forEach((t) => t.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch (e) {
      console.warn('[AudioManager] Microphone permission probe declined:', e);
    }
  }

  return detectAudioDevices(devices);
}

/**
 * Generates authoritative media constraints for system audio loopback capture.
 * Mandates stereo 2-channel 48kHz capture with echoCancellation, noiseSuppression, and autoGainControl disabled.
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
 * Generates media constraints for voice microphone capture with speech optimizations.
 * @param {string} [microphoneDeviceId]
 */
export function generateMicrophoneConstraints(microphoneDeviceId) {
  return {
    audio: {
      deviceId: microphoneDeviceId ? { exact: microphoneDeviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      // Sem AGC: ele abaixava o mic sozinho quando a pessoa gritava (no Windows mexe até no volume do sistema)
      autoGainControl: false,
      channelCount: 1,
      sampleRate: { ideal: 48000 }
    },
    video: false
  };
}

/**
 * Ajusta o Opus no SDP (oferta ou resposta, idempotente — RFC 7587):
 * - stereo/sprop-stereo: estéreo pro som da transmissão, mono pra voz;
 * - maxaveragebitrate: taxa alvo do codificador;
 * - useinbandfec=1: manda redundância pra recuperar pacotes perdidos (Wi-Fi ruim);
 * - maxplaybackrate=48000: banda cheia (sem isso o Chromium pode cortar os agudos).
 * Parâmetros que já existiam e não são nossos (minptime, cbr…) são mantidos.
 *
 * @param {string} sdp
 * @param {{ stereo?: boolean, bitrate?: number }} [options]
 * @returns {string}
 */
export function tuneOpusSdp(sdp, { stereo = true, bitrate = 256000 } = {}) {
  if (!sdp || typeof sdp !== 'string') return sdp;

  // 1. Locate the dynamic payload type assigned to opus/48000/2
  const match = sdp.match(/a=rtpmap:(\d+)\s+opus\/48000\/2/i);
  if (!match) return sdp;
  const pt = match[1];

  const flag = stereo ? 1 : 0;
  const ours = `stereo=${flag};sprop-stereo=${flag};maxaveragebitrate=${bitrate};useinbandfec=1;maxplaybackrate=48000`;

  const fmtpRegex = new RegExp(`a=fmtp:${pt}\\s+(.*)`);
  if (fmtpRegex.test(sdp)) {
    return sdp.replace(fmtpRegex, (_, existingParams) => {
      // Clean previous tokens to ensure idempotency
      const cleaned = existingParams
        .split(';')
        .map((p) => p.trim())
        .filter((p) => p && !/^(stereo|sprop-stereo|maxaveragebitrate|useinbandfec|maxplaybackrate)=/i.test(p))
        .join(';');
      const prefix = cleaned ? `${cleaned};` : '';
      return `a=fmtp:${pt} ${prefix}${ours}`;
    });
  }

  // 2. If no fmtp line existed, insert it immediately following the rtpmap line
  return sdp.replace(
    new RegExp(`(a=rtpmap:${pt}\\s+opus\/48000\/2\r?\n)`, 'i'),
    `$1a=fmtp:${pt} ${ours}\r\n`
  );
}

/**
 * Som da transmissão: Opus estéreo em alta taxa.
 * @param {string} sdp
 * @param {number} [bitrate=256000]
 * @returns {string}
 */
export function enhanceOpusStereoSdp(sdp, bitrate = 256000) {
  return tuneOpusSdp(sdp, { stereo: true, bitrate });
}

/**
 * Voz: Opus mono. 64 kbps já é voz "de estúdio" (o padrão do Chromium é ~32 kbps).
 * @param {string} sdp
 * @param {number} [bitrate=64000]
 * @returns {string}
 */
export function enhanceOpusVoiceSdp(sdp, bitrate = 64000) {
  return tuneOpusSdp(sdp, { stereo: false, bitrate });
}

/**
 * Enforces maximum encoder bitrate on RTCRtpSender.
 * @param {RTCPeerConnection} pc
 * @param {MediaStreamTrack} audioTrack
 * @param {number} [maxBitrate=256000]
 */
export async function configureAudioSenderBitrate(pc, audioTrack, maxBitrate = 256000) {
  if (!pc || !pc.getSenders) return;
  const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio' && s.track === audioTrack);
  if (!sender || !sender.getParameters || !sender.setParameters) return;

  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = maxBitrate;
    await sender.setParameters(params);
  } catch (err) {
    console.warn('[AudioManager] Failed to configure RTCRtpSender maxBitrate:', err);
  }
}

/**
 * VoiceActivityDetector - Web Audio AnalyserNode Voice Activity Detection
 * Computes RMS dBFS on local microphone stream, applying thresholding with hangover hysteresis.
 */
export class VoiceActivityDetector {
  constructor(mediaStream, options = {}) {
    this.stream = mediaStream;
    const AudioContextClass = typeof window !== 'undefined'
      ? (window.AudioContext || window.webkitAudioContext)
      : null;
    this.audioContext = options.audioContext || (AudioContextClass ? new AudioContextClass() : null);
    this.thresholdDb = options.thresholdDb !== undefined ? options.thresholdDb : -48; // dBFS
    this.hangoverMs = options.hangoverMs !== undefined ? options.hangoverMs : 300; // ms
    this.onSpeakingChange = options.onSpeakingChange || (() => {});
    this.onVolumeLevel = options.onVolumeLevel || null; // (normLevel, db)

    this.sourceNode = null;
    this.analyserNode = null;
    this.dataArray = null;
    this.rafId = null;

    this.isSpeaking = false;
    this.lastSpokeTime = 0;
    this.lastEmitTime = 0;
    this.minEmitIntervalMs = 80;
    this.isEnabled = true;

    if (this.audioContext && this.stream) {
      this.initAudioGraph();
    }
  }

  initAudioGraph() {
    if (!this.stream || !this.stream.getAudioTracks || !this.stream.getAudioTracks().length) return;
    if (!this.audioContext) return;

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }

    try {
      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 512;
      this.analyserNode.smoothingTimeConstant = 0.2;

      this.sourceNode.connect(this.analyserNode);
      // NEVER connect to this.audioContext.destination (avoids mic echo loopback)

      this.dataArray = new Float32Array(this.analyserNode.fftSize);
      this.startLoop();
    } catch (err) {
      console.warn('[VAD] Failed to initialize audio graph:', err);
    }
  }

  setStream(newStream) {
    this.stop();
    this.stream = newStream;
    if (this.audioContext && this.stream) {
      this.initAudioGraph();
    }
  }

  setEnabled(enabled) {
    this.isEnabled = Boolean(enabled);
    if (!this.isEnabled && this.isSpeaking) {
      this.isSpeaking = false;
      this.onSpeakingChange(false);
      if (this.onVolumeLevel) this.onVolumeLevel(0, -100);
    }
  }

  setThreshold(db) {
    this.thresholdDb = Number(db);
  }

  startLoop() {
    if (typeof requestAnimationFrame === 'undefined') return;

    const processFrame = () => {
      if (!this.analyserNode || !this.isEnabled) {
        this.rafId = requestAnimationFrame(processFrame);
        return;
      }

      this.analyserNode.getFloatTimeDomainData(this.dataArray);

      // Compute Root Mean Square (RMS)
      let sumSquares = 0.0;
      for (let i = 0; i < this.dataArray.length; i++) {
        const val = this.dataArray[i];
        sumSquares += val * val;
      }
      const rms = Math.sqrt(sumSquares / this.dataArray.length);
      const db = 20 * Math.log10(Math.max(rms, 0.00001)); // epsilon prevents -infinity

      const now = Date.now();

      // Normalize volume level (0.0 to 1.0) for UI meter
      if (this.onVolumeLevel) {
        const norm = Math.max(0, Math.min(1, (db + 70) / 60));
        this.onVolumeLevel(norm, db);
      }

      // Voice Activity Decision Logic with Hangover Hysteresis
      if (db >= this.thresholdDb) {
        this.lastSpokeTime = now;
        if (!this.isSpeaking && (now - this.lastEmitTime >= this.minEmitIntervalMs)) {
          this.isSpeaking = true;
          this.lastEmitTime = now;
          this.onSpeakingChange(true);
        }
      } else if (this.isSpeaking && (now - this.lastSpokeTime > this.hangoverMs)) {
        if (now - this.lastEmitTime >= this.minEmitIntervalMs) {
          this.isSpeaking = false;
          this.lastEmitTime = now;
          this.onSpeakingChange(false);
        }
      }

      this.rafId = requestAnimationFrame(processFrame);
    };

    this.rafId = requestAnimationFrame(processFrame);
  }

  stop() {
    if (this.rafId && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch (_) {}
      this.sourceNode = null;
    }
    if (this.analyserNode) {
      try { this.analyserNode.disconnect(); } catch (_) {}
      this.analyserNode = null;
    }
    if (this.isSpeaking) {
      this.isSpeaking = false;
      this.onSpeakingChange(false);
    }
  }

  destroy() {
    this.stop();
  }
}

/**
 * Sanitize raw volume input to a valid numeric percent or fallback default.
 * Preserves +/-Infinity for boundary clamping while filtering NaN, unparseables, and invalid types.
 *
 * @param {*} volumePercent - Raw volume input
 * @param {number} [defaultPercent=100] - Safe fallback percentage
 * @returns {number} Sanitized numeric percentage
 */
export function sanitizeVolumePercent(volumePercent, defaultPercent = 100) {
  if (volumePercent === null || volumePercent === undefined || volumePercent === '') {
    return defaultPercent;
  }
  if (typeof volumePercent !== 'number' && typeof volumePercent !== 'string') {
    return defaultPercent;
  }
  const num = Number(volumePercent);
  if (Number.isNaN(num)) {
    return defaultPercent;
  }
  return num;
}

// Transmissão vai até 300% (filme baixinho); voz de cada pessoa até 200%
const MAX_STREAM_VOLUME_PERCENT = 300;

/**
 * VolumeMixerManager - Manages Web Audio GainNodes: 0–200% for users, 0–300% for streams
 */
export class VolumeMixerManager {
  constructor(options = {}) {
    const AudioContextClass = typeof window !== 'undefined'
      ? (window.AudioContext || window.webkitAudioContext)
      : null;
    this.audioContext = options.audioContext || (AudioContextClass ? new AudioContextClass() : null);
    this.userMixers = new Map(); // userId -> { sourceNode, gainNode, stream, volumePercent, userName }
    this.streamMixers = new Map(); // streamId -> { sourceNode, gainNode, stream, volumePercent }

    if (this.audioContext) {
      this.masterDeafenGain = this.audioContext.createGain ? this.audioContext.createGain() : null;
      if (this.masterDeafenGain && this.audioContext.destination) {
        try {
          this.masterDeafenGain.connect(this.audioContext.destination);
        } catch (_) {}
      }
    } else {
      this.masterDeafenGain = null;
    }
    this.isDeafened = false;
    this.masterVolume = 1.0; // volume geral do Telinha (0–2), multiplicado no mesmo ganho do ensurdecer
  }

  ensureAudioContext() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
  }

  /**
   * Attach an incoming voice MediaStream for a user
   */
  attachUserStream(userId, mediaStream, userName = '') {
    this.ensureAudioContext();
    this.detachUserStream(userId);

    if (!this.audioContext || !this.audioContext.createGain) {
      return null;
    }

    const gainNode = this.audioContext.createGain();
    let sourceNode = null;
    if (mediaStream && this.audioContext.createMediaStreamSource) {
      try {
        sourceNode = this.audioContext.createMediaStreamSource(mediaStream);
        sourceNode.connect(gainNode);
      } catch (err) {
        console.warn('[VolumeMixer] Error creating MediaStreamSource:', err);
      }
    }

    if (this.masterDeafenGain) {
      try { gainNode.connect(this.masterDeafenGain); } catch (_) {}
    }

    // Retrieve saved preference or default to 100%
    const savedVol = this.loadUserVolume(userId, userName);
    const safeVol = sanitizeVolumePercent(savedVol, 100);
    let clampedGain = Math.max(0.0, Math.min(2.0, safeVol / 100));
    if (!Number.isFinite(clampedGain)) clampedGain = 1.0;
    if (gainNode.gain && typeof gainNode.gain.setValueAtTime === 'function') {
      gainNode.gain.setValueAtTime(clampedGain, this.audioContext.currentTime || 0);
    } else if (gainNode.gain) {
      gainNode.gain.value = clampedGain;
    }

    const safeVolumePercent = safeVol === Infinity
      ? 200
      : safeVol === -Infinity
        ? 0
        : Math.max(0, Math.min(200, safeVol));

    this.userMixers.set(userId, {
      sourceNode,
      gainNode,
      stream: mediaStream,
      volumePercent: safeVolumePercent,
      userName
    });

    return gainNode;
  }

  /**
   * Attach an incoming screen system audio MediaStream
   */
  attachScreenStream(streamId, mediaStream) {
    this.ensureAudioContext();
    this.detachScreenStream(streamId);

    if (!this.audioContext || !this.audioContext.createGain) {
      return null;
    }

    const gainNode = this.audioContext.createGain();
    let sourceNode = null;
    if (mediaStream && this.audioContext.createMediaStreamSource) {
      try {
        sourceNode = this.audioContext.createMediaStreamSource(mediaStream);
        sourceNode.connect(gainNode);
      } catch (err) {
        console.warn('[VolumeMixer] Error creating MediaStreamSource for screen:', err);
      }
    }

    if (this.masterDeafenGain) {
      try { gainNode.connect(this.masterDeafenGain); } catch (_) {}
    }

    const savedVol = this.loadStreamVolume(streamId);
    const safeVol = sanitizeVolumePercent(savedVol, 100);
    let clampedGain = Math.max(0.0, Math.min(2.0, safeVol / 100));
    if (!Number.isFinite(clampedGain)) clampedGain = 1.0;
    if (gainNode.gain && typeof gainNode.gain.setValueAtTime === 'function') {
      gainNode.gain.setValueAtTime(clampedGain, this.audioContext.currentTime || 0);
    } else if (gainNode.gain) {
      gainNode.gain.value = clampedGain;
    }

    const safeVolumePercent = safeVol === Infinity
      ? 200
      : safeVol === -Infinity
        ? 0
        : Math.max(0, Math.min(200, safeVol));

    this.streamMixers.set(streamId, {
      sourceNode,
      gainNode,
      stream: mediaStream,
      volumePercent: safeVolumePercent
    });

    return gainNode;
  }

  /**
   * Set user volume (0% to 200%)
   * Clamps strictly to [0.0, 2.0]. Guarantees finite AudioParam values.
   */
  setUserVolume(userId, volumePercent) {
    const safePercent = sanitizeVolumePercent(volumePercent, 100);
    let clampedGain = Math.max(0.0, Math.min(2.0, safePercent / 100));
    if (!Number.isFinite(clampedGain)) {
      clampedGain = 1.0;
    }
    const safeVolumePercent = safePercent === Infinity
      ? 200
      : safePercent === -Infinity
        ? 0
        : Math.max(0, Math.min(200, safePercent));

    let entry = this.userMixers.get(userId);

    if (!entry) {
      const gainNode = this.audioContext && this.audioContext.createGain
        ? this.audioContext.createGain(1.0)
        : { gain: { value: 1.0, setValueAtTime(v) { this.value = v; } } };
      if (this.masterDeafenGain && gainNode.connect) {
        try { gainNode.connect(this.masterDeafenGain); } catch (_) {}
      }
      entry = { gainNode, sourceNode: null, stream: null, volumePercent: safeVolumePercent };
      this.userMixers.set(userId, entry);
    }

    entry.volumePercent = safeVolumePercent;

    if (entry.gainNode && entry.gainNode.gain) {
      const now = this.audioContext?.currentTime || 0;
      if (typeof entry.gainNode.gain.cancelScheduledValues === 'function') {
        entry.gainNode.gain.cancelScheduledValues(now);
        entry.gainNode.gain.linearRampToValueAtTime(clampedGain, now + 0.03);
      } else if (typeof entry.gainNode.gain.setValueAtTime === 'function') {
        entry.gainNode.gain.setValueAtTime(clampedGain, now);
      } else {
        entry.gainNode.gain.value = clampedGain;
      }
    }

    this.saveUserVolume(userId, entry.userName, entry.volumePercent);
    return clampedGain;
  }

  /**
   * Set stream volume (0% to 300%)
   * Clamps strictly to [0.0, 3.0]. Guarantees finite AudioParam values.
   */
  setStreamVolume(streamId, volumePercent) {
    const safePercent = sanitizeVolumePercent(volumePercent, 100);
    let clampedGain = Math.max(0.0, Math.min(MAX_STREAM_VOLUME_PERCENT / 100, safePercent / 100));
    if (!Number.isFinite(clampedGain)) {
      clampedGain = 1.0;
    }
    const safeVolumePercent = safePercent === Infinity
      ? MAX_STREAM_VOLUME_PERCENT
      : safePercent === -Infinity
        ? 0
        : Math.max(0, Math.min(MAX_STREAM_VOLUME_PERCENT, safePercent));

    let entry = this.streamMixers.get(streamId);

    if (!entry) {
      const gainNode = this.audioContext && this.audioContext.createGain
        ? this.audioContext.createGain(1.0)
        : { gain: { value: 1.0, setValueAtTime(v) { this.value = v; } } };
      if (this.masterDeafenGain && gainNode.connect) {
        try { gainNode.connect(this.masterDeafenGain); } catch (_) {}
      }
      entry = { gainNode, sourceNode: null, stream: null, volumePercent: safeVolumePercent };
      this.streamMixers.set(streamId, entry);
    }

    entry.volumePercent = safeVolumePercent;
    this.applyStreamGain(entry);

    this.saveStreamVolume(streamId, entry.volumePercent);
    return clampedGain;
  }

  /**
   * Silences a stream without losing its volume (hidden tile outside mosaic mode)
   */
  setStreamAudible(streamId, audible) {
    const entry = this.streamMixers.get(streamId);
    if (!entry) return;
    entry.audible = Boolean(audible);
    this.applyStreamGain(entry);
  }

  applyStreamGain(entry) {
    if (!entry.gainNode || !entry.gainNode.gain) return;
    let target = entry.audible === false ? 0 : Math.max(0.0, Math.min(2.0, entry.volumePercent / 100));
    if (!Number.isFinite(target)) target = 1.0;
    const now = this.audioContext?.currentTime || 0;
    if (typeof entry.gainNode.gain.cancelScheduledValues === 'function') {
      entry.gainNode.gain.cancelScheduledValues(now);
      entry.gainNode.gain.linearRampToValueAtTime(target, now + 0.03);
    } else if (typeof entry.gainNode.gain.setValueAtTime === 'function') {
      entry.gainNode.gain.setValueAtTime(target, now);
    } else {
      entry.gainNode.gain.value = target;
    }
  }

  /**
   * Mute or restore master output when deafened
   */
  setDeafened(deafened) {
    this.isDeafened = Boolean(deafened);
    this.applyMasterGain();
  }

  /**
   * Volume geral de tudo que o Telinha toca (vozes e transmissões), 0% a 200%
   */
  setMasterVolume(volumePercent) {
    const safePercent = sanitizeVolumePercent(volumePercent, 100);
    let gain = Math.max(0.0, Math.min(2.0, safePercent / 100));
    if (!Number.isFinite(gain)) gain = 1.0;
    this.masterVolume = gain;
    this.applyMasterGain();
    return gain;
  }

  applyMasterGain() {
    if (!this.masterDeafenGain || !this.masterDeafenGain.gain) return;

    const now = this.audioContext?.currentTime || 0;
    const targetGain = this.isDeafened ? 0.0 : this.masterVolume;
    if (typeof this.masterDeafenGain.gain.cancelScheduledValues === 'function') {
      this.masterDeafenGain.gain.cancelScheduledValues(now);
      this.masterDeafenGain.gain.linearRampToValueAtTime(targetGain, now + 0.03);
    } else if (typeof this.masterDeafenGain.gain.setValueAtTime === 'function') {
      this.masterDeafenGain.gain.setValueAtTime(targetGain, now);
    } else {
      this.masterDeafenGain.gain.value = targetGain;
    }
  }

  detachUserStream(userId) {
    const entry = this.userMixers.get(userId);
    if (!entry) return;
    try {
      if (entry.sourceNode) entry.sourceNode.disconnect();
      if (entry.gainNode) entry.gainNode.disconnect();
    } catch (_) {}
    this.userMixers.delete(userId);
  }

  detachScreenStream(streamId) {
    const entry = this.streamMixers.get(streamId);
    if (!entry) return;
    try {
      if (entry.sourceNode) entry.sourceNode.disconnect();
      if (entry.gainNode) entry.gainNode.disconnect();
    } catch (_) {}
    this.streamMixers.delete(streamId);
  }

  saveUserVolume(userId, userName, percent) {
    try {
      if (typeof localStorage !== 'undefined') {
        const num = Number(percent);
        const safe = Number.isFinite(num) ? Math.max(0, Math.min(200, num)) : 100;
        if (userId) localStorage.setItem(`telinha_user_vol_${userId}`, String(safe));
        if (userName) localStorage.setItem(`telinha_user_vol_name_${userName}`, String(safe));
      }
    } catch (_) {}
  }

  loadUserVolume(userId, userName) {
    try {
      if (typeof localStorage !== 'undefined') {
        if (userId) {
          const val = localStorage.getItem(`telinha_user_vol_${userId}`);
          if (val !== null && val !== '') {
            const num = Number(val);
            if (Number.isFinite(num)) {
              return Math.max(0, Math.min(200, num));
            }
          }
        }
        if (userName) {
          const val = localStorage.getItem(`telinha_user_vol_name_${userName}`);
          if (val !== null && val !== '') {
            const num = Number(val);
            if (Number.isFinite(num)) {
              return Math.max(0, Math.min(200, num));
            }
          }
        }
      }
    } catch (_) {}
    return 100;
  }

  saveStreamVolume(streamId, percent) {
    try {
      if (typeof localStorage !== 'undefined') {
        const num = Number(percent);
        const safe = Number.isFinite(num) ? Math.max(0, Math.min(MAX_STREAM_VOLUME_PERCENT, num)) : 100;
        localStorage.setItem(`telinha_stream_vol_${streamId}`, String(safe));
      }
    } catch (_) {}
  }

  loadStreamVolume(streamId) {
    try {
      if (typeof localStorage !== 'undefined') {
        const val = localStorage.getItem(`telinha_stream_vol_${streamId}`);
        if (val !== null && val !== '') {
          const num = Number(val);
          if (Number.isFinite(num)) {
            return Math.max(0, Math.min(MAX_STREAM_VOLUME_PERCENT, num));
          }
        }
      }
    } catch (_) {}
    return 100;
  }
}

/**
 * DeafenController - Coordinates media silencing, mic coordination, and volume restoration
 */
export class DeafenController {
  constructor({ appState, mixerManager, socket, vadDetector }) {
    this.appState = appState;
    this.mixerManager = mixerManager;
    this.socket = socket;
    this.vadDetector = vadDetector;
    this.wasMicOnBeforeDeafen = false;
  }

  toggleDeafen() {
    if (!this.appState || !this.appState.myUser) return;
    this.setDeafened(!this.appState.myUser.isDeafened);
  }

  setDeafened(deafened) {
    if (!this.appState || !this.appState.myUser) return;

    const targetDeafened = Boolean(deafened);

    // Early-exit idempotency guard: ignore redundant invocations with identical target state
    if (Boolean(this.appState.myUser.isDeafened) === targetDeafened) {
      return;
    }

    // Apply new deafen state
    this.appState.myUser.isDeafened = targetDeafened;

    if (targetDeafened) {
      // 1. Snapshot mic state prior to deafen (ONLY on false -> true transition)
      this.wasMicOnBeforeDeafen = Boolean(this.appState.myUser.isMicOn);

      // 2. Deafening forces mic off
      this.appState.myUser.isMicOn = false;
      if (this.vadDetector) {
        this.vadDetector.setEnabled(false);
      }

      // Disable mic hardware tracks without affecting screen audio
      if (this.appState.localMicStream) {
        this.appState.localMicStream.getAudioTracks().forEach((t) => { t.enabled = false; });
      }

      // 3. Silence all remote audio playback elements
      this.silenceAllRemoteMedia(true);
    } else {
      // 1. Restore all remote audio playback elements
      this.silenceAllRemoteMedia(false);

      // 2. Restore mic state to what it was prior to deafen
      this.appState.myUser.isMicOn = Boolean(this.wasMicOnBeforeDeafen);
      if (this.appState.localMicStream) {
        this.appState.localMicStream.getAudioTracks().forEach((t) => {
          t.enabled = this.appState.myUser.isMicOn;
        });
      }

      if (this.vadDetector) {
        this.vadDetector.setEnabled(this.appState.myUser.isMicOn);
      }
    }

    // 4. CRITICAL ISOLATION CHECK: Outbound screen loopback audio MUST remain active!
    if (this.appState.localScreenStream) {
      const screenAudio = this.appState.localScreenStream.getAudioTracks()[0];
      if (screenAudio) {
        screenAudio.enabled = true;
      }
    }

    // 5. Mute master mixer output
    if (this.mixerManager) {
      this.mixerManager.setDeafened(targetDeafened);
    }
  }

  silenceAllRemoteMedia(shouldMute) {
    if (typeof document === 'undefined') return;

    // A. Mute/unmute all incoming voice audio tags
    const voiceContainer = document.getElementById('voice-streams-container');
    if (voiceContainer) {
      const audios = voiceContainer.querySelectorAll('audio');
      audios.forEach((audio) => {
        setRemoteElementMuted(audio, shouldMute);
      });
    }

    // B. Mute/unmute all active screen videos
    const videoContainer = document.getElementById('videos-grid');
    if (videoContainer) {
      const videos = videoContainer.querySelectorAll('video');
      videos.forEach((video) => {
        setRemoteElementMuted(video, shouldMute);
      });
    }
  }
}

// Fonte criada pelo app desktop no Linux para transmitir o som de um app só
const APP_AUDIO_LABEL = /telinha[ _]jogo/i;

/**
 * AudioManager - High-level manager coordinating audio devices and acquisition
 */
export class AudioManager {
  constructor(options = {}) {
    this.selectedSystemAudioId =
      (typeof localStorage !== 'undefined' && localStorage.getItem('telinha_audio_system_id')) || null;
    this.selectedMicrophoneId =
      (typeof localStorage !== 'undefined' && localStorage.getItem('telinha_audio_input_id')) || null;
    this.selectedOutputId =
      (typeof localStorage !== 'undefined' && localStorage.getItem('telinha_audio_output_id')) || null;

    this.currentSystemAudioTrack = null;
    this.currentMicStream = null;

    this.volumeMixer = options.volumeMixer || new VolumeMixerManager();
    this.vad = null;
  }

  async initDevices() {
    const detected = await refreshAudioDevices(false);
    if (!this.selectedSystemAudioId && detected.defaultSystemAudio) {
      this.selectedSystemAudioId = detected.defaultSystemAudio.deviceId;
    }
    if (!this.selectedMicrophoneId && detected.defaultMicrophone) {
      this.selectedMicrophoneId = detected.defaultMicrophone.deviceId;
    }
    return detected;
  }

  async acquireSystemAudioTrack(preferredDeviceId = this.selectedSystemAudioId) {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return null;
    }

    // Só aceita dispositivos de som do sistema: cair no dispositivo padrão mandaria o microfone
    const detected = await refreshAudioDevices(true);
    const systemIds = detected.systemAudioDevices
      .filter((d) => !APP_AUDIO_LABEL.test(d.label))
      .map((d) => d.deviceId);
    const candidates = [];
    if (preferredDeviceId && systemIds.includes(preferredDeviceId)) candidates.push(preferredDeviceId);
    if (detected.defaultSystemAudio) candidates.push(detected.defaultSystemAudio.deviceId);
    systemIds.forEach((id) => candidates.push(id));

    for (const deviceId of new Set(candidates)) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(generateSystemAudioConstraints(deviceId));
        const track = stream.getAudioTracks()[0];
        if (track) {
          track.contentHint = 'music';
          this.currentSystemAudioTrack = track;
          this.selectedSystemAudioId = deviceId;
          return track;
        }
      } catch (err) {
        console.warn(`[AudioManager] System audio device ${deviceId} failed:`, err);
      }
    }
    return null;
  }

  /**
   * Captures only the app(s) moved to the "Telinha_Transmissao" virtual sink (Linux).
   * The source can take a moment to show up in enumerateDevices after being created.
   */
  async acquireAppAudioTrack(timeoutMs = 3000) {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const dev = devices.find((d) => d.kind === 'audioinput' && APP_AUDIO_LABEL.test(d.label));
      if (dev) {
        const stream = await navigator.mediaDevices.getUserMedia(generateSystemAudioConstraints(dev.deviceId));
        const track = stream.getAudioTracks()[0];
        if (track) {
          track.contentHint = 'music';
          this.currentSystemAudioTrack = track;
        }
        return track || null;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  }

  // noiseSuppression: false quando o Telinha aplica o RNNoise por conta própria (evita filtrar duas vezes)
  async acquireMicrophoneStream(preferredDeviceId = this.selectedMicrophoneId, { noiseSuppression = true } = {}) {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return null;
    }

    const constraints = generateMicrophoneConstraints(preferredDeviceId);
    constraints.audio.noiseSuppression = noiseSuppression;
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const track = stream.getAudioTracks()[0];
    if (track) {
      track.contentHint = 'speech';
    }
    this.currentMicStream = stream;
    return stream;
  }

  savePreferences(systemId, micId, outputId) {
    if (typeof localStorage === 'undefined') return;
    if (systemId) {
      this.selectedSystemAudioId = systemId;
      localStorage.setItem('telinha_audio_system_id', systemId);
    }
    if (micId) {
      this.selectedMicrophoneId = micId;
      localStorage.setItem('telinha_audio_input_id', micId);
    }
    if (outputId) {
      this.selectedOutputId = outputId;
      localStorage.setItem('telinha_audio_output_id', outputId);
    }
  }
}

// Bind to globalThis / window for browser and mixed execution contexts
if (typeof globalThis !== 'undefined') {
  globalThis.isSystemAudioLabel = isSystemAudioLabel;
  globalThis.isMicrophoneLabel = isMicrophoneLabel;
  globalThis.detectAudioDevices = detectAudioDevices;
  globalThis.refreshAudioDevices = refreshAudioDevices;
  globalThis.generateSystemAudioConstraints = generateSystemAudioConstraints;
  globalThis.generateMicrophoneConstraints = generateMicrophoneConstraints;
  globalThis.enhanceOpusStereoSdp = enhanceOpusStereoSdp;
  globalThis.enhanceOpusVoiceSdp = enhanceOpusVoiceSdp;
  globalThis.configureAudioSenderBitrate = configureAudioSenderBitrate;
  globalThis.VoiceActivityDetector = VoiceActivityDetector;
  globalThis.VolumeMixerManager = VolumeMixerManager;
  globalThis.DeafenController = DeafenController;
  globalThis.AudioManager = AudioManager;
  globalThis.sanitizeVolumePercent = sanitizeVolumePercent;
  globalThis.setRemoteElementMuted = setRemoteElementMuted;
}
