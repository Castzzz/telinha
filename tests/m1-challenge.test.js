/**
 * tests/m1-challenge.test.js - Milestone 1 Empirical Challenge Harness
 * 
 * Adversarially challenges:
 * 1. Dynamic room creation & pruning behavior when empty (custom vs permanent default rooms).
 * 2. Real-time AO VIVO live badge state changes across multi-viewers (3+ viewers across multiple channels).
 * 3. Deafen and mute state synchronization across peers (rapid toggles, channel isolation).
 * 4. Legacy WebSocket /ws endpoint compatibility (RFC 6455 handshake, frame parsing, ping/pong, HTTP 426/400).
 */

import { io as ioClient } from 'socket.io-client';
import http from 'node:http';
import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_SCRIPT = path.join(ROOT_DIR, 'server.js');
const TEST_PORT = 19444;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let serverProcess = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', [SERVER_SCRIPT], {
      cwd: ROOT_DIR,
      env: { ...process.env, PORT: String(TEST_PORT) },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        stopServer();
        reject(new Error(`Server failed to start on port ${TEST_PORT} within 5000ms`));
      }
    }, 5000);

    serverProcess.stdout.on('data', (chunk) => {
      const msg = chunk.toString();
      if (msg.includes('TELINHA') || msg.includes(String(TEST_PORT))) {
        if (!started) {
          started = true;
          clearTimeout(timeout);
          resolve();
        }
      }
    });

    serverProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error(`Server process exited early with code ${code}`));
      }
    });
  });
}

async function stopServer() {
  if (serverProcess) {
    try {
      serverProcess.kill('SIGTERM');
    } catch {}
    serverProcess = null;
  }
}

function createSocketClient(name = 'Amigo') {
  const client = ioClient(BASE_URL, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false
  });
  return client;
}

async function runAllChallenges() {
  console.log('========================================================================');
  console.log('⚔️  MILESTONE 1 EMPIRICAL CHALLENGER TEST HARNESS');
  console.log('========================================================================\n');

  console.log(`[Setup] Spawning isolated server on port ${TEST_PORT}...`);
  await startServer();
  console.log(`[Setup] Server active at ${BASE_URL}\n`);

  let passed = 0;
  let failed = 0;

  async function challenge(title, testFn) {
    process.stdout.write(`  ● CHALLENGE: ${title} ... `);
    const start = Date.now();
    try {
      await testFn();
      const elapsed = Date.now() - start;
      console.log(`\x1b[32mPASSED\x1b[0m (${elapsed}ms)`);
      passed++;
    } catch (err) {
      const elapsed = Date.now() - start;
      console.log(`\x1b[31mFAILED\x1b[0m (${elapsed}ms)`);
      console.error(`    ↳ Error: ${err.message}`);
      if (err.stack) {
        console.error(`    ↳ Stack:\n${err.stack.split('\n').slice(1, 4).join('\n')}`);
      }
      failed++;
    }
  }

  try {
    // ========================================================================
    // SUITE 1: DYNAMIC ROOM CREATION & PRUNING BEHAVIOR
    // ========================================================================
    console.log('\n--- SUITE 1: Dynamic Room Creation & Pruning Lifecycle ---');

    await challenge('1.1: Default permanent channels are pre-seeded and flagged isDefault', async () => {
      const res = await fetch(`${BASE_URL}/api/channels`);
      assert.equal(res.status, 200);
      const list = await res.json();
      const defaults = ['geral', 'cinema', 'futebol', 'gameplay'];
      for (const d of defaults) {
        const found = list.find((c) => c.id === d);
        assert.ok(found, `Default channel "${d}" must be present`);
        assert.equal(found.isDefault, true, `Channel "${d}" must have isDefault === true`);
      }
    });

    await challenge('1.2: Dynamic room creation broadcasts channel-created and updates channels-list', async () => {
      const clientA = createSocketClient('Alice');
      const clientB = createSocketClient('Bob');

      await Promise.all([
        new Promise((r) => clientA.on('connect', r)),
        new Promise((r) => clientB.on('connect', r))
      ]);

      const createdPromiseB = new Promise((resolve) => clientB.once('channel-created', resolve));
      const summaryPromiseB = new Promise((resolve) => {
        clientB.on('channels-list', (list) => {
          const ch = list.find((c) => c.id === 'super-devs');
          if (ch) resolve(list);
        });
      });

      const createRes = await new Promise((resolve) => {
        clientA.emit('create-channel', { name: 'Super Devs' }, resolve);
      });

      assert.equal(createRes.success, true);
      assert.equal(createRes.channelId, 'super-devs');
      assert.equal(createRes.channelName, 'Super Devs');

      const createdEvt = await createdPromiseB;
      assert.equal(createdEvt.channel.id, 'super-devs');
      assert.equal(createdEvt.channel.userCount, 0);

      const summaryList = await summaryPromiseB;
      const ch = summaryList.find((c) => c.id === 'super-devs');
      assert.ok(ch, 'Created channel must appear in global channels-list');
      assert.equal(ch.isDefault, false, 'Custom channel must have isDefault === false');
      assert.equal(ch.userCount, 0);

      clientA.disconnect();
      clientB.disconnect();
    });

    await challenge('1.3: Custom room persists while populated and prunes automatically when empty', async () => {
      const c1 = createSocketClient('User1');
      const c2 = createSocketClient('User2');
      const observer = createSocketClient('Observer');

      await Promise.all([
        new Promise((r) => c1.on('connect', r)),
        new Promise((r) => c2.on('connect', r)),
        new Promise((r) => observer.on('connect', r))
      ]);

      // Create custom room
      const createRes = await new Promise((resolve) => {
        c1.emit('create-channel', { name: 'Sala Torneio' }, resolve);
      });
      const roomId = createRes.channelId; // 'sala-torneio'

      // c1 joins
      c1.emit('join-channel', { channelId: roomId, userName: 'User1' });
      await new Promise((r) => c1.once('channel-state', r));

      // c2 joins
      c2.emit('join-channel', { channelId: roomId, userName: 'User2' });
      await new Promise((r) => c2.once('channel-state', r));

      // Verify channel has 2 users
      const res1 = await fetch(`${BASE_URL}/api/channels`);
      const list1 = await res1.json();
      const ch1 = list1.find((c) => c.id === roomId);
      assert.ok(ch1);
      assert.equal(ch1.userCount, 2);

      // User1 leaves by switching to geral -> channel must NOT be pruned (User2 remains)
      c1.emit('join-channel', { channelId: 'geral', userName: 'User1' });
      await new Promise((r) => c1.once('channel-state', r));
      await sleep(50);

      const res2 = await fetch(`${BASE_URL}/api/channels`);
      const list2 = await res2.json();
      const ch2 = list2.find((c) => c.id === roomId);
      assert.ok(ch2, 'Custom channel must NOT be deleted while 1 user is still inside');
      assert.equal(ch2.userCount, 1);

      // User2 disconnects -> channel now empty, must be PRUNED!
      const prunePromise = new Promise((resolve) => {
        observer.on('channels-list', (channels) => {
          if (!channels.some((c) => c.id === roomId)) {
            resolve(channels);
          }
        });
      });

      c2.disconnect();

      const finalChannels = await prunePromise;
      assert.ok(!finalChannels.some((c) => c.id === roomId), 'Empty custom room must be pruned from channels-list');

      // Verify REST API confirms deletion
      const res3 = await fetch(`${BASE_URL}/api/channels`);
      const list3 = await res3.json();
      assert.ok(!list3.some((c) => c.id === roomId), 'Empty custom room must be pruned from REST /api/channels');

      c1.disconnect();
      observer.disconnect();
    });

    await challenge('1.4: Permanent default rooms are IMMUNE to pruning even when 0 users remain', async () => {
      const client = createSocketClient('Tester');
      await new Promise((r) => client.on('connect', r));

      // Join default room "cinema"
      client.emit('join-channel', { channelId: 'cinema', userName: 'Tester' });
      await new Promise((r) => client.once('channel-state', r));

      // Leave "cinema" to "geral"
      client.emit('join-channel', { channelId: 'geral', userName: 'Tester' });
      await new Promise((r) => client.once('channel-state', r));

      // Check all 4 default channels still exist with 0 users in cinema
      const res = await fetch(`${BASE_URL}/api/channels`);
      const list = await res.json();
      const cinema = list.find((c) => c.id === 'cinema');
      assert.ok(cinema, 'Default room "cinema" must NEVER be pruned');
      assert.equal(cinema.isDefault, true);
      assert.equal(cinema.userCount, 0);

      const defaults = ['geral', 'cinema', 'futebol', 'gameplay'];
      for (const d of defaults) {
        assert.ok(list.some((c) => c.id === d), `Default room ${d} must remain present`);
      }

      client.disconnect();
    });

    await challenge('1.5: Direct join-channel to uncreated custom room creates and prunes on empty', async () => {
      const client = createSocketClient('DirectJoiner');
      await new Promise((r) => client.on('connect', r));

      // Directly emit join-channel with arbitrary slug
      client.emit('join-channel', { channelId: 'sala-improvisada', userName: 'DirectJoiner' });
      const state = await new Promise((r) => client.once('channel-state', r));
      assert.equal(state.channelId, 'sala-improvisada');

      const resBefore = await fetch(`${BASE_URL}/api/channels`);
      const listBefore = await resBefore.json();
      const created = listBefore.find((c) => c.id === 'sala-improvisada');
      assert.ok(created, 'Direct join must instantiate custom channel');
      assert.equal(created.isDefault, false);

      // Now client leaves
      client.emit('leave-channel');
      await sleep(60);

      const resAfter = await fetch(`${BASE_URL}/api/channels`);
      const listAfter = await resAfter.json();
      assert.ok(!listAfter.some((c) => c.id === 'sala-improvisada'), 'Custom channel must be pruned when direct joiner leaves');

      client.disconnect();
    });

    await challenge('1.6: Channel collision resolution & sanitization of special characters', async () => {
      const client = createSocketClient('Creator');
      await new Promise((r) => client.on('connect', r));

      // Try creating duplicate room name
      const resA = await new Promise((resolve) => client.emit('create-channel', { name: 'Mesmo Nome' }, resolve));
      const resB = await new Promise((resolve) => client.emit('create-channel', { name: 'Mesmo Nome' }, resolve));

      assert.equal(resA.channelId, 'mesmo-nome');
      assert.notEqual(resB.channelId, resA.channelId, 'Collision must generate a unique slug');
      assert.ok(resB.channelId.startsWith('mesmo-nome-'), 'Duplicate room must increment slug suffix');

      // Create with special unicode, emojis and spaces
      const resC = await new Promise((resolve) => client.emit('create-channel', { name: 'Café & Jogos 🎮 !!' }, resolve));
      assert.ok(/^[\w-]+$/.test(resC.channelId), `Generated slug must be url-safe: ${resC.channelId}`);

      client.disconnect();
    });

    await challenge('1.7: Parallel race condition: concurrent channel creations with identical name', async () => {
      const clients = Array.from({ length: 5 }, (_, i) => createSocketClient(`RaceClient${i}`));
      await Promise.all(clients.map(c => new Promise(r => c.on('connect', r))));

      // 5 clients simultaneously request creating "Sala Concorrente"
      const results = await Promise.all(clients.map(c => 
        new Promise(resolve => c.emit('create-channel', { name: 'Sala Concorrente' }, resolve))
      ));

      // Each must succeed and get a unique channelId
      const channelIds = results.map(r => r.channelId);
      const uniqueIds = new Set(channelIds);
      assert.equal(uniqueIds.size, 5, 'Every concurrent channel creation must receive a unique slug');

      clients.forEach(c => c.disconnect());
    });

    // ========================================================================
    // SUITE 2: REAL-TIME AO VIVO BADGE PROPAGATION ACROSS MULTI-VIEWERS
    // ========================================================================
    console.log('\n--- SUITE 2: AO VIVO Badge Propagation Across Multi-Viewers ---');

    await challenge('2.1: AO VIVO badge propagates in real-time to multi-viewers in-room and cross-channel', async () => {
      const streamer = createSocketClient('StreamerAlice');
      const viewer1 = createSocketClient('ViewerBob');
      const viewer2 = createSocketClient('ViewerCharlie');
      const outsideViewer = createSocketClient('OutsideDave');

      await Promise.all([
        new Promise((r) => streamer.on('connect', r)),
        new Promise((r) => viewer1.on('connect', r)),
        new Promise((r) => viewer2.on('connect', r)),
        new Promise((r) => outsideViewer.on('connect', r))
      ]);

      // Join channels
      streamer.emit('join-channel', { channelId: 'cinema', userName: 'Alice' });
      viewer1.emit('join-channel', { channelId: 'cinema', userName: 'Bob' });
      viewer2.emit('join-channel', { channelId: 'cinema', userName: 'Charlie' });
      outsideViewer.emit('join-channel', { channelId: 'geral', userName: 'Dave' });

      await Promise.all([
        new Promise((r) => streamer.once('channel-state', r)),
        new Promise((r) => viewer1.once('channel-state', r)),
        new Promise((r) => viewer2.once('channel-state', r)),
        new Promise((r) => outsideViewer.once('channel-state', r))
      ]);

      // Set up listeners for in-room state change and global channels-list
      const v1StatePromise = new Promise((resolve) => {
        viewer1.on('user-state-changed', (evt) => {
          if (evt.userId === streamer.id && evt.isSharing === true) resolve(evt);
        });
      });

      const v2StatePromise = new Promise((resolve) => {
        viewer2.on('user-state-changed', (evt) => {
          if (evt.userId === streamer.id && evt.isSharing === true) resolve(evt);
        });
      });

      const outsideSummaryPromise = new Promise((resolve) => {
        outsideViewer.on('channels-list', (list) => {
          const cinema = list.find((c) => c.id === 'cinema');
          if (cinema && cinema.activeStreams === 1 && cinema.sharers.includes('Alice')) {
            resolve(cinema);
          }
        });
      });

      // Streamer starts sharing
      streamer.emit('user-state-changed', {
        isSharing: true,
        streamQuality: '1080p60'
      });

      const [v1Evt, v2Evt, cinemaSummary] = await Promise.all([
        v1StatePromise,
        v2StatePromise,
        outsideSummaryPromise
      ]);

      assert.equal(v1Evt.isSharing, true);
      assert.equal(v1Evt.channelId, 'cinema');
      assert.equal(v2Evt.isSharing, true);
      assert.equal(v2Evt.channelId, 'cinema');
      assert.equal(cinemaSummary.activeStreams, 1);
      assert.ok(cinemaSummary.sharers.includes('Alice'));
      assert.ok(cinemaSummary.users.find((u) => u.id === streamer.id).isSharing === true);

      // Now streamer stops sharing
      const v1StopPromise = new Promise((resolve) => {
        viewer1.on('user-state-changed', (evt) => {
          if (evt.userId === streamer.id && evt.isSharing === false) resolve(evt);
        });
      });

      const outsideStopPromise = new Promise((resolve) => {
        outsideViewer.on('channels-list', (list) => {
          const cinema = list.find((c) => c.id === 'cinema');
          if (cinema && cinema.activeStreams === 0) resolve(cinema);
        });
      });

      streamer.emit('user-state-changed', { isSharing: false });

      const [stopEvt, stoppedSummary] = await Promise.all([v1StopPromise, outsideStopPromise]);
      assert.equal(stopEvt.isSharing, false);
      assert.equal(stoppedSummary.activeStreams, 0);
      assert.equal(stoppedSummary.sharers.length, 0);

      streamer.disconnect();
      viewer1.disconnect();
      viewer2.disconnect();
      outsideViewer.disconnect();
    });

    await challenge('2.2: Channel switch while streaming transfers AO VIVO badge and clears previous channel', async () => {
      const streamer = createSocketClient('SwitchStreamer');
      const cinemaViewer = createSocketClient('CinemaViewer');
      const gameplayViewer = createSocketClient('GameplayViewer');

      await Promise.all([
        new Promise((r) => streamer.on('connect', r)),
        new Promise((r) => cinemaViewer.on('connect', r)),
        new Promise((r) => gameplayViewer.on('connect', r))
      ]);

      streamer.emit('join-channel', { channelId: 'cinema', userName: 'Streamer' });
      cinemaViewer.emit('join-channel', { channelId: 'cinema', userName: 'CinemaViewer' });
      gameplayViewer.emit('join-channel', { channelId: 'gameplay', userName: 'GameplayViewer' });

      await Promise.all([
        new Promise((r) => streamer.once('channel-state', r)),
        new Promise((r) => cinemaViewer.once('channel-state', r)),
        new Promise((r) => gameplayViewer.once('channel-state', r))
      ]);

      // Start streaming in cinema
      streamer.emit('user-state-changed', { isSharing: true });
      await sleep(50);

      // Prepare listener: cinemaViewer should receive user-left for streamer
      const cinemaLeftPromise = new Promise((resolve) => {
        cinemaViewer.once('user-left', (evt) => {
          if (evt.userId === streamer.id) resolve(evt);
        });
      });

      // gameplayViewer should receive channels-list where cinema.activeStreams=0 and gameplay.activeStreams=1
      const gameplayStatePromise = new Promise((resolve) => {
        gameplayViewer.on('channels-list', (list) => {
          const cinema = list.find((c) => c.id === 'cinema');
          const gameplay = list.find((c) => c.id === 'gameplay');
          if (cinema?.activeStreams === 0 && gameplay?.activeStreams === 1) {
            resolve({ cinema, gameplay });
          }
        });
      });

      // Switch to gameplay while sharing
      streamer.emit('join-channel', { channelId: 'gameplay', userName: 'Streamer', isSharing: true });

      const [leftEvt, streamTransition] = await Promise.all([
        cinemaLeftPromise,
        gameplayStatePromise
      ]);

      assert.equal(leftEvt.userId, streamer.id);
      assert.equal(streamTransition.cinema.activeStreams, 0);
      assert.equal(streamTransition.gameplay.activeStreams, 1);

      streamer.disconnect();
      cinemaViewer.disconnect();
      gameplayViewer.disconnect();
    });

    await challenge('2.3: Abrupt streamer disconnection immediately clears AO VIVO badge with no ghost streams', async () => {
      const streamer = createSocketClient('AbruptStreamer');
      const observer = createSocketClient('Observer');

      await Promise.all([
        new Promise((r) => streamer.on('connect', r)),
        new Promise((r) => observer.on('connect', r))
      ]);

      streamer.emit('join-channel', { channelId: 'gameplay', userName: 'GhostBuster', isSharing: true });
      await new Promise((r) => streamer.once('channel-state', r));
      await sleep(50);

      // Verify active stream is 1
      const resBefore = await fetch(`${BASE_URL}/api/channels`);
      const listBefore = await resBefore.json();
      const gpBefore = listBefore.find((c) => c.id === 'gameplay');
      assert.equal(gpBefore.activeStreams, 1);

      // Listen for clear in observer
      const clearPromise = new Promise((resolve) => {
        observer.on('channels-list', (list) => {
          const gp = list.find((c) => c.id === 'gameplay');
          if (gp && gp.activeStreams === 0) resolve(gp);
        });
      });

      // Abruptly kill streamer socket
      streamer.disconnect();

      const clearedGp = await clearPromise;
      assert.equal(clearedGp.activeStreams, 0, 'activeStreams must return to 0 immediately upon disconnect');
      assert.equal(clearedGp.sharers.length, 0);

      observer.disconnect();
    });

    await challenge('2.4: Multi-streamer concurrency: dual simultaneous screen shares in the same channel', async () => {
      const s1 = createSocketClient('Streamer1');
      const s2 = createSocketClient('Streamer2');
      const viewer = createSocketClient('Viewer');

      await Promise.all([
        new Promise((r) => s1.on('connect', r)),
        new Promise((r) => s2.on('connect', r)),
        new Promise((r) => viewer.on('connect', r))
      ]);

      s1.emit('join-channel', { channelId: 'futebol', userName: 'Streamer1' });
      s2.emit('join-channel', { channelId: 'futebol', userName: 'Streamer2' });
      viewer.emit('join-channel', { channelId: 'geral', userName: 'Viewer' });

      await Promise.all([
        new Promise((r) => s1.once('channel-state', r)),
        new Promise((r) => s2.once('channel-state', r)),
        new Promise((r) => viewer.once('channel-state', r))
      ]);

      // Streamer1 starts sharing
      const s1SharePromise = new Promise((resolve) => {
        viewer.on('channels-list', (list) => {
          const fut = list.find((c) => c.id === 'futebol');
          if (fut && fut.activeStreams === 1) resolve(fut);
        });
      });
      s1.emit('user-state-changed', { isSharing: true });
      const fut1 = await s1SharePromise;
      assert.equal(fut1.activeStreams, 1);
      assert.deepEqual(fut1.sharers, ['Streamer1']);

      // Streamer2 starts sharing concurrently
      const s2SharePromise = new Promise((resolve) => {
        viewer.on('channels-list', (list) => {
          const fut = list.find((c) => c.id === 'futebol');
          if (fut && fut.activeStreams === 2) resolve(fut);
        });
      });
      s2.emit('user-state-changed', { isSharing: true });
      const fut2 = await s2SharePromise;
      assert.equal(fut2.activeStreams, 2);
      assert.ok(fut2.sharers.includes('Streamer1') && fut2.sharers.includes('Streamer2'));

      // Streamer1 stops sharing -> drops to 1
      const dropToOnePromise = new Promise((resolve) => {
        viewer.on('channels-list', (list) => {
          const fut = list.find((c) => c.id === 'futebol');
          if (fut && fut.activeStreams === 1 && !fut.sharers.includes('Streamer1')) resolve(fut);
        });
      });
      s1.emit('user-state-changed', { isSharing: false });
      const futDrop = await dropToOnePromise;
      assert.equal(futDrop.activeStreams, 1);
      assert.deepEqual(futDrop.sharers, ['Streamer2']);

      // Streamer2 stops sharing -> drops to 0
      const dropToZeroPromise = new Promise((resolve) => {
        viewer.on('channels-list', (list) => {
          const fut = list.find((c) => c.id === 'futebol');
          if (fut && fut.activeStreams === 0) resolve(fut);
        });
      });
      s2.emit('user-state-changed', { isSharing: false });
      const futZero = await dropToZeroPromise;
      assert.equal(futZero.activeStreams, 0);

      s1.disconnect();
      s2.disconnect();
      viewer.disconnect();
    });

    // ========================================================================
    // SUITE 3: DEAFEN AND MUTE STATE SYNCHRONIZATION ACROSS PEERS
    // ========================================================================
    console.log('\n--- SUITE 3: Deafen & Mute State Synchronization Across Peers ---');

    await challenge('3.1: Mic mute/unmute and deafen/undeafen propagate to channel peers', async () => {
      const peerA = createSocketClient('PeerA');
      const peerB = createSocketClient('PeerB');

      await Promise.all([
        new Promise((r) => peerA.on('connect', r)),
        new Promise((r) => peerB.on('connect', r))
      ]);

      peerA.emit('join-channel', { channelId: 'futebol', userName: 'PeerA', isMicOn: false, isDeafened: false });
      peerB.emit('join-channel', { channelId: 'futebol', userName: 'PeerB', isMicOn: false, isDeafened: false });

      await Promise.all([
        new Promise((r) => peerA.once('channel-state', r)),
        new Promise((r) => peerB.once('channel-state', r))
      ]);

      // 1. PeerA turns mic ON
      const micOnPromise = new Promise((resolve) => {
        peerB.on('user-state-changed', (evt) => {
          if (evt.userId === peerA.id && evt.isMicOn === true) resolve(evt);
        });
      });
      peerA.emit('user-state-changed', { isMicOn: true });
      const micOnEvt = await micOnPromise;
      assert.equal(micOnEvt.isMicOn, true);

      // 2. PeerA enables deafen (which mutes mic as well)
      const deafenPromise = new Promise((resolve) => {
        peerB.on('user-state-changed', (evt) => {
          if (evt.userId === peerA.id && evt.isDeafened === true && evt.isMicOn === false) resolve(evt);
        });
      });
      peerA.emit('user-state-changed', { isDeafened: true, isMicOn: false });
      const deafenEvt = await deafenPromise;
      assert.equal(deafenEvt.isDeafened, true);
      assert.equal(deafenEvt.isMicOn, false);

      // 3. Global summary reflects state
      const res = await fetch(`${BASE_URL}/api/channels`);
      const list = await res.json();
      const fut = list.find((c) => c.id === 'futebol');
      const uA = fut.users.find((u) => u.id === peerA.id);
      assert.equal(uA.isDeafened, true);
      assert.equal(uA.isMicOn, false);

      peerA.disconnect();
      peerB.disconnect();
    });

    await challenge('3.2: Rapid toggle stress test preserves consistency without deadlock', async () => {
      const client = createSocketClient('RapidToggler');
      const observer = createSocketClient('StateWatcher');

      await Promise.all([
        new Promise((r) => client.on('connect', r)),
        new Promise((r) => observer.on('connect', r))
      ]);

      client.emit('join-channel', { channelId: 'geral', userName: 'RapidToggler' });
      observer.emit('join-channel', { channelId: 'geral', userName: 'StateWatcher' });

      await Promise.all([
        new Promise((r) => client.once('channel-state', r)),
        new Promise((r) => observer.once('channel-state', r))
      ]);

      // Blast 30 rapid state updates
      for (let i = 0; i < 30; i++) {
        client.emit('user-state-changed', {
          isMicOn: i % 2 === 0,
          isDeafened: i % 3 === 0,
          isSpeaking: i % 5 === 0
        });
      }

      // Final settled state: mic ON, deafen FALSE, speaking FALSE
      const settledPromise = new Promise((resolve) => {
        observer.on('user-state-changed', (evt) => {
          if (evt.userId === client.id && evt.isMicOn === true && evt.isDeafened === false && evt.isSpeaking === false) {
            resolve(evt);
          }
        });
      });

      client.emit('user-state-changed', {
        isMicOn: true,
        isDeafened: false,
        isSpeaking: false
      });

      const settled = await settledPromise;
      assert.equal(settled.isMicOn, true);
      assert.equal(settled.isDeafened, false);
      assert.equal(settled.isSpeaking, false);

      client.disconnect();
      observer.disconnect();
    });

    await challenge('3.3: Channel isolation guarantees no chat/reaction/signal leakage across rooms', async () => {
      const userCinema = createSocketClient('UserCinema');
      const userFutebol = createSocketClient('UserFutebol');

      await Promise.all([
        new Promise((r) => userCinema.on('connect', r)),
        new Promise((r) => userFutebol.on('connect', r))
      ]);

      userCinema.emit('join-channel', { channelId: 'cinema', userName: 'UserCinema' });
      userFutebol.emit('join-channel', { channelId: 'futebol', userName: 'UserFutebol' });

      await Promise.all([
        new Promise((r) => userCinema.once('channel-state', r)),
        new Promise((r) => userFutebol.once('channel-state', r))
      ]);

      let leakedChat = false;
      let leakedReaction = false;
      let leakedSignal = false;

      userFutebol.on('chat-message', () => { leakedChat = true; });
      userFutebol.on('reaction', () => { leakedReaction = true; });
      userFutebol.on('webrtc-signal', () => { leakedSignal = true; });

      // Cinema user emits chat, reaction, and tries to signal across channel
      userCinema.emit('chat-message', { text: 'Mensagem Confidencial do Cinema' });
      userCinema.emit('reaction', { emoji: '🎬' });
      userCinema.emit('webrtc-signal', { target: userFutebol.id, signal: { type: 'offer' } });

      await sleep(150);

      assert.equal(leakedChat, false, 'Chat message must not leak to different channel');
      assert.equal(leakedReaction, false, 'Reaction must not leak to different channel');
      assert.equal(leakedSignal, false, 'WebRTC signal must not bridge cross-channel targets');

      userCinema.disconnect();
      userFutebol.disconnect();
    });

    await challenge('3.4: Adversarial payload fuzzing: malformed state, oversized chat, and boundary inputs', async () => {
      const client = createSocketClient('Fuzzer');
      await new Promise((r) => client.on('connect', r));

      // Join channel with extreme length and special characters
      client.emit('join-channel', {
        channelId: 'geral',
        userName: 'A'.repeat(500),
        isMicOn: 'not-a-boolean',
        isDeafened: 12345
      });
      const state = await new Promise((r) => client.once('channel-state', r));
      assert.ok(state.me.name.length <= 25, 'Username must be truncated to safe limit');

      // Emit null / invalid state
      client.emit('user-state-changed', null);
      client.emit('user-state-changed', undefined);
      client.emit('user-state-changed', 'invalid-string');

      // Send 50KB chat message (must be truncated to 600 chars without crash)
      const chatPromise = new Promise((resolve) => client.once('chat-message', resolve));
      client.emit('chat-message', { text: 'X'.repeat(50000) });
      const chatReceived = await chatPromise;
      assert.equal(chatReceived.text.length, 600, 'Chat message must be clamped to 600 characters');

      client.disconnect();
    });

    // ========================================================================
    // SUITE 4: LEGACY WEBSOCKET /ws UPGRADE COMPATIBILITY
    // ========================================================================
    console.log('\n--- SUITE 4: Legacy WebSocket /ws Upgrade Compatibility ---');

    await challenge('4.1: Raw RFC 6455 WebSocket handshake and frame exchange on /ws?sala=geral', async () => {
      const tcpSocket = new net.Socket();
      await new Promise((resolve) => tcpSocket.connect(TEST_PORT, '127.0.0.1', resolve));

      const secKey = randomBytes(16).toString('base64');
      const expectedAccept = createHash('sha1')
        .update(`${secKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');

      const req = [
        'GET /ws?sala=geral HTTP/1.1',
        `Host: 127.0.0.1:${TEST_PORT}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${secKey}`,
        'Sec-WebSocket-Version: 13',
        '\r\n'
      ].join('\r\n');

      tcpSocket.write(req);

      const handshakeData = await new Promise((resolve) => {
        tcpSocket.once('data', resolve);
      });

      const responseText = handshakeData.toString();
      assert.ok(responseText.includes('HTTP/1.1 101 Switching Protocols'), 'Handshake must return 101');
      assert.ok(responseText.includes(`Sec-WebSocket-Accept: ${expectedAccept}`), 'Sec-WebSocket-Accept must match');

      // Send a WebSocket Ping frame (Opcode 0x9, masked)
      // Header: 0x89 (FIN + Ping), 0x80 (Masked + len 0), 4-byte mask
      const pingFrame = Buffer.from([0x89, 0x80, 0x11, 0x22, 0x33, 0x44]);
      tcpSocket.write(pingFrame);

      const pongData = await new Promise((resolve) => {
        tcpSocket.once('data', resolve);
      });

      // Pong frame opcode is 0xA -> 0x8A
      assert.equal(pongData[0], 0x8a, 'Server must return Pong frame (0x8A) upon receiving Ping');

      // Send a Close frame (Opcode 0x8, masked)
      const closeFrame = Buffer.from([0x88, 0x80, 0x55, 0x66, 0x77, 0x88]);
      tcpSocket.write(closeFrame);

      const closeResp = await new Promise((resolve) => {
        tcpSocket.once('data', resolve);
      });
      assert.equal(closeResp[0], 0x88, 'Server must respond with Close frame (0x88)');

      tcpSocket.end();
      tcpSocket.destroy();
    });

    await challenge('4.2: Standard globalThis.WebSocket client connects to /ws?sala=cinema cleanly', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws?sala=cinema`);

      const opened = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), 2000);
        ws.addEventListener('open', () => {
          clearTimeout(timeout);
          resolve(true);
        });
        ws.addEventListener('error', () => {
          clearTimeout(timeout);
          resolve(false);
        });
      });

      assert.equal(opened, true, 'Standard WebSocket must connect successfully');
      ws.send(JSON.stringify({ type: 'ping' }));
      await sleep(50);
      ws.close();
    });

    await challenge('4.3: WebSocket upgrade rejects missing or malformed room parameters', async () => {
      // 1. Missing sala parameter
      const resNoSala = await fetch(`${BASE_URL}/ws`);
      assert.equal(resNoSala.status, 400, 'HTTP /ws without sala must return 400');

      // 2. Invalid room parameter over HTTP
      const resInvalid = await fetch(`${BASE_URL}/ws?sala=bad$$chars!`);
      assert.equal(resInvalid.status, 400, 'HTTP /ws with invalid chars must return 400');

      // 3. Raw WebSocket upgrade without sala returns HTTP 400
      const s1 = new net.Socket();
      await new Promise((r) => s1.connect(TEST_PORT, '127.0.0.1', r));
      s1.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${TEST_PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      const resp1 = await new Promise((r) => s1.once('data', r));
      assert.ok(resp1.toString().includes('400 Bad Request'), 'WS Upgrade without sala must return 400 Bad Request');
      s1.destroy();

      // 4. Raw WebSocket upgrade with invalid characters returns HTTP 400
      const s2 = new net.Socket();
      await new Promise((r) => s2.connect(TEST_PORT, '127.0.0.1', r));
      s2.write(`GET /ws?sala=invalid@room! HTTP/1.1\r\nHost: 127.0.0.1:${TEST_PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      const resp2 = await new Promise((r) => s2.once('data', r));
      assert.ok(resp2.toString().includes('400 Bad Request'), 'WS Upgrade with invalid chars must return 400 Bad Request');
      s2.destroy();
    });

    await challenge('4.4: HTTP GET and POST on /ws return 426 Upgrade Required when sala is valid', async () => {
      const getRes = await fetch(`${BASE_URL}/ws?sala=geral`);
      assert.equal(getRes.status, 426, 'GET /ws with valid sala must return 426 Upgrade Required');

      const postRes = await fetch(`${BASE_URL}/ws?sala=futebol`, { method: 'POST' });
      assert.equal(postRes.status, 426, 'POST /ws with valid sala must return 426 Upgrade Required');
    });

    await challenge('4.5: Raw WebSocket and Socket.IO operate simultaneously without protocol interference', async () => {
      // Connect raw WebSocket
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws?sala=geral`);
      await new Promise((resolve) => ws.addEventListener('open', resolve));

      // Connect Socket.IO client concurrently
      const ioCli = createSocketClient('CoexistClient');
      await new Promise((resolve) => ioCli.on('connect', resolve));

      ioCli.emit('join-channel', { channelId: 'geral', userName: 'CoexistClient' });
      const state = await new Promise((resolve) => ioCli.once('channel-state', resolve));
      assert.equal(state.channelId, 'geral');

      // Send raw ws message and ping
      ws.send('raw test payload');
      await sleep(50);

      // Verify Socket.IO continues unaffected
      ioCli.emit('chat-message', { text: 'Coexistence is smooth' });
      await sleep(50);

      ws.close();
      ioCli.disconnect();
    });

    await challenge('4.6: Raw WebSocket protocol boundary: oversized frame > 1MB immediately closes socket', async () => {
      const s = new net.Socket();
      await new Promise((r) => s.connect(TEST_PORT, '127.0.0.1', r));

      const secKey = randomBytes(16).toString('base64');
      s.write(`GET /ws?sala=geral HTTP/1.1\r\nHost: 127.0.0.1:${TEST_PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${secKey}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      await new Promise((r) => s.once('data', r));

      // Construct a frame header claiming 2MB payload (0x81, 0xFE, length=0x00200000)
      const head = Buffer.alloc(14);
      head[0] = 0x81; // FIN + text
      head[1] = 0x80 | 127; // Masked + 127
      head.writeBigUInt64BE(BigInt(2 * 1024 * 1024), 2); // 2MB length > 1MB limit
      head.writeUInt32BE(0x12345678, 10); // mask

      // Server should immediately destroy/close socket when len > 1 << 20 (line 88 in server.js)
      const closePromise = new Promise((resolve) => {
        s.on('close', () => resolve('closed'));
        s.on('end', () => resolve('ended'));
      });

      s.write(head);
      const result = await Promise.race([
        closePromise,
        sleep(500).then(() => 'timeout')
      ]);

      assert.ok(result === 'closed' || result === 'ended', 'Server must terminate socket on oversized frame');
      s.destroy();
    });

  } finally {
    console.log('\n[Teardown] Shutting down isolated test server...');
    await stopServer();
    console.log('[Teardown] Server shut down cleanly.');
  }

  console.log('\n========================================================================');
  console.log(`CHALLENGER RESULTS: Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllChallenges().catch((err) => {
  console.error('\nFatal Challenger Harness Error:', err);
  stopServer().finally(() => process.exit(1));
});
