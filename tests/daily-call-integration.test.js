import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {io as client} from 'socket.io-client';

test('servidor mantém o tempo ao trocar, sair, reconectar e virar o dia, sem divulgar calls privadas', {timeout:15000}, async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'teletela-tempo-servidor-'));
 process.env.TELINHA_DATA_DIR=directory;process.env.OWNER_KEY='dono-tempo-diario';process.env.TELINHA_MUSIC='0';process.env.SFU_SECRET='';
 const backend=await import('../server.js'),server=await backend.startServer(0,'127.0.0.1'),sockets=[];
 t.after(async()=>{for(const socket of sockets)socket.disconnect();await new Promise(resolve=>backend.io.close(resolve));fs.rmSync(directory,{recursive:true,force:true});});
 let now=Date.parse('2026-10-30T12:00:00Z');backend.dailyCalls.now=()=>now;
 const once=(socket,event)=>new Promise(resolve=>socket.once(event,resolve));
 async function connect(token){const socket=client('http://127.0.0.1:'+server.address().port,{transports:['websocket'],autoConnect:false,reconnection:false,auth:{permissionToken:token||''}});sockets.push(socket);const identity=once(socket,'permission-identity'),connected=once(socket,'connect');socket.connect();await connected;return {socket,token:(await identity).token};}
 const emit=(socket,event,payload)=>socket.timeout(2000).emitWithAck(event,payload);
 const join=(socket,id)=>emit(socket,'join-channel',{channelId:id,isMicOn:false});
 const owner=(await connect()).socket,first=await connect(),guest=first.socket;
 await emit(owner,'owner-claim',{key:process.env.OWNER_KEY});await join(owner,'geral');await join(guest,'geral');
 now+=60000;const other=(await emit(owner,'create-channel',{name:'Outra call'})).channelId;await join(guest,other);
 const identity=backend.io.sockets.sockets.get(guest.id).data.user.accessId;
 assert.equal(backend.dailyCalls.snapshot(identity).elapsedMs,60000);now+=30000;await emit(guest,'leave-channel',{});
 now+=3600000;assert.equal(backend.dailyCalls.snapshot(identity).elapsedMs,90000);
 const disconnected=once(backend.io.sockets.sockets.get(guest.id),'disconnect');guest.disconnect();await disconnected;
 const second=await connect(first.token);await join(second.socket,'geral');now+=60000;
 assert.equal(backend.getChannelsSummary().find(ch=>ch.id==='geral').users.find(user=>user.id===second.socket.id).dailyCallTime.elapsedMs,150000);
 const copy=await connect(first.token);await join(copy.socket,'geral');now+=60000;assert.equal(backend.dailyCalls.snapshot(identity).elapsedMs,210000);
 await emit(second.socket,'leave-channel',{});now+=60000;assert.equal(backend.dailyCalls.snapshot(identity).elapsedMs,270000);
 now=Date.parse('2026-10-31T03:00:04Z');assert.equal(backend.dailyCalls.snapshot(identity).elapsedMs,4000);
 const privateId=(await emit(owner,'create-channel',{name:'Privado',access:{private:true,members:[backend.io.sockets.sockets.get(owner.id).data.user.accessId],roles:[]}})).channelId;
 await join(owner,privateId);const updates=[];copy.socket.on('daily-call-times',payload=>updates.push(...payload));backend.syncDailyCallTimes();await new Promise(resolve=>setTimeout(resolve,40));
 assert(updates.some(item=>item.userId===copy.socket.id&&item.time.elapsedMs===4000));assert(!updates.some(item=>item.userId===owner.id));
 const saved=JSON.parse(fs.readFileSync(path.join(directory,'daily-call-time.json'),'utf8'));assert.equal(saved.day,'2026-10-31');assert.equal(saved.totals[identity],4000);
});
