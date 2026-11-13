import test from 'node:test';
import assert from 'node:assert/strict';
import { videoMetrics } from '../public/transmission-diagnostics.js';
const report = (...rows) => new Map(rows.map(row => [row.id, row]));
test('taxa e perdas usam deltas de vídeo; primeira amostra fica indisponível e RTX é excluído', () => {
  const video = { id: 'v', type: 'inbound-rtp', kind: 'video', timestamp: 1000, codecId: 'c', bytesReceived: 1000, packetsReceived: 90, packetsLost: 10, framesDecoded: 10, freezeCount: 1, frameWidth: 1280, frameHeight: 720 };
  const codec = { id: 'c', mimeType: 'video/VP8' }, pair = { id: 'p', type: 'candidate-pair', currentRoundTripTime: .05 }, transport = { id: 't', type: 'transport', selectedCandidatePairId: 'p' };
  const first = videoMetrics(report(video, codec, pair, transport));
  assert.equal(first.rows[0].kbps, null); assert.equal(first.rows[0].loss, null); assert.equal(first.rows[0].rtt, 50);
  const next = videoMetrics(report({ ...video, timestamp: 3000, bytesReceived: 11000, packetsReceived: 180, packetsLost: 20, framesDecoded: 70, freezeCount: 2 }, codec), first.next);
  assert.equal(next.rows[0].kbps, 40); assert.equal(next.rows[0].fps, 30); assert.equal(next.rows[0].loss, 10); assert.equal(next.rows[0].freezes, 1);
  const reset = videoMetrics(report({ ...video, timestamp: 4000, bytesReceived: 1, packetsLost: 0 }, codec), next.next);
  assert.equal(reset.rows[0].kbps, null); assert.equal(reset.rows[0].loss, null);
  assert.equal(videoMetrics(report({ ...video, codecId: 'rtx' }, { id: 'rtx', mimeType: 'video/rtx' })).rows.length, 0);
});
test('envio usa perda do destino e motivo de limitação; ausência de métricas não vira zero', () => {
  const row = videoMetrics(report({ id: 'v', type: 'outbound-rtp', kind: 'video', timestamp: 1, remoteId: 'r', qualityLimitationReason: 'cpu' }, { id: 'r', fractionLost: .03, roundTripTime: .1 }), undefined, 'outbound').rows[0];
  assert.equal(row.loss, 3); assert.equal(row.rtt, 100); assert.equal(row.limitation, 'cpu'); assert.equal(row.kbps, null); assert.equal(row.fps, null);
});

test('distingue captura de envio e usa a banda do transporte da própria faixa', () => {
  const stats = report(
    { id: 'v', type: 'outbound-rtp', kind: 'video', mediaSourceId: 's', transportId: 't', frameWidth: 960, frameHeight: 540, targetBitrate: 188000, qualityLimitationReason: 'bandwidth' },
    { id: 's', type: 'media-source', kind: 'video', width: 1920, height: 1080 },
    { id: 't', type: 'transport', selectedCandidatePairId: 'p' },
    { id: 'p', type: 'candidate-pair', localCandidateId: 'c', availableOutgoingBitrate: 210000, currentRoundTripTime: .008 },
    { id: 'c', type: 'local-candidate', protocol: 'udp' },
    { id: 'other-t', type: 'transport', selectedCandidatePairId: 'other-p' },
    { id: 'other-p', type: 'candidate-pair', availableOutgoingBitrate: 9000000, currentRoundTripTime: .5 }
  );
  const row = videoMetrics(stats, undefined, 'outbound').rows[0];
  assert.deepEqual([row.captureWidth, row.captureHeight], [1920, 1080]);
  assert.deepEqual([row.width, row.height], [960, 540]);
  assert.equal(row.targetKbps, 188);
  assert.equal(row.availableOutgoingKbps, 210);
  assert.equal(row.protocol, 'UDP');
  assert.equal(row.rtt, 8);
});
