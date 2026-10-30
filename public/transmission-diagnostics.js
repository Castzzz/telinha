// Apenas estatísticas de vídeo; não abre capturas nem altera a qualidade escolhida.
export function videoMetrics(report, previous = new Map(), direction = 'inbound') {
  const rows = [], next = new Map();
  const finite = value => Number.isFinite(value) ? value : null;
  let pair = null;
  for (const stat of report.values()) {
    if (stat.type === 'transport' && stat.selectedCandidatePairId) pair = report.get(stat.selectedCandidatePairId);
  }
  if (!pair) pair = [...report.values()].find(s => s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated);
  for (const stat of report.values()) {
    if (stat.type !== direction + '-rtp' || (stat.kind || stat.mediaType) !== 'video' || stat.isRemote) continue;
    const codec = report.get(stat.codecId)?.mimeType || '';
    if (/\/(rtx|red|ulpfec|flexfec)/i.test(codec)) continue;
    const old = previous.get(stat.id), seconds = old ? (stat.timestamp - old.timestamp) / 1000 : 0;
    const bytes = direction === 'inbound' ? stat.bytesReceived : stat.bytesSent;
    const oldBytes = direction === 'inbound' ? old?.bytesReceived : old?.bytesSent;
    const frames = direction === 'inbound' ? stat.framesDecoded : stat.framesEncoded;
    const oldFrames = direction === 'inbound' ? old?.framesDecoded : old?.framesEncoded;
    const delta = (a, b) => seconds > 0 && Number.isFinite(a) && Number.isFinite(b) && a >= b ? a - b : null;
    const byteDelta = delta(bytes, oldBytes), frameDelta = delta(frames, oldFrames);
    let loss = null;
    if (direction === 'inbound') {
      const received = delta(stat.packetsReceived, old?.packetsReceived), lost = delta(stat.packetsLost, old?.packetsLost);
      if (received !== null && lost !== null && received + lost > 0) loss = 100 * lost / (received + lost);
    } else {
      const remote = report.get(stat.remoteId);
      if (Number.isFinite(remote?.fractionLost)) loss = 100 * remote.fractionLost;
    }
    const remote = report.get(stat.remoteId);
    const rtt = finite(remote?.roundTripTime) ?? finite(pair?.currentRoundTripTime);
    rows.push({ id: stat.id, width: finite(stat.frameWidth), height: finite(stat.frameHeight),
      fps: finite(stat.framesPerSecond) ?? (frameDelta === null ? null : frameDelta / seconds),
      kbps: byteDelta === null ? null : byteDelta * 8 / seconds / 1000,
      loss, rtt: rtt === null ? null : rtt * 1000, codec: codec.replace('video/', '') || null,
      limitation: direction === 'outbound' ? stat.qualityLimitationReason || null : null,
      freezes: direction === 'inbound' ? delta(stat.freezeCount, old?.freezeCount) : null });
    next.set(stat.id, { ...stat });
  }
  return { rows, next };
}

export function setupTransmissionDiagnostics({ getConnections, mountStageOverlay }) {
  const modal = document.getElementById('modal-transmission-diagnostics');
  const results = document.getElementById('transmission-diagnostics-results');
  const status = document.getElementById('transmission-diagnostics-status');
  let timer = null, generation = 0, samples = new Map(), returnFocus;
  const visible = () => !modal.classList.contains('hidden');
  function stop() { generation++; clearTimeout(timer); timer = null; samples.clear(); }
  const format = (value, suffix, digits = 0) => value === null ? 'Indisponível' : value.toLocaleString('pt-BR', { maximumFractionDigits: digits }) + suffix;
  function card(connection, metrics) {
    const node = document.createElement('article'); node.className = 'diagnostic-card';
    const heading = document.createElement('strong'); heading.textContent = connection.label;
    const description = document.createElement('p'); description.textContent = `${connection.direction === 'inbound' ? 'Recebendo' : 'Enviando'} · ${connection.route} · ${({ new: 'Iniciando', connecting: 'Conectando', connected: 'Conectado', disconnected: 'Reconectando', failed: 'Falha', closed: 'Encerrado' })[connection.pc.connectionState] || 'Aguardando'}`;
    const fields = document.createElement('dl');
    const reason = { none: 'Sem limitação informada', cpu: 'Processamento do PC', bandwidth: 'Banda disponível', other: 'Outro motivo' };
    for (const [key, value] of [
      ['Resolução real', metrics.width && metrics.height ? `${metrics.width} × ${metrics.height}` : 'Indisponível'],
      ['Quadros por segundo', format(metrics.fps, ' FPS', 1)], ['Taxa de vídeo', format(metrics.kbps, ' kb/s', 0)],
      [connection.direction === 'inbound' ? 'Perda no intervalo' : 'Perda informada pelo destino', format(metrics.loss, '%', 1)],
      ['Latência de ida e volta', format(metrics.rtt, ' ms')], ['Codec', metrics.codec || 'Indisponível'],
      ['Limitação de envio', reason[metrics.limitation] || 'Indisponível neste trecho'],
      ['Congelamentos no intervalo', format(metrics.freezes, '')]
    ]) {
      const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = value; fields.append(dt, dd);
    }
    node.append(heading, description, fields);
    if (metrics.limitation === 'cpu' || metrics.limitation === 'bandwidth') {
      const tip = document.createElement('p'); tip.textContent = metrics.limitation === 'cpu'
        ? 'O navegador informou limite de processamento. Tente reduzir resolução/FPS ou fechar programas pesados.'
        : 'O navegador informou limite de banda. Tente uma qualidade menor e confira o uso da internet.';
      node.append(tip);
    }
    return node;
  }
  async function update(version) {
    const connections = getConnections(), live = new Map(), nodes = [];
    await Promise.all(connections.map(async connection => {
      try {
        const report = await connection.pc.getStats();
        if (version !== generation || !visible()) return;
        const metrics = videoMetrics(report, samples.get(connection.pc), connection.direction);
        live.set(connection.pc, metrics.next);
        for (const row of metrics.rows) nodes.push(card(connection, row));
      } catch { /* A conexão pode encerrar enquanto o painel consulta. */ }
    }));
    if (version !== generation || !visible()) return;
    samples = live; results.replaceChildren(...nodes);
    status.textContent = connections.length ? nodes.length ? 'Dados ausentes aparecem como indisponíveis. A taxa precisa de duas medições.' : 'Aguardando estatísticas de vídeo…' : 'Nenhuma transmissão ativa. Comece a transmitir ou assistir para medir.';
    timer = setTimeout(() => update(version), 2000);
  }
  function open(event) {
    stop(); returnFocus = event.currentTarget;
    mountStageOverlay(modal); modal.classList.remove('hidden');
    modal.querySelector('button').focus(); update(generation);
  }
  for (const id of ['btn-stage-diagnostics', 'btn-settings-diagnostics']) document.getElementById(id).addEventListener('click', open);
  new MutationObserver(() => { if (!visible()) stop(); }).observe(modal, { attributes: true, attributeFilter: ['class'] });
  modal.querySelector('[data-close-modal]').addEventListener('click', () => { modal.classList.add('hidden'); stop(); returnFocus?.focus(); });
  modal.addEventListener('keydown', event => { if (event.key === 'Escape') { modal.classList.add('hidden'); stop(); returnFocus?.focus(); } });
}
