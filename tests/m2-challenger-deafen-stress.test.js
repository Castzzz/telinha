// tests/m2-challenger-deafen-stress.test.js
// Milestone 2 Iteration 2 Adversarial Stress Suite for DeafenController & Audio Isolation
// Verification of rapid deafen sequences, state transitions, and screen audio invariants.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VolumeMixerManager,
  VoiceActivityDetector,
  DeafenController,
  sanitizeVolumePercent
} from '../public/audio-manager.js';
import {
  MockAudioContext,
  MockMediaStream,
  MockMediaStreamTrack,
  MockGainNode
} from './helpers/mock-webrtc.js';

// Strict AudioParam Oracle to detect any non-finite floats (W3C specification)
class StrictMockAudioParam {
  constructor(initialValue = 1.0) {
    this._value = initialValue;
  }
  get value() { return this._value; }
  set value(v) {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new TypeError("Failed to set 'value' on 'AudioParam': Non-finite float");
    }
    this._value = v;
  }
  setValueAtTime(v, startTime) {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new TypeError("Failed to execute 'setValueAtTime': Non-finite float");
    }
    this._value = v;
  }
  linearRampToValueAtTime(v, endTime) {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new TypeError("Failed to execute 'linearRampToValueAtTime': Non-finite float");
    }
    this._value = v;
  }
  cancelScheduledValues(t) {}
}

class StrictMockGainNode {
  constructor(initialGain = 1.0) {
    this.gain = new StrictMockAudioParam(initialGain);
    this._connectedTo = [];
  }
  connect(dest) { this._connectedTo.push(dest); }
  disconnect() { this._connectedTo = []; }
}

class StrictMockAudioContext extends MockAudioContext {
  constructor() {
    super();
    this.currentTime = 0;
  }
  createGain(initial = 1.0) {
    return new StrictMockGainNode(initial);
  }
}

// -----------------------------------------------------------------------------
// SUITE 1: RAPID SEQUENCES OF SETDEAFENED (REPEATED TRUE / REPEATED FALSE)
// -----------------------------------------------------------------------------

test('STRESS 1.1: 100 Repeated setDeafened(true) with Initial Mic ON -> Undeafen Restores Mic', () => {
  const mockCtx = new StrictMockAudioContext();
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

  // Call setDeafened(true) 100 times in rapid succession
  for (let i = 0; i < 100; i++) {
    deafenCtrl.setDeafened(true);
    assert.equal(appState.myUser.isDeafened, true, `Iteration ${i}: isDeafened must be true`);
    assert.equal(appState.myUser.isMicOn, false, `Iteration ${i}: isMicOn must be forced to false`);
    assert.equal(micTrack.enabled, false, `Iteration ${i}: micTrack must be disabled`);
    assert.equal(screenTrack.enabled, true, `Iteration ${i}: screenTrack must stay enabled`);
    assert.equal(screenTrack.readyState, 'live', `Iteration ${i}: screenTrack must stay live`);
    assert.equal(mixer.isDeafened, true, `Iteration ${i}: mixer.isDeafened must be true`);
    assert.equal(mixer.masterDeafenGain.gain.value, 0.0, `Iteration ${i}: masterDeafenGain must be 0.0`);
  }

  // Undeafen once: MUST cleanly restore mic state to true
  deafenCtrl.setDeafened(false);
  assert.equal(appState.myUser.isDeafened, false, 'isDeafened must be restored to false');
  assert.equal(appState.myUser.isMicOn, true, 'isMicOn must be restored to true');
  assert.equal(micTrack.enabled, true, 'micTrack must be restored to enabled');
  assert.equal(screenTrack.enabled, true, 'screenTrack must stay enabled');
  assert.equal(screenTrack.readyState, 'live', 'screenTrack must stay live');
  assert.equal(mixer.isDeafened, false, 'mixer.isDeafened must be false');
  assert.equal(mixer.masterDeafenGain.gain.value, 1.0, 'masterDeafenGain must be restored to 1.0');
});

test('STRESS 1.2: 100 Repeated setDeafened(true) with Initial Mic OFF -> Undeafen Preserves Mic OFF', () => {
  const mockCtx = new StrictMockAudioContext();
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

  // Call setDeafened(true) 100 times
  for (let i = 0; i < 100; i++) {
    deafenCtrl.setDeafened(true);
    assert.equal(appState.myUser.isDeafened, true);
    assert.equal(appState.myUser.isMicOn, false);
    assert.equal(micTrack.enabled, false);
    assert.equal(screenTrack.enabled, true);
    assert.equal(screenTrack.readyState, 'live');
  }

  // Undeafen once: MUST preserve mic state as false
  deafenCtrl.setDeafened(false);
  assert.equal(appState.myUser.isDeafened, false);
  assert.equal(appState.myUser.isMicOn, false, 'Pre-deafen mic state was false, must remain false');
  assert.equal(micTrack.enabled, false, 'micTrack must remain false');
  assert.equal(screenTrack.enabled, true);
  assert.equal(screenTrack.readyState, 'live');
  assert.equal(mixer.isDeafened, false);
  assert.equal(mixer.masterDeafenGain.gain.value, 1.0);
});

test('STRESS 1.3: 100 Repeated setDeafened(false) while Already Undeafened (No-op Idempotency)', () => {
  const mockCtx = new StrictMockAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: mockCtx });
  const screenTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'som_do_pc' });
  const micTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'Microphone', enabled: true });

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

  // Call setDeafened(false) 100 times
  for (let i = 0; i < 100; i++) {
    deafenCtrl.setDeafened(false);
    assert.equal(appState.myUser.isDeafened, false);
    assert.equal(appState.myUser.isMicOn, true);
    assert.equal(micTrack.enabled, true);
    assert.equal(screenTrack.enabled, true);
    assert.equal(screenTrack.readyState, 'live');
    assert.equal(mixer.isDeafened, false);
    assert.equal(mixer.masterDeafenGain.gain.value, 1.0);
  }
});

test('STRESS 1.4: 100 Repeated setDeafened(false) after Single Deafen', () => {
  const mockCtx = new StrictMockAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: mockCtx });
  const screenTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'som_do_pc' });
  const micTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'Microphone', enabled: true });

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

  deafenCtrl.setDeafened(true);
  assert.equal(appState.myUser.isDeafened, true);
  assert.equal(appState.myUser.isMicOn, false);

  // Call setDeafened(false) 100 times
  for (let i = 0; i < 100; i++) {
    deafenCtrl.setDeafened(false);
    assert.equal(appState.myUser.isDeafened, false, `Iteration ${i}: isDeafened must stay false`);
    assert.equal(appState.myUser.isMicOn, true, `Iteration ${i}: isMicOn must stay true`);
    assert.equal(micTrack.enabled, true, `Iteration ${i}: micTrack must stay enabled`);
    assert.equal(screenTrack.enabled, true, `Iteration ${i}: screenTrack must stay enabled`);
    assert.equal(screenTrack.readyState, 'live', `Iteration ${i}: screenTrack must stay live`);
  }
});

test('STRESS 1.5: Truthy and Falsy Non-Boolean Coercion Resilience', () => {
  const mockCtx = new StrictMockAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: mockCtx });
  const screenTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'som_do_pc' });
  const micTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'Microphone', enabled: true });

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

  // Truthy inputs should activate deafen
  const truthyInputs = [1, 'true', {}, [1, 2], -1, 42, 'deafen'];
  for (const input of truthyInputs) {
    appState.myUser.isMicOn = true;
    appState.myUser.isDeafened = false;
    deafenCtrl.setDeafened(input);
    assert.equal(appState.myUser.isDeafened, true, `Truthy input ${String(input)} must set isDeafened true`);
    assert.equal(appState.myUser.isMicOn, false);
    assert.equal(screenTrack.enabled, true);
    assert.equal(screenTrack.readyState, 'live');
  }

  // Falsy inputs should deactivate deafen
  const falsyInputs = [0, '', null, undefined, NaN, false];
  for (const input of falsyInputs) {
    appState.myUser.isMicOn = true;
    appState.myUser.isDeafened = false;
    deafenCtrl.setDeafened(true); // first deafen
    assert.equal(appState.myUser.isDeafened, true);

    deafenCtrl.setDeafened(input);
    assert.equal(appState.myUser.isDeafened, false, `Falsy input ${String(input)} must set isDeafened false`);
    assert.equal(appState.myUser.isMicOn, true);
    assert.equal(screenTrack.enabled, true);
    assert.equal(screenTrack.readyState, 'live');
  }
});

// -----------------------------------------------------------------------------
// SUITE 2: RAPID INTERLEAVING OF DEAFEN, MIC MUTE/UNMUTE, AND SCREEN SHARING
// -----------------------------------------------------------------------------

test('STRESS 2.1: Alternating Square-Wave Cycles (500 Rapid Deafen Toggles)', () => {
  const mockCtx = new StrictMockAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: mockCtx });
  const screenTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'som_do_pc' });
  screenTrack.contentHint = 'music';
  const micTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'fifine Microphone Mono' });

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

  for (let cycle = 0; cycle < 500; cycle++) {
    const shouldDeafen = cycle % 2 === 0;
    deafenCtrl.setDeafened(shouldDeafen);

    // Invariant: screenTrack MUST ALWAYS BE LIVE AND ENABLED!
    assert.equal(screenTrack.enabled, true, `Cycle ${cycle}: screenTrack.enabled must be true`);
    assert.equal(screenTrack.readyState, 'live', `Cycle ${cycle}: screenTrack.readyState must be live`);
    assert.equal(screenTrack.contentHint, 'music', `Cycle ${cycle}: screenTrack.contentHint must be music`);

    if (shouldDeafen) {
      assert.equal(appState.myUser.isDeafened, true);
      assert.equal(appState.myUser.isMicOn, false);
      assert.equal(micTrack.enabled, false);
      assert.equal(mixer.masterDeafenGain.gain.value, 0.0);
    } else {
      assert.equal(appState.myUser.isDeafened, false);
      assert.equal(appState.myUser.isMicOn, true);
      assert.equal(micTrack.enabled, true);
      assert.equal(mixer.masterDeafenGain.gain.value, 1.0);
    }
  }
});

test('STRESS 2.2: Extreme Monte Carlo Fuzzing (5,000 Random Interleaved Operations)', () => {
  const mockCtx = new StrictMockAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: mockCtx });

  let screenTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'som_do_pc' });
  screenTrack.contentHint = 'music';
  let micTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'Microphone' });

  const appState = {
    myUser: { isMicOn: true, isDeafened: false },
    localScreenStream: new MockMediaStream([screenTrack]),
    localMicStream: new MockMediaStream([micTrack]),
    activeStreams: new Map()
  };

  const vadDetector = new VoiceActivityDetector({
    audioContext: mockCtx,
    onSpeechStart: () => {},
    onSpeechEnd: () => {}
  });

  const deafenCtrl = new DeafenController({
    appState,
    mixerManager: mixer,
    socket: { emit() {} },
    vadDetector
  });

  // Linear Congruential Generator for reproducible deterministic pseudo-randomness
  let seed = 1337;
  function rand() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  let isScreenSharingActive = true;

  for (let step = 0; step < 5000; step++) {
    const action = Math.floor(rand() * 8);

    switch (action) {
      case 0: // Set deafened true
        deafenCtrl.setDeafened(true);
        break;

      case 1: // Set deafened false
        deafenCtrl.setDeafened(false);
        break;

      case 2: // Toggle deafen
        deafenCtrl.toggleDeafen();
        break;

      case 3: // Mic toggle when NOT deafened
        if (!appState.myUser.isDeafened) {
          appState.myUser.isMicOn = rand() > 0.5;
          if (appState.localMicStream) {
            appState.localMicStream.getAudioTracks().forEach((t) => {
              t.enabled = appState.myUser.isMicOn;
            });
          }
          vadDetector.setEnabled(appState.myUser.isMicOn);
        }
        break;

      case 4: // Screen share stop
        if (isScreenSharingActive) {
          appState.localScreenStream = null;
          isScreenSharingActive = false;
        }
        break;

      case 5: // Screen share restart
        if (!isScreenSharingActive) {
          screenTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'som_do_pc' });
          screenTrack.contentHint = 'music';
          appState.localScreenStream = new MockMediaStream([screenTrack]);
          isScreenSharingActive = true;
        }
        break;

      case 6: { // Fuzz user volume [-200 to 500, NaN, non-numeric]
        const sample = rand();
        let val;
        if (sample < 0.1) val = NaN;
        else if (sample < 0.2) val = Infinity;
        else if (sample < 0.3) val = 'bad_volume';
        else val = (rand() * 400) - 100;
        const gain = mixer.setUserVolume('fuzz-user', val);
        assert.ok(gain >= 0.0 && gain <= 2.0, `Gain ${gain} out of bounds at step ${step}`);
        break;
      }

      case 7: { // Fuzz stream volume
        const val = rand() < 0.2 ? 'corrupt' : (rand() * 300);
        const gain = mixer.setStreamVolume('fuzz-stream', val);
        assert.ok(gain >= 0.0 && gain <= 3.0, `Stream gain ${gain} out of bounds at step ${step}`);
        break;
      }
    }

    // STRICT INVARIANTS CHECKED AT EVERY STEP:
    if (isScreenSharingActive && appState.localScreenStream) {
      const activeScreenAudio = appState.localScreenStream.getAudioTracks()[0];
      assert.ok(activeScreenAudio, `Step ${step}: screenAudio must exist`);
      assert.equal(
        activeScreenAudio.enabled,
        true,
        `Step ${step}: Outbound screen audio track MUST remain enabled === true`
      );
      assert.equal(
        activeScreenAudio.readyState,
        'live',
        `Step ${step}: Outbound screen audio track MUST remain readyState === "live"`
      );
    }

    if (appState.myUser.isDeafened) {
      assert.equal(
        appState.myUser.isMicOn,
        false,
        `Step ${step}: While deafened, isMicOn must strictly be false`
      );
      if (appState.localMicStream) {
        appState.localMicStream.getAudioTracks().forEach((t) => {
          assert.equal(t.enabled, false, `Step ${step}: micTrack must be disabled while deafened`);
        });
      }
      assert.equal(
        mixer.masterDeafenGain.gain.value,
        0.0,
        `Step ${step}: masterDeafenGain must be 0.0 while deafened`
      );
      assert.equal(
        vadDetector.isEnabled,
        false,
        `Step ${step}: VAD must be disabled while deafened`
      );
    } else {
      assert.equal(
        mixer.masterDeafenGain.gain.value,
        1.0,
        `Step ${step}: masterDeafenGain must be 1.0 when not deafened`
      );
    }
  }
});

// -----------------------------------------------------------------------------
// SUITE 3: DOM REMOTE MEDIA SILENCING UNDER JSDOM / BROWSER SIMULATION
// -----------------------------------------------------------------------------

test('STRESS 3.1: silenceAllRemoteMedia Mutes and Unmutes Remote Elements Cleanly', () => {
  // Simulate DOM elements
  const mockAudio1 = { muted: false };
  const mockAudio2 = { muted: false };
  const mockVideo1 = { muted: false };
  const mockVideo2 = { muted: false };

  globalThis.document = {
    getElementById(id) {
      if (id === 'voice-streams-container') {
        return {
          querySelectorAll(selector) {
            return selector === 'audio' ? [mockAudio1, mockAudio2] : [];
          }
        };
      }
      if (id === 'videos-grid') {
        return {
          querySelectorAll(selector) {
            return selector === 'video' ? [mockVideo1, mockVideo2] : [];
          }
        };
      }
      return null;
    }
  };

  const mockCtx = new StrictMockAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: mockCtx });
  const screenTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'som_do_pc' });

  const appState = {
    myUser: { isMicOn: true, isDeafened: false },
    localScreenStream: new MockMediaStream([screenTrack]),
    localMicStream: new MockMediaStream([]),
    activeStreams: new Map()
  };

  const deafenCtrl = new DeafenController({
    appState,
    mixerManager: mixer,
    socket: { emit() {} }
  });

  // 0. Por padrão ensurdecer cala só as vozes: as transmissões continuam tocando
  deafenCtrl.setDeafened(true);
  assert.equal(mockAudio1.muted, true, 'Remote audio 1 must be muted');
  assert.equal(mockVideo1.muted, false, 'Streams keep playing while deafened by default');
  assert.equal(mixer.streamBus.gain.value, 1.0, 'Stream bus stays open');
  assert.equal(mixer.masterDeafenGain.gain.value, 0.0, 'Voice bus is silenced');
  deafenCtrl.setDeafened(false);

  // 1. Deafen ON com a opção "ensurdecer também silencia as transmissões"
  mixer.setDeafenStreams(true);
  deafenCtrl.setDeafened(true);
  assert.equal(mixer.streamBus.gain.value, 0.0, 'Stream bus silenced');
  assert.equal(mockAudio1.muted, true, 'Remote audio 1 must be muted');
  assert.equal(mockAudio2.muted, true, 'Remote audio 2 must be muted');
  assert.equal(mockVideo1.muted, true, 'Remote video 1 must be muted');
  assert.equal(mockVideo2.muted, true, 'Remote video 2 must be muted');
  assert.equal(screenTrack.enabled, true, 'Local screen audio MUST remain enabled');

  // 2. Deafen OFF
  deafenCtrl.setDeafened(false);
  assert.equal(mockAudio1.muted, false, 'Remote audio 1 must be unmuted');
  assert.equal(mockAudio2.muted, false, 'Remote audio 2 must be unmuted');
  assert.equal(mockVideo1.muted, false, 'Remote video 1 must be unmuted');
  assert.equal(mockVideo2.muted, false, 'Remote video 2 must be unmuted');
  assert.equal(screenTrack.enabled, true, 'Local screen audio MUST remain enabled');

  // Clean up global DOM simulation
  delete globalThis.document;
});

// -----------------------------------------------------------------------------
// SUITE 4: EXTREME CORRUPTED INPUTS & DEFENSIVE BOUNDARIES
// -----------------------------------------------------------------------------

test('STRESS 4.1: Null, Undefined, and Missing MediaStreams Resilience', () => {
  const mockCtx = new StrictMockAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: mockCtx });

  // Completely empty / null streams
  const appState = {
    myUser: { isMicOn: true, isDeafened: false },
    localScreenStream: null,
    localMicStream: null,
    activeStreams: new Map()
  };

  const deafenCtrl = new DeafenController({
    appState,
    mixerManager: mixer,
    socket: { emit() {} }
  });

  // Toggling deafen when streams are null must not throw
  assert.doesNotThrow(() => {
    deafenCtrl.setDeafened(true);
  });
  assert.equal(appState.myUser.isDeafened, true);
  assert.equal(appState.myUser.isMicOn, false);

  assert.doesNotThrow(() => {
    deafenCtrl.setDeafened(false);
  });
  assert.equal(appState.myUser.isDeafened, false);
  assert.equal(appState.myUser.isMicOn, true);

  // appState null safety
  const brokenCtrl = new DeafenController({ appState: null, mixerManager: null, socket: null });
  assert.doesNotThrow(() => {
    brokenCtrl.setDeafened(true);
    brokenCtrl.toggleDeafen();
  });
});

test('STRESS 4.2: Zero-Audio-Track (Video Only) Screen Stream Invariant', () => {
  const mockCtx = new StrictMockAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: mockCtx });
  const videoTrack = new MockMediaStreamTrack({ kind: 'video', label: 'Screen Video' });

  const appState = {
    myUser: { isMicOn: true, isDeafened: false },
    localScreenStream: new MockMediaStream([videoTrack]), // zero audio tracks!
    localMicStream: new MockMediaStream([]),
    activeStreams: new Map()
  };

  const deafenCtrl = new DeafenController({
    appState,
    mixerManager: mixer,
    socket: { emit() {} }
  });

  assert.doesNotThrow(() => {
    deafenCtrl.setDeafened(true);
  });
  assert.equal(appState.myUser.isDeafened, true);
  assert.equal(videoTrack.enabled, true);
  assert.equal(videoTrack.readyState, 'live');

  assert.doesNotThrow(() => {
    deafenCtrl.setDeafened(false);
  });
  assert.equal(appState.myUser.isDeafened, false);
});

test('STRESS 4.3: Hostile Input Fuzzing against sanitizeVolumePercent', () => {
  const hostileInputs = [
    Symbol('volume'),
    100n, // BigInt
    {},
    { toString: () => 'not a number' },
    { valueOf: () => NaN },
    () => 50,
    [1, 2, 3],
    new Date(),
    /regex/,
    new Error('crash'),
    null,
    undefined,
    '',
    '   ',
    'NaN',
    'Infinity',
    '-Infinity',
    '150%',
    '1e2',
    '0x64',
    -0,
    +0
  ];

  for (const input of hostileInputs) {
    let result;
    assert.doesNotThrow(() => {
      result = sanitizeVolumePercent(input, 100);
    }, `sanitizeVolumePercent threw on input: ${String(input)}`);

    assert.equal(typeof result, 'number');
    assert.ok(!Number.isNaN(result), `sanitizeVolumePercent returned NaN for ${String(input)}`);
  }
});

