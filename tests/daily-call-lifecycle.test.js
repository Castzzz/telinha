import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';

test('encerrar o processo com servidor embutido salva os segundos desde o último checkpoint',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'teletela-tempo-saida-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const server=new URL('../server.js',import.meta.url).href;
 const script=`const backend=await import(${JSON.stringify(server)});let now=Date.parse('2026-10-30T12:00:00Z');backend.dailyCalls.now=()=>now;await backend.startServer(0,'127.0.0.1');backend.dailyCalls.joinChannel('perfil','sessao','geral');now+=5000;process.exit(0);`;
 execFileSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,TELINHA_DATA_DIR:dir,TELINHA_MUSIC:'0',SFU_SECRET:''},stdio:'pipe',timeout:10000});
 const saved=JSON.parse(fs.readFileSync(path.join(dir,'daily-call-time.json'),'utf8'));assert.equal(saved.totals.perfil,5000);
 assert.equal(saved.channelTotals.geral.perfil,5000);
});
