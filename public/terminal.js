// Uma atualização de presença pode reconstruir o índice durante a navegação.
export function canalComFoco(arvore) {
  const linha = document.activeElement;
  if (document.documentElement.dataset.visual !== 'terminal' || !linha?.matches('.channel-row') || !arvore.contains(linha)) return '';
  return linha.parentElement.dataset.channelId || linha.parentElement.dataset.textChannelId;
}

export function restaurarFocoDoCanal(arvore, id) {
  if (!id) return;
  const valor = CSS.escape(id);
  arvore.querySelector(`:is([data-channel-id="${valor}"], [data-text-channel-id="${valor}"]) > .channel-row`)?.focus({ preventScroll: true });
}

export function configurarIndiceTerminal(indice) {
  indice.addEventListener('keydown', evento => {
    if (document.documentElement.dataset.visual !== 'terminal' || !evento.target.matches('.channel-row')) return;
    if (evento.altKey || evento.ctrlKey || evento.metaKey || evento.shiftKey) return;
    const teclas = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!teclas.includes(evento.key)) return;
    const linhas = [...indice.querySelectorAll('.channel-row')].filter(linha => linha.getClientRects().length);
    const atual = linhas.indexOf(evento.target);
    const destinos = { ArrowDown: Math.min(linhas.length - 1, atual + 1), ArrowUp: Math.max(0, atual - 1), Home: 0, End: linhas.length - 1 };
    evento.preventDefault();
    linhas[destinos[evento.key]]?.focus();
  });
}
