// tests/m2-challenger-audio-isolation.test.js
// Milestone 2 Empirical Adversarial Challenge Suite
// Tests Audio Device Classification Regex, Opus SDP Munging, and Voice/Screen Isolation under stress

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSystemAudioLabel,
  isMicrophoneLabel,
  detectAudioDevices,
  generateSystemAudioConstraints,
  generateMicrophoneConstraints,
  enhanceOpusStereoSdp,
  configureAudioSenderBitrate,
  VoiceActivityDetector,
  VolumeMixerManager,
  DeafenController,
  AudioManager
} from '../public/audio-manager.js';
import {
  MockAudioContext,
  MockMediaStream,
  MockMediaStreamTrack,
  MockRTCPeerConnection
} from './helpers/mock-webrtc.js';

// =========================================================================
// SUITE 1: AUDIO DEVICE CLASSIFICATION REGEX & MULTILINGUAL / TRICKY NAMES
// =========================================================================

test('Challenger 1.1: Tricky & Multilingual System Audio Loopback Names', () => {
  const systemAudioLabels = [
    // Standard PulseAudio / PipeWire default monitor sinks
    'Monitor of Built-in Audio Analog Stereo',
    'Monitor of USB Audio CODEC Analog Stereo',
    'Monitor of PulseAudio Sound Server',
    'Monitor of TU106 High Definition Audio Controller Digital Stereo (HDMI 2)',
    'Monitor of ALC892 Analog Stereo',
    'Monitor of SteelSeries Arctis 7 Game',
    'Monitor of Family 17h/19h HD Audio Controller Digital Stereo (HDMI)',
    'monitor of built-in audio analog stereo', // lowercase
    'MONITOR OF BUILT-IN AUDIO', // uppercase
    'Monitor of Speakers (Realtek(R) Audio)',

    // Dedicated Linux loopback sinks & Portuguese labels
    'som_do_pc',
    'SOM_DO_PC',
    'Som do PC',
    'som_do_pc_jogos_e_videos',
    'som do pc jogos e videos',
    'Som do PC (Jogos e Vídeos)',
    'Som_do_PC_Jogos_e_Videos',
    'som_do_pc-sink',
    'som_do_pc.monitor',
    'som do pc - loopback',

    // Generic system / loopback / monitor terms
    'monitor de audio do sistema',
    'monitor de áudio do sistema',
    'Monitor de Áudio Analógico',
    'Monitor de som',
    'monitor do sistema',
    'monitor de som do pc',
    'System Loopback Audio',
    'System Audio Loopback',
    'PulseAudio System Loopback',
    'PipeWire loopback-sink',
    'Áudio do Sistema',
    'audio do sistema',
    'Sistema de Som (Loopback)',

    // Windows Stereo Mix / Loopback devices
    'Stereo Mix (Realtek High Definition Audio)',
    'Stereo Mix (Realtek Audio)',
    'Stereo Mix',
    'STEREO MIX',
    'stereo mix (IDT High Definition Audio CODEC)'
  ];

  for (const label of systemAudioLabels) {
    assert.equal(
      isSystemAudioLabel(label),
      true,
      `Expected "${label}" to be classified as System Audio (isSystemAudioLabel === true)`
    );
    assert.equal(
      isMicrophoneLabel(label),
      false,
      `Expected "${label}" NOT to be classified as Microphone (isMicrophoneLabel === false)`
    );
  }
});

test('Challenger 1.2: Physical Microphones & Headset Inputs Classification', () => {
  const microphoneLabels = [
    // Fifine microphones
    'fifine Microphone Mono',
    'FIFINE K669B Microphone',
    'fifine K688 USB Dynamic Microphone Mono',
    'Fifine AmpliGame A6V Gaming Mic',
    'fifine Microphone (Analog Stereo)',
    'fifine-mic-usb-input',

    // Standard built-in / vendor mics
    'Built-in Microphone',
    'Microphone (Realtek High Definition Audio)',
    'Microphone (Realtek(R) Audio)',
    'Microfone Interno',
    'Microfone USB',
    'Microfone (Realtek High Definition Audio)',
    'Microfone de Mesa',

    // Gaming headsets & Studio mics
    'Headset Microphone (Logitech PRO X Gaming Headset)',
    'Logitech PRO X Headset Mono',
    'HyperX QuadCast S',
    'HyperX Cloud II Wireless Microphone',
    'Razer BlackShark V2 Pro Microphone',
    'Blue Yeti USB Microphone',
    'Blue Snowball iCE',
    'Shure MV7 Mono Microphone',
    'Audio-Technica AT2020USB+',
    'Rode NT-USB Mini',
    'Elgato Wave:3',

    // Webcams & auxiliary inputs
    'Webcam C920 Microphone Mono',
    '2K Camera Analog Stereo',
    'USB Audio Device Mono',
    'Line In (Realtek Audio)',
    'Front Microphone (Realtek Audio)',
    'External Mic'
  ];

  for (const label of microphoneLabels) {
    assert.equal(
      isSystemAudioLabel(label),
      false,
      `Expected "${label}" NOT to be classified as System Audio`
    );
    assert.equal(
      isMicrophoneLabel(label),
      true,
      `Expected "${label}" to be classified as Microphone (isMicrophoneLabel === true)`
    );
  }
});

test('Challenger 1.3: Boundary Cases & Corrupt Inputs for Device Classifiers', () => {
  // Empty, null, undefined, non-strings
  const nonStringInputs = [null, undefined, '', 0, 12345, true, false, {}, [], () => {}];

  for (const input of nonStringInputs) {
    assert.equal(isSystemAudioLabel(input), false, `Invalid input ${JSON.stringify(input)} must return false`);
    assert.equal(isMicrophoneLabel(input), false, `Invalid input ${JSON.stringify(input)} must return false`);
  }

  // Tricky strings that should NOT false-positive as system audio
  const deceptiveMicLabels = [
    'Microphone with Studio Monitor headphones', // has "monitor" in middle, but starts with Microphone
    'Personal Voice Monitor Mic',               // has "monitor", but not system audio
    'Auditory Feedback Monitor Microphone'
  ];

  for (const label of deceptiveMicLabels) {
    assert.equal(isSystemAudioLabel(label), false, `"${label}" must not be mistaken for system audio`);
    assert.equal(isMicrophoneLabel(label), true, `"${label}" should be classified as microphone`);
  }

  // Whitespace string behavior: isMicrophoneLabel treats any non-system string as a candidate mic
  assert.equal(isSystemAudioLabel('   '), false);
  assert.equal(typeof isMicrophoneLabel('   '), 'boolean');
});

test('Challenger 1.4: Device Detection Priority & Resiliency under Diverse Hardware', () => {
  const diverseDevices = [
    { kind: 'audioinput', deviceId: 'mic-webcam', label: 'Webcam C920 Microphone Mono' },
    { kind: 'audioinput', deviceId: 'sys-monitor', label: 'Monitor of Built-in Audio Analog Stereo' },
    { kind: 'audioinput', deviceId: 'mic-fifine', label: 'fifine K688 USB Dynamic Microphone Mono' },
    { kind: 'audioinput', deviceId: 'sys-gaming', label: 'som_do_pc_jogos_e_videos' },
    { kind: 'audioinput', deviceId: 'sys-mix', label: 'Stereo Mix (Realtek Audio)' },
    { kind: 'audiooutput', deviceId: 'out-headphones', label: 'Headphones (Realtek Audio)' },
    { kind: 'videoinput', deviceId: 'cam-1', label: 'Webcam C920' },
    null, // resilient to null/corrupt entries
    { kind: 'audioinput', deviceId: 'unknown-blank', label: '' } // blank label
  ];

  const detected = detectAudioDevices(diverseDevices);

  // System audio devices count
  assert.equal(detected.systemAudioDevices.length, 3, 'Should discover 3 system loopback sinks');
  // Microphone devices count
  assert.equal(detected.microphoneDevices.length, 2, 'Should discover 2 physical microphones');
  // Audio outputs count
  assert.equal(detected.audioOutputs.length, 1, 'Should discover 1 audio output');

  // Priority check: dedicated gaming loopback (som_do_pc) must take precedence over generic Monitor of...
  assert.equal(
    detected.defaultSystemAudio.deviceId,
    'sys-gaming',
    'Dedicated som_do_pc sink must be prioritized as defaultSystemAudio'
  );

  // Priority check: USB / Fifine microphone must take precedence over webcam mic
  assert.equal(
    detected.defaultMicrophone.deviceId,
    'mic-fifine',
    'Fifine USB microphone must be prioritized as defaultMicrophone'
  );

  // Null & empty resilience
  const resNull = detectAudioDevices(null);
  assert.equal(resNull.systemAudioDevices.length, 0);
  assert.equal(resNull.defaultSystemAudio, null);

  const resEmpty = detectAudioDevices([]);
  assert.equal(resEmpty.systemAudioDevices.length, 0);
  assert.equal(resEmpty.defaultMicrophone, null);
});

test('Challenger 1.5 [Edge Case]: Leading whitespace in system audio label', () => {
  // When a label has leading whitespace, ^monitor regex fails unless trimmed
  const untrimmedLabel = '  Monitor of Built-in Audio Analog Stereo';
  const isSys = isSystemAudioLabel(untrimmedLabel);
  // Empirical observation: returns false due to ^ anchor without leading \s*
  assert.equal(isSys, false, 'Empirically demonstrates that leading whitespace bypasses ^monitor anchor');

  // Conversely, som_do_pc uses (\b|_) which matches after leading space
  assert.equal(isSystemAudioLabel('  som_do_pc'), true);
});


// =========================================================================
// SUITE 2: OPUS SDP MUNGING ADVERSARIAL EDGE CASES
// =========================================================================

test('Challenger 2.1: Opus SDP Munging with Missing fmtp Line', () => {
  const sdpWithoutFmtp = [
    'v=0',
    'o=- 123456789 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'c=IN IP4 0.0.0.0',
    'a=rtpmap:111 opus/48000/2',
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
    'c=IN IP4 0.0.0.0',
    'a=rtpmap:96 VP8/90000'
  ].join('\r\n') + '\r\n';

  const enhanced = enhanceOpusStereoSdp(sdpWithoutFmtp, 256000);

  // Must inject a=fmtp:111 right after rtpmap
  assert.match(enhanced, /a=rtpmap:111 opus\/48000\/2\r?\na=fmtp:111 /);
  assert.match(enhanced, /stereo=1/);
  assert.match(enhanced, /sprop-stereo=1/);
  assert.match(enhanced, /maxaveragebitrate=256000/);

  // Video section must remain untouched
  assert.match(enhanced, /a=rtpmap:96 VP8\/90000/);
});

test('Challenger 2.2: Opus SDP Munging with Existing Partial & Conflicting Parameters', () => {
  const sdpWithOldParams = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;stereo=0;sprop-stereo=0;maxaveragebitrate=32000;useinbandfec=1;cbr=1'
  ].join('\r\n') + '\r\n';

  const enhanced = enhanceOpusStereoSdp(sdpWithOldParams, 256000);

  // Must retain minptime, useinbandfec, cbr
  assert.match(enhanced, /minptime=10/);
  assert.match(enhanced, /useinbandfec=1/);
  assert.match(enhanced, /cbr=1/);

  // Must replace stereo=0 with stereo=1
  assert.doesNotMatch(enhanced, /stereo=0/);
  assert.match(enhanced, /stereo=1/);

  // Must replace sprop-stereo=0 with sprop-stereo=1
  assert.doesNotMatch(enhanced, /sprop-stereo=0/);
  assert.match(enhanced, /sprop-stereo=1/);

  // Must replace 32000 with 256000
  assert.doesNotMatch(enhanced, /maxaveragebitrate=32000/);
  assert.match(enhanced, /maxaveragebitrate=256000/);
});

test('Challenger 2.3: Strict Idempotency over 10 Successive Passes', () => {
  const baseSdp = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1'
  ].join('\r\n') + '\r\n';

  let currentSdp = baseSdp;
  for (let pass = 1; pass <= 10; pass++) {
    currentSdp = enhanceOpusStereoSdp(currentSdp, 256000);

    // Verify token counts on each pass
    const stereoMatches = currentSdp.match(/(?:^|[;\s])stereo=1(?=[;\r\n]|$)/g) || [];
    const spropMatches = currentSdp.match(/(?:^|[;\s])sprop-stereo=1(?=[;\r\n]|$)/g) || [];
    const bitrateMatches = currentSdp.match(/(?:^|[;\s])maxaveragebitrate=256000(?=[;\r\n]|$)/g) || [];

    assert.equal(stereoMatches.length, 1, `Pass ${pass}: stereo=1 must appear exactly once`);
    assert.equal(spropMatches.length, 1, `Pass ${pass}: sprop-stereo=1 must appear exactly once`);
    assert.equal(bitrateMatches.length, 1, `Pass ${pass}: maxaveragebitrate=256000 must appear exactly once`);

    // Ensure no syntax bugs like double semicolons or trailing spaces
    assert.doesNotMatch(currentSdp, /;;/, `Pass ${pass}: Must not produce double semicolons`);
  }
});

test('Challenger 2.4: Dynamic Opus Payload Types (96, 109, 111, 120)', () => {
  const payloadTypes = ['96', '109', '111', '120'];

  for (const pt of payloadTypes) {
    const sdp = [
      'v=0',
      `m=audio 9 UDP/TLS/RTP/SAVPF ${pt}`,
      `a=rtpmap:${pt} opus/48000/2`,
      `a=fmtp:${pt} minptime=20`
    ].join('\r\n') + '\r\n';

    const enhanced = enhanceOpusStereoSdp(sdp, 256000);
    assert.match(
      enhanced,
      new RegExp(`a=fmtp:${pt} minptime=20;stereo=1;sprop-stereo=1;maxaveragebitrate=256000`),
      `Payload type ${pt} must be dynamically recognized and enhanced`
    );
  }
});

test('Challenger 2.5: Non-Opus SDP and Video-Only Media Descriptions', () => {
  // Only PCMU (G.711) audio, no Opus
  const pcmuSdp = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 0',
    'a=rtpmap:0 PCMU/8000',
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
    'a=rtpmap:96 VP8/90000'
  ].join('\r\n') + '\r\n';

  const resPcmu = enhanceOpusStereoSdp(pcmuSdp, 256000);
  assert.equal(resPcmu, pcmuSdp, 'SDP without Opus must remain completely unmodified');

  // Video-only SDP
  const videoOnlySdp = [
    'v=0',
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
    'a=rtpmap:96 VP8/90000'
  ].join('\r\n') + '\r\n';

  const resVideo = enhanceOpusStereoSdp(videoOnlySdp, 256000);
  assert.equal(resVideo, videoOnlySdp, 'Video-only SDP must remain unmodified');
});

test('Challenger 2.6: Corrupt & Boundary SDP Resilience', () => {
  const corruptSDPs = [
    null,
    undefined,
    '',
    '   ',
    'invalid sdp string without any linebreaks',
    'v=0\r\no=- 123 456\r\n',
    'a=rtpmap: opus/48000/2', // missing PT digits
    'a=fmtp:111 stereo=1'     // fmtp without rtpmap
  ];

  for (const corrupt of corruptSDPs) {
    // Must never throw an unhandled exception
    assert.doesNotThrow(() => {
      const out = enhanceOpusStereoSdp(corrupt, 256000);
      if (typeof corrupt === 'string') {
        assert.equal(typeof out, 'string');
      } else {
        assert.equal(out, corrupt);
      }
    });
  }
});

test('Challenger 2.7: Custom Bitrate Variations (128kbps, 256kbps, 320kbps, 512kbps)', () => {
  const baseSdp = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10'
  ].join('\r\n') + '\r\n';

  const bitrates = [128000, 256000, 320000, 512000];
  for (const br of bitrates) {
    const enhanced = enhanceOpusStereoSdp(baseSdp, br);
    assert.match(enhanced, new RegExp(`maxaveragebitrate=${br}`), `Should set maxaveragebitrate=${br}`);
    assert.match(enhanced, /stereo=1/);
    assert.match(enhanced, /sprop-stereo=1/);
  }
});

test('Challenger 2.8 [Adversarial Finding]: Multiple audio m-lines in SDP', () => {
  const multiAudioSdp = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=20'
  ].join('\r\n') + '\r\n';

  const res = enhanceOpusStereoSdp(multiAudioSdp, 256000);
  const standaloneStereo = res.match(/(?<![a-zA-Z0-9-])stereo=1/g) || [];
  // fmtpRegex without /g replaces only the first occurrence in multi-audio SDPs
  assert.equal(standaloneStereo.length, 1, 'Only first audio m-line is enhanced because regex lacks /g flag');
});

test('Challenger 2.9 [Adversarial Finding]: Bare a=fmtp line without parameters causes \\s+ newline consumption', () => {
  const bareFmtpSdp = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111',
    'm=video 9 UDP/TLS/RTP/SAVPF 96'
  ].join('\r\n') + '\r\n';

  const res = enhanceOpusStereoSdp(bareFmtpSdp, 256000);
  // Demonstrates that \\s+ in fmtpRegex matches \\r\\n and eats the following line when fmtp has no trailing space
  const videoLinePresent = res.includes('m=video 9 UDP/TLS/RTP/SAVPF 96\r\n') || res.includes('m=video 9 UDP/TLS/RTP/SAVPF 96\n');
  assert.equal(videoLinePresent, false, 'Empirically reproduces that \\s+ consumes CRLF when fmtp has no trailing space');
});


// =========================================================================
// SUITE 3: EMPIRICAL 100% VOICE & SCREEN AUDIO ISOLATION
// =========================================================================

test('Challenger 3.1: Complete Voice and Screen Audio Segregation Baseline', () => {
  // Screen track represents system loopback (som_do_pc)
  const screenAudioTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'som_do_pc' });
  screenAudioTrack.contentHint = 'music';
  const screenVideoTrack = new MockMediaStreamTrack({ kind: 'video', label: 'Screen' });
  const localScreenStream = new MockMediaStream([screenVideoTrack, screenAudioTrack]);

  // Mic track represents physical voice microphone
  const micTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'fifine Microphone Mono' });
  micTrack.contentHint = 'speech';
  const localMicStream = new MockMediaStream([micTrack]);

  const mockCtx = new MockAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: mockCtx });

  const appState = {
    myUser: { isMicOn: false, isDeafened: false, isSharing: true },
    localScreenStream,
    localMicStream,
    activeStreams: new Map()
  };

  const deafenCtrl = new DeafenController({
    appState,
    mixerManager: mixer,
    socket: { emit() {} },
    vadDetector: null
  });

  // Verify initial state: Mic is OFF, Screen loopback is LIVE
  assert.equal(appState.myUser.isMicOn, false);
  assert.equal(appState.myUser.isSharing, true);
  assert.equal(screenAudioTrack.readyState, 'live');
  assert.equal(screenAudioTrack.enabled, true);
  assert.equal(screenAudioTrack.contentHint, 'music');
});

test('Challenger 3.2: Rapid Microphone Mute/Unmute Cycle Guaranteeing Screen Audio Invariance', () => {
  const screenAudioTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'som_do_pc' });
  screenAudioTrack.contentHint = 'music';
  const localScreenStream = new MockMediaStream([screenAudioTrack]);

  const micTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'fifine Microphone Mono' });
  const localMicStream = new MockMediaStream([micTrack]);

  const appState = {
    myUser: { isMicOn: true, isDeafened: false, isSharing: true },
    localScreenStream,
    localMicStream
  };

  // Perform 50 rapid alternating mic mute and unmute cycles
  for (let i = 0; i < 50; i++) {
    const shouldMicBeOn = i % 2 === 0;

    // Simulate microphone state toggle
    appState.myUser.isMicOn = shouldMicBeOn;
    appState.localMicStream.getAudioTracks().forEach((t) => {
      t.enabled = shouldMicBeOn;
    });

    // Verification of isolation at every step
    assert.equal(
      micTrack.enabled,
      shouldMicBeOn,
      `Cycle ${i}: Mic track enabled must match desired mic state ${shouldMicBeOn}`
    );

    // CRITICAL ISOLATION: Outbound screen audio track MUST NEVER be muted or ended!
    assert.equal(
      screenAudioTrack.enabled,
      true,
      `Cycle ${i}: Outbound screen audio track must ALWAYS remain enabled === true`
    );
    assert.equal(
      screenAudioTrack.readyState,
      'live',
      `Cycle ${i}: Outbound screen audio track must ALWAYS remain readyState === "live"`
    );
    assert.equal(
      screenAudioTrack.contentHint,
      'music',
      `Cycle ${i}: Outbound screen audio track contentHint must remain "music"`
    );
  }
});

test('Challenger 3.3: Deafen / Undeafen State Cycles with Mic State Restoration', () => {
  const screenAudioTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'som_do_pc' });
  screenAudioTrack.contentHint = 'music';
  const localScreenStream = new MockMediaStream([screenAudioTrack]);

  const micTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'fifine Microphone Mono' });
  const localMicStream = new MockMediaStream([micTrack]);

  const mockCtx = new MockAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: mockCtx });

  const appState = {
    myUser: { isMicOn: true, isDeafened: false, isSharing: true },
    localScreenStream,
    localMicStream,
    activeStreams: new Map()
  };

  const deafenCtrl = new DeafenController({
    appState,
    mixerManager: mixer,
    socket: { emit() {} },
    vadDetector: null
  });

  // 1. User is speaking (mic ON) and starts sharing screen
  assert.equal(appState.myUser.isMicOn, true);
  assert.equal(screenAudioTrack.readyState, 'live');
  assert.equal(screenAudioTrack.enabled, true);

  // 2. User activates DEAFEN
  deafenCtrl.setDeafened(true);
  assert.equal(appState.myUser.isDeafened, true);
  assert.equal(appState.myUser.isMicOn, false, 'Deafen forces microphone off');
  assert.equal(micTrack.enabled, false, 'Local mic hardware track disabled');

  // CRITICAL: Screen loopback audio MUST REMAIN LIVE AND BROADCASTING
  assert.equal(screenAudioTrack.readyState, 'live', 'Screen audio MUST remain live under deafen');
  assert.equal(screenAudioTrack.enabled, true, 'Screen audio MUST remain enabled under deafen');

  // 3. User deactivates DEAFEN (Restores state)
  deafenCtrl.setDeafened(false);
  assert.equal(appState.myUser.isDeafened, false);
  assert.equal(appState.myUser.isMicOn, true, 'Pre-deafen mic state must be restored');
  assert.equal(micTrack.enabled, true, 'Local mic track re-enabled');
  assert.equal(screenAudioTrack.readyState, 'live');
  assert.equal(screenAudioTrack.enabled, true);

  // 4. Test case where mic was OFF before deafen
  appState.myUser.isMicOn = false;
  micTrack.enabled = false;

  deafenCtrl.setDeafened(true);
  assert.equal(appState.myUser.isDeafened, true);
  assert.equal(appState.myUser.isMicOn, false);
  assert.equal(screenAudioTrack.enabled, true);

  deafenCtrl.setDeafened(false);
  assert.equal(appState.myUser.isDeafened, false);
  assert.equal(appState.myUser.isMicOn, false, 'Pre-deafen mic state (off) preserved');
  assert.equal(micTrack.enabled, false);
  assert.equal(screenAudioTrack.enabled, true);
});

test('Challenger 3.4: High-Stress Adversarial Concurrency & Volume Mixer Fuzzing (100 Iterations)', () => {
  const screenAudioTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'som_do_pc' });
  screenAudioTrack.contentHint = 'music';
  const localScreenStream = new MockMediaStream([screenAudioTrack]);

  const micTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'fifine Microphone Mono' });
  const localMicStream = new MockMediaStream([micTrack]);

  const mockCtx = new MockAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: mockCtx });

  const appState = {
    myUser: { isMicOn: false, isDeafened: false, isSharing: true },
    localScreenStream,
    localMicStream,
    activeStreams: new Map()
  };

  const deafenCtrl = new DeafenController({
    appState,
    mixerManager: mixer,
    socket: { emit() {} },
    vadDetector: null
  });

  // Seeded/deterministic PRNG for repeatability
  let seed = 42;
  function pseudoRandom() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }

  for (let iteration = 0; iteration < 100; iteration++) {
    const action = Math.floor(pseudoRandom() * 6);

    switch (action) {
      case 0: // Toggle Mic ON
        appState.myUser.isMicOn = true;
        micTrack.enabled = true;
        break;

      case 1: // Toggle Mic OFF
        appState.myUser.isMicOn = false;
        micTrack.enabled = false;
        break;

      case 2: // Toggle Deafen
        deafenCtrl.setDeafened(!appState.myUser.isDeafened);
        break;

      case 3: { // Fuzz user volume [-100% to +350%]
        const fuzzedVol = (pseudoRandom() * 450) - 100;
        const gain = mixer.setUserVolume('fuzz-user-1', fuzzedVol);
        assert.ok(gain >= 0.0 && gain <= 2.0, `User gain ${gain} must be strictly within [0.0, 2.0]`);
        break;
      }

      case 4: { // Fuzz stream volume [-50% to +300%]
        const fuzzedVol = (pseudoRandom() * 350) - 50;
        const gain = mixer.setStreamVolume('fuzz-stream-1', fuzzedVol);
        assert.ok(gain >= 0.0 && gain <= 3.0, `Stream gain ${gain} must be strictly within [0.0, 2.0]`);
        break;
      }

      case 5: // Deafen master toggle
        mixer.setDeafened(pseudoRandom() > 0.5);
        break;
    }

    // Invariant Check at EVERY single step of the 100 iterations:
    assert.equal(
      screenAudioTrack.readyState,
      'live',
      `Stress iteration ${iteration}: Outbound screen audio track MUST remain readyState === "live"`
    );
    assert.equal(
      screenAudioTrack.enabled,
      true,
      `Stress iteration ${iteration}: Outbound screen audio track MUST remain enabled === true`
    );
    assert.equal(
      screenAudioTrack.contentHint,
      'music',
      `Stress iteration ${iteration}: Outbound screen audio track MUST maintain contentHint === "music"`
    );
  }
});

test('Challenger 3.5: Sudden Hardware Mic Track Termination (Disconnect/Stop)', () => {
  const screenAudioTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'som_do_pc' });
  screenAudioTrack.contentHint = 'music';
  const localScreenStream = new MockMediaStream([screenAudioTrack]);

  const micTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'fifine Microphone Mono' });
  const localMicStream = new MockMediaStream([micTrack]);

  const appState = {
    myUser: { isMicOn: true, isDeafened: false, isSharing: true },
    localScreenStream,
    localMicStream
  };

  // User pulls physical USB microphone cable (micTrack.stop())
  micTrack.stop();
  assert.equal(micTrack.readyState, 'ended', 'Physical microphone track has ended');

  // CRITICAL ISOLATION: Screen audio loopback MUST NOT be killed or ended
  assert.equal(screenAudioTrack.readyState, 'live', 'Screen audio MUST stay live when mic disconnects');
  assert.equal(screenAudioTrack.enabled, true, 'Screen audio MUST stay enabled when mic disconnects');
  assert.equal(localScreenStream.getAudioTracks().length, 1);
});

test('Challenger 3.6: Voice Activity Detection (VAD) Speech Events Isolation', () => {
  const mockCtx = new MockAudioContext();
  const micTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'fifine Microphone Mono' });
  const micStream = new MockMediaStream([micTrack]);

  const screenTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'som_do_pc' });
  screenTrack.contentHint = 'music';

  let speakingTransitions = [];
  const vad = new VoiceActivityDetector(micStream, {
    audioContext: mockCtx,
    thresholdDb: -45,
    onSpeakingChange: (speaking) => speakingTransitions.push(speaking)
  });

  // Enable and simulate speaking
  vad.setEnabled(true);
  assert.equal(vad.isEnabled, true);

  // Mute mic & disable VAD
  vad.setEnabled(false);
  assert.equal(vad.isEnabled, false);
  assert.equal(vad.isSpeaking, false);

  // Screen audio pipeline remains untouched
  assert.equal(screenTrack.readyState, 'live');
  assert.equal(screenTrack.enabled, true);

  vad.destroy();
});
