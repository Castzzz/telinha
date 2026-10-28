import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraSource } from '../public/camera-source.js';
class Track {
  constructor(facing) { this.kind='video';this.readyState='live';this.facing=facing; }
  getSettings(){return {facingMode:this.facing,deviceId:this.facing};}
  stop(){this.readyState='ended';}
}
class Stream {
  constructor(track){this.tracks=[track];}
  getTracks(){return this.tracks.slice();}
  getVideoTracks(){return this.getTracks();}
  addTrack(t){this.tracks.push(t);}
  removeTrack(t){this.tracks=this.tracks.filter(current=>current!==t);}
}
const failure=name=>Object.assign(new Error(name),{name});
const facing=constraints=>constraints.video.facingMode?.exact||constraints.video.facingMode?.ideal||constraints.video.deviceId?.exact;

test('alterna frontal/traseira preservando a MediaStream e encerrando a lente antiga',async()=>{
  const calls=[],changed=[];
  const source=new CameraSource({mediaDevices:{async getUserMedia(c){calls.push(c);return new Stream(new Track(facing(c)));}},onStream:async(...args)=>changed.push(args)});
  await source.start();const stream=source.stream,front=stream.getVideoTracks()[0];
  assert.equal(source.facing,'user');assert.equal(calls[0].audio,false);
  await source.flip();assert.equal(source.stream,stream);assert.equal(source.facing,'environment');assert.equal(front.readyState,'ended');
  const rear=stream.getVideoTracks()[0];await source.flip();assert.equal(source.stream,stream);assert.equal(source.facing,'user');assert.equal(rear.readyState,'ended');
  assert.equal(changed[1][1],front);assert.equal(source.busy,false);source.stop();
});

test('se não existe a outra lente, mantém a câmera atual',async()=>{
  let calls=0;
  const source=new CameraSource({mediaDevices:{async getUserMedia(c){if(calls++)throw failure('OverconstrainedError');return new Stream(new Track(facing(c)));},async enumerateDevices(){return [{kind:'videoinput',deviceId:'user',label:'Frontal'}];}},onStream:async()=>{}});
  await source.start();const front=source.stream.getVideoTracks()[0];
  await assert.rejects(source.flip());assert.equal(front.readyState,'live');assert.equal(source.facing,'user');assert.equal(source.busy,false);source.stop();
});

test('libera somente o vídeo quando o aparelho não suporta duas câmeras abertas',async()=>{
  let previous;
  const source=new CameraSource({mediaDevices:{async getUserMedia(c){if(facing(c)==='environment'&&previous.readyState==='live')throw failure('NotReadableError');const stream=new Stream(new Track(facing(c)));previous ||= stream.getVideoTracks()[0];return stream;}},onStream:async()=>{}});
  await source.start();const stream=source.stream;await source.flip();assert.equal(previous.readyState,'ended');assert.equal(source.stream,stream);assert.equal(source.facing,'environment');source.stop();
});

test('restaura a lente anterior se a troca falhar depois de liberar o hardware',async()=>{
  let count=0;
  const source=new CameraSource({mediaDevices:{async getUserMedia(c){count++;if(count===2||count===3)throw failure('NotReadableError');return new Stream(new Track(facing(c)));}},onStream:async()=>{}});
  await source.start();const stream=source.stream;await assert.rejects(source.flip());
  assert.equal(source.stream,stream);assert.equal(source.facing,'user');assert.equal(stream.getVideoTracks()[0].readyState,'live');assert.equal(source.busy,false);source.stop();
});

test('troca por deviceId quando a WebView não seleciona facingMode',async()=>{
  const source=new CameraSource({mediaDevices:{async getUserMedia(c){if(c.video.facingMode?.exact)throw failure('OverconstrainedError');return new Stream(new Track(facing(c)));},async enumerateDevices(){return [{kind:'videoinput',deviceId:'user',label:'Front'},{kind:'videoinput',deviceId:'environment',label:'Back'}];}},onStream:async()=>{}});
  await source.start();await source.flip();assert.equal(source.facing,'environment');source.stop();
});

test('sair ou desligar durante a abertura impede capturas atrasadas e vazamento da câmera',async()=>{
  let resolve,installed=0;
  const source=new CameraSource({mediaDevices:{getUserMedia(){return new Promise(done=>{resolve=done;});}},onStream:async()=>installed++});
  const pending=source.start();source.stop();const late=new Stream(new Track('user'));resolve(late);await pending;
  assert.equal(source.stream,null);assert.equal(installed,0);assert.equal(late.getVideoTracks()[0].readyState,'ended');assert.equal(source.busy,false);
});

test('desligar durante a troca cancela o resultado e não reativa a câmera',async()=>{
  let resolve,count=0,installed=0;
  const source=new CameraSource({mediaDevices:{async getUserMedia(c){if(++count===1)return new Stream(new Track(facing(c)));return new Promise(done=>{resolve=done;});}},onStream:async()=>installed++});
  await source.start();const flip=source.flip();source.stop();const late=new Stream(new Track('environment'));resolve(late);await flip;
  assert.equal(source.stream,null);assert.equal(installed,1);assert.equal(late.getVideoTracks()[0].readyState,'ended');assert.equal(source.busy,false);
});

test('encerra a captura se nem a lente anterior puder ser recuperada',async()=>{
  let count=0,lost=0;
  const source=new CameraSource({mediaDevices:{async getUserMedia(c){if(++count>1)throw failure('NotReadableError');return new Stream(new Track(facing(c)));}},onStream:async()=>{},onLost:()=>lost++});
  await source.start();await assert.rejects(source.flip(),/reabrir/);
  assert.equal(lost,1);assert.equal(source.stream,null);assert.equal(source.busy,false);
});

test('aceita facingMode confirmado mesmo quando a WebView usa o mesmo deviceId',async()=>{
  const source=new CameraSource({mediaDevices:{async getUserMedia(c){const track=new Track(facing(c));track.getSettings=()=>({facingMode:track.facing,deviceId:'default'});return new Stream(track);}},onStream:async()=>{}});
  await source.start();await source.flip();assert.equal(source.facing,'environment');source.stop();
});

test('a lente antiga encerrada pelo Android durante a troca não cancela a nova',async()=>{
  let previous,lost=0;
  const source=new CameraSource({mediaDevices:{async getUserMedia(c){if(previous){previous.readyState='ended';previous.onended?.();}const track=new Track(facing(c));previous ||= track;return new Stream(track);}},onStream:async()=>{},onLost:()=>lost++});
  await source.start();const stream=source.stream;await source.flip();
  assert.equal(source.stream,stream);assert.equal(source.facing,'environment');assert.equal(stream.getVideoTracks()[0].readyState,'live');assert.equal(lost,0);source.stop();
});
