import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAppearance, readableAccent } from '../public/personalization.js';
test('personalização aceita apenas cores e imagens locais válidas e limita intensidade', () => {
  assert.deepEqual(normalizeAppearance({ accent: 'red; color: blue', wallpaper: 'url(https://exemplo.test)', intensity: 90 }), { accent: '', wallpaper: '', intensity: 30 });
  assert.equal(normalizeAppearance({ wallpaper: 'data:image/svg+xml;base64,AAAA' }).wallpaper, '');
  assert.equal(normalizeAppearance({ wallpaper: 'data:image/png;base64,AAAA', intensity: -8 }).intensity, 5);
  assert.equal(normalizeAppearance(null).accent, '');
});
test('cores claras são ajustadas para contraste mínimo de 4,5 com texto branco', () => {
  for (const color of ['#ffffff', '#ffff00', '#00ff00', '#000000', '#5865f2']) {
    const adjusted = readableAccent(color), rgb = [1,3,5].map(i => parseInt(adjusted.slice(i,i+2),16)/255).map(n => n<=.04045?n/12.92:((n+.055)/1.055)**2.4);
    assert(1.05 / (.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]+.05) >= 4.5);
  }
  assert.equal(readableAccent('inválido'), '');
});
