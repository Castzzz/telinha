window.temasTeletela = { escuro: 'Escuro', preto: 'Preto', claro: 'Claro' };
// Compartilhado com a janela de entrada, que também abre via file://.
window.aplicarVisual = function (preferencia, pagina = document) {
  // O identificador antigo continua válido nos perfis já salvos.
  const escolhido = preferencia === 'violeta' ? 'roda' : preferencia;
  const visual = ['roda', 'terminal'].includes(escolhido) ? escolhido : 'classico';
  pagina.documentElement.dataset.visual = visual;
  for (const elemento of pagina.querySelectorAll('[data-somente-terminal]')) elemento.hidden = visual !== 'terminal';
  for (const folha of pagina.querySelectorAll('link[data-visual-css]')) {
    const ativa = folha.dataset.visualCss === visual || (folha.dataset.visualCss === 'alternativo' && visual !== 'classico');
    folha.media = ativa ? 'all' : 'not all';
  }
};
