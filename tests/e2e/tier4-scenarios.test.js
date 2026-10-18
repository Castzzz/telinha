// tests/e2e/tier4-scenarios.test.js
// Tier 4: Real-World Multi-User Application Scenarios
// Validates end-to-end complex workflows across multiple concurrent participants.

import { describe, it } from '../runner.js';
import { assert } from '../helpers/test-utils.js';
import {
  SimulatedClient,
  MockSignalingHub,
  enhanceOpusStereoSdp
} from '../helpers/mock-webrtc.js';

describe('Tier 4: Real-World Multi-User Application Scenarios', () => {
  it('T4.1: "Cinema Watch-Party" with 3 users, muted host mic, text chat, and live loopback audio', () => {
    const hub = new MockSignalingHub();

    // 1. Host and 2 Viewers
    const host = new SimulatedClient({ name: 'Castzin (Host)' });
    const viewer1 = new SimulatedClient({ name: 'Amigo1' });
    const viewer2 = new SimulatedClient({ name: 'Amigo2' });

    // Join Cinema channel
    hub.joinChannel(host, 'cinema');
    hub.joinChannel(viewer1, 'cinema');
    hub.joinChannel(viewer2, 'cinema');

    // 2. Host starts high-quality screen share with system audio loopback; Host mic is MUTED
    host.setMicMuted(true);
    assert.equal(host.isMicOn, false, 'Host starts with mic muted');

    host.startScreenShare();
    hub.updateUserState(host, { isSharing: true, isMicOn: false });

    // Verify SDP munging for 48kHz stereo Opus up to 256kbps
    const streamSdp = enhanceOpusStereoSdp(
      'a=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10\r\n',
      256000
    );
    assert.match(streamSdp, /stereo=1;sprop-stereo=1;maxaveragebitrate=256000/);

    // 3. Viewers see host AO VIVO
    const cinemaState = hub.getChannelsList().find((c) => c.id === 'cinema');
    assert.equal(cinemaState.activeStreams, 1);
    assert.equal(host.screenAudioTrack.readyState, 'live');

    // 4. Viewers exchange chat messages
    const chatLog = [];
    hub.on('chat-message', (m) => chatLog.push(m));

    hub.sendChatMessage(viewer1, 'O som tá estéreo e cristalino!');
    hub.sendChatMessage(viewer2, 'Sim, qualidade absurda!');

    assert.equal(chatLog.length, 2);

    // 5. Host briefly un-mutes to talk to friends, then mutes again
    host.setMicMuted(false);
    assert.equal(host.isMicOn, true);
    assert.equal(host.screenAudioTrack.readyState, 'live', 'Screen audio must NOT glitch on mic unmute');

    hub.sendChatMessage(host, 'Valeu pessoal! Curtam o filme!');
    host.setMicMuted(true);
    assert.equal(host.isMicOn, false);
    assert.equal(host.screenAudioTrack.readyState, 'live', 'Screen audio must NOT glitch on mic mute');

    // 6. Cleanup
    hub.leaveChannel(host);
    hub.leaveChannel(viewer1);
    hub.leaveChannel(viewer2);

    const afterLeave = hub.getChannelsList().find((c) => c.id === 'cinema');
    assert.equal(afterLeave.userCount, 0);
    assert.equal(afterLeave.activeStreams, 0);
  });

  it('T4.2: "Gaming Tournament with Dual Streams & Mosaic Grid"', () => {
    const hub = new MockSignalingHub();

    const p1 = new SimulatedClient({ name: 'Player1' });
    const p2 = new SimulatedClient({ name: 'Player2' });
    const spec1 = new SimulatedClient({ name: 'Spectator1' });
    const spec2 = new SimulatedClient({ name: 'Spectator2' });

    // All join Gameplay room
    hub.joinChannel(p1, 'gameplay');
    hub.joinChannel(p2, 'gameplay');
    hub.joinChannel(spec1, 'gameplay');
    hub.joinChannel(spec2, 'gameplay');

    // Both players stream simultaneously
    p1.startScreenShare();
    p2.startScreenShare();
    hub.updateUserState(p1, { isSharing: true });
    hub.updateUserState(p2, { isSharing: true });

    // Spectator 1 watches Player 1 in spotlight mode, boosts volume to 130%
    spec1.activeStreamId = p1.id;
    spec1.stageMode = 'spotlight';
    const p1Gain = spec1.setStreamVolume(p1.id, 130);
    assert.equal(p1Gain, 1.3);

    // Spectator 2 switches to Mosaic Grid mode to watch both players concurrently
    spec2.stageMode = 'mosaic';
    spec2.activeStreams.add(p1.id);
    spec2.activeStreams.add(p2.id);
    assert.equal(spec2.stageMode, 'mosaic');
    assert.equal(spec2.activeStreams.size, 2);

    // Player 1 gets eliminated and stops streaming
    p1.stopScreenShare();
    hub.updateUserState(p1, { isSharing: false });

    const gameplayState = hub.getChannelsList().find((c) => c.id === 'gameplay');
    assert.equal(gameplayState.activeStreams, 1, 'Only Player 2 stream remains active');

    // Clean leave
    hub.leaveChannel(p1);
    hub.leaveChannel(p2);
    hub.leaveChannel(spec1);
    hub.leaveChannel(spec2);
  });

  it('T4.3: "Dynamic Room Migration & Meeting" across channels', () => {
    const hub = new MockSignalingHub();

    const u1 = new SimulatedClient({ name: 'Alice' });
    const u2 = new SimulatedClient({ name: 'Bob' });
    const u3 = new SimulatedClient({ name: 'Charlie' });
    const u4 = new SimulatedClient({ name: 'Diana' });

    // 1. All start in Geral lobby
    hub.joinChannel(u1, 'geral');
    hub.joinChannel(u2, 'geral');
    hub.joinChannel(u3, 'geral');
    hub.joinChannel(u4, 'geral');

    let geral = hub.getChannelsList().find((c) => c.id === 'geral');
    assert.equal(geral.userCount, 4);

    // 2. Alice creates custom room 'Estudos-Dev'
    const newRoom = hub.createChannel('Estudos-Dev');

    // 3. Alice, Bob, Charlie migrate to Estudos-Dev; Diana stays in Geral
    hub.joinChannel(u1, newRoom.id);
    hub.joinChannel(u2, newRoom.id);
    hub.joinChannel(u3, newRoom.id);

    geral = hub.getChannelsList().find((c) => c.id === 'geral');
    assert.equal(geral.userCount, 1, 'Only Diana should remain in Geral');

    const estudos = hub.getChannelsList().find((c) => c.id === newRoom.id);
    assert.equal(estudos.userCount, 3);

    // 4. Bob presents screen; Charlie deafens incoming audio
    u2.startScreenShare();
    hub.updateUserState(u2, { isSharing: true });
    u3.setDeafened(true);
    hub.updateUserState(u3, { isDeafened: true, isMicOn: false });

    assert.equal(u2.screenAudioTrack.readyState, 'live');
    assert.equal(u3.isDeafened, true);

    // 5. Clean teardown
    u2.stopScreenShare();
    hub.leaveChannel(u1);
    hub.leaveChannel(u2);
    hub.leaveChannel(u3);
    hub.leaveChannel(u4);
  });

  it('T4.4: "High-Stress Session" with rapid multi-user operations', () => {
    const hub = new MockSignalingHub();
    const clients = Array.from({ length: 5 }, (_, i) => new SimulatedClient({ name: `User_${i + 1}` }));

    // Rapid joins across various channels
    const targetChannels = ['geral', 'cinema', 'futebol', 'gameplay'];
    clients.forEach((c, i) => {
      hub.joinChannel(c, targetChannels[i % targetChannels.length]);
    });

    // Rapid concurrent state mutations
    clients.forEach((c, i) => {
      c.setMicMuted(i % 2 === 0);
      c.setDeafened(i % 3 === 0);
      c.setUserVolume(`other-${i}`, 50 + i * 25);
    });

    // Concurrent screen shares
    clients[0].startScreenShare();
    clients[1].startScreenShare();
    hub.updateUserState(clients[0], { isSharing: true });
    hub.updateUserState(clients[1], { isSharing: true });

    // Assert states are consistent
    assert.equal(clients[0].screenAudioTrack.readyState, 'live');
    assert.equal(clients[1].screenAudioTrack.readyState, 'live');

    // Disconnect all
    clients.forEach((c) => hub.leaveChannel(c));

    for (const ch of hub.getChannelsList()) {
      assert.equal(ch.userCount, 0, `Channel ${ch.name} must have 0 users`);
      assert.equal(ch.activeStreams, 0, `Channel ${ch.name} must have 0 active streams`);
    }
  });
}, { tier: 4 });
