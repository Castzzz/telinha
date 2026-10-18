/**
 * tests/m1-collision-concurrency.test.js
 * 
 * Empirical challenger test specifically verifying:
 * 1. Default room collision: Creating room "Geral" creates a distinct room ("geral-2") without loop or failure.
 * 2. Sequential collisions: Repeatedly creating "Geral" produces "geral-2", "geral-3", "geral-4", etc.
 * 3. High-concurrency race condition: 20 simultaneous requests to create "Geral".
 * 4. Custom collision pruning and reallocation: verify dynamic room prunes when empty and subsequent creation reclaims or advances cleanly.
 * 5. Permanent vs Dynamic integrity: Geral (default) remains intact and never pruned, while geral-2 prunes on empty.
 */

import { io as ioClient } from 'socket.io-client';
import http from 'node:http';
import assert from 'node:assert/strict';
import { app, server, io, channels, getChannelsSummary } from '../server.js';

const TEST_PORT = 19777;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function createSocket(name) {
  return ioClient(BASE_URL, {
    transports: ['websocket'],
    forceNew: true,
    auth: { userName: name }
  });
}

async function runTests() {
  console.log('\n========================================================================');
  console.log('⚡ EMPIRICAL CHALLENGE: CHANNEL COLLISION & CONCURRENCY RESOLUTION');
  console.log('========================================================================');

  await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));
  console.log(`[Setup] Server running at ${BASE_URL}`);

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Creating room "Geral" creates distinct room "geral-2"
    // -------------------------------------------------------------------------
    console.log('\n[Test 1] Verifying room "Geral" collision resolution creates "geral-2"...');
    const client1 = createSocket('User1');
    await new Promise((r) => client1.on('connect', r));

    assert.ok(channels.has('geral'), 'Default channel "geral" must exist initially');
    assert.equal(channels.get('geral').isDefault, true);

    const res1 = await new Promise((resolve) => {
      client1.emit('create-channel', { name: 'Geral' }, resolve);
    });

    console.log('  Result 1:', res1);
    assert.equal(res1.success, true, 'create-channel must succeed');
    assert.equal(res1.channelId, 'geral-2', 'First collision of "Geral" must yield "geral-2"');
    assert.equal(res1.channelName, 'Geral', 'Channel display name must remain "Geral"');
    assert.ok(channels.has('geral-2'), 'channels map must now contain "geral-2"');
    assert.equal(channels.get('geral-2').isDefault, false, '"geral-2" must not be a default channel');

    // -------------------------------------------------------------------------
    // TEST 2: Repeatedly creating "Geral" creates "geral-3", "geral-4"
    // -------------------------------------------------------------------------
    console.log('\n[Test 2] Sequential collisions on "Geral"...');
    const res2 = await new Promise((resolve) => {
      client1.emit('create-channel', { name: 'Geral' }, resolve);
    });
    console.log('  Result 2:', res2);
    assert.equal(res2.channelId, 'geral-3', 'Second collision of "Geral" must yield "geral-3"');

    const res3 = await new Promise((resolve) => {
      client1.emit('create-channel', { name: 'Geral' }, resolve);
    });
    console.log('  Result 3:', res3);
    assert.equal(res3.channelId, 'geral-4', 'Third collision of "Geral" must yield "geral-4"');

    // Also test case-insensitivity: "gErAl"
    const resCase = await new Promise((resolve) => {
      client1.emit('create-channel', { name: 'gErAl' }, resolve);
    });
    console.log('  Result Case Insensitive:', resCase);
    assert.equal(resCase.channelId, 'geral-5', 'Normalized "gErAl" collision must yield "geral-5"');

    // -------------------------------------------------------------------------
    // TEST 3: Concurrent parallel race: 20 simultaneous creations of "Geral"
    // -------------------------------------------------------------------------
    console.log('\n[Test 3] 20 concurrent parallel creations of "Geral"...');
    const swarm = Array.from({ length: 20 }, (_, i) => createSocket(`SwarmUser_${i}`));
    await Promise.all(swarm.map((c) => new Promise((r) => c.on('connect', r))));

    const swarmResults = await Promise.all(
      swarm.map((c, i) =>
        new Promise((resolve) => c.emit('create-channel', { name: 'Geral' }, resolve))
      )
    );

    const generatedIds = swarmResults.map((r) => r.channelId);
    console.log(`  Generated 20 IDs from concurrent requests: ${generatedIds.slice(0, 5).join(', ')} ...`);

    assert.equal(swarmResults.length, 20);
    for (const res of swarmResults) {
      assert.equal(res.success, true);
      assert.ok(res.channelId.startsWith('geral-'), `ID must start with geral-: ${res.channelId}`);
    }

    const uniqueSet = new Set(generatedIds);
    assert.equal(
      uniqueSet.size,
      20,
      `All 20 concurrent IDs must be completely unique! Found duplicates: ${generatedIds.length - uniqueSet.size}`
    );

    // -------------------------------------------------------------------------
    // TEST 4: Join, activity and pruning lifecycle in collided rooms
    // -------------------------------------------------------------------------
    console.log('\n[Test 4] Testing join, presence and pruning on collided room "geral-2"...');
    const client2 = createSocket('User2');
    await new Promise((r) => client2.on('connect', r));

    // Join geral-2
    const joinStatePromise = new Promise((resolve) => {
      client2.on('channel-state', resolve);
    });
    client2.emit('join-channel', {
      channelId: 'geral-2',
      userName: 'User2',
      isMicOn: true,
      isDeafened: false
    });
    const state = await joinStatePromise;
    assert.equal(state.channelId, 'geral-2');
    assert.equal(channels.get('geral-2').users.size, 1);

    // Leave geral-2 -> should prune
    client2.emit('leave-channel');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(channels.has('geral-2'), false, 'geral-2 must be pruned when empty');

    // Default "geral" must STILL exist and NEVER prune
    assert.equal(channels.has('geral'), true, 'Default room "geral" must never be pruned');

    // -------------------------------------------------------------------------
    // TEST 5: Creating "Geral" again after "geral-2" was pruned
    // -------------------------------------------------------------------------
    console.log('\n[Test 5] Creating "Geral" again after "geral-2" was pruned...');
    const resReclaimed = await new Promise((resolve) => {
      client1.emit('create-channel', { name: 'Geral' }, resolve);
    });
    console.log('  Result Reclaimed:', resReclaimed);
    assert.equal(resReclaimed.success, true);
    // Since geral-2 was pruned and is no longer in channels, the counter finds geral-2 free
    assert.equal(resReclaimed.channelId, 'geral-2', 'Re-creating "Geral" reclaims free slug "geral-2"');

    // Cleanup sockets
    client1.disconnect();
    client2.disconnect();
    swarm.forEach((c) => c.disconnect());

    console.log('\n========================================================================');
    console.log('✅ ALL CHANNEL COLLISION & CONCURRENCY TESTS PASSED EMPIRICALLY!');
    console.log('========================================================================\n');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log('[Teardown] Server stopped.');
  }
}

runTests().catch((err) => {
  console.error('\n❌ EMPIRICAL TEST FAILED:', err);
  process.exit(1);
});
