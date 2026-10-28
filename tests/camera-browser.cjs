// Duas pessoas com vídeo WebRTC real; lentes simuladas por cores e microfone separado.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict');
const {registerAppScheme,handleAppProtocol,roomUrl}=require('../electron/app-protocol.cjs');
registerAppScheme();
const directory=require('node:fs').mkdtempSync(path.join(os.tmpdir(),'teletela-camera-ui-'));
app.setPath('userData',path.join(directory,'electron'));
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.on('window-all-closed',()=>{});
const windows=[],pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const js=(w,code)=>w.webContents.executeJavaScript(code);
const click=(w,s)=>js(w,`document.querySelector(${JSON.stringify(s)}).click();void 0`);
async function until(w,code){for(let i=0;i<160;i++){if(await js(w,code))return;await pause(75);}throw new Error('Estado esperado: '+code);}
let call;
const sfu=process.env.CAMERA_TEST_SFU==='1',mode=sfu?'sfu':'p2p';
app.whenReady().then(async()=>{
  const {startMusicCall}=await import('../scripts/music-call.mjs');call=await startMusicCall({port:0,sfu});
  async function open(name,mobile=false){
    const w=new BrowserWindow({width:mobile?390:1100,height:844,show:false,webPreferences:{partition:'camera-'+name,offscreen:true,backgroundThrottling:false}});
    windows.push(w);handleAppProtocol(w.webContents.session);await w.loadURL(roomUrl(call.url));
    await until(w,'Boolean(window.appState?.myId)');
    await js(w,`localStorage.setItem('telinha_prefs',JSON.stringify({profile:{id:'perfil-${name}',name:'${name}',color:'#5865f2'},seenWhatsNew:'99'}));void 0`);
    w.reload();await until(w,`document.querySelector('#dock-user-name').textContent==='${name}'&&Boolean(appState.myId)`);
    await js(w,"document.querySelectorAll('.modal-backdrop').forEach(e=>e.classList.add('hidden'));document.querySelector('#channel-geral .channel-row').click();void 0");
    await until(w,"appState.currentChannelId==='geral'");return w;
  }
  const first=await open('Cast',true),second=await open('Amigo');
  await click(first,'#btn-toggle-mic');await until(first,'Boolean(appState.localMicStream?.getAudioTracks()[0]?.enabled)');
  await js(first,`(()=>{
    window.cameraRequests=[];window.cameraTracks=[];window.cameraMode='normal';
    const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async constraints=>{
      if(!constraints.video)return original(constraints);
      cameraRequests.push(constraints);
      const facing=constraints.video.facingMode?.exact||constraints.video.facingMode?.ideal||constraints.video.deviceId?.exact||'user';
      if(cameraMode==='fail'&&facing==='environment')throw Object.assign(new Error('Sem traseira'),{name:'OverconstrainedError'});
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
      const ctx=canvas.getContext('2d');ctx.fillStyle=facing==='environment'?'#0044ff':'#ff2200';ctx.fillRect(0,0,640,360);
      const timer=setInterval(()=>{ctx.fillRect(0,0,640,360);},50),stream=canvas.captureStream(20),track=stream.getVideoTracks()[0],stop=track.stop.bind(track);
      track.stop=()=>{clearInterval(timer);stop();};
      track.getSettings=()=>({facingMode:facing,deviceId:facing,width:640,height:360,frameRate:20});
      cameraTracks.push(track);
      if(cameraMode==='hold')await new Promise(resolve=>{window.releaseCamera=resolve;});
      return stream;
    };
    window.cameraMicBefore=appState.localMicStream;
  })()`);
  await click(first,'[data-mobile-proxy="btn-share-camera"]');await until(first,'appState.myUser.isCameraOn&&!appState.cameraBusy');
  const sharer=await js(first,'appState.myId'),viewer=await js(second,'appState.myId'),key=sharer+'__cam';
  await until(second,`Boolean(document.querySelector('.badge-live-stream[data-stream-key="${key}"]'))`);
  await click(second,`.badge-live-stream[data-stream-key="${key}"]`);
  await until(second,`Boolean(appState.activeStreams.get('${key}')?.stream?.getVideoTracks()[0])`);
  const color=async expected=>{
    for(let i=0;i<100;i++){
      const good=await js(second,`(()=>{const video=document.querySelector('#video-el-${key}');if(!video||video.readyState<2)return false;const c=document.createElement('canvas');c.width=1;c.height=1;const x=c.getContext('2d');x.drawImage(video,0,0,1,1);const p=x.getImageData(0,0,1,1).data;return ${expected==='rear'?'p[2]>180&&p[0]<70':'p[0]>180&&p[2]<70'};})()`);
      if(good)return;await pause(75);
    }throw new Error('O outro participante não recebeu a imagem '+expected);
  };
  await color('front');
  await js(first,`window.cameraStreamBefore=appState.localCameraStream;window.cameraPeerBefore=${sfu?'appState.sfuCameraPublisher.pc':`appState.screenPeersOut.get('${viewer}__cam')`};void 0`);
  await js(second,`window.cameraReceiverBefore=${sfu?`appState.sfuViewers.get('${key}').pc`:`appState.screenPeersIn.get('${key}')`};void 0`);
  const point=await js(first,"(()=>{const b=document.querySelector('#btn-mobile-flip-camera');const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
  assert(await js(first,`document.querySelector('#btn-mobile-flip-camera').contains(document.elementFromPoint(${point.x},${point.y}))`),'Botão de virar deve ser clicável');
  first.webContents.sendInputEvent({type:'mouseMove',...point});first.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});first.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});
  await until(first,"appState.cameraFacingMode==='environment'&&!appState.cameraBusy");await color('rear');
  assert(await js(first,`appState.localCameraStream===cameraStreamBefore&&${sfu?'appState.sfuCameraPublisher.pc':`appState.screenPeersOut.get('${viewer}__cam')`}===cameraPeerBefore&&appState.localMicStream===cameraMicBefore&&cameraMicBefore.getAudioTracks()[0].enabled`),'Troca deve preservar MediaStream, conexão e microfone');
  assert(await js(second,`${sfu?`appState.sfuViewers.get('${key}').pc`:`appState.screenPeersIn.get('${key}')`}===cameraReceiverBefore`),'Espectador não deve reconectar');
  await click(first,'#mobile-call-more');await click(first,'#mobile-flip-camera-option');await until(first,"appState.cameraFacingMode==='user'&&!appState.cameraBusy");await color('front');
  assert(await js(first,"!document.querySelector('#mobile-call-options').open"));
  await js(first,"cameraMode='fail';void 0");await click(first,'#btn-mobile-flip-camera');await until(first,'!appState.cameraBusy');await color('front');
  assert(await js(first,"appState.myUser.isCameraOn&&appState.cameraFacingMode==='user'"),'Falha não deve desligar a câmera atual');
  await js(first,`cameraMode='normal';document.querySelector('#input-admin-key').value=${JSON.stringify(process.env.OWNER_KEY)};document.querySelector('#btn-admin-login').click();void 0`);
  await until(first,"appState.isOwner&&appState.channels.get('geral').users.get(appState.myId).isOwner===true");
  assert(await js(first,"!document.querySelector('.badge-admin[title=\"Dono do servidor\"]')"),'Dono não deve ter coroinha no nome');
  for(const theme of ['escuro','preto','claro']){await js(first,`document.documentElement.dataset.theme='${theme}';void 0`);await pause(150);await fs.writeFile(`/tmp/teletela-camera-${mode}-${theme}.png`,(await first.webContents.capturePage()).toPNG());}
  await js(first,"cameraMode='hold';void 0");await click(first,'#btn-mobile-flip-camera');await until(first,"appState.cameraBusy&&typeof releaseCamera==='function'");
  await click(first,'[data-mobile-proxy="btn-dock-leave"]');await js(first,'releaseCamera();void 0');await pause(200);
  assert(await js(first,'!appState.currentChannelId&&!appState.myUser.isCameraOn&&!appState.localCameraStream&&cameraTracks.every(t=>t.readyState===\'ended\')'),'Sair durante a troca deve encerrar todas as câmeras');
  console.log('Câmera '+mode+': frontal/traseira recebidas por outra pessoa, peers e microfone preservados, menu, falha, cancelamento e dono sem coroinha passaram.');
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{for(const w of windows)if(!w.isDestroyed())w.destroy();if(call)await call.close();await fs.rm(directory,{recursive:true,force:true});app.exit(process.exitCode||0);});
