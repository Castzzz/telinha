import { test } from 'node:test';
import assert from 'node:assert/strict';
import activity from '../electron/game-activity.cjs';
import { activityElapsed } from '../public/game-activity.js';

const { detectGames, parseTasklist, createActivityTracker, customGameList } = activity;

test('atividade reconhece Windows, Linux nativo e Proton sem confundir launcher com jogo', () => {
  assert.deepEqual(detectGames([
    { pid: 1, exe: 'Steam.exe' },
    { pid: 2, exe: 'LeagueClient.exe' },
    { pid: 3, exe: '/usr/bin/node', argv: ['node', '/tmp/cs2.exe'] }
  ]), []);
  const detected = detectGames([
    { pid: 10, exe: 'CS2.EXE' },
    { pid: 11, exe: '/games/dota2' },
    { pid: 12, exe: '/usr/lib/wine/wine64-preloader', argv: ['Z:\\games\\ELDEN RING\\Game\\eldenring.exe'] },
    { pid: 13, exe: 'League of Legends.exe' }
  ]);
  assert.deepEqual(detected.map((g) => g.id), ['cs2', 'dota2', 'elden-ring', 'lol']);
});

test('Minecraft Java exige o cliente, sem contar launcher nem servidor dedicado', () => {
  assert.deepEqual(detectGames([
    { pid: 1, exe: 'javaw.exe', argv: ['javaw.exe', '-jar', 'launcher.jar'] },
    { pid: 2, exe: '/usr/bin/java', argv: ['java', 'net.minecraft.server.Main'] }
  ]), []);
  for (const main of ['net.minecraft.client.main.Main', 'net.fabricmc.loader.impl.launch.knot.KnotClient', '--launchTarget forgeclient']) {
    assert.equal(detectGames([{ pid: 3, exe: '/usr/bin/java', argv: ['java', main, '--username', 'Amigo'] }])[0]?.id, 'minecraft');
  }
});

test('cadastro manual usa correspondência exata e rejeita caminhos ou comandos', () => {
  const custom = customGameList([
    { name: 'Meu jogo', executable: 'MEU JOGO.EXE' },
    { name: 'comando', executable: 'jogo; cat segredo' },
    { name: 'caminho', executable: '/tmp/jogo' },
    { name: 'vazio', executable: '   ' }
  ]);
  assert.deepEqual(custom, [{ name: 'Meu jogo', executable: 'meu jogo.exe' }]);
  assert.equal(detectGames([{ pid: 1, exe: 'Meu Jogo.exe' }], custom)[0]?.name, 'Meu jogo');
  assert.deepEqual(detectGames([{ pid: 1, exe: 'outro-meu jogo.exe' }], custom), []);
});

test('tasklist lê CSV sem cabeçalho e preserva nomes com espaço e vírgula', () => {
  assert.deepEqual(parseTasklist('"League of Legends.exe","123","Console","1","123 K"\r\n"jogo, teste.exe","456","Console","1","123 K"\r\nINFO: nada encontrado'), [
    { exe: 'League of Legends.exe', pid: '123' }, { exe: 'jogo, teste.exe', pid: '456' }
  ]);
});

test('tempo é estável, escolhe o jogo atual e reinicia quando o processo muda ou fecha', async () => {
  let time = 100000;
  let processes = [{ pid: 1, exe: 'cs2.exe' }];
  const tracker = createActivityTracker({ collect: async () => processes, now: () => time });
  assert.deepEqual(await tracker.sample(), { id: 'cs2', name: 'Counter-Strike 2', startedAt: time });
  time += 15000;
  processes.unshift({ pid: 2, exe: 'dota2.exe' });
  assert.equal((await tracker.sample()).startedAt, 100000);
  processes = [{ pid: 3, exe: 'cs2.exe' }];
  assert.equal((await tracker.sample()).startedAt, time);
  processes = [];
  assert.equal(await tracker.sample(), null);
  time += 15000;
  processes = [{ pid: 3, exe: 'cs2.exe' }];
  assert.equal((await tracker.sample()).startedAt, time);
  tracker.reset();
  time += 15000;
  assert.equal((await tracker.sample()).startedAt, time);
});

test('desligar o compartilhamento descarta uma detecção ainda em andamento', async () => {
  let resolve;
  const tracker = createActivityTracker({ collect: () => new Promise((done) => { resolve = done; }) });
  const pending = tracker.sample();
  tracker.reset();
  resolve([{ pid: 1, exe: 'cs2.exe' }]);
  assert.equal(await pending, null);
});

test('relógio de atividade trata início, minutos e horas sem tempo negativo', () => {
  assert.equal(activityElapsed(10000, 0), 'há menos de 1 min');
  assert.equal(activityElapsed(0, 23 * 60000), 'há 23 min');
  assert.equal(activityElapsed(0, 60 * 60000), 'há 1 h');
  assert.equal(activityElapsed(0, 125 * 60000), 'há 2 h 5 min');
});
