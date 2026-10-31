const PEOPLE = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="4"/><path d="M1 21v-2a8 8 0 0 1 16 0v2M17 4a4 4 0 0 1 0 8M23 21v-2a7 7 0 0 0-4-6"/></svg>';
const narrow = window.matchMedia('(max-width: 1279px)');

export function setupServerMembers({ socket, prefs, savePrefs, avatar, applyName, openProfile, serverUrl, assetKey }) {
  const panel = document.createElement('aside'); panel.id = 'server-members'; panel.className = 'server-members';
  panel.setAttribute('aria-labelledby', 'server-members-title');
  panel.innerHTML = `<div class="server-members-header"><div>${PEOPLE}<h2 id="server-members-title">Membros</h2><span id="server-members-count"></span></div><button type="button" id="server-members-close" class="btn-icon-close" aria-label="Recolher membros">✕</button></div>
    <label class="server-members-search"><span class="sr-only">Buscar membro</span><input type="search" id="server-members-search" placeholder="Buscar membro" maxlength="80" autocomplete="off"></label>
    <p id="server-members-status" role="status"></p><div id="server-members-groups" class="server-members-groups"></div>`;
  document.getElementById('app-layout').append(panel);
  const scrim = document.createElement('button'); scrim.type = 'button'; scrim.className = 'server-members-scrim'; scrim.setAttribute('aria-label', 'Fechar membros'); document.body.append(scrim);
  const buttons = [];
  for (const [parent, id, className] of [['.topbar-right', 'btn-server-members', 'btn-topbar-tool'], ['#mobile-header', 'btn-mobile-members', 'mobile-icon-button']]) {
    const button = document.createElement('button'); button.type = 'button'; button.id = id; button.className = className;
    button.innerHTML = `${PEOPLE}${id === 'btn-server-members' ? '<span>Membros</span>' : ''}`;
    button.setAttribute('aria-label', 'Membros do servidor'); button.setAttribute('aria-controls', panel.id); button.title = 'Membros do servidor';
    document.querySelector(parent).append(button); buttons.push(button);
    button.addEventListener('click', () => setOpen(!isOpen(), button));
  }
  const $ = selector => panel.querySelector(selector);
  let members = [], received = false, supported = null, desktopOpen = prefs.membersOpen !== false, overlayOpen = false, returnFocus;
  const isOpen = () => narrow.matches ? overlayOpen : desktopOpen;
  function setOpen(open, trigger) {
    if (trigger) returnFocus = trigger;
    if (narrow.matches) overlayOpen = open;
    else { desktopOpen = open; savePrefs({ membersOpen: open }); }
    renderVisibility();
    if (open && narrow.matches) $('#server-members-close').focus();
    if (!open) returnFocus?.focus();
  }
  function renderVisibility() {
    const open = isOpen(); panel.classList.toggle('hidden', !open);
    document.body.classList.toggle('members-open', open); scrim.classList.toggle('hidden', !open || !narrow.matches);
    buttons.forEach(button => button.setAttribute('aria-expanded', String(open)));
    if (narrow.matches) { panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); }
    else { panel.removeAttribute('role'); panel.removeAttribute('aria-modal'); }
  }
  function shown(member) {
    return { ...member, channelId: null, activity: null,
      memberAvatarUrl: member.avatarV ? `${serverUrl}/api/member-avatar/${encodeURIComponent(member.memberId)}?v=${member.avatarV}&access=${encodeURIComponent(assetKey())}` : '' };
  }
  function render() {
    const online = members.filter(member => member.online).length;
    $('#server-members-count').textContent = received ? String(members.length) : '';
    $('#server-members-status').textContent = !socket.connected ? 'Sem conexão com a sala.' : supported === false ? 'Esta sala precisa de atualização para mostrar os membros.' : !received ? 'Carregando membros…' : '';
    $('#server-members-status').classList.toggle('hidden', Boolean(socket.connected && received));
    const list = $('#server-members-groups'); list.replaceChildren();
    if (!socket.connected) return;
    const query = $('#server-members-search').value.trim().toLocaleLowerCase('pt-BR');
    for (const [label, active, count] of [['Online', true, online], ['Offline', false, members.length - online]]) {
      const group = members.filter(member => member.online === active && member.name.toLocaleLowerCase('pt-BR').includes(query))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.memberId.localeCompare(b.memberId));
      if (!group.length) continue;
      const section = document.createElement('section'); section.className = 'server-members-group';
      const title = document.createElement('h3'); title.textContent = `${label} — ${query ? group.length : count}`; section.append(title);
      for (const member of group) {
        const row = document.createElement('button'); row.type = 'button'; row.className = 'server-member'; row.dataset.memberId = member.memberId;
        row.setAttribute('aria-label', `${member.name}, ${active ? 'online' : 'offline'}. Abrir perfil`);
        const photo = document.createElement('span'); photo.className = 'server-member-avatar'; photo.style.backgroundColor = /^#[0-9a-f]{6}$/i.test(member.color) ? member.color : 'var(--accent-brand)';
        photo.innerHTML = avatar(shown(member));
        const dot = document.createElement('span'); dot.className = `server-member-presence ${active ? 'is-online' : ''}`; photo.append(dot);
        const info = document.createElement('span'); info.className = 'server-member-info';
        const name = document.createElement('strong'); name.textContent = member.name; applyName(name, member); info.append(name);
        const role = member.roles.find(role => role.id === member.displayRoleId);
        if (role) { const caption = document.createElement('small'); caption.textContent = role.name; info.append(caption); }
        row.append(photo, info); row.addEventListener('click', () => { if (narrow.matches) setOpen(false); openProfile(member.id); }); section.append(row);
      }
      list.append(section);
    }
    if (received && !list.children.length) { const empty = document.createElement('p'); empty.className = 'server-members-empty'; empty.textContent = query ? 'Ninguém com esse nome.' : 'Nenhum membro para mostrar.'; list.append(empty); }
  }
  $('#server-members-close').addEventListener('click', () => setOpen(false)); scrim.addEventListener('click', () => setOpen(false));
  $('#server-members-search').addEventListener('input', render);
  panel.addEventListener('keydown', event => {
    if (!narrow.matches || event.key !== 'Tab') return;
    const items = [...panel.querySelectorAll('button, input')].filter(element => !element.disabled);
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
    else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && narrow.matches && overlayOpen) { event.preventDefault(); setOpen(false); } });
  narrow.addEventListener('change', () => { overlayOpen = false; renderVisibility(); });
  socket.on('server-members', payload => { supported = payload?.supported === true; received = supported; members = supported && Array.isArray(payload.members) ? payload.members : []; render(); });
  socket.on('room-info', info => { if (!received && info.assetKey) supported = info.membersVersion === 1; queueMicrotask(render); });
  socket.on('disconnect', () => { members = []; received = false; render(); });
  socket.on('connect', () => { supported = null; render(); });
  renderVisibility(); render();
  return { find(id) { const member = members.find(member => member.id === id); return member ? shown(member) : null; },
    closeOverlay() { if (!narrow.matches || !overlayOpen) return false; setOpen(false); return true; } };
}
