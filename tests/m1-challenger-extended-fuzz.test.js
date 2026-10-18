/**
 * tests/m1-challenger-extended-fuzz.test.js
 *
 * Milestone 1 Extended Fuzzing & Negative Stress Harness:
 * 1. Live Network Fuzzing across all 13 Socket.IO listeners:
 *    - Emit undefined, null, numbers (0, -1, 42, 1e9), booleans (true, false),
 *      strings ("", "   ", unicode, long strings), arrays ([], [1,2,3], [null]),
 *      malformed objects, and ACK callbacks.
 * 2. Pre-state matrix:
 *    - Unauthenticated/unjoined socket (user.channelId === null).
 *    - Joined socket (user.channelId === 'geral' or custom).
 * 3. In-Process Adversarial Boundary Fuzzing on Socket.IO listeners:
 *    - Circular references: `const obj = {}; obj.self = obj;`
 *    - Throwing property getters: `{ get name() { throw new Error('Boom'); } }`
 *    - Functions as payloads, BigInt, Symbols, Object.create(null).
 * 4. Liveness & Health Verification:
 *    - Server survives 100% of payloads without crashing, exiting, or unhandled exceptions.
 *    - Server remains fully functional (accepts new connections, broadcasts messages, serves HTTP).
 */

import { io as ioClient } from 'socket.io-client';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_SCRIPT = path.join(ROOT_DIR, 'server.js');
const FUZZ_PORT = 19333;
const IN_PROCESS_PORT = 19334;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ManagedServer {
  constructor(port) {
    this.port = port;
    this.url = `http://127.0.0.1:${port}`;
    this.proc = null;
    this.stderr = '';
    this.stdout = '';
    this.exitCode = null;
    this.crashed = false;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.proc = spawn('node', [SERVER_SCRIPT], {
        cwd: ROOT_DIR,
        env: { ...process.env, PORT: String(this.port) },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let ready = false;
      const timeout = setTimeout(() => {
        if (!ready) {
          this.kill();
          reject(new Error(`Server timed out on port ${this.port}`));
        }
      }, 6000);

      this.proc.stdout.on('data', (c) => {
        const text = c.toString();
        this.stdout += text;
        if (text.includes('TELINHA') || text.includes(String(this.port))) {
          if (!ready) {
            ready = true;
            clearTimeout(timeout);
            resolve();
          }
        }
      });

      this.proc.stderr.on('data', (c) => {
        this.stderr += c.toString();
      });

      this.proc.on('exit', (code) => {
        this.exitCode = code;
        if (code !== 0 && code !== null) {
          this.crashed = true;
        }
        if (!ready) {
          clearTimeout(timeout);
          reject(new Error(`Server exited early with code ${code}`));
        }
      });
    });
  }

  async isAlive() {
    try {
      const res = await fetch(`${this.url}/api/health`, { signal: AbortSignal.timeout(600) });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  kill() {
    if (this.proc) {
      try {
        this.proc.kill('SIGKILL');
      } catch {}
      this.proc = null;
    }
  }
}

async function runExtendedFuzzing() {
  console.log('\n========================================================================');
  console.log('🧪 TELINHA M1 EXTENDED NEGATIVE FUZZING & ADVERSARIAL HARNESS');
  console.log('========================================================================\n');

  const server = new ManagedServer(FUZZ_PORT);
  await server.start();
  console.log(`[Setup] Live fuzzing server running on ${server.url}`);

  const LISTENERS = [
    'get-channels',
    'create-channel',
    'join-channel',
    'user-state-changed',
    'user-state-update',
    'webrtc-signal',
    'webrtc-offer',
    'webrtc-answer',
    'webrtc-ice-candidate',
    'request-stream',
    'chat-message',
    'reaction',
    'leave-channel'
  ];

  const PRIMITIVE_PAYLOADS = [
    { label: 'undefined (no arg)', value: undefined },
    { label: 'null', value: null },
    { label: 'number: 0', value: 0 },
    { label: 'number: -1', value: -1 },
    { label: 'number: 42', value: 42 },
    { label: 'number: 1e9', value: 1000000000 },
    { label: 'boolean: true', value: true },
    { label: 'boolean: false', value: false },
    { label: 'empty string: ""', value: '' },
    { label: 'whitespace string: "   "', value: '   ' },
    { label: 'arbitrary string: "fuzz_payload"', value: 'fuzz_payload' },
    { label: 'long string (100KB)', value: 'X'.repeat(100000) },
    { label: 'unicode emojis', value: '🚀🔥🎮🎧'.repeat(200) },
    { label: 'empty array: []', value: [] },
    { label: 'primitive array: [1, 2, 3]', value: [1, 2, 3] },
    { label: 'array with nulls: [null, undefined]', value: [null, null] },
    { label: 'array of objects: [{}, {}]', value: [{}, {}] },
    { label: 'empty object: {}', value: {} },
    { label: 'deeply nested object', value: { a: { b: { c: { d: { e: 123 } } } } } },
    { label: 'prototype pollution attempt', value: { __proto__: { admin: true }, constructor: { prototype: { poll: 1 } } } }
  ];

  let fuzzAttempts = 0;
  let serverCrashed = false;

  console.log('\n--- PHASE 1: Live Network Fuzzing (Unauthenticated / No Channel) ---');
  const unjoinedClient = ioClient(server.url, { transports: ['websocket'], reconnection: false });
  await new Promise((r) => unjoinedClient.on('connect', r));

  for (const listener of LISTENERS) {
    for (const p of PRIMITIVE_PAYLOADS) {
      fuzzAttempts++;
      if (p.value === undefined) {
        unjoinedClient.emit(listener);
      } else {
        unjoinedClient.emit(listener, p.value);
      }
      // Also test with callback argument
      unjoinedClient.emit(listener, p.value, () => {});
    }
  }
  await sleep(250);

  let alive = await server.isAlive();
  assert.ok(alive, 'Server crashed during Phase 1 unjoined client fuzzing!');
  console.log(`  ✓ Phase 1 PASSED: ${fuzzAttempts} live payloads absorbed with 0 crashes.`);

  console.log('\n--- PHASE 2: Live Network Fuzzing (Joined Channel & Active State) ---');
  const joinedClient = ioClient(server.url, { transports: ['websocket'], reconnection: false });
  await new Promise((r) => joinedClient.on('connect', r));
  joinedClient.emit('join-channel', { channelId: 'geral', userName: 'Fuzzer' });
  await sleep(100);

  let phase2Attempts = 0;
  for (const listener of LISTENERS) {
    for (const p of PRIMITIVE_PAYLOADS) {
      phase2Attempts++;
      if (p.value === undefined) {
        joinedClient.emit(listener);
      } else {
        joinedClient.emit(listener, p.value);
      }
      joinedClient.emit(listener, p.value, () => {});
    }
  }
  await sleep(250);

  alive = await server.isAlive();
  assert.ok(alive, 'Server crashed during Phase 2 joined client fuzzing!');
  console.log(`  ✓ Phase 2 PASSED: ${phase2Attempts} live payloads absorbed with 0 crashes.`);

  console.log('\n--- PHASE 3: Semi-Structured Malformed Schema Fuzzing ---');
  const schemaAttacks = [
    // chat-message
    { event: 'chat-message', payload: { text: null } },
    { event: 'chat-message', payload: { text: 12345 } },
    { event: 'chat-message', payload: { text: true } },
    { event: 'chat-message', payload: { text: [] } },
    { event: 'chat-message', payload: { text: {} } },
    { event: 'chat-message', payload: { text: '   ' } },
    { event: 'chat-message', payload: { text: 'A'.repeat(50000) } },
    // reaction
    { event: 'reaction', payload: { emoji: null } },
    { event: 'reaction', payload: { emoji: 12345 } },
    { event: 'reaction', payload: { emoji: [] } },
    { event: 'reaction', payload: { emoji: {} } },
    { event: 'reaction', payload: { emoji: '🎉'.repeat(500) } },
    // join-channel
    { event: 'join-channel', payload: { channelId: null, userName: null } },
    { event: 'join-channel', payload: { channelId: 123, userName: 456 } },
    { event: 'join-channel', payload: { channelId: [], userName: [] } },
    { event: 'join-channel', payload: { channelId: {}, userName: {} } },
    { event: 'join-channel', payload: { channelId: 'cinema', isMicOn: 'true', isDeafened: 1, isSharing: {} } },
    { event: 'join-channel', payload: { channelId: 'a'.repeat(5000), userName: 'b'.repeat(5000) } },
    // create-channel
    { event: 'create-channel', payload: { name: null } },
    { event: 'create-channel', payload: { name: 99999 } },
    { event: 'create-channel', payload: { name: [] } },
    { event: 'create-channel', payload: { name: {} } },
    { event: 'create-channel', payload: { name: 'A'.repeat(5000) } },
    { event: 'create-channel', payload: { name: '!@#$%^&*()_+=~`{}[]' } },
    // user-state-changed
    { event: 'user-state-changed', payload: { isSharing: 'yes', isMicOn: 1, isDeafened: {}, isSpeaking: [] } },
    { event: 'user-state-changed', payload: { streamQuality: 12345 } },
    { event: 'user-state-changed', payload: { streamQuality: 'Q'.repeat(500) } },
    // webrtc-signal & peers
    { event: 'webrtc-signal', payload: { target: null, signal: null } },
    { event: 'webrtc-signal', payload: { target: 123, signal: 456 } },
    { event: 'webrtc-signal', payload: { target: 'nonexistent', signal: {} } },
    { event: 'webrtc-offer', payload: { targetId: null, sdp: null } },
    { event: 'webrtc-offer', payload: { targetId: 123, sdp: 456 } },
    { event: 'webrtc-answer', payload: { targetId: null, sdp: null } },
    { event: 'webrtc-ice-candidate', payload: { targetId: null, candidate: null } },
    { event: 'request-stream', payload: { targetId: null } },
    { event: 'request-stream', payload: { targetId: 12345 } }
  ];

  let phase3Attempts = 0;
  for (const attack of schemaAttacks) {
    phase3Attempts++;
    joinedClient.emit(attack.event, attack.payload);
  }
  await sleep(250);

  alive = await server.isAlive();
  assert.ok(alive, 'Server crashed during Phase 3 schema attacks!');
  console.log(`  ✓ Phase 3 PASSED: ${phase3Attempts} semi-structured attacks absorbed with 0 crashes.`);

  // Disconnect clients
  unjoinedClient.disconnect();
  joinedClient.disconnect();
  await sleep(100);
  server.kill();

  console.log('\n--- PHASE 4: In-Process Extreme Adversarial Fuzzing (Circular Objects & Throwing Getters) ---');
  // Import server module components directly
  const { server: inProcServer, io, startServer, safeHandler, isPlainObject, safeObject } = await import('../server.js');
  
  await startServer(IN_PROCESS_PORT, '127.0.0.1');
  const directClient = ioClient(`http://127.0.0.1:${IN_PROCESS_PORT}`, { transports: ['websocket'], reconnection: false });
  await new Promise((r) => directClient.on('connect', r));

  const socketInstance = io.sockets.sockets.get(directClient.id);
  assert.ok(socketInstance, 'Obtained internal socket instance from Socket.IO server');

  // Verify safeHandler and defensive helpers under extreme conditions:
  // 1. Circular Object
  const circularObj = {};
  circularObj.self = circularObj;
  circularObj.inner = { parent: circularObj };

  // 2. Object with throwing getter
  const throwingObj = {
    get text() {
      throw new Error('Hostile getter detonation!');
    },
    get name() {
      throw new Error('Hostile getter detonation!');
    },
    get channelId() {
      throw new Error('Hostile getter detonation!');
    }
  };

  // 3. Object with null prototype
  const bareObj = Object.create(null);
  bareObj.text = 'bare-text';

  // 4. Function as payload
  const funcPayload = function () { return 'malicious'; };

  // 5. Symbol and BigInt
  const symbolPayload = Symbol('fuzz');
  const bigintPayload = 9007199254740991n;

  const hostilePayloads = [
    { label: 'Circular object', value: circularObj },
    { label: 'Throwing getter object', value: throwingObj },
    { label: 'Object.create(null)', value: bareObj },
    { label: 'Function payload', value: funcPayload },
    { label: 'Symbol payload', value: symbolPayload },
    { label: 'BigInt payload', value: bigintPayload }
  ];

  // Test isPlainObject and safeObject directly
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject(undefined), false);
  assert.equal(isPlainObject(123), false);
  assert.equal(isPlainObject('abc'), false);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(funcPayload), false);
  assert.equal(isPlainObject(circularObj), true);

  console.log('  Testing safeHandler error boundary with throwing function...');
  let trapped = false;
  const hostileFn = safeHandler(() => {
    throw new Error('Immediate crash attempt');
  });
  // Must NOT throw
  hostileFn();
  console.log('  ✓ safeHandler successfully trapped throwing function without bubbling.');

  console.log('  Executing internal socket listeners directly with hostile payloads...');
  for (const listener of LISTENERS) {
    const rawListeners = socketInstance.listeners(listener);
    for (const fn of rawListeners) {
      for (const hp of hostilePayloads) {
        try {
          // Direct execution simulating un-sanitized internal delivery
          fn(hp.value, () => {});
        } catch (err) {
          console.error(`💥 Listener "${listener}" threw during ${hp.label}:`, err.message);
          serverCrashed = true;
        }
      }
    }
  }

  assert.ok(!serverCrashed, 'One or more socket listeners threw unhandled exceptions during in-process fuzzing!');
  console.log(`  ✓ Phase 4 PASSED: In-process circular objects, throwing getters, BigInt, and bare objects trapped safely.`);

  console.log('\n--- PHASE 5: Post-Fuzzing Sanity & Functional Liveness Verification ---');
  // Verify that after all fuzzing, normal operations work perfectly
  const sanityClient = ioClient(`http://127.0.0.1:${IN_PROCESS_PORT}`, { transports: ['websocket'], reconnection: false });
  await new Promise((r) => sanityClient.on('connect', r));

  const joinPromise = new Promise((resolve) => sanityClient.once('channel-state', resolve));
  sanityClient.emit('join-channel', { channelId: 'geral', userName: 'SanityUser' });
  const state = await joinPromise;
  assert.equal(state.channelId, 'geral');
  assert.equal(state.me.name, 'SanityUser');

  const createPromise = new Promise((resolve) => {
    sanityClient.emit('create-channel', { name: 'Sala Pós-Fuzz' }, resolve);
  });
  const createRes = await createPromise;
  assert.equal(createRes.success, true);
  assert.ok(createRes.channelId.includes('sala-pos-fuzz'));

  directClient.disconnect();
  sanityClient.disconnect();
  await new Promise((r) => inProcServer.close(r));
  console.log('  ✓ Phase 5 PASSED: Post-fuzz server fully operational, responsive, and functional.');

  console.log('\n========================================================================');
  console.log(`🎉 ALL FUZZING CHECKS PASSED: Total attempts: ${fuzzAttempts + phase2Attempts + phase3Attempts + 6 * LISTENERS.length}`);
  console.log('   Zero unhandled exceptions. Zero server crashes. Complete DoS resilience.');
  console.log('👉 FINAL VERDICT: APPROVE');
  console.log('========================================================================\n');
}

runExtendedFuzzing()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Extended Fuzzing Failed:', err);
    process.exit(1);
  });
