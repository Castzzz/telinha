export const permissionLabels = {
  kickMembers: 'Tirar pessoas da call', moveMembers: 'Mover pessoas entre calls',
  muteMembers: 'Mutar pessoas', deafenMembers: 'Ensurdecer pessoas', manageChannels: 'Gerenciar canais e visibilidade'
};

export function hasPermission(state, permission) {
  return Boolean(state.isAdmin || state.permissions?.includes(permission));
}

export function setupPermissions({ socket, state, saveIdentity, showToast, escapeHtml, onChange }) {
  const $ = selector => document.querySelector(selector);
  let directory = { roles: [], members: [] }, editingChannel = null, accessRequest = 0;
  const request = async (event, data) => {
    try {
      const result = await socket.timeout(5000).emitWithAck(event, data).catch(() => {
        throw new Error('O servidor demorou para responder. Tente de novo.');
      });
      if (!result?.success) throw new Error(result?.error || 'Não deu para salvar.');
      return result;
    } catch (err) { showToast(err.message || 'Espere a conexão voltar.', 'error'); return null; }
  };
  const options = (items, selected) => items.map(item => `<option value="${escapeHtml(item.id)}"${item.id === selected ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
  const checks = (items, selected = []) => items.map(item => `<label class="permission-choice"><input type="checkbox" value="${escapeHtml(item.id)}"${selected.includes(item.id) ? ' checked' : ''}> <span>${escapeHtml(item.name)}</span></label>`).join('');
  const selected = selector => [...document.querySelectorAll(`${selector} input:checked`)].map(input => input.value);
  const renderAccess = (prefix, access = { roles: [], members: [] }) => {
    $(`#${prefix}-roles`).innerHTML = checks(directory.roles, access.roles);
    $(`#${prefix}-members`).innerHTML = checks(directory.members.map(m => ({ ...m, name: `${m.name} · ${m.id.slice(0, 6)}` })), access.members);
  };
  const readAccess = prefix => ({ private: $(`#${prefix}-private`).checked, roles: selected(`#${prefix}-roles`), members: selected(`#${prefix}-members`) });
  const fillRole = () => {
    const role = directory.roles.find(r => r.id === $('#permission-role-id').value);
    $('#permission-role-name').value = role?.name || '';
    $('#permission-role-position').value = role?.position || 10;
    $('#permission-role-delete').disabled = !role;
    $('#permission-role-flags').innerHTML = checks(Object.entries(permissionLabels).map(([id, name]) => ({ id, name })), role?.permissions);
  };
  const fillMember = () => {
    const member = directory.members.find(m => m.id === $('#permission-member-id').value);
    $('#permission-member-roles').innerHTML = checks(directory.roles, member?.roles);
    $('#permission-member-save').disabled = !member;
  };
  const loadChannel = async () => {
    const channelId = $('#permission-channel-id').value;
    const generation = ++accessRequest;
    editingChannel = null;
    $('#permission-channel-save').disabled = true;
    if (!channelId) return;
    const result = await request('get-channel-access', { channelId });
    if (!result || generation !== accessRequest) return;
    editingChannel = channelId;
    $('#channel-access-private').checked = result.access.private;
    renderAccess('channel-access', result.access);
    $('#permission-channel-save').disabled = false;
  };
  const refreshChannels = () => {
    const selector = $('#permission-channel-id');
    if (!selector) return;
    const current = selector.value;
    const channels = [...state.channels.values()].filter(ch => ch.canManageAccess);
    selector.innerHTML = '<option value="">Escolha um canal</option>' + options(channels, current);
    if (editingChannel && !channels.some(ch => ch.id === editingChannel)) { editingChannel = null; $('#permission-channel-save').disabled = true; }
  };
  $('#permission-role-id').addEventListener('change', fillRole);
  $('#permission-member-id').addEventListener('change', fillMember);
  $('#permission-channel-id').addEventListener('change', loadChannel);
  $('#permission-role-form').addEventListener('submit', async event => {
    event.preventDefault();
    const result = await request('role-save', { id: $('#permission-role-id').value || undefined, name: $('#permission-role-name').value,
      position: Number($('#permission-role-position').value), permissions: selected('#permission-role-flags') });
    if (result) { $('#permission-role-id').value = result.role.id; fillRole(); showToast('Cargo salvo.', 'success'); }
  });
  $('#permission-role-delete').addEventListener('click', async () => {
    const id = $('#permission-role-id').value;
    if (id && await request('role-delete', { id })) { fillRole(); showToast('Cargo removido.', 'success'); }
  });
  $('#permission-member-save').addEventListener('click', async () => {
    if (await request('member-roles', { memberId: $('#permission-member-id').value, roles: selected('#permission-member-roles') })) showToast('Cargos da pessoa salvos.', 'success');
  });
  $('#permission-channel-save').addEventListener('click', async () => {
    if (editingChannel && await request('channel-access', { channelId: editingChannel, access: readAccess('channel-access') })) showToast('Visibilidade do canal salva.', 'success');
  });
  $('#new-channel-access-private').addEventListener('change', () => {
    $('#new-channel-access-choices').classList.toggle('hidden', !$('#new-channel-access-private').checked);
  });
  socket.on('permission-identity', ({ token }) => { if (typeof token === 'string') saveIdentity(token); });
  socket.on('permissions-state', payload => {
    state.permissions = payload.permissions || [];
    state.permissionRoles = payload.roles || [];
    $('#permission-device').textContent = payload.memberId ? `Código deste aparelho: ${payload.memberId.slice(0, 6)}. Informe ao admin para ele escolher a instalação certa.` : '';
    state.isAdmin = Boolean(payload.owner);
    $('#permission-status').textContent = payload.owner ? 'Controle total pela senha de admin.' : state.permissionRoles.length ? `Seus cargos: ${state.permissionRoles.map(r => r.name).join(', ')}` : 'Você está usando seu perfil de visitante.';
    $('#permission-management').classList.toggle('hidden', !payload.directory);
    $('#permission-role-management').classList.toggle('hidden', !payload.owner);
    $('#new-channel-access').classList.toggle('hidden', !payload.directory);
    if (payload.directory) {
      const previous = directory;
      directory = payload.directory;
      const rolesChanged = JSON.stringify(directory.roles) !== JSON.stringify(previous.roles);
      const membersChanged = JSON.stringify(directory.members) !== JSON.stringify(previous.members);
      if (rolesChanged || membersChanged) {
        const roleId = $('#permission-role-id').value, memberId = $('#permission-member-id').value;
        const draft = readAccess('new-channel-access');
        if (rolesChanged) {
          $('#permission-role-id').innerHTML = '<option value="">Criar cargo</option>' + options(directory.roles, roleId);
          fillRole();
        }
        $('#permission-member-id').innerHTML = options(directory.members.map(m => ({ ...m, name: `${m.name} · ${m.id.slice(0, 6)}` })), memberId);
        fillMember(); renderAccess('new-channel-access', draft);
        if (editingChannel) renderAccess('channel-access', readAccess('channel-access'));
      }
    }
    refreshChannels(); onChange();
  });
  fillRole();
  return { refreshChannels, newAccess: () => hasPermission(state, 'manageChannels') && $('#new-channel-access-private').checked ? readAccess('new-channel-access') : undefined };
}
