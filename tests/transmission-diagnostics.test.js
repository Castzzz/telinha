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
