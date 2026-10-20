// tests/m2-challenger-volume-param-stress.test.js
// Milestone 2 Iteration 2 Adversarial Challenger Test Suite
// Focus: VolumeMixerManager & AudioParam Non-Finite Stress Testing & Fuzzing Oracle

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VolumeMixerManager,
  sanitizeVolumePercent
} from '../public/audio-manager.js';
import {
  MockAudioContext,
  MockMediaStream,
  MockMediaStreamTrack
} from './helpers/mock-webrtc.js';

// -----------------------------------------------------------------------------
// ADVERSARIAL AUDIO PARAM SPY & STRICT SPECIFICATION ORACLE
// -----------------------------------------------------------------------------

/**
 * Strict W3C Web Audio API AudioParam Oracle.
 * Under Section 4.5 of Web Audio spec:
 * "The provided float value must be finite. NaN, Infinity, and -Infinity are forbidden."
 * Any method call with a non-finite float MUST throw a TypeError.
 */
class StrictAuditingAudioParam {
  constructor(name, initialValue = 1.0) {
    this.name = name;
    this._value = initialValue;
    this.history = [];
  }

  _auditValue(fnName, val) {
    if (typeof val === 'number') {
      if (Number.isNaN(val)) {
        throw new TypeError(`[AudioParam Specification Violation] ${fnName} on '${this.name}' received NaN`);
      }
      if (!Number.isFinite(val)) {
        throw new TypeError(`[AudioParam Specification Violation] ${fnName} on '${this.name}' received non-finite value: ${val}`);
      }
      if (val < 0.0 || val > 2.0) {
        throw new RangeError(`[AudioParam Safety Boundary Violation] ${fnName} on '${this.name}' received out-of-range gain: ${val} (expected [0.0, 2.0])`);
      }
    } else {
      throw new TypeError(`[AudioParam Specification Violation] ${fnName} on '${this.name}' received non-numeric value: ${typeof val}`);
    }
  }

  _auditTime(fnName, time) {
    if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) {
      throw new TypeError(`[AudioParam Specification Violation] ${fnName} on '${this.name}' received invalid time: ${time}`);
    }
  }

  get value() {
    return this._value;
  }

  set value(v) {
    this._auditValue('set value', v);
    this._value = v;
    this.history.push({ op: 'set', value: v });
  }

  setValueAtTime(v, startTime) {
    this._auditValue('setValueAtTime', v);
    this._auditTime('setValueAtTime', startTime);
    this._value = v;
    this.history.push({ op: 'setValueAtTime', value: v, time: startTime });
  }

  linearRampToValueAtTime(v, endTime) {
    this._auditValue('linearRampToValueAtTime', v);
    this._auditTime('linearRampToValueAtTime', endTime);
    this._value = v;
    this.history.push({ op: 'linearRampToValueAtTime', value: v, time: endTime });
  }

  cancelScheduledValues(startTime) {
    this._auditTime('cancelScheduledValues', startTime);
    this.history.push({ op: 'cancelScheduledValues', time: startTime });
  }
}

class StrictAuditingGainNode {
  constructor(name = 'gainNode', initialGain = 1.0) {
    this.gain = new StrictAuditingAudioParam(name, initialGain);
    this._connectedTo = [];
  }

  connect(dest) {
    this._connectedTo.push(dest);
  }

  disconnect() {
    this._connectedTo = [];
  }
}

class StrictAuditingAudioContext extends MockAudioContext {
  constructor() {
    super();
    this.currentTime = 100.5;
    this.createdNodes = [];
  }

  createGain(initialGain = 1.0) {
    const node = new StrictAuditingGainNode(`gainNode_${this.createdNodes.length + 1}`, initialGain);
    this.createdNodes.push(node);
    return node;
  }
}

// -----------------------------------------------------------------------------
// ADVERSARIAL INPUT VECTORS
// -----------------------------------------------------------------------------

const ADVERSARIAL_INPUTS = [
  // 1. Non-finite IEEE-754 primitives
  { label: 'NaN', input: NaN, expectedGain: 1.0 },
  { label: 'Number.NaN', input: Number.NaN, expectedGain: 1.0 },
  { label: 'Positive Infinity', input: Infinity, expectedGain: 2.0 },
  { label: 'Number.POSITIVE_INFINITY', input: Number.POSITIVE_INFINITY, expectedGain: 2.0 },
  { label: 'String "+Infinity"', input: '+Infinity', expectedGain: 2.0 },
  { label: 'String "Infinity"', input: 'Infinity', expectedGain: 2.0 },
  { label: 'Negative Infinity', input: -Infinity, expectedGain: 0.0 },
  { label: 'Number.NEGATIVE_INFINITY', input: Number.NEGATIVE_INFINITY, expectedGain: 0.0 },
  { label: 'String "-Infinity"', input: '-Infinity', expectedGain: 0.0 },

  // 2. Nullish and Empty primitives
  { label: 'null', input: null, expectedGain: 1.0 },
  { label: 'undefined', input: undefined, expectedGain: 1.0 },
  { label: 'Empty String', input: '', expectedGain: 1.0 },
  { label: 'Whitespace String', input: '   ', expectedGain: 0.0 }, // Number(' ') === 0 -> 0% -> 0.0 gain
  { label: 'Tab and newline string', input: '\t\n', expectedGain: 0.0 }, // Number('\t\n') === 0 -> 0.0 gain

  // 3. Complex Objects, Arrays, and Functions
  { label: 'Empty Object {}', input: {}, expectedGain: 1.0 },
  { label: 'Object { value: 150 }', input: { value: 150 }, expectedGain: 1.0 },
  { label: 'Object.create(null)', input: Object.create(null), expectedGain: 1.0 },
  { label: 'Empty Array []', input: [], expectedGain: 1.0 },
  { label: 'Array [150]', input: [150], expectedGain: 1.0 },
  { label: 'Array [100, 200]', input: [100, 200], expectedGain: 1.0 },
  { label: 'Date Object', input: new Date(), expectedGain: 1.0 },
  { label: 'RegExp Object', input: /100/g, expectedGain: 1.0 },
  { label: 'Function returning 150', input: () => 150, expectedGain: 1.0 },

  // 4. Symbols and Non-Numeric Primitives
  { label: 'Symbol("volume")', input: Symbol('volume'), expectedGain: 1.0 },
  { label: 'Symbol.for("100")', input: Symbol.for('100'), expectedGain: 1.0 },
  { label: 'Boolean true', input: true, expectedGain: 1.0 },
  { label: 'Boolean false', input: false, expectedGain: 1.0 },
  { label: 'BigInt 100n', input: 100n, expectedGain: 1.0 },

  // 5. Extreme numeric values and boundary conditions
  { label: 'Number.MAX_VALUE', input: Number.MAX_VALUE, expectedGain: 2.0 },
  { label: '-Number.MAX_VALUE', input: -Number.MAX_VALUE, expectedGain: 0.0 },
  { label: 'Number.MIN_VALUE (subnormal)', input: Number.MIN_VALUE, expectedGain: 0.0 },
  { label: 'Number.MAX_SAFE_INTEGER', input: Number.MAX_SAFE_INTEGER, expectedGain: 2.0 },
  { label: 'Number.MIN_SAFE_INTEGER', input: Number.MIN_SAFE_INTEGER, expectedGain: 0.0 },
  { label: 'Negative Zero (-0)', input: -0, expectedGain: 0.0 },
  { label: 'Negative Number -100', input: -100, expectedGain: 0.0 },
  { label: 'Negative Float -0.0001', input: -0.0001, expectedGain: 0.0 },
  { label: 'Extreme boost 10,000%', input: 10000, expectedGain: 2.0 },
  { label: 'Extreme boost 1,000,000%', input: 1000000, expectedGain: 2.0 },
  { label: 'String "10000"', input: '10000', expectedGain: 2.0 },
  { label: 'String "-500"', input: '-500', expectedGain: 0.0 },

  // 6. Unparseable and malformed strings
  { label: 'String "abc"', input: 'abc', expectedGain: 1.0 },
  { label: 'String "100px"', input: '100px', expectedGain: 1.0 },
  { label: 'String "10,000%"', input: '10,000%', expectedGain: 1.0 },
  { label: 'String "100%"', input: '100%', expectedGain: 1.0 },
  { label: 'String "NaN"', input: 'NaN', expectedGain: 1.0 },
  { label: 'String "undefined"', input: 'undefined', expectedGain: 1.0 },
  { label: 'String "null"', input: 'null', expectedGain: 1.0 },
  { label: 'String "0x10" (hex)', input: '0x10', expectedGain: 0.16 }, // Number('0x10') === 16 -> 16% -> 0.16
  { label: 'String "0b101" (bin)', input: '0b101', expectedGain: 0.05 }, // Number('0b101') === 5 -> 5% -> 0.05
  { label: 'String "12.34.56"', input: '12.34.56', expectedGain: 1.0 },
  { label: 'String with null bytes', input: '100\x00\x00', expectedGain: 1.0 },
  { label: 'String "InfinityAndBeyond"', input: 'InfinityAndBeyond', expectedGain: 1.0 }
];

// =============================================================================
// TEST SUITE 1: sanitizeVolumePercent Adversarial Oracle
// =============================================================================

test('ADVERSARIAL 1.1: sanitizeVolumePercent rejects all non-numbers/symbols/objects without throwing', () => {
  for (const item of ADVERSARIAL_INPUTS) {
    let result;
    assert.doesNotThrow(() => {
      result = sanitizeVolumePercent(item.input, 100);
    }, `sanitizeVolumePercent must not throw for input: ${item.label}`);

    assert.equal(typeof result, 'number', `Output for ${item.label} must be a number`);
    assert.equal(Number.isNaN(result), false, `Output for ${item.label} must not be NaN`);
  }
});

test('ADVERSARIAL 1.2: sanitizeVolumePercent custom default fallback honor', () => {
  const customDefault = 42;
  assert.equal(sanitizeVolumePercent(NaN, customDefault), 42);
  assert.equal(sanitizeVolumePercent(null, customDefault), 42);
  assert.equal(sanitizeVolumePercent(undefined, customDefault), 42);
  assert.equal(sanitizeVolumePercent('invalid', customDefault), 42);
  assert.equal(sanitizeVolumePercent(Symbol('x'), customDefault), 42);
  assert.equal(sanitizeVolumePercent({}, customDefault), 42);
  assert.equal(sanitizeVolumePercent('', customDefault), 42);
});

// =============================================================================
// TEST SUITE 2: VolumeMixerManager & Strict AudioParam Non-Finite Rejection
// =============================================================================

test('ADVERSARIAL 2.1: setUserVolume with adversarial inputs never calls AudioParam with non-finite floats', () => {
  const ctx = new StrictAuditingAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: ctx });

  for (const item of ADVERSARIAL_INPUTS) {
    const userId = `user_${item.label.replace(/\s+/g, '_')}`;
    let gain;

    assert.doesNotThrow(() => {
      gain = mixer.setUserVolume(userId, item.input);
    }, `mixer.setUserVolume must not throw on AudioParam for ${item.label}`);

    assert.equal(typeof gain, 'number', `Returned gain for ${item.label} must be number`);
    assert.equal(Number.isFinite(gain), true, `Returned gain for ${item.label} must be finite`);
    assert.ok(gain >= 0.0 && gain <= 2.0, `Gain for ${item.label} (${gain}) must be in [0.0, 2.0]`);

    if (item.expectedGain !== undefined) {
      assert.ok(
        Math.abs(gain - item.expectedGain) < 1e-4,
        `Expected gain ~${item.expectedGain} for ${item.label}, got ${gain}`
      );
    }

    // Verify mixer internal state
    const entry = mixer.userMixers.get(userId);
    assert.ok(entry, `Mixer must record entry for ${userId}`);
    assert.equal(Number.isFinite(entry.volumePercent), true, `entry.volumePercent must be finite for ${item.label}`);
    assert.ok(entry.volumePercent >= 0 && entry.volumePercent <= 200, `entry.volumePercent must be in [0, 200]`);

    // Verify AudioParam history
    const nodeGainParam = entry.gainNode.gain;
    assert.ok(nodeGainParam.history.length > 0, `AudioParam history must record operations`);
    for (const record of nodeGainParam.history) {
      if (record.value !== undefined) {
        assert.equal(Number.isFinite(record.value), true, `AudioParam operation value must be finite`);
        assert.ok(record.value >= 0.0 && record.value <= 2.0, `AudioParam operation value must be in [0.0, 2.0]`);
      }
      if (record.time !== undefined) {
        assert.equal(Number.isFinite(record.time), true, `AudioParam operation time must be finite`);
      }
    }
  }
});

test('ADVERSARIAL 2.2: setStreamVolume with adversarial inputs never calls AudioParam with non-finite floats', () => {
  const ctx = new StrictAuditingAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: ctx });

  for (const item of ADVERSARIAL_INPUTS) {
    const streamId = `stream_${item.label.replace(/\s+/g, '_')}`;
    let gain;

    assert.doesNotThrow(() => {
      gain = mixer.setStreamVolume(streamId, item.input);
    }, `mixer.setStreamVolume must not throw on AudioParam for ${item.label}`);

    assert.equal(typeof gain, 'number', `Returned stream gain for ${item.label} must be number`);
    assert.equal(Number.isFinite(gain), true, `Returned stream gain for ${item.label} must be finite`);
    assert.ok(gain >= 0.0 && gain <= 3.0, `Stream gain for ${item.label} (${gain}) must be in [0.0, 3.0]`);

    // Transmissão vai até 300%: onde a voz trava em 2.0, a transmissão trava em 3.0
    const expectedGain = item.expectedGain === 2.0 ? 3.0 : item.expectedGain;
    if (expectedGain !== undefined) {
      assert.ok(
        Math.abs(gain - expectedGain) < 1e-4,
        `Expected stream gain ~${expectedGain} for ${item.label}, got ${gain}`
      );
    }

    const entry = mixer.streamMixers.get(streamId);
    assert.ok(entry, `Mixer must record stream entry for ${streamId}`);
    assert.equal(Number.isFinite(entry.volumePercent), true);
    assert.ok(entry.volumePercent >= 0 && entry.volumePercent <= 300);

    const nodeGainParam = entry.gainNode.gain;
    assert.ok(nodeGainParam.history.length > 0);
    for (const record of nodeGainParam.history) {
      if (record.value !== undefined) {
        assert.equal(Number.isFinite(record.value), true);
        assert.ok(record.value >= 0.0 && record.value <= 3.0);
      }
    }
  }
});

// =============================================================================
// TEST SUITE 3: Stream Attachment & Corrupted LocalStorage Oracle
// =============================================================================

test('ADVERSARIAL 3.1: attachUserStream and attachScreenStream with poisoned localStorage', () => {
  const ctx = new StrictAuditingAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: ctx });

  const mockTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'Test Audio' });
  const mockStream = new MockMediaStream([mockTrack]);

  // Poison localStorage with all kinds of corruption
  const poisonValues = ['NaN', 'undefined', 'null', 'Infinity', '-Infinity', '999999999', '-999999999', '{"bad":1}', ''];

  for (let i = 0; i < poisonValues.length; i++) {
    const val = poisonValues[i];
    const userId = `poison_user_${i}`;
    const streamId = `poison_stream_${i}`;

    // Mock localStorage behavior
    mixer.loadUserVolume = () => val;
    mixer.loadStreamVolume = () => val;

    let userGainNode, streamGainNode;

    assert.doesNotThrow(() => {
      userGainNode = mixer.attachUserStream(userId, mockStream, 'TestUser');
    }, `attachUserStream must not throw with poisoned localStorage value: ${val}`);

    assert.ok(userGainNode);
    assert.equal(Number.isFinite(userGainNode.gain.value), true);
    assert.ok(userGainNode.gain.value >= 0.0 && userGainNode.gain.value <= 2.0);

    assert.doesNotThrow(() => {
      streamGainNode = mixer.attachScreenStream(streamId, mockStream);
    }, `attachScreenStream must not throw with poisoned localStorage value: ${val}`);

    assert.ok(streamGainNode);
    assert.equal(Number.isFinite(streamGainNode.gain.value), true);
    assert.ok(streamGainNode.gain.value >= 0.0 && streamGainNode.gain.value <= 2.0);
  }
});

// =============================================================================
// TEST SUITE 4: High-Throughput Randomized Adversarial Fuzzing (10,000 Iterations)
// =============================================================================

test('ADVERSARIAL 4.1: High-throughput fuzzing harness (10,000 pseudo-random adversarial inputs)', () => {
  const ctx = new StrictAuditingAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: ctx });

  const fuzzGenerators = [
    // Extreme floats
    () => (Math.random() - 0.5) * 1e16,
    // Negative numbers
    () => -Math.random() * 1000,
    // Special IEEE 754 constants
    () => [NaN, Infinity, -Infinity, 0, -0, Number.MIN_VALUE, Number.MAX_VALUE, Number.EPSILON][Math.floor(Math.random() * 8)],
    // Random string representations of numbers
    () => String((Math.random() - 0.5) * 500),
    // Random garbage strings
    () => Math.random().toString(36).substring(2),
    // Numeric string with suffix
    () => `${Math.floor(Math.random() * 300)}%`,
    () => `${Math.floor(Math.random() * 300)}px`,
    // Whitespace permutations
    () => ' '.repeat(Math.floor(Math.random() * 5)),
    // Non-primitive types
    () => ({ random: Math.random() }),
    () => [Math.random(), Math.random()],
    () => null,
    () => undefined,
    () => Boolean(Math.random() > 0.5)
  ];

  const FUZZ_COUNT = 10000;
  for (let i = 0; i < FUZZ_COUNT; i++) {
    const gen = fuzzGenerators[i % fuzzGenerators.length];
    const fuzzInput = gen();

    const sanitized = sanitizeVolumePercent(fuzzInput, 100);
    assert.equal(typeof sanitized, 'number');
    assert.equal(Number.isNaN(sanitized), false);

    const userGain = mixer.setUserVolume('fuzz_user', fuzzInput);
    assert.equal(typeof userGain, 'number');
    assert.equal(Number.isFinite(userGain), true);
    assert.ok(userGain >= 0.0 && userGain <= 2.0);

    const streamGain = mixer.setStreamVolume('fuzz_stream', fuzzInput);
    assert.equal(typeof streamGain, 'number');
    assert.equal(Number.isFinite(streamGain), true);
    assert.ok(streamGain >= 0.0 && streamGain <= 3.0);
  }
});

// =============================================================================
// TEST SUITE 5: DeafenController & masterDeafenGain AudioParam Safety
// =============================================================================

test('ADVERSARIAL 5.1: setDeafened AudioParam safety with adversarial inputs', () => {
  const ctx = new StrictAuditingAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: ctx });

  const testDeafenInputs = [
    true, false, null, undefined, NaN, Infinity, -Infinity,
    'true', 'false', '', '1', 0, 1, Symbol('deafen'), {}, []
  ];

  for (const input of testDeafenInputs) {
    assert.doesNotThrow(() => {
      mixer.setDeafened(input);
    }, `mixer.setDeafened must not throw for input: ${String(input)}`);

    const masterParam = mixer.masterDeafenGain.gain;
    assert.ok(Number.isFinite(masterParam.value));
    assert.ok(masterParam.value === 0.0 || masterParam.value === 1.0);
  }
});

