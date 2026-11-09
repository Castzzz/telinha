// Explicações continuam disponíveis sem disputar espaço com os controles.
export function setupSettingsLayout() {
  const nav = document.querySelector('.settings-nav');
  const caption = document.createElement('span'); caption.className = 'settings-nav-caption'; caption.textContent = 'APLICATIVO';
  const group = ['perfil', 'conta', 'amigos', 'aparencia', 'atividade', 'microfone', 'som', 'transmissao', 'atalhos', 'admin'];
  for (const topic of group) {
    const tab = nav.querySelector(`[data-settings-tab="${topic}"]`);
    if (topic === 'microfone') nav.append(caption);
    if (tab) nav.append(tab);
  }
  nav.append(document.getElementById('btn-settings-whats-new'));

  for (const section of document.querySelectorAll('.settings-section')) {
    if (['perfil', 'admin'].includes(section.dataset.settingsSection)) continue;
    const notes = [...section.querySelectorAll('p.form-help:not([id]), p.account-intro, .personalization-controls > p:not([id]), .personal-field > small:not([id]), .form-group > small:not([id]), .checkbox-label small:not([id])')]
      .filter(note => !note.closest('details') && !note.querySelector('input, button, a'));
    if (!notes.length) continue;
    const details = document.createElement('details'); details.className = 'settings-help';
    const summary = document.createElement('summary'); summary.textContent = 'Como funciona'; details.append(summary);
    for (const note of notes) {
      const group = note.closest('.form-group');
      const label = group?.querySelector('label');
      const heading = label?.querySelector('strong')?.textContent || label?.childNodes[0]?.textContent?.trim();
      if (heading && heading.length < 100) {
        const title = document.createElement('strong'); title.className = 'settings-help-label'; title.textContent = heading; details.append(title);
      }
      if (note.previousElementSibling?.tagName === 'BR') note.previousElementSibling.remove();
      details.append(note);
    }
    section.append(details);
  }
}
