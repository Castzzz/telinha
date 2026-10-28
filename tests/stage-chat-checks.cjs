// Confere alvos de clique, arraste real e continuidade do vídeo durante a navegação.
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
module.exports = async function checkStageChat(win) {
  const js = code => win.webContents.executeJavaScript(code);
  const rect = selector => js(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),width:r.width}; })()`);
  async function click(selector) {
    const p = await rect(selector);
    assert(await js(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${p.x},${p.y}))`), 'Clique bloqueado: ' + selector + ' ' + await js(`JSON.stringify({hit:document.elementFromPoint(${p.x},${p.y})?.outerHTML.slice(0,300),bar:getComputedStyle(document.querySelector('#stage-section')).cssText,classes:document.body.className,stage:document.querySelector('#stage-section').getBoundingClientRect().toJSON()})`));
    win.webContents.sendInputEvent({ type: 'mouseMove', x:p.x, y:p.y });
    win.webContents.sendInputEvent({ type: 'mouseDown', x:p.x, y:p.y, button:'left', clickCount:1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x:p.x, y:p.y, button:'left', clickCount:1 });
    await pause(100);
  }
  async function until(code) {
    for (let i=0;i<50;i++) { if (await js(code)) return; await pause(100); }
    throw new Error('Estado esperado: ' + code);
  }
  await click('#stage-cinema-toggle');
  win.webContents.sendInputEvent({type:'mouseMove',x:350,y:200});
  await until("document.querySelector('#stage-cinema-bar').classList.contains('is-idle')");
  await pause(200);
  assert(await js("getComputedStyle(document.querySelector('#stage-cinema-bar')).opacity === '0'"), 'Faixa recolhida deve sumir de verdade');
  win.webContents.sendInputEvent({type:'mouseMove',x:360,y:210}); await pause(100);
  assert(await js("!document.querySelector('#stage-cinema-bar').classList.contains('is-idle')"), 'Mover o mouse deve revelar participantes');
  await js("document.querySelector('#stage-cinema-toggle').focus();void 0");
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
  assert(await js("getComputedStyle(document.querySelector('#stage-cinema-bar')).opacity !== '0'"));
  // Faixa expandida e recolhida não podem interceptar os botões dos emojis.
  for (const collapsed of [false,true]) {
    await js(`if ((document.querySelector('#stage-cinema-toggle').getAttribute('aria-expanded') === 'false') !== ${collapsed}) document.querySelector('#stage-cinema-toggle').click();void 0`);
    await click('#btn-more-reactions'); await click('#quick-reactions button');
    await until("document.querySelectorAll('#stage-cinema-reactions > *').length > 0");
    await click('#btn-more-reactions');
  }
  await js("if(document.querySelector('#stage-cinema-toggle').getAttribute('aria-expanded')==='false')document.querySelector('#stage-cinema-toggle').click();if(document.querySelector('#chat-drawer').classList.contains('collapsed'))document.querySelector('#btn-toggle-chat').click();void 0");
  await pause(250);
  const before = await js("document.querySelector('#chat-drawer').getBoundingClientRect().width");
  const handle = await rect('#chat-resizer');
  win.webContents.sendInputEvent({type:'mouseMove',x:handle.x,y:handle.y});
  win.webContents.sendInputEvent({type:'mouseDown',x:handle.x,y:handle.y,button:'left',clickCount:1});
  win.webContents.sendInputEvent({type:'mouseMove',x:handle.x-100,y:handle.y}); await pause(50);
  win.webContents.sendInputEvent({type:'mouseUp',x:handle.x-100,y:handle.y,button:'left',clickCount:1});
  await pause(250);
  assert((await js("document.querySelector('#chat-drawer').getBoundingClientRect().width")) >= before + 90, 'O arraste deve alargar o chat da call');
  await js("document.querySelector('#btn-add-text-channel').click();document.querySelector('#input-channel-name').value='Mesa RPG';document.querySelector('#form-create-channel').requestSubmit();void 0");
  await until("appState.textView === 'mesa-rpg' && document.querySelector('#app-layout').classList.contains('text-with-stream')");
  assert(await js("document.querySelector('#chat-drawer').getBoundingClientRect().width > 800"), 'Canal de texto deve ocupar o centro');
  const live = "document.querySelector('#video-tile-stage-fixture video').srcObject === stageFixtureStream && stageFixtureStream.getVideoTracks()[0].readyState === 'live' && !document.querySelector('#video-tile-stage-fixture video').paused";
  assert(await js(live), 'Trocar layout deve preservar o vídeo');
  await pause(150);
  await fs.writeFile('/tmp/teletela-chat-central.png',(await win.webContents.capturePage()).toPNG());
  await click('#btn-return-to-stream');
  assert(await js("!appState.textView && !document.querySelector('#app-layout').classList.contains('text-full')"));
  assert(await js(live));
  win.setSize(390,844);await pause(250);
  await js("document.querySelector('[data-text-channel-id=mesa-rpg] .channel-row').click();void 0");

  await until("appState.textView === 'mesa-rpg'");
  assert(await js("(() => {const r=document.querySelector('#stage-section').getBoundingClientRect();return r.width>0 && r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight && document.documentElement.scrollWidth<=innerWidth})()"), 'Prévia deve caber no celular');
  assert(await js(live));
  await pause(150);
  await fs.writeFile('/tmp/teletela-chat-central-celular.png',(await win.webContents.capturePage()).toPNG());
  await click('#btn-return-to-stream');win.setSize(1180,950);await pause(250);
  // Mosaico e vídeo único levam os mesmos controles para o topo nativo da tela cheia.
  for (const selector of ['#videos-grid','#video-tile-stage-fixture']) {
    await win.webContents.executeJavaScript(`document.querySelector('${selector}').requestFullscreen()`,true);
    await until("document.fullscreenElement?.contains(document.querySelector('#stage-controls-bar'))");
    await click('#btn-more-reactions');await click('#quick-reactions button');
    await click('#btn-more-reactions');
    await js('document.exitFullscreen()');
    await until("!document.fullscreenElement && document.querySelector('#stage-controls-bar').parentElement.id === 'stage-section'");
  }
  await js("document.body.classList.add('stage-fullscreen');void 0");await pause(150);
  await click('#btn-more-reactions');await click('#quick-reactions button');await click('#btn-more-reactions');
  await js("document.body.classList.remove('stage-fullscreen');void 0");
  await win.webContents.executeJavaScript("document.querySelector('#video-tile-stage-fixture').requestFullscreen()",true);
  await until("document.fullscreenElement?.contains(document.querySelector('#stage-controls-bar'))");
  await js("window.detachedStageTile=document.querySelector('#video-tile-stage-fixture');detachedStageTile.remove();void 0");
  await until("!document.fullscreenElement && document.querySelector('#stage-controls-bar')?.parentElement.id === 'stage-section'");
  // Repõe o vídeo de teste para as verificações seguintes.
  await js("(async()=>{detachedStageTile.querySelector('#video-stage')?.remove();document.querySelector('#videos-grid').append(detachedStageTile);await detachedStageTile.querySelector('video').play()})()");
  console.log('Participantes, reações, arraste do chat e vídeo contínuo no chat central conferidos.');
};
