// tests/e2e/tier3-combinations.test.js
// Tier 3: Cross-Feature Combinations & Pairwise Interactions
// Validates behavior when multiple distinct features interact concurrently.

import { describe, it } from '../runner.js';
import { assert } from '../helpers/test-utils.js';
import {
  MockMediaStreamTrack,
  MockRTCPeerConnection,
  SimulatedClient,
  MockSignalingHub,
  enhanceOpusStereoSdp
} from '../helpers/mock-webrtc.js';

describe('Tier 3: Pairwise Cross-Feature Interactions', () => {
  it('T3.1: Screen Share + Channel Switching terminates stream in old channel cleanly', () => {
    const hub = new MockSignalingHub();
    const streamer = new SimulatedClient({ name: 'Streamer' });

    hub.joinChannel(streamer, 'cinema');
    streamer.startScreenShare();
    hub.updateUserState(streamer, { isSharing: true });

    let cinema = hub.getChannelsList().find((c) => c.id === 'cinema');
    assert.equal(cinema.activeStreams, 1);

    // Streamer hops to 'gameplay' channel
    hub.joinChannel(streamer, 'gameplay');

    cinema = hub.getChannelsList().find((c) => c.id === 'cinema');
    assert.equal(cinema.activeStreams, 0, 'Stream must be cleared from cinema');
    assert.equal(streamer.channelId, 'gameplay');
  });

  it('T3.2: Deafen Toggle + System Audio Loopback retains outbound screen audio broadcasting', () => {
    const hub = new MockSignalingHub();
    const streamer = new SimulatedClient({ name: 'Host' });
    hub.joinChannel(streamer, 'geral');

    streamer.startScreenShare();
    assert.equal(streamer.screenAudioTrack.readyState, 'live');

    // Host deafens client to avoid hearing friends
    streamer.setDeafened(true);
    hub.updateUserState(streamer, { isDeafened: true, isMicOn: false });

    assert.equal(streamer.isDeafened, true);
    assert.equal(streamer.isMicOn, false);
    // Outgoing screen audio MUST continue playing for friends
    assert.equal(streamer.screenAudioTrack.readyState, 'live');
    assert.equal(streamer.screenAudioTrack.enabled, true);
  });

  it('T3.3: Mic VAD Activity + Screen Streaming preserves high-bitrate Opus stereo pipeline', () => {
    const streamer = new SimulatedClient({ name: 'Gamer' });
    streamer.startScreenShare();

    // Screen audio is configured with stereo 256kbps
    const initialSdp = enhanceOpusStereoSdp(
      'a=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10\r\n',
      256000
    );
    assert.match(initialSdp, /maxaveragebitrate=256000/);

    // VAD triggers voice speaking on mic
    streamer.isSpeaking = true;
    streamer.micAudioTrack.enabled = true;

    // Verify screen audio track remains untouched and maintains stereo SDP contract
    assert.equal(streamer.screenAudioTrack.readyState, 'live');
    assert.equal(streamer.screenAudioTrack.contentHint, 'music');
    assert.match(initialSdp, /stereo=1;sprop-stereo=1/);
  });

  it('T3.4: Multi-Screen Stage + Dynamic Room Creation initializes multi-stream stage correctly', () => {
    const hub = new MockSignalingHub();
    const newRoom = hub.createChannel('Torneio');

    const p1 = new SimulatedClient({ name: 'Player1' });
    const p2 = new SimulatedClient({ name: 'Player2' });

    hub.joinChannel(p1, newRoom.id);
    hub.joinChannel(p2, newRoom.id);

    p1.startScreenShare();
    p2.startScreenShare();
    hub.updateUserState(p1, { isSharing: true });
    hub.updateUserState(p2, { isSharing: true });

    const roomState = hub.getChannelsList().find((c) => c.id === 'torneio');
    assert.equal(roomState.activeStreams, 2, 'New dynamic room must track both concurrent streams');
  });

  it('T3.5: Individual User Mic Gain + Stream Gain maintain independent Web Audio nodes', () => {
    const viewer = new SimulatedClient({ name: 'Spectator' });
    const targetUserId = 'friend-alice';
    const targetStreamId = 'stream-alice';

    // Boost Alice's microphone voice to 160%
    viewer.setUserVolume(targetUserId, 160);
    // Lower Alice's game stream volume to 40%
    viewer.setStreamVolume(targetStreamId, 40);

    const userGain = viewer.userMixers.get(targetUserId).gain.value;
    const streamGain = viewer.streamMixers.get(targetStreamId).gain.value;

    assert.equal(userGain, 1.6, 'User mic gain must be 1.6');
    assert.equal(streamGain, 0.4, 'Stream gain must be 0.4');
  });

  it('T3.6: Text Chat Messaging + Active Screen Streaming operate concurrently without conflicts', () => {
    const hub = new MockSignalingHub();
    const streamer = new SimulatedClient({ name: 'Streamer' });
    const viewer = new SimulatedClient({ name: 'Viewer' });

    hub.joinChannel(streamer, 'cinema');
    hub.joinChannel(viewer, 'cinema');

    streamer.startScreenShare();

    const messages = [];
    hub.on('chat-message', (msg) => {
      messages.push(msg);
    });

    hub.sendChatMessage(viewer, 'Que filme massa!');
    hub.sendChatMessage(streamer, 'Valeu mano!');

    assert.equal(messages.length, 2);
    assert.equal(messages[0].senderName, 'Viewer');
    assert.equal(messages[1].senderName, 'Streamer');
    assert.equal(streamer.screenAudioTrack.readyState, 'live');
  });

  it('T3.7: Mic Mute + WebRTC Voice Renegotiation preserves screen peer connection', () => {
    const screenPC = new MockRTCPeerConnection();
    const voicePC = new MockRTCPeerConnection();

    const client = new SimulatedClient({ name: 'Host' });
    client.startScreenShare();

    screenPC.addTrack(client.screenAudioTrack);
    screenPC.addTrack(client.screenVideoTrack);
    voicePC.addTrack(client.micAudioTrack);

    // Mute mic and simulate renegotiating voice connection
    client.setMicMuted(true);
    voicePC.close();

    // Screen peer connection must remain open and live
    assert.notEqual(screenPC.connectionState, 'closed');
    assert.equal(client.screenAudioTrack.readyState, 'live');
  });

  it('T3.8: Audio Input Device Switch leaves system loopback monitor track untouched', () => {
    const client = new SimulatedClient({ name: 'User' });
    client.startScreenShare();

    const oldScreenTrackId = client.screenAudioTrack.id;

    // Switch microphone device (e.g. from USB Mic to Headset Mic)
    client.micAudioTrack.stop();
    client.micAudioTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'New Headset Mic' });

    assert.equal(client.micAudioTrack.label, 'New Headset Mic');
    assert.equal(client.screenAudioTrack.id, oldScreenTrackId, 'Screen track ID must remain unchanged');
    assert.equal(client.screenAudioTrack.readyState, 'live');
  });
}, { tier: 3 });
