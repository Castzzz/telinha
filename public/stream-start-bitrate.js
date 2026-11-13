// Só indica o ponto de partida; o navegador continua livre para reduzir pela rede.
export function withVideoStartBitrate(sdp, maxBitrate, { camera = false, effectiveType } = {}) {
  if (typeof sdp !== 'string' || !Number.isFinite(maxBitrate) || maxBitrate <= 300000) return sdp;
  let cap = camera ? 600000 : 2000000;
  if (effectiveType === 'slow-2g' || effectiveType === '2g') return sdp;
  if (effectiveType === '3g') cap = Math.min(cap, 500000);
  const kbps = Math.floor(Math.min(maxBitrate * 0.5, cap) / 1000);
  if (kbps <= 300) return sdp;
  const newline = sdp.includes('\r\n') ? '\r\n' : '\n';
  return sdp.split(/(?=^m=)/m).map(section => {
    if (!section.startsWith('m=video ') || /^m=video\s+0(?:\s|$)/.test(section) ||
      /^a=(recvonly|inactive)\r?$/m.test(section)) return section;
    const lines = section.split(newline);
    const offered = new Set(lines[0].trim().split(/\s+/).slice(3));
    const payloads = lines.flatMap(line => {
      const match = /^a=rtpmap:(\d+)\s+(VP8|VP9|H264|AV1)\/90000\r?$/i.exec(line);
      return match && offered.has(match[1]) ? [match[1]] : [];
    });
    for (const payload of payloads) {
      const index = lines.findIndex(line => line.startsWith(`a=fmtp:${payload} `));
      if (index >= 0) {
        // Preserva uma indicação já presente no SDP.
        if (!/(?:\s|;)x-google-start-bitrate\s*=/i.test(lines[index])) {
          lines[index] += `;x-google-start-bitrate=${kbps}`;
        }
      } else {
        const rtpmap = lines.findIndex(line => line.startsWith(`a=rtpmap:${payload} `));
        lines.splice(rtpmap + 1, 0, `a=fmtp:${payload} x-google-start-bitrate=${kbps}`);
      }
    }
    return lines.join(newline);
  }).join('');
}

export async function setInitialVideoDescription(pc, offer, maxBitrate, options) {
  const sdp = withVideoStartBitrate(offer.sdp, maxBitrate, options);
  try {
    await pc.setLocalDescription({ type: offer.type, sdp });
  } catch (error) {
    if (sdp === offer.sdp || pc.signalingState !== 'stable') throw error;
    console.warn('[WebRTC] Taxa inicial não aceita; usando negociação padrão.', error);
    await pc.setLocalDescription(offer);
  }
}
