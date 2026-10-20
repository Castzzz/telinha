// tests/m2-challenger-webrtc-mesh.test.js
// Milestone 2 Empirical Challenger Test Suite
// Focus: WebRTC Dual-Mesh Signaling, VolumeMixerManager, VoiceActivityDetector, and DeafenController

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  VolumeMixerManager,
  VoiceActivityDetector,
  DeafenController,
  isSystemAudioLabel,
  isMicrophoneLabel,
  generateSystemAudioConstraints,
  generateMicrophoneConstraints,
  enhanceOpusStereoSdp
} from '../public/audio-manager.js';
import {
  MockAudioContext,
  MockMediaStream,
  MockMediaStreamTrack,
  MockRTCPeerConnection,
  MockGainNode
} from './helpers/mock-webrtc.js';

// -----------------------------------------------------------------------------
// STRICT TEST ORACLES & HARNESS UTILITIES
// -----------------------------------------------------------------------------

/**
 * Strict Web Audio AudioParam Oracle compliant with W3C Web Audio API specification.
 * Throws TypeError if a non-finite float (NaN, Infinity, -Infinity) is supplied.
 */
class StrictMockAudioParam {
  constructor(initialValue = 1.0) {
    this._value = initialValue;
  }

  get value() {
    return this._value;
  }

  set value(v) {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new TypeError("Failed to set 'value' on 'AudioParam': The provided float value is non-finite.");
    }
    this._value = v;
  }

  setValueAtTime(v, startTime) {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new TypeError("Failed to execute 'setValueAtTime' on 'AudioParam': The provided float value is non-finite.");
    }
    this._value = v;
  }

  linearRampToValueAtTime(v, endTime) {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new TypeError("Failed to execute 'linearRampToValueAtTime' on 'AudioParam': The provided float value is non-finite.");
    }
    this._value = v;
  }

  cancelScheduledValues(startTime) {}
}

class StrictMockGainNode {
  constructor(initialGain = 1.0) {
    this.gain = new StrictMockAudioParam(initialGain);
    this._connectedTo = [];
  }

  connect(dest) {
    this._connectedTo.push(dest);
  }

  disconnect() {
    this._connectedTo = [];
  }
}

class StrictMockAudioContext extends MockAudioContext {
  constructor() {
    super();
    this.currentTime = 0;
  }

  createGain(initialGain = 1.0) {
    return new StrictMockGainNode(initialGain);
  }
}

// =============================================================================
// SUITE 1: WebRTC Dual-Mesh Peer Map Lifecycle & Signaling Robustness
// =============================================================================

test('CHALLENGE 1.1: WebRTC Dual-Mesh Peer Separation (screenPeersOut vs screenPeersIn vs voicePeers)', () => {
  const peerId = 'peer-bob';
  const screenTrackAudio = new MockMediaStreamTrack({ kind: 'audio', label: 'som_do_pc' });
  const screenTrackVideo = new MockMediaStreamTrack({ kind: 'video', label: 'Screen Capture' });
  const micTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'Microphone' });

  const screenStream = new MockMediaStream([screenTrackAudio, screenTrackVideo]);
  const micStream = new MockMediaStream([micTrack]);

  // Dual-mesh maps
  const screenPeersOut = new Map();
  const screenPeersIn = new Map();
  const voicePeers = new Map();

  // 1. Establish outbound screen PC
  const pcScreenOut = new MockRTCPeerConnection();
  screenStream.getTracks().forEach((t) => pcScreenOut.addTrack(t, screenStream));
  screenPeersOut.set(peerId, pcScreenOut);

  // 2. Establish inbound screen PC (from another sender)
  const pcScreenIn = new MockRTCPeerConnection();
  screenPeersIn.set(peerId, pcScreenIn);

  // 3. Establish bidirectional voice PC
  const pcVoice = new MockRTCPeerConnection();
  micStream.getTracks().forEach((t) => pcVoice.addTrack(t, micStream));
  voicePeers.set(peerId, pcVoice);

  // Verifications
  assert.equal(screenPeersOut.size, 1);
  assert.equal(screenPeersIn.size, 1);
  assert.equal(voicePeers.size, 1);

  assert.notEqual(screenPeersOut.get(peerId), screenPeersIn.get(peerId), 'Inbound and outbound screen PCs must be isolated');
  assert.notEqual(screenPeersOut.get(peerId), voicePeers.get(peerId), 'Screen and voice PCs must be isolated');

  assert.equal(pcScreenOut.getSenders().length, 2, 'Screen Outbound must have 2 senders (audio + video)');
  assert.equal(pcVoice.getSenders().length, 1, 'Voice must have 1 sender (mic)');
});

test('CHALLENGE 1.2: ICE Candidate Queueing Prior to Remote Description', async () => {
  const iceCandidatesQueue = new Map();

  function enqueueIceCandidate(key, candidate) {
    if (!iceCandidatesQueue.has(key)) {
      iceCandidatesQueue.set(key, []);
    }
    iceCandidatesQueue.get(key).push(candidate);
  }

  async function drainIceCandidates(key, pc) {
    if (!iceCandidatesQueue.has(key) || !pc) return;
    const candidates = iceCandidatesQueue.get(key);
    iceCandidatesQueue.delete(key);

    for (const candidate of candidates) {
      await pc.addIceCandidate(candidate);
    }
  }

  const senderId = 'peer-alice';
  const key = `screen-in:${senderId}`;
  const pc = new MockRTCPeerConnection();

  const candidatesReceived = [];
  pc.addIceCandidate = async (c) => { candidatesReceived.push(c); };

  // 1. Trickle ICE arrives BEFORE setRemoteDescription (remoteDescription is null)
  assert.equal(pc.remoteDescription, null);
  const cand1 = { candidate: 'cand:1', sdpMid: '0' };
  const cand2 = { candidate: 'cand:2', sdpMid: '1' };

  if (pc.remoteDescription && pc.remoteDescription.type) {
    await pc.addIceCandidate(cand1);
  } else {
    enqueueIceCandidate(key, cand1);
  }

  if (pc.remoteDescription && pc.remoteDescription.type) {
    await pc.addIceCandidate(cand2);
  } else {
    enqueueIceCandidate(key, cand2);
  }

  assert.equal(candidatesReceived.length, 0, 'No candidate added to PC yet');
  assert.equal(iceCandidatesQueue.get(key).length, 2, '2 candidates queued in buffer');

  // 2. Offer arrives and setRemoteDescription executes
  await pc.setRemoteDescription({ type: 'offer', sdp: 'v=0...' });
  assert.notEqual(pc.remoteDescription, null);

  // 3. Drain executes
  await drainIceCandidates(key, pc);
  assert.equal(candidatesReceived.length, 2, 'All queued candidates delivered to PC');
  assert.equal(iceCandidatesQueue.has(key), false, 'Queue entry deleted after drain');

  // 4. Candidate arriving AFTER setRemoteDescription is applied immediately
  const cand3 = { candidate: 'cand:3', sdpMid: '0' };
  if (pc.remoteDescription && pc.remoteDescription.type) {
    await pc.addIceCandidate(cand3);
  } else {
    enqueueIceCandidate(key, cand3);
  }
  assert.equal(candidatesReceived.length, 3, 'Late candidate applied directly without queueing');
  assert.equal(iceCandidatesQueue.has(key), false);
});

test('CHALLENGE 1.3: WebRTC Concurrent Offers & Glare Handling Simulation', async () => {
  // Simulating Peer A and Peer B sending offers simultaneously
  const peerA = { voicePeers: new Map(), sentSignals: [] };
  const peerB = { voicePeers: new Map(), sentSignals: [] };

  // Peer A creates offer for Peer B
  const pcA = new MockRTCPeerConnection();
  peerA.voicePeers.set('B', pcA);
  const offerA = await pcA.createOffer();
  await pcA.setLocalDescription(offerA);

  // Peer B simultaneously creates offer for Peer A
  const pcB = new MockRTCPeerConnection();
  peerB.voicePeers.set('A', pcB);
  const offerB = await pcB.createOffer();
  await pcB.setLocalDescription(offerB);

  // Inbound offer handler on Peer A (glare resolution: close conflicting PC and answer)
  async function handleIncomingOffer(peer, senderId, sdp) {
    if (peer.voicePeers.has(senderId)) {
      try { peer.voicePeers.get(senderId).close(); } catch (_) {}
    }
    const newPc = new MockRTCPeerConnection();
    peer.voicePeers.set(senderId, newPc);
    await newPc.setRemoteDescription(sdp);
    const answer = await newPc.createAnswer();
    await newPc.setLocalDescription(answer);
    peer.sentSignals.push({ targetId: senderId, type: 'voice', sdp: newPc.localDescription });
    return newPc;
  }

  const resolvedPcA = await handleIncomingOffer(peerA, 'B', offerB);
  assert.equal(pcA.signalingState, 'closed', 'Conflicting initial PC cleanly closed');
  assert.equal(resolvedPcA.signalingState, 'stable');
  assert.equal(peerA.sentSignals.length, 1);
  assert.equal(peerA.sentSignals[0].sdp.type, 'answer');
});

test('CHALLENGE 1.4: WebRTC Answer Handling in Stable vs Non-Stable Signaling States', async () => {
  const pc = new MockRTCPeerConnection();
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  assert.equal(pc.signalingState, 'have-local-offer');

  let remoteDescCount = 0;
  const originalSetRemoteDesc = pc.setRemoteDescription.bind(pc);
  pc.setRemoteDescription = async (desc) => {
    remoteDescCount++;
    return originalSetRemoteDesc(desc);
  };

  const answer = await pc.createAnswer();

  // Valid Answer when in have-local-offer
  if (pc.signalingState !== 'stable') {
    await pc.setRemoteDescription(answer);
  }
  assert.equal(remoteDescCount, 1);
  assert.equal(pc.signalingState, 'stable');

  // Redundant / Late Answer arriving when already stable must be discarded
  if (pc.signalingState !== 'stable') {
    await pc.setRemoteDescription(answer);
  }
  assert.equal(remoteDescCount, 1, 'Redundant answer safely discarded without setting remote description');
});

test('CHALLENGE 1.5: Abrupt Participant Disconnection & Complete Peer Cleanup', () => {
  const userId = 'user-departing';
  const screenPeersOut = new Map([[userId, new MockRTCPeerConnection()]]);
  const screenPeersIn = new Map([[userId, new MockRTCPeerConnection()]]);
  const voicePeers = new Map([[userId, new MockRTCPeerConnection()]]);
  const activeStreams = new Map([[userId, { userName: 'Departing' }]]);

  function cleanupUserConnections(uid) {
    if (screenPeersOut.has(uid)) {
      try { screenPeersOut.get(uid).close(); } catch (_) {}
      screenPeersOut.delete(uid);
    }
    if (screenPeersIn.has(uid)) {
      try { screenPeersIn.get(uid).close(); } catch (_) {}
      screenPeersIn.delete(uid);
    }
    if (voicePeers.has(uid)) {
      try { voicePeers.get(uid).close(); } catch (_) {}
      voicePeers.delete(uid);
    }
    activeStreams.delete(uid);
  }

  // Initial state check
  assert.equal(screenPeersOut.size, 1);
  assert.equal(screenPeersIn.size, 1);
  assert.equal(voicePeers.size, 1);
  assert.equal(activeStreams.size, 1);

  // Execute cleanup
  cleanupUserConnections(userId);

  assert.equal(screenPeersOut.size, 0);
  assert.equal(screenPeersIn.size, 0);
  assert.equal(voicePeers.size, 0);
  assert.equal(activeStreams.size, 0);

  // Idempotency: repeated call does not throw
  assert.doesNotThrow(() => cleanupUserConnections(userId));
  assert.doesNotThrow(() => cleanupUserConnections('non-existent-user'));
});

test('CHALLENGE 1.6: Channel Switching with Active Streams Lifecycle', () => {
  const screenPeersOut = new Map([['user1', new MockRTCPeerConnection()]]);
  const screenPeersIn = new Map([['user2', new MockRTCPeerConnection()]]);
  const voicePeers = new Map([['user1', new MockRTCPeerConnection()]]);
  const iceCandidatesQueue = new Map([['voice:user1', [{ candidate: 'c1' }]]]);

  const screenTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'Screen Audio' });
  let localScreenStream = new MockMediaStream([screenTrack]);
  let isSharing = true;

  function onWebRTCChannelChange(oldId, newId) {
    for (const [, pc] of screenPeersIn.entries()) {
      try { pc.close(); } catch (_) {}
    }
    screenPeersIn.clear();

    for (const [, pc] of screenPeersOut.entries()) {
      try { pc.close(); } catch (_) {}
    }
    screenPeersOut.clear();

    for (const [, pc] of voicePeers.entries()) {
      try { pc.close(); } catch (_) {}
    }
    voicePeers.clear();

    iceCandidatesQueue.clear();

    if (isSharing) {
      if (localScreenStream) {
        localScreenStream.getTracks().forEach((t) => t.stop());
        localScreenStream = null;
      }
      isSharing = false;
    }
  }

  onWebRTCChannelChange('geral', 'cinema');

  assert.equal(screenPeersOut.size, 0);
  assert.equal(screenPeersIn.size, 0);
  assert.equal(voicePeers.size, 0);
  assert.equal(iceCandidatesQueue.size, 0);
  assert.equal(isSharing, false);
  assert.equal(screenTrack.readyState, 'ended');
});

// =============================================================================
// SUITE 2: VolumeMixerManager Boundary Clamping & Numeric Robustness
// =============================================================================

test('CHALLENGE 2.1: VolumeMixerManager Nominal Clamping [0, 50, 100, 150, 200]', () => {
  const mockCtx = new StrictMockAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: mockCtx });

  assert.equal(mixer.setUserVolume('u1', 0), 0.0);
  assert.equal(mixer.setUserVolume('u1', 50), 0.5);
  assert.equal(mixer.setUserVolume('u1', 100), 1.0);
  assert.equal(mixer.setUserVolume('u1', 150), 1.5);
  assert.equal(mixer.setUserVolume('u1', 200), 2.0);

  assert.equal(mixer.setStreamVolume('s1', 0), 0.0);
  assert.equal(mixer.setStreamVolume('s1', 100), 1.0);
  assert.equal(mixer.setStreamVolume('s1', 200), 2.0);
  assert.equal(mixer.setStreamVolume('s1', 300), 3.0);
});

test('CHALLENGE 2.2: VolumeMixerManager Extreme Boundaries (-10, -500, 500, Infinity)', () => {
  const mockCtx = new StrictMockAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: mockCtx });

  assert.equal(mixer.setUserVolume('u1', -10), 0.0, 'Negative value clamped to 0.0');
  assert.equal(mixer.setUserVolume('u1', -500), 0.0, 'Large negative clamped to 0.0');
  assert.equal(mixer.setUserVolume('u1', -Infinity), 0.0, '-Infinity clamped to 0.0');

  assert.equal(mixer.setUserVolume('u1', 250), 2.0, 'Value > 200 clamped to 2.0');
  assert.equal(mixer.setUserVolume('u1', 500), 2.0, 'Value 500 clamped to 2.0');
  assert.equal(mixer.setUserVolume('u1', Infinity), 2.0, '+Infinity clamped to 2.0');

  assert.equal(mixer.setStreamVolume('s1', -100), 0.0);
  assert.equal(mixer.setStreamVolume('s1', 1000), 3.0);
});

test('CHALLENGE 2.3: VolumeMixerManager Non-Numeric, NaN and Corrupted Inputs Clamping Oracle', () => {
  const mockCtx = new StrictMockAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: mockCtx });

  // Test String numeric values
  assert.equal(mixer.setUserVolume('u1', '150'), 1.5, 'String number 150 parsed to 1.5');
  assert.equal(mixer.setUserVolume('u1', '-20'), 0.0, 'String negative parsed and clamped');
  assert.equal(mixer.setUserVolume('u1', '350'), 2.0, 'String excess parsed and clamped');

  // Test null
  const nullResult = mixer.setUserVolume('u1', null);
  assert.equal(Number.isFinite(nullResult), true, 'null must produce a finite number');
  assert.ok(nullResult >= 0.0 && nullResult <= 2.0, 'null must clamp within [0.0, 2.0]');

  // Test NaN: must not throw uncaught exception and must clamp strictly to [0.0, 2.0]
  let nanResult;
  assert.doesNotThrow(() => {
    nanResult = mixer.setUserVolume('u1', NaN);
  }, 'setUserVolume(NaN) must not throw uncaught TypeError on AudioParam');
  assert.equal(Number.isFinite(nanResult), true, 'NaN volume input must be clamped to a finite number');
  assert.ok(nanResult >= 0.0 && nanResult <= 2.0, `Clamped gain for NaN (${nanResult}) must be in [0.0, 2.0]`);

  // Test non-numeric string 'invalid'
  let invalidResult;
  assert.doesNotThrow(() => {
    invalidResult = mixer.setUserVolume('u1', 'invalid');
  }, 'setUserVolume("invalid") must not throw uncaught TypeError on AudioParam');
  assert.equal(Number.isFinite(invalidResult), true, 'Non-numeric volume input must be clamped to a finite number');
  assert.ok(invalidResult >= 0.0 && invalidResult <= 2.0, `Clamped gain for "invalid" (${invalidResult}) must be in [0.0, 2.0]`);

  // Test undefined
  let undefinedResult;
  assert.doesNotThrow(() => {
    undefinedResult = mixer.setUserVolume('u1', undefined);
  }, 'setUserVolume(undefined) must not throw uncaught TypeError on AudioParam');
  assert.equal(Number.isFinite(undefinedResult), true, 'Undefined volume input must be clamped to a finite number');
  assert.ok(undefinedResult >= 0.0 && undefinedResult <= 2.0, `Clamped gain for undefined (${undefinedResult}) must be in [0.0, 2.0]`);

  // Test setStreamVolume with NaN
  let streamNanResult;
  assert.doesNotThrow(() => {
    streamNanResult = mixer.setStreamVolume('s1', NaN);
  }, 'setStreamVolume(NaN) must not throw uncaught TypeError on AudioParam');
  assert.equal(Number.isFinite(streamNanResult), true, 'NaN stream volume input must be clamped to a finite number');
  assert.ok(streamNanResult >= 0.0 && streamNanResult <= 2.0, `Clamped stream gain for NaN (${streamNanResult}) must be in [0.0, 2.0]`);
});

// =============================================================================
// SUITE 3: VoiceActivityDetector Energy Computation & Hangover Hysteresis
// =============================================================================

test('CHALLENGE 3.1: VAD Silence (All 0.0) Energy Computation', () => {
  let mockBuffer = new Float32Array(512).fill(0.0);

  class VADTestAudioContext extends MockAudioContext {
    createAnalyser() {
      return {
        fftSize: 512,
        smoothingTimeConstant: 0.2,
        getFloatTimeDomainData(dest) { dest.set(mockBuffer); },
        connect() {},
        disconnect() {}
      };
    }
  }

  let rafCb = null;
  globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
  globalThis.cancelAnimationFrame = () => { rafCb = null; };

  const track = new MockMediaStreamTrack({ kind: 'audio' });
  const stream = new MockMediaStream([track]);

  let speakingEvents = [];
  let volumeLevels = [];

  const vad = new VoiceActivityDetector(stream, {
    audioContext: new VADTestAudioContext(),
    thresholdDb: -48,
    hangoverMs: 300,
    onSpeakingChange: (s) => speakingEvents.push(s),
    onVolumeLevel: (norm, db) => volumeLevels.push({ norm, db })
  });

  rafCb(); // Run frame 1

  assert.equal(vad.isSpeaking, false, 'Silence must not trigger isSpeaking');
  assert.equal(speakingEvents.length, 0, 'No speaking events fired');
  assert.equal(volumeLevels.length, 1);
  assert.equal(volumeLevels[0].db, -100, 'All-zero buffer calculates to -100 dBFS via epsilon');
  assert.equal(volumeLevels[0].norm, 0.0, 'Normalized level clamped to 0.0 in silence');

  vad.destroy();
});

test('CHALLENGE 3.2: VAD Noise Floor Below Threshold (-60 dBFS)', () => {
  let mockBuffer = new Float32Array(512).fill(0.001); // 0.001 amplitude -> ~ -60 dBFS

  class VADTestAudioContext extends MockAudioContext {
    createAnalyser() {
      return {
        fftSize: 512,
        smoothingTimeConstant: 0.2,
        getFloatTimeDomainData(dest) { dest.set(mockBuffer); },
        connect() {},
        disconnect() {}
      };
    }
  }

  let rafCb = null;
  globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
  globalThis.cancelAnimationFrame = () => { rafCb = null; };

  const track = new MockMediaStreamTrack({ kind: 'audio' });
  const stream = new MockMediaStream([track]);

  let speakingEvents = [];
  let volumeLevels = [];

  const vad = new VoiceActivityDetector(stream, {
    audioContext: new VADTestAudioContext(),
    thresholdDb: -48, // threshold is -48 dBFS
    onSpeakingChange: (s) => speakingEvents.push(s),
    onVolumeLevel: (norm, db) => volumeLevels.push({ norm, db })
  });

  rafCb();

  assert.equal(vad.isSpeaking, false, 'Noise below threshold must not trip VAD');
  assert.equal(speakingEvents.length, 0);
  assert.ok(volumeLevels[0].db < -48, 'db must be lower than threshold');

  vad.destroy();
});

test('CHALLENGE 3.3 & 3.4: VAD Voice Burst & 300ms Hangover Window Timing', () => {
  let simTime = 1000;
  const originalDateNow = Date.now;
  Date.now = () => simTime;

  let mockBuffer = new Float32Array(512).fill(0.0);

  class VADTestAudioContext extends MockAudioContext {
    createAnalyser() {
      return {
        fftSize: 512,
        smoothingTimeConstant: 0.2,
        getFloatTimeDomainData(dest) { dest.set(mockBuffer); },
        connect() {},
        disconnect() {}
      };
    }
  }

  let rafCb = null;
  globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
  globalThis.cancelAnimationFrame = () => { rafCb = null; };

  const track = new MockMediaStreamTrack({ kind: 'audio' });
  const stream = new MockMediaStream([track]);

  let speakingEvents = [];

  const vad = new VoiceActivityDetector(stream, {
    audioContext: new VADTestAudioContext(),
    thresholdDb: -48,
    hangoverMs: 300,
    onSpeakingChange: (s) => speakingEvents.push({ time: simTime, speaking: s })
  });

  try {
    // 1. Initial silence
    mockBuffer.fill(0.0);
    rafCb();
    assert.equal(vad.isSpeaking, false);

    // 2. Voice burst (0.1 amplitude -> -20 dBFS)
    simTime += 100;
    mockBuffer.fill(0.1);
    rafCb();
    assert.equal(vad.isSpeaking, true, 'Voice burst must trigger isSpeaking = true');
    assert.equal(speakingEvents.length, 1);
    assert.equal(speakingEvents[0].speaking, true);

    // 3. Audio drops back to silence at +50ms
    simTime += 50;
    mockBuffer.fill(0.0);
    rafCb();
    assert.equal(vad.isSpeaking, true, 'Hangover window must maintain isSpeaking = true at +50ms');

    // 4. Audio remains silent at +200ms (within 300ms hangover)
    simTime += 150; // total 200ms since voice stopped
    rafCb();
    assert.equal(vad.isSpeaking, true, 'Hangover window must maintain isSpeaking = true at +200ms');

    // 5. Audio remains silent at +350ms (> 300ms hangover expired)
    simTime += 150; // total 350ms since voice stopped
    rafCb();
    assert.equal(vad.isSpeaking, false, 'Hangover window expired (> 300ms): isSpeaking must transition to false');
    assert.equal(speakingEvents.length, 2);
    assert.equal(speakingEvents[1].speaking, false);
  } finally {
    Date.now = originalDateNow;
    vad.destroy();
  }
});

test('CHALLENGE 3.5: VAD Disabled State Instant Cancellation', () => {
  let mockBuffer = new Float32Array(512).fill(0.1); // voice active

  class VADTestAudioContext extends MockAudioContext {
    createAnalyser() {
      return {
        fftSize: 512,
        smoothingTimeConstant: 0.2,
        getFloatTimeDomainData(dest) { dest.set(mockBuffer); },
        connect() {},
        disconnect() {}
      };
    }
  }

  let rafCb = null;
  globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
  globalThis.cancelAnimationFrame = () => { rafCb = null; };

  const track = new MockMediaStreamTrack({ kind: 'audio' });
  const stream = new MockMediaStream([track]);

  let speakingEvents = [];
  const vad = new VoiceActivityDetector(stream, {
    audioContext: new VADTestAudioContext(),
    thresholdDb: -48,
    onSpeakingChange: (s) => speakingEvents.push(s)
  });

  rafCb();
  assert.equal(vad.isSpeaking, true);

  // Disable VAD (e.g. mic mute)
  vad.setEnabled(false);
  assert.equal(vad.isEnabled, false);
  assert.equal(vad.isSpeaking, false, 'Disabling VAD must immediately cancel isSpeaking');
  assert.equal(speakingEvents.slice(-1)[0], false, 'Emitted speaking = false on disable');

  vad.destroy();
});

// =============================================================================
// SUITE 4: DeafenController Pre-Deafen State Preservation & Screen Audio Invariant
// =============================================================================

test('CHALLENGE 4.1: Standard Deafen Cycle with Mic ON Restores Mic State', () => {
  const mockCtx = new MockAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: mockCtx });

  const screenTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'som_do_pc' });
  const micTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'Microphone' });

  const appState = {
    myUser: { isMicOn: true, isDeafened: false },
    localScreenStream: new MockMediaStream([screenTrack]),
    localMicStream: new MockMediaStream([micTrack]),
    activeStreams: new Map()
  };

  const deafenCtrl = new DeafenController({
    appState,
    mixerManager: mixer,
    socket: { emit() {} }
  });

  // Activate deafen
  deafenCtrl.setDeafened(true);
  assert.equal(appState.myUser.isDeafened, true);
  assert.equal(appState.myUser.isMicOn, false, 'Deafen disables mic');
  assert.equal(micTrack.enabled, false);
  assert.equal(screenTrack.enabled, true, 'Screen loopback audio must remain enabled');
  assert.equal(screenTrack.readyState, 'live');

  // Deactivate deafen
  deafenCtrl.setDeafened(false);
  assert.equal(appState.myUser.isDeafened, false);
  assert.equal(appState.myUser.isMicOn, true, 'Pre-deafen mic state restored to ON');
  assert.equal(micTrack.enabled, true);
  assert.equal(screenTrack.enabled, true);
});

test('CHALLENGE 4.2: Standard Deafen Cycle with Mic OFF Preserves Muted State', () => {
  const mockCtx = new MockAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: mockCtx });

  const screenTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'som_do_pc' });
  const micTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'Microphone', enabled: false });

  const appState = {
    myUser: { isMicOn: false, isDeafened: false },
    localScreenStream: new MockMediaStream([screenTrack]),
    localMicStream: new MockMediaStream([micTrack]),
    activeStreams: new Map()
  };

  const deafenCtrl = new DeafenController({
    appState,
    mixerManager: mixer,
    socket: { emit() {} }
  });

  // Activate deafen
  deafenCtrl.setDeafened(true);
  assert.equal(appState.myUser.isDeafened, true);
  assert.equal(appState.myUser.isMicOn, false);

  // Deactivate deafen
  deafenCtrl.setDeafened(false);
  assert.equal(appState.myUser.isDeafened, false);
  assert.equal(appState.myUser.isMicOn, false, 'Mic was OFF prior to deafen; must remain OFF');
  assert.equal(micTrack.enabled, false);
});

test('CHALLENGE 4.3: Redundant / Repeated Deafen Invocations (Idempotency Challenge)', () => {
  const mockCtx = new MockAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: mockCtx });

  const screenTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'som_do_pc' });
  const micTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'Microphone' });

  const appState = {
    myUser: { isMicOn: true, isDeafened: false },
    localScreenStream: new MockMediaStream([screenTrack]),
    localMicStream: new MockMediaStream([micTrack]),
    activeStreams: new Map()
  };

  const deafenCtrl = new DeafenController({
    appState,
    mixerManager: mixer,
    socket: { emit() {} }
  });

  // 1. Initial Deafen: Mic is ON -> deafen(true)
  deafenCtrl.setDeafened(true);
  assert.equal(appState.myUser.isDeafened, true);
  assert.equal(appState.myUser.isMicOn, false);

  // 2. Redundant Deafen event (e.g. from network or UI click or hotkey debounce)
  deafenCtrl.setDeafened(true);

  // 3. Undeafen: User expects mic to be restored to ON!
  deafenCtrl.setDeafened(false);

  console.log('    [Empirical Observation] After redundant deafen and undeafen, isMicOn is:', appState.myUser.isMicOn);
  if (appState.myUser.isMicOn !== true) {
    console.warn('    ⚠️ [BUG CONFIRMED] DeafenController overwrites wasMicOnBeforeDeafen when setDeafened(true) is invoked redundantly!');
  }

  // Verification
  assert.equal(appState.myUser.isDeafened, false);
  assert.equal(
    appState.myUser.isMicOn,
    true,
    'Pre-deafen mic state was wiped out by redundant deafen invocation (expected isMicOn === true)'
  );
});

test('CHALLENGE 4.4: Outbound Screen Loopback Audio Invariant Under Rapid Toggling', () => {
  const mockCtx = new MockAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: mockCtx });

  const screenTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'som_do_pc' });
  screenTrack.contentHint = 'music';
  const micTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'Microphone' });

  const appState = {
    myUser: { isMicOn: true, isDeafened: false },
    localScreenStream: new MockMediaStream([screenTrack]),
    localMicStream: new MockMediaStream([micTrack]),
    activeStreams: new Map()
  };

  const deafenCtrl = new DeafenController({
    appState,
    mixerManager: mixer,
    socket: { emit() {} }
  });

  // Rapid toggling 20 times
  for (let i = 0; i < 20; i++) {
    deafenCtrl.setDeafened(i % 2 === 0);
    // Invariant: screenTrack.enabled MUST NEVER become false!
    assert.equal(screenTrack.enabled, true, `Screen track enabled invariant violated at iteration ${i}`);
    assert.equal(screenTrack.readyState, 'live', `Screen track readyState violated at iteration ${i}`);
  }
});
