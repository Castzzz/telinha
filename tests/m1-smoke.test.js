/**
 * tests/m1-smoke.test.js - Milestone 1 End-to-End Live Socket.IO Verification
 * Validates real server Socket.IO communication, presence tree, chat isolation,
 * dynamic channel creation, AO VIVO badge broadcast, and clean channel switching.
 */

import { io as ioClient } from 'socket.io-client';
import http from 'node:http';
import { app, server, io } from '../server.js';
import assert from 'node:assert/strict';

const TEST_PORT = 19090;

async function runM1SmokeTests() {
  console.log('\n--- Starting Milestone 1 Live Socket.IO Smoke Verification ---');

  // Start server on dedicated test port
  await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));
  const serverUrl = `http://127.0.0.1:${TEST_PORT}`;
  console.log(`[Test] Server listening at ${serverUrl}`);

  try {
    // 1. Verify REST API /api/health and /api/channels
    console.log('[Test 1] Verifying REST API endpoints...');
    const healthRes = await fetch(`${serverUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.status, 'ok');
    assert.ok(healthData.channelsCount >= 1);

    const channelsRes = await fetch(`${serverUrl}/api/channels`);
    assert.equal(channelsRes.status, 200);
    const channelsData = await channelsRes.json();
    const defaultIds = channelsData.map((c) => c.id);
    assert.ok(defaultIds.includes('geral'));
    // Só o Geral é fixo desde a 2.0
    assert.ok(!defaultIds.includes('cinema'));
    console.log('  ✓ REST API endpoints passed');

    // 2. Connect Client 1 (Alice) to Geral
    console.log('[Test 2] Connecting Client 1 (Alice) to #geral...');
    const client1 = ioClient(serverUrl, { transports: ['websocket'] });
    await new Promise((resolve) => client1.on('connect', resolve));

    client1.emit('join-channel', {
      channelId: 'geral',
      userName: 'Alice',
      isMicOn: false,
      isDeafened: false
    });

    const c1State = await new Promise((resolve) => client1.once('channel-state', resolve));
    assert.equal(c1State.channelId, 'geral');
    assert.equal(c1State.me.name, 'Alice');
    assert.ok(c1State.users.some((u) => u.name === 'Alice'));
    console.log('  ✓ Client 1 joined #geral and received channel-state');

    // 3. Connect Client 2 (Bob) to Cinema
    console.log('[Test 3] Connecting Client 2 (Bob) to #cinema...');
    const client2 = ioClient(serverUrl, { transports: ['websocket'] });
    await new Promise((resolve) => client2.on('connect', resolve));

    client2.emit('join-channel', {
      channelId: 'cinema',
      userName: 'Bob',
      isMicOn: true,
      isDeafened: false
    });

    const c2State = await new Promise((resolve) => client2.once('channel-state', resolve));
    assert.equal(c2State.channelId, 'cinema');
    assert.equal(c2State.me.name, 'Bob');
    assert.ok(c2State.users.some((u) => u.name === 'Bob'));
    console.log('  ✓ Client 2 joined #cinema and received channel-state');

    // 4. Verify Presence in Global channels-list
    console.log('[Test 4] Verifying presence tree in channels-list...');
    const summaryPromise = new Promise((resolve) => client1.once('channels-list', resolve));
    client1.emit('get-channels');
    const summary = await summaryPromise;

    const geralChannel = summary.find((c) => c.id === 'geral');
    const cinemaChannel = summary.find((c) => c.id === 'cinema');

    assert.ok(geralChannel.users.some((u) => u.name === 'Alice'));
    assert.ok(cinemaChannel.users.some((u) => u.name === 'Bob'));
    console.log('  ✓ Presence tree verified: Alice in #geral, Bob in #cinema');

    // 5. Test AO VIVO Badge Broadcast
    console.log('[Test 5] Testing screen share AO VIVO badge broadcast...');
    const liveUpdatePromise = new Promise((resolve) => {
      client2.on('user-state-changed', (evt) => {
        if (evt.userId === client1.id && evt.isSharing === true) {
          resolve(evt);
        }
      });
    });

    // Alice switches to cinema and starts sharing screen
    client1.emit('join-channel', {
      channelId: 'cinema',
      userName: 'Alice',
      isMicOn: false,
      isDeafened: false
    });

    // Wait for channel switch
    await new Promise((r) => setTimeout(r, 100));

    // Alice turns on screen sharing
    client1.emit('user-state-changed', {
      isSharing: true,
      isMicOn: false
    });

    const liveEvt = await liveUpdatePromise;
    assert.equal(liveEvt.isSharing, true);
    assert.equal(liveEvt.channelId, 'cinema');
    console.log('  ✓ AO VIVO badge broadcast verified (isSharing: true)');

    // 6. Test Channel-Scoped Text Chat
    console.log('[Test 6] Testing channel-scoped text chat...');
    const chatPromise = new Promise((resolve) => {
      client2.once('chat-message', resolve);
    });

    client1.emit('chat-message', { text: 'Olá cinema!' });
    const receivedChat = await chatPromise;

    assert.equal(receivedChat.text, 'Olá cinema!');
    assert.equal(receivedChat.senderName, 'Alice');
    assert.equal(receivedChat.channelId, 'cinema');
    console.log('  ✓ Channel text chat received with correct channel scoping');

    // 7. Test Dynamic Room Creation
    console.log('[Test 7] Testing dynamic custom channel creation...');
    const createPromise = new Promise((resolve) => {
      client1.emit('create-channel', { name: 'Sala dos Amigos' }, resolve);
    });

    const createRes = await createPromise;
    assert.equal(createRes.success, true);
    assert.ok(createRes.channelId.includes('sala-dos-amigos'));
    console.log(`  ✓ Dynamic room created: ${createRes.channelId} (${createRes.channelName})`);

    // Disconnect clients
    client1.disconnect();
    client2.disconnect();

    console.log('\n======================================================');
    console.log('✅ ALL MILESTONE 1 SMOKE VERIFICATION TESTS PASSED!');
    console.log('======================================================\n');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log('[Test] Server closed cleanly');
  }
}

runM1SmokeTests().catch((err) => {
  console.error('❌ M1 Smoke Test Failure:', err);
  process.exit(1);
});
