import test from 'node:test';
import assert from 'node:assert/strict';
import { medalClipId, messageLinks } from '../public/chat-links.js';

test('reconhece clipes do Medal em mensagens, preservando o hífen final do ID', () => {
  const id = 'nXa3re55Ul-rjuCm-';
  for (const caminho of ['games/euro-truck-sim-2/clips/', 'pt-br/games/euro-truck-sim-2/clip/', 'clips/', 'clip/']) {
    const [link] = messageLinks(`Olha (https://medal.tv/${caminho}${id}?invite=convite).`);
    assert.equal(medalClipId(link.url), id);
  }
});

test('somente um endereço de clipe do Medal ganha player', () => {
  for (const url of ['https://medal.tv/u/beau', 'https://medal.tv.example.com/clips/123',
    'https://nome@medal.tv/clips/123', 'https://medal.tv:8888/clips/123', 'https://medal.tv/clips/a%2Fb']) {
    assert.equal(medalClipId(new URL(url)), null);
  }
});
