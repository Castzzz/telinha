// A janela destacada acompanha inclusive trocas feitas enquanto ela está aberta.
export function acompanharAparencia(janela) {
  const sala = document.documentElement;
  function atualizar() {
    if (janela.closed) return;
    const raiz = janela.document.documentElement;
    raiz.dataset.theme = sala.dataset.theme || 'escuro';
    if (raiz.dataset.visual !== sala.dataset.visual) window.aplicarVisual(sala.dataset.visual, janela.document);
    raiz.dataset.platform = window.electronAPI?.platform || '';
    raiz.classList.toggle('has-theme-color', sala.classList.contains('has-theme-color'));
    for (const nome of ['--theme-color', '--accent-brand', '--accent-brand-hover', '--interface-ink', '--interface-line', '--interface-tint']) {
      raiz.style.setProperty(nome, sala.style.getPropertyValue(nome));
    }
  }
  atualizar();
  const observador = new MutationObserver(atualizar);
  observador.observe(sala, { attributes: true, attributeFilter: ['data-theme', 'data-visual', 'style', 'class'] });
  janela.addEventListener('pagehide', () => observador.disconnect(), { once: true });
}
