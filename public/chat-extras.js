export function setupChatExtras({ socket, state, prefs, savePrefs, showToast, mountStageOverlay, switchChannel, closeUserPopover }) {
  const $=id=>document.getElementById(id), modal=$('modal-chat-nickname');
  let target=null, generation=0, lastInput=Date.now();
  const current=()=>({scope:'call',channelId:state.currentChannelId});
  const allowed=value=>Boolean(value?.channelId && state.currentChannelId===value.channelId);
  const close=()=>{generation++;modal.classList.add('hidden');target=null;};
  const openNickname=async()=>{
    if(!state.channelLayout)return showToast('Esse servidor ainda não tem suporte aos apelidos por chat.');
    const value=current(),version=++generation;if(!value.channelId)return showToast('Entre num canal de voz para escolher o apelido.');
    try{
      const result=await socket.timeout(5000).emitWithAck('chat-nickname-get',value);
      if(version!==generation||!allowed(value))return;
      if(!result?.success)return showToast(result?.error||'Não consegui carregar o apelido.','error');
      closeUserPopover(); $('modal-user-profile').classList.add('hidden');
      target=value;$('chat-nickname-input').value=result.nickname;$('chat-nickname-profile').textContent='Seu nome de perfil: '+result.profileName;
      mountStageOverlay(modal);modal.classList.remove('hidden');$('chat-nickname-input').focus();
    }catch{showToast('O servidor não respondeu. Tente novamente.','error');}
  };
  document.querySelectorAll('[data-call-nickname]').forEach(button=>button.addEventListener('click',openNickname));
  modal.querySelector('[data-close-modal]').addEventListener('click',close);
  $('chat-nickname-form').addEventListener('submit',async event=>{
    event.preventDefault();const value=target,version=generation;if(!allowed(value))return close();
    const button=$('chat-nickname-save');button.disabled=true;
    try{const result=await socket.timeout(5000).emitWithAck('chat-nickname-set',{...value,nickname:$('chat-nickname-input').value});if(version!==generation)return;if(result?.success){close();showToast('Apelido salvo para este canal de voz.','success');}else showToast(result?.error||'Não consegui salvar.','error');}
    catch{showToast('O servidor não respondeu. Tente novamente.','error');}finally{button.disabled=false;}
  });
  $('chat-nickname-reset').addEventListener('click',()=>{$('chat-nickname-input').value='';$('chat-nickname-form').requestSubmit();});
  modal.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
  const recheck=()=>{if(target&&!allowed(target))close();};
  socket.on('text-channels',recheck);socket.on('channel-state',recheck);socket.on('disconnect',close);window.addEventListener('teletela-call-left',recheck);
  for(const event of ['pointerdown','pointermove','keydown','touchstart'])document.addEventListener(event,()=>{lastInput=Date.now();},{passive:true});
  const enabled=$('check-afk-enabled');enabled.checked=prefs.afkEnabled!==false;
  enabled.addEventListener('change',()=>{savePrefs({afkEnabled:enabled.checked});lastInput=Date.now();activity();});
  async function activity(){
    if(!socket.connected)return;
    let active=Date.now()-lastInput<15000;
    if(state.currentChannelId&&window.electronAPI?.getIdleSeconds){try{const idle=await window.electronAPI.getIdleSeconds();if(Number.isFinite(idle))active=active||idle<15;}catch{}}
    socket.emit('idle-activity',{enabled:prefs.afkEnabled!==false,active});
  }
  setInterval(activity,10000);socket.on('connect',activity);activity();
  socket.on('afk-move',payload=>{if(payload?.fromChannelId!==state.currentChannelId||!state.channels.has(payload.channelId))return;switchChannel(payload.channelId);showToast('Você foi para Ausentes por inatividade. Escolha um canal para voltar.');});
}
