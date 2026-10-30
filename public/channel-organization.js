const DRAG_CHANNEL = 'application/x-teletela-channel';
const ICON_MOVE = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01"/></svg>';
export function setupChannelOrganization({ socket, state, prefs, savePrefs, showToast, mountStageOverlay, renderVoice, renderText }) {
  const $ = id => document.getElementById(id), modal = $('modal-channel-organization');
  let moving = null, busy = false, afkDirty = false;
  const layout = () => state.channelLayout || { categories: [], placements: {}, canManage: false, afk: { channelId: '', minutes: 15 } };
  const request = async (event, payload) => {
    try { const result = await socket.timeout(6000).emitWithAck(event, payload); if (!result?.success) throw new Error(result?.error || 'Não consegui salvar.'); return result; }
    catch (error) { showToast(error.message || 'Sem resposta do servidor.', 'error'); return null; }
  };
  function targetDrop(event, type, categoryId, beforeId = '') {
    if (!layout().canManage || !event.dataTransfer.types.includes(DRAG_CHANNEL)) return;
    event.preventDefault(); event.stopPropagation();
    try { const item = JSON.parse(event.dataTransfer.getData(DRAG_CHANNEL)); if (item.type === type && item.channelId !== beforeId) request('channel-move', { ...item, categoryId, beforeId }); }
    catch { /* Uma transferência de outro aplicativo não é um canal. */ }
  }
  function enableDrop(node, type, categoryId, beforeId = '') {
    node.addEventListener('dragover', event => { if (layout().canManage && event.dataTransfer.types.includes(DRAG_CHANNEL)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; node.classList.add('channel-order-target'); } });
    node.addEventListener('dragleave', () => node.classList.remove('channel-order-target'));
    node.addEventListener('drop', event => { node.classList.remove('channel-order-target'); targetDrop(event,type,categoryId,beforeId); });
  }
  function openMove(type, channelId) {
    moving = { type, channelId }; fillMove(); mountStageOverlay($('modal-channel-move')); $('modal-channel-move').classList.remove('hidden'); $('channel-move-category').focus();
  }
  function fillMove() {
    if (!moving) return;
    const category = $('channel-move-category'), previous = category.value;
    category.replaceChildren();
    for (const item of layout().categories.filter(c => c.type === moving.type)) category.add(new Option(item.name,item.id));
    const current = layout().placements[`${moving.type}:${moving.channelId}`]?.categoryId || moving.type;
    if ([...category.options].some(option => option.value === previous)) category.value = previous; else category.value = current;
    fillPositions();
  }
  function fillPositions() {
    if (!moving) return;
    const position = $('channel-move-before'); position.replaceChildren(new Option('No final', ''));
    const map = moving.type === 'voice' ? state.channels : state.textChannels;
    const list = [...map.values()].filter(ch => ch.id !== moving.channelId && (layout().placements[`${moving.type}:${ch.id}`]?.categoryId || moving.type) === $('channel-move-category').value).sort((a,b) => (layout().placements[`${moving.type}:${a.id}`]?.position ?? 1e9) - (layout().placements[`${moving.type}:${b.id}`]?.position ?? 1e9));
    for (const channel of list) position.add(new Option('Antes de ' + channel.name, channel.id));
  }
  function decorate(type, tree) {
    if (!tree) return;
    const value = layout(), categories = value.categories.filter(c => c.type === type);
    if (!categories.length) return;
    const rows = [...tree.children].filter(node => type === 'voice' ? node.dataset.channelId : node.dataset.textChannelId);
    const header = $('category-' + type);
    if (header) {
      header.querySelector('.category-title').textContent = categories.find(c => c.id === type)?.name || (type === 'voice' ? 'Canais de Voz' : 'Canais de Texto');
      if (!header.dataset.organized) { enableDrop(header,type,type); header.dataset.organized = 'true'; }
    }
    const groups = new Map([[type,tree]]);
    for (const category of categories.filter(c => c.id !== type)) {
      const wrapper = document.createElement('li'); wrapper.className = 'channel-category'; wrapper.dataset.categoryId = category.id;
      const title = document.createElement('button'); title.type = 'button'; title.className = 'category-header custom-category-header'; title.textContent = (prefs.collapsedCategories?.[category.id] ? '▸ ' : '▾ ') + category.name;
      title.setAttribute('aria-expanded',String(!prefs.collapsedCategories?.[category.id]));
      title.addEventListener('click', () => { savePrefs({ collapsedCategories: { ...prefs.collapsedCategories, [category.id]: !prefs.collapsedCategories?.[category.id] } }); renderVoice(); renderText(); });
      const list = document.createElement('ul'); list.className = 'channels-tree custom-category-list';
      list.classList.toggle('hidden',Boolean(prefs.collapsedCategories?.[category.id]));
      enableDrop(title,type,category.id); wrapper.append(title,list); tree.append(wrapper); groups.set(category.id,list);
    }
    for (const row of rows) {
      const id = type === 'voice' ? row.dataset.channelId : row.dataset.textChannelId;
      const categoryId = value.placements[`${type}:${id}`]?.categoryId || type;
      const parent = groups.get(categoryId) || tree;
      if (parent === tree) tree.insertBefore(row, tree.querySelector(':scope > .channel-category')); else parent.append(row);
      if (!value.canManage) continue;
      const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'channel-order-handle'; handle.innerHTML = ICON_MOVE;
      handle.title = 'Arraste para ordenar ou clique para mover'; handle.setAttribute('aria-label','Mudar posição do canal'); handle.draggable = true;
      handle.addEventListener('click', event => { event.stopPropagation(); openMove(type,id); });
      handle.addEventListener('dragstart', event => { event.stopPropagation(); event.dataTransfer.setData(DRAG_CHANNEL,JSON.stringify({ type,channelId:id })); event.dataTransfer.effectAllowed = 'move'; });
      row.querySelector('.channel-row')?.prepend(handle); enableDrop(row,type,categoryId,id);
    }
  }
  function renderManager() {
    const value = layout(), list = $('channel-category-list');
    const drafts = new Map([...list.children].filter(row => row.querySelector('input')?.value !== row.dataset.originalName).map(row => [row.dataset.categoryId,row.querySelector('input')?.value]));
    list.replaceChildren();
    for (const category of value.categories) {
      const row = document.createElement('div'); row.className = 'category-editor'; row.dataset.categoryId = category.id; row.dataset.originalName = category.name;
      const name = document.createElement('input'); name.className = 'form-input'; name.value = drafts.get(category.id) ?? category.name; name.maxLength = 30; name.setAttribute('aria-label','Nome da categoria ' + category.name);
      const label = document.createElement('small'); label.textContent = category.type === 'voice' ? 'Voz' : 'Texto';
      const save = document.createElement('button'); save.type = 'button'; save.className = 'btn-secondary'; save.textContent = 'Salvar nome'; save.addEventListener('click', () => request('category-save',{ ...category,name:name.value }));
      row.append(label,name,save);
      if (category.id !== category.type) {
        const siblings = value.categories.filter(c => c.type === category.type && c.id !== c.type), index = siblings.findIndex(c => c.id === category.id);
        for (const [label,enabled,beforeId] of [['↑',index > 0,siblings[index-1]?.id],['↓',index < siblings.length-1,siblings[index+2]?.id || '']]) {
          const button = document.createElement('button'); button.type='button';button.className='btn-secondary';button.textContent=label;button.disabled=!enabled;button.setAttribute('aria-label',(label==='↑'?'Subir ':'Descer ')+category.name);button.addEventListener('click',()=>request('category-move',{id:category.id,beforeId}));row.append(button);
        }
        const remove=document.createElement('button');remove.type='button';remove.className='btn-secondary';remove.textContent='Apagar';remove.addEventListener('click',()=>request('category-delete',{id:category.id}));row.append(remove);
      }
      list.append(row);
    }
    const select=$('afk-channel'), previous=select.value, previousMinutes=$('afk-minutes').value;select.replaceChildren(new Option('Desligado',''));
    for(const channel of state.channels.values())if(!channel.isDefault&&!channel.hasPassword&&!channel.isPrivate)select.add(new Option(channel.name,channel.id));
    select.value=afkDirty?previous:value.afk?.channelId || ''; $('afk-minutes').value=afkDirty?previousMinutes:String(value.afk?.minutes || 15);
  }
  function refresh() {
    $('btn-organize-channels').classList.toggle('hidden',!layout().canManage);
    if(!modal.classList.contains('hidden'))renderManager();
    if(moving&&!$('modal-channel-move').classList.contains('hidden'))fillMove();
  }
  $('btn-organize-channels').addEventListener('click',()=>{afkDirty=false;renderManager();mountStageOverlay(modal);modal.classList.remove('hidden');});
  $('category-create-form').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;busy=true;const result=await request('category-save',{type:$('category-create-type').value,name:$('category-create-name').value});if(result)$('category-create-name').value='';busy=false;});
  $('channel-move-category').addEventListener('change',fillPositions);
  $('channel-move-form').addEventListener('submit',async event=>{event.preventDefault();if(!moving)return;if(await request('channel-move',{...moving,categoryId:$('channel-move-category').value,beforeId:$('channel-move-before').value}))$('modal-channel-move').classList.add('hidden');});
  for (const id of ['afk-channel','afk-minutes']) $(id).addEventListener('change',()=>{afkDirty=true;});
  $('afk-form').addEventListener('submit',async event=>{event.preventDefault();if(await request('afk-settings',{channelId:$('afk-channel').value,minutes:Number($('afk-minutes').value)})){afkDirty=false;renderManager();showToast('Configuração de ausentes salva.','success');}});
  $('afk-create').addEventListener('click',async()=>{const result=await request('create-channel',{name:'Ausentes'});if(result)await request('afk-settings',{channelId:result.channelId,minutes:Number($('afk-minutes').value)});});
  return {decorate,refresh};
}
