import test from 'node:test';
import assert from 'node:assert/strict';
import { withVideoStartBitrate, setInitialVideoDescription } from '../public/stream-start-bitrate.js';

const audio = 'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 stereo=1;maxaveragebitrate=256000\r\n';
const video = 'm=video 9 UDP/TLS/RTP/SAVPF 96 97 102\r\na=sendrecv\r\na=rtpmap:96 VP8/90000\r\na=rtpmap:97 rtx/90000\r\na=fmtp:97 apt=96\r\na=rtpmap:102 H264/90000\r\na=fmtp:102 packetization-mode=1;profile-level-id=42e01f\r\n';
const sdp = 'v=0\r\n' + audio + video;

test('indica partida de vídeo sem mudar Opus, RTX, teto ou impor bitrate mínimo', () => {
  const result = withVideoStartBitrate(sdp, 5500000);
  assert(result.includes(audio));
  assert(result.includes('a=fmtp:97 apt=96\r\n'));
  assert(result.includes('a=fmtp:96 x-google-start-bitrate=2000\r\n'));
  assert(result.includes('packetization-mode=1;profile-level-id=42e01f;x-google-start-bitrate=2000'));
  assert(!result.includes('x-google-min-bitrate'));
  assert(!result.includes('x-google-max-bitrate'));
  assert.equal(withVideoStartBitrate(result, 5500000), result);
});

test('limita a indicação em câmera e redes lentas, e respeita alvos pequenos', () => {
  assert.match(withVideoStartBitrate(sdp, 2000000, { camera: true }), /start-bitrate=600/);
  assert.match(withVideoStartBitrate(sdp, 5500000, { effectiveType: '3g' }), /start-bitrate=500/);
  for (const effectiveType of ['2g', 'slow-2g']) assert.equal(withVideoStartBitrate(sdp, 5500000, { effectiveType }), sdp);
  for (const bitrate of [0, 300000, NaN, Infinity]) assert.equal(withVideoStartBitrate(sdp, bitrate), sdp);
});

test('preserva recepção, seções rejeitadas, codecs não oferecidos e dica existente', () => {
  for (const direction of ['recvonly', 'inactive']) {
    const input = sdp.replace('a=sendrecv', `a=${direction}`);
    assert.equal(withVideoStartBitrate(input, 5500000), input);
  }
  const rejected = sdp.replace('m=video 9 ', 'm=video 0 ');
  assert.equal(withVideoStartBitrate(rejected, 5500000), rejected);
  const unoffered = sdp.replace('SAVPF 96 97 102', 'SAVPF 97');
  assert.equal(withVideoStartBitrate(unoffered, 5500000), unoffered);
  const existing = video.replace('a=rtpmap:96 VP8/90000\r\n', 'a=rtpmap:96 VP8/90000\r\na=fmtp:96 x-google-start-bitrate=800\r\n');
  assert.match(withVideoStartBitrate(existing, 5500000), /a=fmtp:96 x-google-start-bitrate=800\r\n/);
  const lf = withVideoStartBitrate(sdp.replaceAll('\r\n', '\n'), 5500000);
  assert(!lf.includes('\r'));
  assert.match(lf, /start-bitrate=2000\n/);
});

test('recupera a oferta original se o navegador rejeitar a indicação', async t => {
  t.mock.method(console, 'warn', () => {});
  const calls = [];
  const pc = { signalingState: 'stable', async setLocalDescription(value) {
    calls.push(value);
    if (calls.length === 1) throw new Error('Parâmetro não suportado');
  } };
  const offer = { type: 'offer', sdp };
  await setInitialVideoDescription(pc, offer, 5500000);
  assert.equal(calls.length, 2);
  assert(calls[0].sdp.includes('x-google-start-bitrate=2000'));
  assert.equal(calls[1], offer);
  assert.equal(offer.sdp, sdp);
});

test('não esconde falhas da negociação que não permitem repetir a oferta', async () => {
  const error = new Error('Conexão encerrada');
  let calls = 0;
  const pc = { signalingState: 'closed', async setLocalDescription() { calls++; throw error; } };
  await assert.rejects(setInitialVideoDescription(pc, { type: 'offer', sdp }, 5500000), error);
  assert.equal(calls, 1);
});
