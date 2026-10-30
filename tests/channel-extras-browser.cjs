const { app, BrowserWindow } = require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {registerAppScheme,handleAppProtocol,roomUrl}=require('../electron/app-protocol.cjs');
registerAppScheme();app.disableHardwareAcceleration();app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');app.commandLine.appendSwitch('use-fake-ui-for-media-stream');app.commandLine.appendSwitch('use-fake-device-for-media-stream');app.on('window-all-closed',()=>{});
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'teletela-extras-ui-'));app.setPath('userData',path.join(directory,'electron'));
process.env.TELINHA_DATA_DIR=path.join(directory,'server');process.env.OWNER_KEY='dono-extras-interface';process.env.TELINHA_MUSIC='0';process.env.SFU_SECRET='';
fs.mkdirSync(process.env.TELINHA_DATA_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.TELINHA_DATA_DIR,'channels.json'),JSON.stringify({channels:[{id:'mesa',name:'Mesa'},{id:'taverna',name:'Taverna'}],textChannels:[{id:'aventura',name:'Aventura'},{id:'conversa',name:'Conversa'}]}));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),windows=[],errors=[];
const js=async(win,code)=>{try{return await win.webContents.executeJavaScript(code);}catch(error){console.error('Trecho:',code);throw error;}};
const click=(win,selector)=>js(win,`document.querySelector(${JSON.stringify(selector)}).click();void 0`);
async function until(win,code){for(let i=0;i<160;i++){if(await js(win,code))return;await pause(75);}throw new Error('Estado não chegou: '+code);}
let backend;const timeout=setTimeout(()=>{console.error('Teste excedeu 70 s');app.exit(1);},70000);
app.whenReady().then(async()=>{
 backend=await import('../server.js');const server=await backend.startServer(0,'127.0.0.1');
 async function open(name){
  const win=new BrowserWindow({width:1280,height:900,show:false,webPreferences:{partition:'extras-'+name,offscreen:true,backgroundThrottling:false}});windows.push(win);handleAppProtocol(win.webContents.session);
  win.webContents.on('console-message',event=>{if(event.level==='error'){errors.push(event.message);console.error('[Interface]',event.message);}});
  await win.loadURL(roomUrl('http://127.0.0.1:'+server.address().port));await until(win,'Boolean(window.appState?.myId && document.querySelector("#channel-geral"))');
  await js(win,`document.querySelector('#input-profile-name').value=${JSON.stringify(name)};document.querySelector('#form-profile').requestSubmit();document.querySelectorAll('.modal-backdrop').forEach(el=>el.classList.add('hidden'));void 0`);return win;
 }
 const owner=await open('Dono'),guest=await open('Amigo');
 await js(owner,"document.querySelector('#input-admin-key').value='dono-extras-interface';document.querySelector('#btn-admin-login').click();void 0");await until(owner,'appState.isOwner && !document.querySelector("#btn-organize-channels").classList.contains("hidden")');
 assert(await js(guest,'document.querySelector("#btn-organize-channels").classList.contains("hidden")'));
 await click(owner,'#btn-organize-channels');await js(owner,"document.querySelector('#category-create-type').value='voice';document.querySelector('#category-create-name').value='RPG';document.querySelector('#category-create-form').requestSubmit();void 0");
 await until(owner,'Boolean(document.querySelector(".channel-category"))');const category=backend.channelExtras.categories('voice').find(c=>c.name==='RPG').id;
 await js(owner,"document.querySelectorAll('.modal-backdrop').forEach(el=>el.classList.add('hidden'));void 0");
 async function drag(source,target){await js(owner,`(()=>{const data=new DataTransfer();document.querySelector(${JSON.stringify(source)}).dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));document.querySelector(${JSON.stringify(target)}).dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data}));})()`);}
 await drag('#channel-mesa .channel-order-handle',`[data-category-id="${category}"] .category-header`);await until(guest,`Boolean(document.querySelector('[data-category-id="${category}"] #channel-mesa'))`);
 await drag('#channel-taverna .channel-order-handle','#channel-mesa');await until(guest,`document.querySelector('[data-category-id="${category}"] ul').firstElementChild?.dataset.channelId === 'taverna'`);
 assert(await js(guest,'!document.querySelector(".channel-order-handle")'));
 await click(owner,'#channel-mesa .channel-order-handle');await js(owner,"document.querySelector('#channel-move-category').value='voice';document.querySelector('#channel-move-category').dispatchEvent(new Event('change'));document.querySelector('#channel-move-before').value='geral';document.querySelector('#channel-move-form').requestSubmit();void 0");
 await until(guest,'document.querySelector("#channels-tree").firstElementChild?.dataset.channelId === "mesa"');
 for(const win of [owner,guest])await click(win,'[data-text-channel-id=aventura] .channel-row');
 await click(guest,'#btn-chat-nickname');await until(guest,'!document.querySelector("#modal-chat-nickname").classList.contains("hidden")');
 await js(guest,"document.querySelector('#chat-nickname-input').value='Mago';document.querySelector('#chat-nickname-form').requestSubmit();void 0");await until(guest,'document.querySelector("#modal-chat-nickname").classList.contains("hidden")');
 await js(guest,"document.querySelector('#chat-input').value='Bola de fogo';document.querySelector('#chat-form').requestSubmit();void 0");await until(owner,'document.querySelector(".chat-author")?.textContent === "Mago"');
 assert(await js(owner,'document.querySelector(".chat-author").title === "Amigo"'));
 await new Promise(resolve=>{guest.webContents.once('did-finish-load',resolve);guest.webContents.reload();});await until(guest,'Boolean(window.appState?.myId && document.querySelector("[data-text-channel-id=aventura]"))');
 await js(guest,"document.querySelectorAll('.modal-backdrop').forEach(el=>el.classList.add('hidden'));void 0");await click(guest,'[data-text-channel-id=aventura] .channel-row');await click(guest,'#btn-chat-nickname');await until(guest,'document.querySelector("#chat-nickname-input").value === "Mago"');await click(guest,'[data-close-modal=modal-chat-nickname]');

 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1cAAAAASUVORK5CYII=';
 await js(guest,`(()=>{const bytes=Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0));const data=new DataTransfer();data.items.add(new File([bytes],'teste.png',{type:'image/png'}));document.querySelector('#chat-input').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));})()`);
 await until(owner,'Boolean(document.querySelector(".chat-image"))');await click(owner,'.chat-image');await until(owner,'!document.querySelector("#image-viewer").classList.contains("hidden")');
 const saved=path.join(directory,'baixada.png');
 const download=new Promise((resolve,reject)=>owner.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(saved);item.once('done',(_event,state)=>state==='completed'?resolve():reject(new Error(state)));}));
 await click(owner,'#image-viewer-download');await download;assert.equal(fs.readFileSync(saved).toString('base64'),png);
 assert(await js(owner,'!document.querySelector("#image-viewer").classList.contains("hidden")'));await click(owner,'#image-viewer-close');
 await click(owner,'#btn-organize-channels');await click(owner,'#afk-create');await until(owner,'appState.channelLayout.afk.channelId');
 const afk=backend.channelExtras.data.afk.channelId;
 for(const win of [owner,guest]){await js(win,"document.querySelectorAll('.modal-backdrop').forEach(el=>el.classList.add('hidden'));document.querySelector('#channel-geral .channel-row').click();void 0");await until(win,"appState.currentChannelId==='geral'");}
 const id=await js(guest,'appState.myId'),user=backend.io.sockets.sockets.get(id).data.user;user.lastActiveAt=Date.now()-16*60000;user.afkSupported=true;backend.sweepAfk();await until(guest,`appState.currentChannelId==='${afk}'`);assert.equal(user.channelId,afk);
 await click(owner,'#btn-organize-channels');
 for(const theme of ['escuro','preto','claro']){await js(owner,`document.documentElement.dataset.theme='${theme}';void 0`);await pause(120);await fs.promises.writeFile('/tmp/teletela-organizacao-'+theme+'.png',(await owner.webContents.capturePage()).toPNG());}
 owner.setSize(390,844);await pause(200);assert(await js(owner,'document.querySelector("#modal-channel-organization .modal-card").getBoundingClientRect().width<=innerWidth'));
 await fs.promises.writeFile('/tmp/teletela-organizacao-mobile.png',(await owner.webContents.capturePage()).toPNG());
 assert(!errors.length,errors.join('\n'));
 console.log('Interface: categoria compartilhada, arrastar canal entre grupos/posições, mover por formulário, apelido por chat, download real de PNG e entrada automática em Ausentes passaram. Três temas e celular conferidos.');
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{clearTimeout(timeout);for(const win of windows)if(!win.isDestroyed())win.destroy();if(backend)await new Promise(resolve=>backend.io.close(resolve));fs.rmSync(directory,{recursive:true,force:true});app.exit(process.exitCode||0);});
