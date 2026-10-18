/**
 * tests/m1-challenger-stress.test.js
 * 
 * Empirical Adversarial & Concurrency Stress Test Suite for Milestone 1:
 * 1. Rapid Multi-Client Concurrency (Burst Connect / Disconnect / Abrupt Tear-down)
 * 2. High-Frequency Channel Hopping Storm across default & dynamic custom rooms
 * 3. Cross-Channel WebRTC Signal Spoofing & Isolation Verification
 * 4. High-Volume Chat Bursts, Circular Buffer Bound Clamping & Payload Truncation
 * 5. Adversarial Malformed Payload & Remote Denial-of-Service (DoS) Attack Vectors
 */

import { io as ioClient } from 'socket.io-client';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_SCRIPT = path.join(ROOT_DIR, 'server.js');
const BASE_TEST_PORT = 19200;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class TestServerInstance {
  constructor(port) {
    this.port = port;
    this.url = `http://127.0.0.1:${port}`;
    this.process = null;
    this.stderrOutput = '';
    this.stdoutOutput = '';
    this.exitCode = null;
    this.exitSignal = null;
    this.crashed = false;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.process = spawn('node', [SERVER_SCRIPT], {
        cwd: ROOT_DIR,
        env: { ...process.env, PORT: String(this.port) },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let started = false;
      const timeout = setTimeout(() => {
        if (!started) {
          this.kill();
          reject(new Error(`Server failed to start on port ${this.port} within 6000ms`));
        }
      }, 6000);

      this.process.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        this.stdoutOutput += text;
        if (text.includes('TELINHA') || text.includes(String(this.port))) {
          if (!started) {
            started = true;
            clearTimeout(timeout);
            resolve();
          }
        }
      });

      this.process.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        this.stderrOutput += text;
      });

      this.process.on('exit', (code, signal) => {
        this.exitCode = code;
        this.exitSignal = signal;
        if (code !== 0 && code !== null) {
          this.crashed = true;
        }
        if (!started) {
          clearTimeout(timeout);
          reject(new Error(`Server exited unexpectedly with code ${code}`));
        }
      });

      this.process.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  createClient(options = {}) {
    return ioClient(this.url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      ...options
    });
  }

  async isAlive() {
    try {
      const res = await fetch(`${this.url}/api/health`, { signal: AbortSignal.timeout(500) });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  kill() {
    if (this.process) {
      try {
        this.process.kill('SIGKILL');
      } catch {
        // ignore
      }
      this.process = null;
    }
  }
}

async function runEmpiricalStressSuite() {
  console.log('\n================================================================');
  console.log('⚡ TELINHA M1 EMPIRICAL ADVERSARIAL & CONCURRENCY HARNESS');
  console.log('================================================================');

  const mainServer = new TestServerInstance(BASE_TEST_PORT);
  await mainServer.start();
  console.log(`[Harness] Main test server running at ${mainServer.url}`);

  const testResults = [];

  try {
    // ------------------------------------------------------------------------
    // HARNESS 1: Rapid Multi-Client Burst Connect & Disconnect Stress
    // ------------------------------------------------------------------------
    console.log('\n[Challenge 1] Rapid Multi-Client Burst Connect & Disconnect Stress...');
    try {
      const TOTAL_CLIENTS = 40;
      const clients = [];

      const connectPromises = [];
      for (let i = 0; i < TOTAL_CLIENTS; i++) {
        const client = mainServer.createClient();
        clients.push(client);
        connectPromises.push(new Promise((resolve, reject) => {
          client.on('connect', resolve);
          client.on('connect_error', reject);
        }));
      }

      await Promise.all(connectPromises);
      assert.equal(clients.length, TOTAL_CLIENTS, 'All 40 clients connected successfully');

      const channelTargets = ['geral', 'cinema', 'futebol', 'gameplay', 'custom-alpha'];
      for (let i = 0; i < TOTAL_CLIENTS; i++) {
        const ch = channelTargets[i % channelTargets.length];
        clients[i].emit('join-channel', {
          channelId: ch,
          userName: `User-${i}`,
          isMicOn: i % 2 === 0,
          isDeafened: i % 4 === 0,
          isSharing: i % 5 === 0
        });
      }

      await wait(150);

      const healthRes = await fetch(`${mainServer.url}/api/health`);
      assert.equal(healthRes.status, 200);
      const healthData = await healthRes.json();
      assert.equal(healthData.totalUsers, TOTAL_CLIENTS);

      // Abruptly drop half the clients
      for (let i = 0; i < 20; i++) {
        clients[i].disconnect();
      }

      await wait(200);

      const channelsSummaryPromise = new Promise((resolve) => {
        clients[25].once('channels-list', resolve);
        clients[25].emit('get-channels');
      });
      const summary = await channelsSummaryPromise;

      const totalSurvivingUsers = summary.reduce((acc, ch) => acc + ch.userCount, 0);
      assert.equal(totalSurvivingUsers, 20, `Expected 20 active users after abrupt drop, got ${totalSurvivingUsers}`);

      // Drop remaining 20 clients
      for (let i = 20; i < TOTAL_CLIENTS; i++) {
        clients[i].disconnect();
      }

      await wait(200);

      const finalHealthRes = await fetch(`${mainServer.url}/api/health`);
      const finalHealth = await finalHealthRes.json();
      assert.equal(finalHealth.totalUsers, 0, 'All clients cleaned up after full disconnect');

      const channelsRes = await fetch(`${mainServer.url}/api/channels`);
      const finalChannels = await channelsRes.json();
      const nonDefaultCustom = finalChannels.filter(c => !c.isDefault);
      assert.equal(nonDefaultCustom.length, 0, 'Abandoned dynamic custom channels were pruned on empty');

      console.log('  ✓ Challenge 1 PASSED: Burst connect/disconnect & dynamic room cleanup verified.');
      testResults.push({ name: 'Challenge 1: Rapid Multi-Client Burst Connect/Disconnect', status: 'PASS' });
    } catch (err) {
      console.error('  ✗ Challenge 1 FAILED:', err.message);
      testResults.push({ name: 'Challenge 1: Rapid Multi-Client Burst Connect/Disconnect', status: 'FAIL', error: err.message });
    }

    // ------------------------------------------------------------------------
    // HARNESS 2: High-Frequency Channel Hopping Storm
    // ------------------------------------------------------------------------
    console.log('\n[Challenge 2] High-Frequency Channel Hopping Storm...');
    try {
      const HOPPING_CLIENTS = 10;
      const HOPS_PER_CLIENT = 15;
      const targetChannels = ['geral', 'cinema', 'futebol', 'gameplay', 'sala-temp-a', 'sala-temp-b'];
      const hopperClients = [];

      for (let i = 0; i < HOPPING_CLIENTS; i++) {
        hopperClients.push(mainServer.createClient());
      }

      await Promise.all(hopperClients.map(c => new Promise(r => c.on('connect', r))));

      const hopTasks = hopperClients.map(async (client, clientIndex) => {
        for (let hop = 0; hop < HOPS_PER_CLIENT; hop++) {
          const targetChannel = targetChannels[(clientIndex + hop) % targetChannels.length];
          client.emit('join-channel', {
            channelId: targetChannel,
            userName: `Hopper-${clientIndex}`,
            isSharing: hop % 3 === 0
          });
          await wait(5 + (hop % 3) * 5);
        }
      });

      await Promise.all(hopTasks);
      await wait(300);

      const summaryRes = await fetch(`${mainServer.url}/api/channels`);
      const channelsList = await summaryRes.json();

      let registeredCount = 0;
      const seenUserIds = new Set();

      for (const ch of channelsList) {
        for (const u of ch.users) {
          assert.ok(!seenUserIds.has(u.id), `User ${u.id} duplicated across channels during hopping!`);
          seenUserIds.add(u.id);
          registeredCount++;
        }
      }

      assert.equal(registeredCount, HOPPING_CLIENTS, `Expected ${HOPPING_CLIENTS} total registered users, found ${registeredCount}`);
      assert.equal(seenUserIds.size, HOPPING_CLIENTS, 'All hopper clients accounted for with zero duplication');

      hopperClients.forEach(c => c.disconnect());
      await wait(150);

      console.log('  ✓ Challenge 2 PASSED: Channel hopping storm (150 rapid hops across 10 clients) maintained 100% consistency.');
      testResults.push({ name: 'Challenge 2: High-Frequency Channel Hopping Storm', status: 'PASS' });
    } catch (err) {
      console.error('  ✗ Challenge 2 FAILED:', err.message);
      testResults.push({ name: 'Challenge 2: High-Frequency Channel Hopping Storm', status: 'FAIL', error: err.message });
    }

    // ------------------------------------------------------------------------
    // HARNESS 3: Cross-Channel Signal Spoofing & Isolation Attack
    // ------------------------------------------------------------------------
    console.log('\n[Challenge 3] Cross-Channel Signal Spoofing & Isolation Attack...');
    try {
      const alice = mainServer.createClient();
      const bob = mainServer.createClient();
      const charlie = mainServer.createClient();
      const rogue = mainServer.createClient();

      await Promise.all([
        new Promise(r => alice.on('connect', r)),
        new Promise(r => bob.on('connect', r)),
        new Promise(r => charlie.on('connect', r)),
        new Promise(r => rogue.on('connect', r))
      ]);

      alice.emit('join-channel', { channelId: 'geral', userName: 'Alice' });
      charlie.emit('join-channel', { channelId: 'geral', userName: 'Charlie' });
      bob.emit('join-channel', { channelId: 'cinema', userName: 'Bob' });

      await wait(150);

      const leakedSignals = [];
      const recordLeak = (evtName, data) => leakedSignals.push({ event: evtName, data });

      bob.on('webrtc-signal', (d) => recordLeak('webrtc-signal', d));
      bob.on('webrtc-offer', (d) => recordLeak('webrtc-offer', d));
      bob.on('webrtc-answer', (d) => recordLeak('webrtc-answer', d));
      bob.on('webrtc-ice-candidate', (d) => recordLeak('webrtc-ice-candidate', d));
      bob.on('request-stream', (d) => recordLeak('request-stream', d));

      const legitSignals = [];
      charlie.on('webrtc-signal', (d) => legitSignals.push({ event: 'webrtc-signal', d }));
      charlie.on('webrtc-offer', (d) => legitSignals.push({ event: 'webrtc-offer', d }));
      charlie.on('request-stream', (d) => legitSignals.push({ event: 'request-stream', d }));

      // Spoofing attempts: Alice targeting Bob in another channel
      alice.emit('webrtc-signal', {
        target: bob.id,
        type: 'screen',
        signal: { type: 'offer', sdp: 'fake-sdp-to-bob' }
      });
      alice.emit('webrtc-offer', {
        targetId: bob.id,
        sdp: { type: 'offer', sdp: 'fake-offer-to-bob' },
        type: 'screen'
      });
      alice.emit('webrtc-answer', {
        targetId: bob.id,
        sdp: { type: 'answer', sdp: 'fake-answer-to-bob' },
        type: 'screen'
      });
      alice.emit('webrtc-ice-candidate', {
        targetId: bob.id,
        candidate: { candidate: 'candidate:1 1 UDP ...' },
        type: 'screen'
      });
      alice.emit('request-stream', {
        targetId: bob.id,
        type: 'screen'
      });

      // Rogue (not in any channel) targeting Bob
      rogue.emit('webrtc-signal', {
        target: bob.id,
        type: 'voice',
        signal: { type: 'offer', sdp: 'rogue-sdp' }
      });

      // Legitimate signaling: Alice targeting Charlie in same channel
      alice.emit('webrtc-signal', {
        target: charlie.id,
        type: 'screen',
        signal: { type: 'offer', sdp: 'legit-alice-to-charlie' }
      });
      alice.emit('webrtc-offer', {
        targetId: charlie.id,
        sdp: { type: 'offer', sdp: 'legit-offer-to-charlie' },
        type: 'screen'
      });
      alice.emit('request-stream', {
        targetId: charlie.id,
        type: 'screen'
      });

      await wait(250);

      assert.equal(leakedSignals.length, 0, `Bob received ${leakedSignals.length} leaked signals: ${JSON.stringify(leakedSignals)}`);
      assert.equal(legitSignals.length, 3, `Expected 3 legitimate signals on Charlie, got ${legitSignals.length}`);

      alice.disconnect();
      bob.disconnect();
      charlie.disconnect();
      rogue.disconnect();
      await wait(100);

      console.log('  ✓ Challenge 3 PASSED: Cross-channel signal spoofing strictly blocked; intra-channel routing intact.');
      testResults.push({ name: 'Challenge 3: Cross-Channel Signal Spoofing & Isolation', status: 'PASS' });
    } catch (err) {
      console.error('  ✗ Challenge 3 FAILED:', err.message);
      testResults.push({ name: 'Challenge 3: Cross-Channel Signal Spoofing & Isolation', status: 'FAIL', error: err.message });
    }

    // ------------------------------------------------------------------------
    // HARNESS 4: Chat Message Burst, Circular Buffer Bound & Isolation
    // ------------------------------------------------------------------------
    console.log('\n[Challenge 4] Chat Message Burst, Circular Buffer Bound & Isolation...');
    try {
      const sender = mainServer.createClient();
      const inRoomReceiver = mainServer.createClient();
      const otherRoomReceiver = mainServer.createClient();

      await Promise.all([
        new Promise(r => sender.on('connect', r)),
        new Promise(r => inRoomReceiver.on('connect', r)),
        new Promise(r => otherRoomReceiver.on('connect', r))
      ]);

      sender.emit('join-channel', { channelId: 'futebol', userName: 'Striker' });
      inRoomReceiver.emit('join-channel', { channelId: 'futebol', userName: 'Defender' });
      otherRoomReceiver.emit('join-channel', { channelId: 'cinema', userName: 'Watcher' });

      await wait(150);

      const receivedInRoom = [];
      const receivedInOtherRoom = [];

      inRoomReceiver.on('chat-message', (msg) => receivedInRoom.push(msg));
      otherRoomReceiver.on('chat-message', (msg) => receivedInOtherRoom.push(msg));

      const BURST_COUNT = 75;
      for (let i = 0; i < BURST_COUNT; i++) {
        sender.emit('chat-message', { text: `Burst message #${i} - GOOOL!` });
      }

      await wait(300);

      assert.equal(receivedInOtherRoom.length, 0, 'Cross-channel chat leakage detected!');
      assert.equal(receivedInRoom.length, BURST_COUNT, `Expected ${BURST_COUNT} messages, got ${receivedInRoom.length}`);

      // Circular buffer limit verification
      const lateJoiner = mainServer.createClient();
      await new Promise(r => lateJoiner.on('connect', r));

      const statePromise = new Promise(resolve => lateJoiner.once('channel-state', resolve));
      lateJoiner.emit('join-channel', { channelId: 'futebol', userName: 'Goalkeeper' });
      const channelState = await statePromise;

      assert.equal(channelState.recentMessages.length, 50, `Buffer must be clamped to 50, got ${channelState.recentMessages.length}`);
      assert.equal(channelState.recentMessages[channelState.recentMessages.length - 1].text, `Burst message #${BURST_COUNT - 1} - GOOOL!`);

      // Oversized payload (20KB text) truncation verification
      const oversizedText = 'A'.repeat(20000);
      const oversizedPromise = new Promise(resolve => inRoomReceiver.once('chat-message', resolve));
      sender.emit('chat-message', { text: oversizedText });
      const truncatedMsg = await oversizedPromise;

      assert.ok(truncatedMsg.text.length <= 600, `Message length ${truncatedMsg.text.length} exceeded 600 characters`);
      assert.equal(truncatedMsg.text.length, 600, 'Message correctly truncated to 600 characters');

      // Valid empty/whitespace strings do not corrupt or crash
      sender.emit('chat-message', { text: '' });
      sender.emit('chat-message', { text: '   ' });

      await wait(100);

      sender.disconnect();
      inRoomReceiver.disconnect();
      otherRoomReceiver.disconnect();
      lateJoiner.disconnect();
      await wait(100);

      console.log('  ✓ Challenge 4 PASSED: Chat burst, 50-message buffer clamp, 600-char truncation & room isolation verified.');
      testResults.push({ name: 'Challenge 4: Chat Message Burst, Circular Buffer Bound & Isolation', status: 'PASS' });
    } catch (err) {
      console.error('  ✗ Challenge 4 FAILED:', err.message);
      testResults.push({ name: 'Challenge 4: Chat Message Burst, Circular Buffer Bound & Isolation', status: 'FAIL', error: err.message });
    }

  } finally {
    mainServer.kill();
    console.log('[Harness] Main test server stopped.');
  }

  // ------------------------------------------------------------------------
  // HARNESS 5: Adversarial Malformed Payload & Remote Denial of Service (DoS)
  // ------------------------------------------------------------------------
  console.log('\n[Challenge 5] Adversarial Malformed Payload & Remote Denial of Service (DoS) Investigation...');
  const dosVulnerabilities = [];

  const malformedAttackVectors = [
    { event: 'chat-message', payload: null, description: 'socket.emit("chat-message", null)' },
    { event: 'join-channel', payload: null, description: 'socket.emit("join-channel", null)' },
    { event: 'create-channel', payload: null, description: 'socket.emit("create-channel", null)' },
    { event: 'webrtc-signal', payload: null, description: 'socket.emit("webrtc-signal", null)' },
    { event: 'webrtc-offer', payload: null, description: 'socket.emit("webrtc-offer", null)' },
    { event: 'reaction', payload: null, description: 'socket.emit("reaction", null)' }
  ];

  for (let idx = 0; idx < malformedAttackVectors.length; idx++) {
    const vector = malformedAttackVectors[idx];
    const targetPort = BASE_TEST_PORT + 1 + idx;
    const testInstance = new TestServerInstance(targetPort);

    try {
      await testInstance.start();
      const attacker = testInstance.createClient();
      await new Promise((r) => attacker.on('connect', r));

      // First join a channel so user.channelId is set if required
      attacker.emit('join-channel', { channelId: 'geral', userName: 'Attacker' });
      await wait(100);

      // Fire malformed exploit payload
      attacker.emit(vector.event, vector.payload);
      await wait(150);

      // Check if server survived or crashed
      const alive = await testInstance.isAlive();
      if (!alive || testInstance.crashed) {
        console.error(`  💥 VULNERABILITY CONFIRMED: ${vector.description} crashed the server!`);
        console.error(`     Exit code: ${testInstance.exitCode}, Stderr:\n${testInstance.stderrOutput.trim()}`);
        dosVulnerabilities.push({
          vector: vector.description,
          event: vector.event,
          exitCode: testInstance.exitCode,
          stderr: testInstance.stderrOutput.trim()
        });
      } else {
        console.log(`  ✓ Resilient: ${vector.description} did not crash the server.`);
      }

      attacker.disconnect();
    } catch (err) {
      console.error(`  [Harness 5 error during ${vector.description}]:`, err.message);
    } finally {
      testInstance.kill();
      await wait(50);
    }
  }

  if (dosVulnerabilities.length > 0) {
    testResults.push({
      name: 'Challenge 5: Malformed Payload & Remote Denial of Service (DoS) Immunity',
      status: 'FAIL',
      error: `${dosVulnerabilities.length} DoS attack vector(s) crashed the server process via unhandled destructuring TypeError.`
    });
  } else {
    testResults.push({
      name: 'Challenge 5: Malformed Payload & Remote Denial of Service (DoS) Immunity',
      status: 'PASS'
    });
  }

  // ------------------------------------------------------------------------
  // FINAL SUMMARY & VERDICT
  // ------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('📊 CHALLENGE HARNESS SUMMARY:');
  for (const res of testResults) {
    const badge = res.status === 'PASS' ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${badge} - ${res.name}${res.error ? ` (${res.error})` : ''}`);
  }
  console.log('================================================================');

  const hasFailures = testResults.some(r => r.status === 'FAIL');
  const verdict = hasFailures ? 'REQUEST_CHANGES' : 'APPROVE';
  console.log(`\n👉 FINAL VERDICT: ${verdict}\n`);

  return { verdict, testResults, dosVulnerabilities };
}

runEmpiricalStressSuite()
  .then((res) => {
    // If verdict is REQUEST_CHANGES, exit code 1 to indicate issues found
    process.exit(res.verdict === 'APPROVE' ? 0 : 2);
  })
  .catch((err) => {
    console.error('Fatal Harness Error:', err);
    process.exit(1);
  });
