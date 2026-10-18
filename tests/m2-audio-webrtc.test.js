// tests/m2-audio-webrtc.test.js
// Milestone 2 Verification Suite: System Audio Loopback, Opus SDP Munging, VAD & Volume Mixers

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

test('M2.1: Device Label Classification', () => {
  // System Audio / Linux Loopback Labels
  assert.equal(isSystemAudioLabel('Monitor of Built-in Audio Analog Stereo'), true);
  assert.equal(isSystemAudioLabel('Monitor of USB Headset'), true);
  assert.equal(isSystemAudioLabel('som_do_pc'), true);
  assert.equal(isSystemAudioLabel('Som_do_PC_Jogos_e_Videos'), true);
  assert.equal(isSystemAudioLabel('System Loopback Audio'), true);
  assert.equal(isSystemAudioLabel('Stereo Mix (Realtek Audio)'), true);
  assert.equal(isSystemAudioLabel('monitor de audio do sistema'), true);

  // Microphones
  assert.equal(isSystemAudioLabel('fifine Microphone Mono'), false);
  assert.equal(isSystemAudioLabel('Built-in Microphone'), false);
  assert.equal(isSystemAudioLabel('Logitech PRO X Headset Mono'), false);
  assert.equal(isSystemAudioLabel('2K Camera Analog Stereo'), false);

  assert.equal(isMicrophoneLabel('fifine Microphone Mono'), true);
  assert.equal(isMicrophoneLabel('Logitech PRO X Headset Mono'), true);
  assert.equal(isMicrophoneLabel('som_do_pc'), false);
});

test('M2.2: Device Detection & Priority Categorization', () => {
  const devices = [
    { kind: 'audioinput', deviceId: 'mic-1', label: 'fifine Microphone Mono' },
    { kind: 'audioinput', deviceId: 'sys-1', label: 'Monitor of Built-in Audio' },
    { kind: 'audioinput', deviceId: 'sys-2', label: 'Som_do_PC_Jogos_e_Videos' },
    { kind: 'audiooutput', deviceId: 'out-1', label: 'Speakers' }
  ];

  const detected = detectAudioDevices(devices);
  assert.equal(detected.systemAudioDevices.length, 2);
  assert.equal(detected.microphoneDevices.length, 1);
  assert.equal(detected.audioOutputs.length, 1);
  assert.equal(detected.defaultSystemAudio.deviceId, 'sys-2', 'Should prioritize dedicated som_do_pc sink');
  assert.equal(detected.defaultMicrophone.deviceId, 'mic-1');

  // Empty devices safety check
  const empty = detectAudioDevices([]);
  assert.equal(empty.systemAudioDevices.length, 0);
  assert.equal(empty.microphoneDevices.length, 0);
  assert.equal(empty.defaultSystemAudio, null);
  assert.equal(empty.defaultMicrophone, null);
});

test('M2.3: System Audio & Microphone Capture Constraints', () => {
  const sysConstraints = generateSystemAudioConstraints('device-sys-123');
  assert.equal(sysConstraints.audio.deviceId.exact, 'device-sys-123');
  assert.equal(sysConstraints.audio.echoCancellation, false);
  assert.equal(sysConstraints.audio.noiseSuppression, false);
  assert.equal(sysConstraints.audio.autoGainControl, false);
  assert.equal(sysConstraints.audio.channelCount.ideal, 2);
  assert.equal(sysConstraints.audio.sampleRate.ideal, 48000);
  assert.equal(sysConstraints.video, false);

  const micConstraints = generateMicrophoneConstraints('device-mic-456');
  assert.equal(micConstraints.audio.deviceId.exact, 'device-mic-456');
  assert.equal(micConstraints.audio.echoCancellation, true);
  assert.equal(micConstraints.audio.noiseSuppression, true);
  assert.equal(micConstraints.audio.autoGainControl, true);
  assert.equal(micConstraints.audio.channelCount, 1);
});

test('M2.4: Opus High-Fidelity Stereo SDP Munging', () => {
  const sdpWithFmtp = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1'
  ].join('\r\n') + '\r\n';

  const enhanced = enhanceOpusStereoSdp(sdpWithFmtp, 256000);
  assert.match(enhanced, /a=fmtp:111/);
  assert.match(enhanced, /stereo=1/);
  assert.match(enhanced, /sprop-stereo=1/);
  assert.match(enhanced, /maxaveragebitrate=256000/);

  // Idempotency: munging again produces clean non-duplicated tokens
  const doubleEnhanced = enhanceOpusStereoSdp(enhanced, 256000);
  const stereoMatches = doubleEnhanced.match(/(?:^|[;\s])stereo=1(?=[;\r\n]|$)/g);
  assert.equal(stereoMatches.length, 1, 'stereo=1 must not be duplicated');

  // Missing fmtp line insertion
  const sdpWithoutFmtp = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=rtpmap:111 opus/48000/2',
    'm=video 9 UDP/TLS/RTP/SAVPF 96'
  ].join('\r\n') + '\r\n';

  const inserted = enhanceOpusStereoSdp(sdpWithoutFmtp, 256000);
  assert.match(inserted, /a=fmtp:111 stereo=1;sprop-stereo=1;maxaveragebitrate=256000/);
});

test('M2.5: VolumeMixerManager 0-200% GainNode Amplification & Clamping', () => {
  const mockCtx = new MockAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: mockCtx });

  // Normal 100% volume
  const gainNormal = mixer.setUserVolume('user-alice', 100);
  assert.equal(gainNormal, 1.0);

  // Boost to 175%
  const gainBoost = mixer.setUserVolume('user-alice', 175);
  assert.equal(gainBoost, 1.75);

  // High gain boundary: 200%
  const gainMax = mixer.setUserVolume('user-alice', 200);
  assert.equal(gainMax, 2.0);

  // Clamping test: value > 200% clamped to 2.0
  const gainExcess = mixer.setUserVolume('user-alice', 350);
  assert.equal(gainExcess, 2.0);

  // Clamping test: negative value clamped to 0.0
  const gainNegative = mixer.setUserVolume('user-alice', -50);
  assert.equal(gainNegative, 0.0);

  // Stream volume mixers
  const streamGain = mixer.setStreamVolume('stream-1', 140);
  assert.equal(streamGain, 1.4);
});

test('M2.6: DeafenController Isolation & Media Silencing', () => {
  const mockCtx = new MockAudioContext();
  const mixer = new VolumeMixerManager({ audioContext: mockCtx });

  const screenTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'System Audio Loopback' });
  screenTrack.contentHint = 'music';
  const micTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'Microphone' });

  const appState = {
    myUser: { isMicOn: true, isDeafened: false },
    localScreenStream: new MockMediaStream([screenTrack]),
    localMicStream: new MockMediaStream([micTrack]),
    activeStreams: new Map()
  };

  const deafenCtrl = new DeafenController({
    appState,
    mixerManager: mixer,
    socket: { emit() {} },
    vadDetector: null
  });

  // Activate Deafen
  deafenCtrl.setDeafened(true);
  assert.equal(appState.myUser.isDeafened, true);
  assert.equal(appState.myUser.isMicOn, false, 'Deafen forces microphone off');
  assert.equal(micTrack.enabled, false, 'Local mic track disabled');

  // CRITICAL ISOLATION: Outbound screen loopback audio MUST remain LIVE and ENABLED!
  assert.equal(screenTrack.readyState, 'live', 'Screen audio track must remain live');
  assert.equal(screenTrack.enabled, true, 'Screen audio track must remain enabled');
  assert.equal(screenTrack.contentHint, 'music');

  // Deactivate Deafen
  deafenCtrl.setDeafened(false);
  assert.equal(appState.myUser.isDeafened, false);
  assert.equal(appState.myUser.isMicOn, true, 'Mic state pre-deafen restored');
  assert.equal(micTrack.enabled, true);
  assert.equal(screenTrack.readyState, 'live');
});

test('M2.7: VoiceActivityDetector Lifecycle', () => {
  const mockCtx = new MockAudioContext();
  const micTrack = new MockMediaStreamTrack({ kind: 'audio', label: 'Microphone' });
  const micStream = new MockMediaStream([micTrack]);

  let speakingStates = [];
  const vad = new VoiceActivityDetector(micStream, {
    audioContext: mockCtx,
    thresholdDb: -45,
    onSpeakingChange: (speaking) => speakingStates.push(speaking)
  });

  assert.equal(vad.isEnabled, true);
  assert.equal(vad.isSpeaking, false);

  // Disable VAD (e.g. when mic is muted)
  vad.setEnabled(false);
  assert.equal(vad.isEnabled, false);
  assert.equal(vad.isSpeaking, false);

  vad.destroy();
});
