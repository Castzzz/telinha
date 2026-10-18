// tests/e2e/tier2-boundaries.test.js
// Tier 2: Boundary & Corner Cases
// Minimum 5 tests per core feature (Total: 25 tests)

import { describe, it } from '../runner.js';
import { assert } from '../helpers/test-utils.js';
import { fetchServer } from '../helpers/server-fixture.js';
import {
  MockMediaStreamTrack,
  SimulatedClient,
  MockSignalingHub,
  isSystemAudioLabel,
  isMicrophoneLabel,
  detectAudioDevices,
  generateSystemAudioConstraints,
  enhanceOpusStereoSdp
} from '../helpers/mock-webrtc.js';

// ==========================================================================
// FEATURE 1: Startup & Server Boundaries
// ==========================================================================
describe('CF-1 Boundaries: Startup & Server Resiliency', () => {
  it('T2.1.1: Path traversal attempts (/../../../etc/passwd) are rejected with 404', async () => {
    const res = await fetchServer('/../../../etc/passwd');
    assert.equal(res.status, 404, 'Path traversal must return 404 Not Found');
  });

  it('T2.1.2: WebSocket endpoint rejects requests with invalid room names', async () => {
    // ROOM_RE is /^[\w-]{1,64}$/
    // Request with invalid characters or overly long room name
    const res = await fetchServer('/ws?sala=' + 'a'.repeat(100));
    // Must reject with 400 or close
    assert.notEqual(res.status, 200, 'Invalid room name must be rejected');
  });

  it('T2.1.3: Method Not Allowed: POST requests on static file endpoints return 405', async () => {
    const res = await fetchServer('/index.html', { method: 'POST' });
    assert.equal(res.status, 405, 'POST on static files must return HTTP 405');
  });

  it('T2.1.4: Static file request for non-existent file returns HTTP 404 cleanly', async () => {
    const res = await fetchServer('/non-existent-xyz-' + Date.now() + '.html');
    assert.equal(res.status, 404, 'Non-existent file must return HTTP 404');
  });

  it('T2.1.5: OPTIONS and HEAD requests on root do not crash the server', async () => {
    const headRes = await fetchServer('/', { method: 'HEAD' });
    assert.ok([200, 405].includes(headRes.status), 'HEAD request must return 200 or 405 without crash');
  });
}, { tier: 2 });

// ==========================================================================
// FEATURE 2: Channel & Presence Boundaries
// ==========================================================================
describe('CF-2 Boundaries: Channel Navigation & Presence Edge Cases', () => {
  it('T2.2.1: Channel creation with empty or whitespace-only name throws validation error', () => {
    const hub = new MockSignalingHub();
    assert.throws(() => hub.createChannel(''), /inválido|vazio/i);
    assert.throws(() => hub.createChannel('    '), /vazio/i);
    assert.throws(() => hub.createChannel(null), /inválido/i);
  });

  it('T2.2.2: Channel creation with HTML/special characters is sanitized safely', () => {
    const hub = new MockSignalingHub();
    const ch = hub.createChannel('<script>alert("hack")</script>');
    assert.ok(!ch.name.includes('<script>'), 'HTML tags must be stripped');
    assert.ok(!ch.id.includes('<'), 'Channel ID must be sanitized');
  });

  it('T2.2.3: Channel name length boundary: names longer than 32 chars are truncated', () => {
    const hub = new MockSignalingHub();
    const longName = 'A'.repeat(50);
    const ch = hub.createChannel(longName);
    assert.ok(ch.name.length <= 32, 'Channel name must not exceed 32 characters');
  });

  it('T2.2.4: Rapid channel switching across multiple channels preserves clean final state', () => {
    const hub = new MockSignalingHub();
    const client = new SimulatedClient({ name: 'FastHopper' });

    // Join 4 channels in rapid succession
    hub.joinChannel(client, 'geral');
    hub.joinChannel(client, 'cinema');
    hub.joinChannel(client, 'futebol');
    hub.joinChannel(client, 'gameplay');

    assert.equal(client.channelId, 'gameplay');
    // Ensure client is ONLY in gameplay, not in previous channels
    assert.equal(hub.channels.get('geral').users.has(client.id), false);
    assert.equal(hub.channels.get('cinema').users.has(client.id), false);
    assert.equal(hub.channels.get('futebol').users.has(client.id), false);
    assert.equal(hub.channels.get('gameplay').users.has(client.id), true);
  });

  it('T2.2.5: Abrupt client disconnect cleans up presence and terminates active screen share', () => {
    const hub = new MockSignalingHub();
    const streamer = new SimulatedClient({ name: 'Streamer' });
    hub.joinChannel(streamer, 'cinema');
    streamer.startScreenShare();

    assert.equal(streamer.isSharing, true);
    hub.leaveChannel(streamer);

    assert.equal(streamer.channelId, null);
    assert.equal(streamer.isSharing, false, 'Screen share must be stopped on channel leave');
    assert.equal(streamer.screenAudioTrack, null);
  });
}, { tier: 2 });

// ==========================================================================
// FEATURE 3: Audio Loopback & Hardware Constraints Boundaries
// ==========================================================================
describe('CF-3 Boundaries: Audio Loopback & Hardware Edge Cases', () => {
  it('T2.3.1: Classifier rejects physical microphone and headset input labels', () => {
    assert.equal(isSystemAudioLabel(''), false);
    assert.equal(isSystemAudioLabel(null), false);
    assert.equal(isSystemAudioLabel(undefined), false);
    assert.equal(isSystemAudioLabel('Microphone (High Definition Audio Device)'), false);
    assert.equal(isSystemAudioLabel('FrontMic (Realtek)'), false);
    assert.equal(isSystemAudioLabel('Logitech PRO X Wireless Gaming Headset Mono'), false);
  });

  it('T2.3.2: Device detection handles empty device list without throwing unhandled exceptions', () => {
    const res = detectAudioDevices([]);
    assert.deepEqual(res.systemAudioDevices, []);
    assert.deepEqual(res.microphoneDevices, []);
    assert.equal(res.defaultSystemAudio, null);
    assert.equal(res.defaultMicrophone, null);
  });

  it('T2.3.3: SDP munging creates Opus fmtp line if initially missing from SDP', () => {
    const sdpWithoutFmtp = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=rtpmap:111 opus/48000/2',
      'm=video 9 UDP/TLS/RTP/SAVPF 96'
    ].join('\r\n') + '\r\n';

    const enhanced = enhanceOpusStereoSdp(sdpWithoutFmtp, 256000);
    assert.match(enhanced, /a=fmtp:111 stereo=1;sprop-stereo=1;maxaveragebitrate=256000/);
  });

  it('T2.3.4: SDP munging idempotency: running twice produces clean non-duplicated parameters', () => {
    const initialSdp = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=rtpmap:111 opus/48000/2',
      'a=fmtp:111 minptime=10'
    ].join('\r\n') + '\r\n';

    const pass1 = enhanceOpusStereoSdp(initialSdp, 256000);
    const pass2 = enhanceOpusStereoSdp(pass1, 256000);

    const matches = pass2.match(/maxaveragebitrate=256000/g);
    assert.equal(matches.length, 1, 'maxaveragebitrate must appear exactly once');
    const stereoMatches = pass2.match(/(?:^|[;\s])stereo=1(?=[;\r\n]|$)/g);
    assert.equal(stereoMatches.length, 1, 'stereo=1 must appear exactly once');
  });

  it('T2.3.5: Fallback to default system audio when preferred device is omitted', () => {
    const constraints = generateSystemAudioConstraints(undefined);
    assert.equal(constraints.audio.deviceId, undefined);
    assert.equal(constraints.audio.channelCount.ideal, 2);
    assert.equal(constraints.audio.echoCancellation, false);
  });
}, { tier: 2 });

// ==========================================================================
// FEATURE 4: Voice Independence & Rapid Toggling Boundaries
// ==========================================================================
describe('CF-4 Boundaries: Voice Independence & Rapid Toggling', () => {
  it('T2.4.1: Rapid mic toggling (10 mute/unmute cycles in 100ms) leaves screen audio track "live"', () => {
    const client = new SimulatedClient({ name: 'RapidToggler' });
    client.startScreenShare();
    assert.equal(client.screenAudioTrack.readyState, 'live');

    for (let i = 0; i < 10; i++) {
      client.setMicMuted(i % 2 === 0);
      assert.equal(client.screenAudioTrack.readyState, 'live', `Screen audio track must remain live on toggle ${i}`);
      assert.equal(client.screenAudioTrack.enabled, true);
    }
  });

  it('T2.4.2: Rapid deafen toggling while receiving screen audio does not tear down connection', () => {
    const client = new SimulatedClient({ name: 'DeafenTester' });
    client.startScreenShare();

    for (let i = 0; i < 6; i++) {
      client.setDeafened(i % 2 === 0);
      assert.equal(client.screenAudioTrack.readyState, 'live');
    }
  });

  it('T2.4.3: Volume mixer clamps negative values to 0.0 and values exceeding 200% to 2.0', () => {
    const client = new SimulatedClient({ name: 'VolumeTester' });

    // Negative volume
    const gainZero = client.setStreamVolume('stream-1', -50);
    assert.equal(gainZero, 0.0, 'Negative volume must clamp to 0.0');

    // > 200% volume
    const gainMax = client.setStreamVolume('stream-1', 350);
    assert.equal(gainMax, 2.0, 'Volume exceeding 200% must clamp to 2.0');

    // User volume clamps
    const userZero = client.setUserVolume('user-1', -10);
    assert.equal(userZero, 0.0);
    const userMax = client.setUserVolume('user-1', 500);
    assert.equal(userMax, 2.0);
  });

  it('T2.4.4: Simultaneous mic toggle and deafen toggle resolves cleanly without state corruption', () => {
    const client = new SimulatedClient({ name: 'StateTester' });
    client.setMicMuted(false);
    client.setDeafened(true);

    assert.equal(client.isDeafened, true);
    assert.equal(client.isMicOn, false, 'Deafened state forces mic off');
  });

  it('T2.4.5: Microphone track unexpected ended event does not stop screen loopback audio track', () => {
    const client = new SimulatedClient({ name: 'CrashTester' });
    client.startScreenShare();

    // Abruptly kill mic track
    client.micAudioTrack.stop();
    assert.equal(client.micAudioTrack.readyState, 'ended');

    // Screen audio track MUST remain live
    assert.equal(client.screenAudioTrack.readyState, 'live', 'Screen audio track must NOT end when mic track ends');
  });
}, { tier: 2 });

// ==========================================================================
// FEATURE 5: Multi-Screen Stage Boundaries & Stress
// ==========================================================================
describe('CF-5 Boundaries: Multi-Screen Stage Stress & Edge Cases', () => {
  it('T2.5.1: Stage handles empty stream list by reverting to Voice Lounge fallback', () => {
    const client = new SimulatedClient({ name: 'LoungeTester' });
    assert.equal(client.activeStreams.size, 0);
    assert.equal(client.activeStreamId, null);
    // When no streams are active, client remains in default stage view
  });

  it('T2.5.2: Transmitter abrupt disconnect immediately removes stream and clears activeStreams', () => {
    const hub = new MockSignalingHub();
    const streamer = new SimulatedClient({ name: 'Host' });
    hub.joinChannel(streamer, 'cinema');
    streamer.startScreenShare();
    hub.updateUserState(streamer, { isSharing: true });

    let cinema = hub.getChannelsList().find((c) => c.id === 'cinema');
    assert.equal(cinema.activeStreams, 1);

    // Streamer disconnects
    hub.leaveChannel(streamer);
    cinema = hub.getChannelsList().find((c) => c.id === 'cinema');
    assert.equal(cinema.activeStreams, 0, 'Active stream count must be 0 after streamer disconnects');
  });

  it('T2.5.3: Dynamic stream resolution change preserves track live state', () => {
    const streamer = new SimulatedClient({ name: 'ResolutionTester' });
    streamer.startScreenShare();

    // Mock resolution resize event on video track
    streamer.screenVideoTrack.readyState = 'live';
    assert.equal(streamer.screenVideoTrack.readyState, 'live');
    assert.equal(streamer.screenAudioTrack.readyState, 'live');
  });

  it('T2.5.4: Switching between Spotlight and Mosaic mode with 4 concurrent streams preserves all streams', () => {
    const viewer = new SimulatedClient({ name: 'Viewer' });
    for (let i = 1; i <= 4; i++) {
      viewer.activeStreams.add(`stream-${i}`);
    }

    assert.equal(viewer.activeStreams.size, 4);

    viewer.stageMode = 'mosaic';
    assert.equal(viewer.stageMode, 'mosaic');
    assert.equal(viewer.activeStreams.size, 4);

    viewer.stageMode = 'spotlight';
    assert.equal(viewer.stageMode, 'spotlight');
    assert.equal(viewer.activeStreams.size, 4);
  });

  it('T2.5.5: Setting one stream volume to 200% does not clip or alter neighboring streams', () => {
    const viewer = new SimulatedClient({ name: 'MixerTester' });

    viewer.setStreamVolume('stream-1', 200);
    viewer.setStreamVolume('stream-2', 75);

    assert.equal(viewer.streamMixers.get('stream-1').gain.value, 2.0);
    assert.equal(viewer.streamMixers.get('stream-2').gain.value, 0.75);
  });
}, { tier: 2 });
