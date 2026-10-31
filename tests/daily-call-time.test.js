import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DailyCallStore } from '../daily-call-store.js';
import { callDay, dailyCallElapsed, createDailyCallClocks, formatCallDuration } from '../public/call-time.js';
const at = value => Date.parse(value);

test('a virada segue meia-noite de Brasília, inclusive em dia histórico com horário de verão', () => {
  assert.equal(callDay(at('2026-10-31T02:59:59Z')).day,'2026-10-30');
  const next=callDay(at('2026-10-31T03:00:00Z'));assert.equal(next.day,'2026-10-31');assert.equal(next.startsAt,at('2026-10-31T03:00:00Z'));
  const dst=callDay(at('2018-11-04T12:00:00Z'));assert.equal(dst.endsAt-dst.startsAt,23*3600000);
});

test('sair, voltar e trocar de canal somam somente os períodos em voz', () => {
  let now=at('2026-10-30T12:00:00Z');const store=new DailyCallStore('',()=>now);
  store.join('amigo','socket');now+=600000;store.leave('socket');now+=1800000;assert.equal(store.snapshot('amigo').elapsedMs,600000);
  store.join('amigo','socket');now+=120000;store.leave('socket');store.join('amigo','socket');now+=60000;
  assert.equal(store.snapshot('amigo').elapsedMs,780000);assert.equal(store.snapshot('amigo').running,true);
});

test('dois aparelhos da mesma identidade contam a união dos períodos, sem duplicar', () => {
  let now=at('2026-10-30T12:00:00Z');const store=new DailyCallStore('',()=>now);
  store.join('amigo','pc');now+=60000;store.join('amigo','celular');store.join('amigo','celular');now+=60000;store.leave('pc');now+=60000;store.leave('celular');
  assert.equal(store.snapshot('amigo').elapsedMs,180000);assert.equal(store.snapshot('amigo').running,false);store.leave('pc');assert.equal(store.snapshot('amigo').elapsedMs,180000);
});

test('à meia-noite zera todos, e quem continua na call acumula só o tempo do dia novo', () => {
  let now=at('2026-10-31T02:59:00Z');const store=new DailyCallStore('',()=>now);
  store.join('online','s1');store.join('offline','s2');now+=30000;store.leave('s2');now=at('2026-10-31T03:00:04Z');
  assert.equal(store.snapshot('online').elapsedMs,4000);assert.equal(store.snapshot('offline').elapsedMs,0);
  now=at('2026-11-02T04:00:00Z');assert.equal(store.snapshot('online').elapsedMs,3600000);
});

test('reiniciar recupera o total salvo, e não soma o período em que o servidor ficou desligado', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'teletela-tempo-diario-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let now=at('2026-10-30T12:00:00Z');const first=new DailyCallStore(dir,()=>now);first.join('amigo','antigo');now+=60000;first.checkpoint();
  now+=3600000;const second=new DailyCallStore(dir,()=>now);assert.equal(second.snapshot('amigo').elapsedMs,60000);assert.equal(second.snapshot('amigo').running,false);
  second.join('amigo','novo');now+=60000;second.leave('novo');assert.equal(second.snapshot('amigo').elapsedMs,120000);
  now=at('2026-10-31T04:00:00Z');assert.equal(new DailyCallStore(dir,()=>now).snapshot('amigo').elapsedMs,0);
});

test('o relógio da interface usa a chegada do pacote, reseta à meia-noite e congela na desconexão', () => {
  let monotonic=1000;const clocks=createDailyCallClocks(()=>monotonic),serverTime=at('2026-10-31T02:59:58Z');
  const snapshot={day:'2026-10-30',elapsedMs:600000,running:true,serverTime,dayEndsAt:callDay(serverTime).endsAt};
  clocks.remember('amigo',snapshot);monotonic+=1000;assert.equal(clocks.elapsed('amigo'),601000);
  monotonic+=3000;assert.equal(clocks.elapsed('amigo'),2000);clocks.freeze();monotonic+=60000;assert.equal(clocks.elapsed('amigo'),2000);
  assert.equal(dailyCallElapsed({...snapshot,running:false},4000),0);assert.equal(formatCallDuration(3661000),'1:01:01');
});

test('cada call pausa separadamente e retoma seu acumulado ao voltar do AFK', () => {
  let now=at('2026-10-30T12:00:00Z');const store=new DailyCallStore('',()=>now);
  store.joinChannel('amigo','pc','geral');now+=2*3600000;store.leave('pc');store.joinChannel('amigo','pc','afk');
  now+=20*60000;assert.equal(store.snapshotChannel('amigo','geral').elapsedMs,2*3600000);assert.equal(store.snapshotChannel('amigo','geral').running,false);
  assert.equal(store.snapshotChannel('amigo','afk').elapsedMs,20*60000);
  store.leave('pc');store.joinChannel('amigo','pc','geral');now+=10*60000;
  assert.equal(store.snapshotChannel('amigo','geral').elapsedMs,130*60000);assert.equal(store.snapshotChannel('amigo','afk').elapsedMs,20*60000);
  assert.equal(store.snapshotChannel('amigo','afk').running,false);assert.equal(store.snapshotChannel('amigo','geral').channelId,'geral');
  assert.equal(store.snapshot('amigo').elapsedMs,150*60000,'O total antigo continua preservado separadamente.');
});

test('aparelhos na mesma call não duplicam; aparelhos em canais diferentes contam separadamente', () => {
  let now=at('2026-10-30T12:00:00Z');const store=new DailyCallStore('',()=>now);
  store.joinChannel('amigo','pc','geral');store.joinChannel('amigo','celular','geral');store.joinChannel('amigo','pc','geral');
  now+=60000;store.leave('celular');store.joinChannel('amigo','celular','afk');now+=60000;
  assert.equal(store.snapshotChannel('amigo','geral').elapsedMs,120000);assert.equal(store.snapshotChannel('amigo','afk').elapsedMs,60000);
  store.leave('pc');now+=60000;assert.equal(store.snapshotChannel('amigo','geral').elapsedMs,120000);
  assert.equal(store.snapshotChannel('amigo','afk').elapsedMs,120000);assert.equal(store.snapshot('amigo').elapsedMs,180000);
});

test('tempo por canal persiste, não conta servidor desligado e não inventa divisão do total antigo', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'teletela-tempo-canal-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let now=at('2026-10-30T12:00:00Z');let store=new DailyCallStore(dir,()=>now);
  store.joinChannel('amigo','s','geral');now+=60000;store.leave('s');store.joinChannel('amigo','s','afk');now+=30000;store.checkpoint();
  now+=3600000;store=new DailyCallStore(dir,()=>now);
  assert.equal(store.snapshotChannel('amigo','geral').elapsedMs,60000);assert.equal(store.snapshotChannel('amigo','afk').elapsedMs,30000);assert.equal(store.snapshotChannel('amigo','afk').running,false);
  store.joinChannel('amigo','novo','geral');now+=10000;store.leave('novo');assert.equal(store.snapshotChannel('amigo','geral').elapsedMs,70000);
  const file=path.join(dir,'daily-call-time.json');const saved=JSON.parse(fs.readFileSync(file));assert.equal(saved.version,2);assert.equal(saved.channelTotals.geral.amigo,70000);
  delete saved.channelTotals;delete saved.version;fs.writeFileSync(file,JSON.stringify(saved));store=new DailyCallStore(dir,()=>now);
  assert.equal(store.snapshot('amigo').elapsedMs,100000);assert.equal(store.snapshotChannel('amigo','geral').elapsedMs,0);
});

test('virada, migração de identidade e exclusão de canal respeitam os acumulados separados', () => {
  let now=at('2026-10-30T12:00:00Z');const store=new DailyCallStore('',()=>now);
  store.joinChannel('antigo','s','geral');now+=60000;store.leave('s');store.joinChannel('antigo','s','afk');now+=30000;
  store.merge('antigo','novo');assert.equal(store.snapshotChannel('novo','geral').elapsedMs,60000);assert.equal(store.snapshotChannel('novo','afk').elapsedMs,30000);
  now+=10000;store.leave('s');assert.equal(store.snapshotChannel('novo','afk').elapsedMs,40000);
  store.removeChannel('geral');store.joinChannel('novo','s','geral');now+=5000;assert.equal(store.snapshotChannel('novo','geral').elapsedMs,5000);
  now=at('2026-10-31T03:00:04Z');assert.equal(store.snapshotChannel('novo','geral').elapsedMs,4000);assert.equal(store.snapshotChannel('novo','afk').elapsedMs,0);
  store.merge('novo',null);now+=10000;assert.equal(store.snapshotChannel('novo','geral').elapsedMs,0);assert.equal(store.snapshotChannel('novo','geral').running,false);
});
