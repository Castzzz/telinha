import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeImageCrop, imageCropRect } from '../public/image-crop.js';

test('perfil antigo e valores inválidos recebem um enquadramento seguro', () => {
  assert.deepEqual(normalizeImageCrop(), { x: 0.5, y: 0.5, zoom: 1 });
  assert.deepEqual(normalizeImageCrop({ x: '<script>', y: NaN, zoom: Infinity }), { x: 0.5, y: 0.5, zoom: 1 });
  assert.deepEqual(normalizeImageCrop({ x: -1, y: 2, zoom: 99 }), { x: 0, y: 1, zoom: 4 });
});

test('foto retangular pode mostrar as extremidades e receber zoom sem distorção', () => {
  assert.deepEqual(imageCropRect(800, 400, 1), { x: 200, y: 0, width: 400, height: 400 });
  assert.deepEqual(imageCropRect(800, 400, 1, { x: 1, y: 1, zoom: 2 }), { x: 600, y: 200, width: 200, height: 200 });
  assert.deepEqual(imageCropRect(400, 800, 1, { x: 0, y: 0, zoom: 1 }), { x: 0, y: 0, width: 400, height: 400 });
});

test('banner conserva a proporção 3:1 e o recorte permanece dentro da imagem', () => {
  for (const [width, height] of [[800, 400], [400, 800], [1, 1], [4000, 10]]) {
    for (const x of [0, 0.3, 1]) for (const y of [0, 0.8, 1]) for (const zoom of [1, 2.5, 4]) {
      const rect = imageCropRect(width, height, 3, { x, y, zoom });
      assert.ok(Math.abs(rect.width / rect.height - 3) < 1e-10);
      assert.ok(rect.x >= 0 && rect.y >= 0);
      assert.ok(rect.x + rect.width <= width + 1e-10);
      assert.ok(rect.y + rect.height <= height + 1e-10);
    }
  }
});
