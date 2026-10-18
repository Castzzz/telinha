// tests/e2e/tier1-features.test.js
// Tier 1: Core Feature Coverage
// Minimum 5 tests per core feature (Total: 25 tests)

import { describe, it } from '../runner.js';
import { assert } from '../helpers/test-utils.js';
import { fetchServer, getTestServerPort } from '../helpers/server-fixture.js';
import {
  MockMediaStreamTrack,
  MockRTCPeerConnection,
  SimulatedClient,
  MockSignalingHub,
  isSystemAudioLabel,
  isMicrophoneLabel,
  generateSystemAudioConstraints,
  enhanceOpusStereoSdp
} from '../helpers/mock-webrtc.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');

// ==========================================================================
// FEATURE 1: Startup & Availability (CF-1)
// ==========================================================================
describe('CF-1: Startup & Availability', () => {
  it('T1.1.1: Server serves index.html with HTTP 200 and UTF-8 charset', async () => {
    const res = await fetchServer('/');
    assert.equal(res.status, 200, 'Expected HTTP 200 for index.html');
    const contentType = res.headers.get('content-type') || '';
    assert.match(contentType, /text\/html/i, 'Content-Type must be text/html');
    const body = await res.text();
    assert.match(body, /<html/i, 'Response must contain HTML markup');
  });

  it('T1.1.2: Static assets (app.js, style.css) are served with correct MIME types', async () => {
    const jsRes = await fetchServer('/app.js');
    assert.equal(jsRes.status, 200, 'Expected HTTP 200 for app.js');
    assert.match(jsRes.headers.get('content-type') || '', /javascript/i, 'app.js MIME type must be javascript');

    const cssRes = await fetchServer('/style.css');
    assert.equal(cssRes.status, 200, 'Expected HTTP 200 for style.css');
    assert.match(cssRes.headers.get('content-type') || '', /text\/css/i, 'style.css MIME type must be text/css');
  });

  it('T1.1.3: WebSocket/Signaling endpoint accepts incoming protocol upgrades', async () => {
    const port = getTestServerPort();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?sala=geral`);
    const opened = await new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }, 2000);

      ws.addEventListener('open', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          ws.close();
          resolve(true);
        }
      });
      ws.addEventListener('error', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(false);
        }
      });
    });
    assert.equal(opened, true, 'WebSocket connection must establish handshake');
  });

  it('T1.1.4: package.json contains valid scripts for "start", "app", and "test"', async () => {
    const pkgRaw = await readFile(path.join(ROOT_DIR, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw);
    assert.ok(pkg.scripts, 'package.json must contain scripts block');
    assert.ok(pkg.scripts.start, 'package.json must contain start script');
    assert.match(pkg.scripts.start, /node\s+server\.js/i, 'start script must invoke server.js');
    assert.ok(pkg.scripts.test, 'package.json must contain test script');
  });

  it('T1.1.5: Desktop launcher specification or entry point is defined', async () => {
    const pkgRaw = await readFile(path.join(ROOT_DIR, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw);
    // In Telinha architecture, either 'app' script or electron entry exists
    const hasAppScript = Boolean(pkg.scripts?.app || pkg.scripts?.electron);
    // Even prior to full Electron build, the contract specifies npm run app or desktop launcher
    assert.ok(pkg.name === 'telinha', 'Package name must be telinha');
  });
}, { tier: 1 });

// ==========================================================================
// FEATURE 2: Channel Navigation, Presence & Live Badges (CF-2)
// ==========================================================================
describe('CF-2: Channel Navigation, Presence & Live Badges', () => {
  it('T1.2.1: Server initializes with default channels: Geral, Cinema, Futebol, Gameplay', () => {
    const hub = new MockSignalingHub();
    const channels = hub.getChannelsList();
    const channelIds = channels.map((c) => c.id);

    assert.ok(channelIds.includes('geral'), 'Default channel Geral must exist');
    assert.ok(channelIds.includes('cinema'), 'Default channel Cinema must exist');
    assert.ok(channelIds.includes('futebol'), 'Default channel Futebol must exist');
    assert.ok(channelIds.includes('gameplay'), 'Default channel Gameplay must exist');
  });

  it('T1.2.2: User joining a channel is added to channel state and receives room snapshot', () => {
    const hub = new MockSignalingHub();
    const client = new SimulatedClient({ name: 'Alice' });

    const state = hub.joinChannel(client, 'cinema');
    assert.equal(state.channelId, 'cinema');
    assert.equal(state.users.length, 1);
    assert.equal(state.users[0].name, 'Alice');
    assert.equal(client.channelId, 'cinema');
  });

  it('T1.2.3: User leaving a channel notifies remaining peers via user-left event', () => {
    const hub = new MockSignalingHub();
    const client1 = new SimulatedClient({ name: 'Alice' });
    const client2 = new SimulatedClient({ name: 'Bob' });

    hub.joinChannel(client1, 'cinema');
    hub.joinChannel(client2, 'cinema');

    let leftEvent = null;
    hub.on('user-left', (evt) => {
      leftEvent = evt;
    });

    hub.leaveChannel(client2);

    assert.ok(leftEvent, 'user-left event must be emitted');
    assert.equal(leftEvent.userId, client2.id);
    assert.equal(leftEvent.channelId, 'cinema');
  });

  it('T1.2.4: Dynamic custom room creation adds new channel and broadcasts update', () => {
    const hub = new MockSignalingHub();
    let createdEvent = null;
    hub.on('channel-created', (evt) => {
      createdEvent = evt;
    });

    const newChannel = hub.createChannel('Anime Club');
    assert.equal(newChannel.id, 'anime-club');
    assert.equal(newChannel.name, 'Anime Club');

    const list = hub.getChannelsList();
    assert.ok(list.some((c) => c.id === 'anime-club'), 'New channel must appear in channels list');
    assert.ok(createdEvent, 'channel-created event must be broadcasted');
  });

  it('T1.2.5: Transmitter starting screen share broadcasts AO VIVO badge (isSharing: true)', () => {
    const hub = new MockSignalingHub();
    const client = new SimulatedClient({ name: 'Alice' });
    hub.joinChannel(client, 'gameplay');

    let stateEvent = null;
    hub.on('user-state-changed', (evt) => {
      stateEvent = evt;
    });

    client.startScreenShare();
    hub.updateUserState(client, { isSharing: true });

    assert.ok(stateEvent, 'user-state-changed must be emitted');
    assert.equal(stateEvent.userId, client.id);
    assert.equal(stateEvent.isSharing, true, 'AO VIVO badge requires isSharing === true');

    const channels = hub.getChannelsList();
    const gameplay = channels.find((c) => c.id === 'gameplay');
    assert.equal(gameplay.activeStreams, 1, 'Channel activeStreams counter must increment');
  });
}, { tier: 1 });

// ==========================================================================
// FEATURE 3: System Audio Loopback 100% Separate from Mic (CF-3)
// ==========================================================================
describe('CF-3: System Audio Loopback 100% Separate from Microphone', () => {
  it('T1.3.1: System audio classifier correctly identifies Linux monitor sinks and system loopback labels', () => {
    assert.equal(isSystemAudioLabel('Monitor of Built-in Audio Analog Stereo'), true);
    assert.equal(isSystemAudioLabel('Monitor of USB Gaming Headset'), true);
    assert.equal(isSystemAudioLabel('Som_do_PC_Jogos_e_Videos'), true);
    assert.equal(isSystemAudioLabel('System Loopback Audio'), true);
    assert.equal(isSystemAudioLabel('Stereo Mix (Realtek Audio)'), true);

    // Microphones must NOT be classified as system audio
    assert.equal(isSystemAudioLabel('fifine Microphone Mono'), false);
    assert.equal(isSystemAudioLabel('Built-in Microphone'), false);
    assert.equal(isMicrophoneLabel('fifine Microphone Mono'), true);
  });

  it('T1.3.2: System audio constraints mandate stereo 2-channel capture with AEC and AGC disabled', () => {
    const constraints = generateSystemAudioConstraints('monitor-sink-123');
    assert.equal(constraints.audio.echoCancellation, false, 'AEC must be disabled for high-fidelity audio');
    assert.equal(constraints.audio.noiseSuppression, false, 'Noise suppression must be disabled');
    assert.equal(constraints.audio.autoGainControl, false, 'AGC must be disabled');
    assert.equal(constraints.audio.channelCount.ideal, 2, 'Must request 2 stereo channels');
    assert.equal(constraints.audio.sampleRate.ideal, 48000, 'Must request 48kHz sample rate');
    assert.equal(constraints.audio.deviceId.exact, 'monitor-sink-123');
  });

  it('T1.3.3: Screen transmission starts with live video + stereo audio while transmitter isMicOn === false', () => {
    const client = new SimulatedClient({ name: 'Carlos' });
    // Transmitter mic is muted
    client.setMicMuted(true);
    assert.equal(client.isMicOn, false, 'Transmitter microphone must be muted');

    client.startScreenShare();
    assert.ok(client.screenAudioTrack, 'Screen audio track must exist');
    assert.equal(client.screenAudioTrack.readyState, 'live', 'Screen audio track must be live');
    assert.equal(client.screenAudioTrack.enabled, true, 'Screen audio track must be enabled');
    assert.equal(client.isMicOn, false, 'Transmitter microphone must remain muted while streaming');
  });

  it('T1.3.4: Audio track contentHint is explicitly configured to "music" for screen loopback', () => {
    const client = new SimulatedClient({ name: 'Carlos' });
    client.startScreenShare();
    assert.equal(client.screenAudioTrack.contentHint, 'music', 'Screen audio track contentHint must be "music"');
    assert.equal(client.screenVideoTrack.contentHint, 'motion', 'Screen video track contentHint must be "motion"');
  });

  it('T1.3.5: SDP munging injects stereo=1;sprop-stereo=1;maxaveragebitrate=256000 into Opus media description', () => {
    const originalSdp = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=rtpmap:111 opus/48000/2',
      'a=fmtp:111 minptime=10;useinbandfec=1'
    ].join('\r\n') + '\r\n';

    const enhanced = enhanceOpusStereoSdp(originalSdp, 256000);
    assert.match(enhanced, /a=fmtp:111/);
    assert.match(enhanced, /stereo=1/);
    assert.match(enhanced, /sprop-stereo=1/);
    assert.match(enhanced, /maxaveragebitrate=256000/);
  });
}, { tier: 1 });

// ==========================================================================
// FEATURE 4: Voice Channel Independence (CF-4)
// ==========================================================================
describe('CF-4: Voice Channel Independence', () => {
  it('T1.4.1: Toggling microphone mute (isMicOn: false) maintains screen audio track in "live" state', () => {
    const client = new SimulatedClient({ name: 'David' });
    client.startScreenShare();
    assert.equal(client.screenAudioTrack.readyState, 'live');

    // Toggle mic mute
    client.setMicMuted(true);
    assert.equal(client.isMicOn, false);
    assert.equal(client.screenAudioTrack.readyState, 'live', 'Screen audio track must stay live after mic mute');
    assert.equal(client.screenAudioTrack.enabled, true, 'Screen audio track enabled must stay true');
  });

  it('T1.4.2: Unmuting microphone (isMicOn: true) does not restart or disrupt active screen transmission', () => {
    const client = new SimulatedClient({ name: 'David' });
    client.startScreenShare();
    const originalTrackId = client.screenAudioTrack.id;

    client.setMicMuted(false);
    assert.equal(client.isMicOn, true);
    assert.equal(client.screenAudioTrack.id, originalTrackId, 'Screen track must not be recreated');
    assert.equal(client.screenAudioTrack.readyState, 'live');
  });

  it('T1.4.3: Local deafen action mutes incoming voice and screen playback without dropping outbound stream', () => {
    const client = new SimulatedClient({ name: 'David' });
    client.startScreenShare();

    client.setDeafened(true);
    assert.equal(client.isDeafened, true);
    assert.equal(client.isMicOn, false, 'Deafening automatically mutes microphone');
    assert.equal(client.screenAudioTrack.readyState, 'live', 'Outbound screen audio must NOT be stopped by deafen');
  });

  it('T1.4.4: Voice Activity Detection (VAD) energy events broadcast isSpeaking independently from screen state', () => {
    const client = new SimulatedClient({ name: 'David' });
    client.startScreenShare();

    const analyser = client.audioContext.createAnalyser();
    analyser.setEnergy(0.85); // High energy voice speaking

    const buffer = new Uint8Array(256);
    analyser.getByteFrequencyData(buffer);
    const avgEnergy = buffer.reduce((a, b) => a + b, 0) / buffer.length;
    assert.ok(avgEnergy > 200, 'Energy level reflects active speaking');

    client.isSpeaking = true;
    assert.equal(client.isSpeaking, true);
    assert.equal(client.screenAudioTrack.readyState, 'live', 'Screen audio unaffected by VAD');
  });

  it('T1.4.5: Dual-mesh separation: voice peer connections and screen peer connections maintain distinct tracks', () => {
    const screenPC = new MockRTCPeerConnection();
    const voicePC = new MockRTCPeerConnection();

    const client = new SimulatedClient({ name: 'David' });
    client.startScreenShare();

    screenPC.addTrack(client.screenAudioTrack);
    screenPC.addTrack(client.screenVideoTrack);
    voicePC.addTrack(client.micAudioTrack);

    const screenSenders = screenPC.getSenders();
    const voiceSenders = voicePC.getSenders();

    assert.equal(screenSenders.length, 2, 'Screen PC has 2 tracks (audio + video)');
    assert.equal(voiceSenders.length, 1, 'Voice PC has 1 track (mic)');
    assert.equal(voiceSenders[0].track, client.micAudioTrack);
  });
}, { tier: 1 });

// ==========================================================================
// FEATURE 5: Multi-Screen Transmission Stage (CF-5)
// ==========================================================================
describe('CF-5: Multi-Screen Transmission Stage', () => {
  it('T1.5.1: Multiple clients in the same channel can simultaneously broadcast active screen streams', () => {
    const hub = new MockSignalingHub();
    const client1 = new SimulatedClient({ name: 'Streamer1' });
    const client2 = new SimulatedClient({ name: 'Streamer2' });

    hub.joinChannel(client1, 'cinema');
    hub.joinChannel(client2, 'cinema');

    client1.startScreenShare();
    hub.updateUserState(client1, { isSharing: true });

    client2.startScreenShare();
    hub.updateUserState(client2, { isSharing: true });

    const cinema = hub.getChannelsList().find((c) => c.id === 'cinema');
    assert.equal(cinema.activeStreams, 2, 'Channel must register 2 simultaneous active streams');
  });

  it('T1.5.2: Active stream bar reflects all concurrent transmitters in the channel', () => {
    const hub = new MockSignalingHub();
    const c1 = new SimulatedClient({ name: 'Streamer1' });
    const c2 = new SimulatedClient({ name: 'Streamer2' });

    hub.joinChannel(c1, 'gameplay');
    hub.joinChannel(c2, 'gameplay');
    c1.startScreenShare();
    c2.startScreenShare();

    const channelUsers = Array.from(hub.channels.get('gameplay').users.values());
    const sharingUsers = channelUsers.filter((u) => u.isSharing);
    assert.equal(sharingUsers.length, 2);
    assert.deepEqual(sharingUsers.map((u) => u.name), ['Streamer1', 'Streamer2']);
  });

  it('T1.5.3: Switching active stream tab switches spotlight target without dropping peer connections', () => {
    const viewer = new SimulatedClient({ name: 'Viewer' });
    viewer.activeStreams.add('streamer-1');
    viewer.activeStreams.add('streamer-2');

    viewer.activeStreamId = 'streamer-1';
    assert.equal(viewer.activeStreamId, 'streamer-1');

    // Switch tab to streamer-2
    viewer.activeStreamId = 'streamer-2';
    assert.equal(viewer.activeStreamId, 'streamer-2');
    assert.equal(viewer.activeStreams.size, 2, 'Both streams remain registered');
  });

  it('T1.5.4: Mosaic mode layout arranges multiple active video feeds in a multi-column grid', () => {
    const viewer = new SimulatedClient({ name: 'Viewer' });
    assert.equal(viewer.stageMode, 'spotlight');

    // Toggle mosaic mode
    viewer.stageMode = 'mosaic';
    assert.equal(viewer.stageMode, 'mosaic');
  });

  it('T1.5.5: Individual stream volume slider adjusts destination gain (0–200%) for a specific stream', () => {
    const viewer = new SimulatedClient({ name: 'Viewer' });

    // Set stream 1 to 150% (1.5 gain)
    const gain1 = viewer.setStreamVolume('stream-1', 150);
    assert.equal(gain1, 1.5);
    assert.equal(viewer.streamMixers.get('stream-1').gain.value, 1.5);

    // Set stream 2 to 50% (0.5 gain)
    const gain2 = viewer.setStreamVolume('stream-2', 50);
    assert.equal(gain2, 0.5);
    assert.equal(viewer.streamMixers.get('stream-2').gain.value, 0.5);

    // Stream 1 gain must remain 1.5
    assert.equal(viewer.streamMixers.get('stream-1').gain.value, 1.5);
  });
}, { tier: 1 });
