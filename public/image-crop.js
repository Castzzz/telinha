// Posição relativa à sobra da imagem: 0 = início, 1 = fim; zoom nunca deixa bordas vazias.
export function normalizeImageCrop(raw) {
  const number = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value)) : fallback;
  return {
    x: number(raw?.x, 0.5, 0, 1),
    y: number(raw?.y, 0.5, 0, 1),
    zoom: number(raw?.zoom, 1, 1, 4)
  };
}

export function imageCropRect(width, height, aspect, raw) {
  const { x, y, zoom } = normalizeImageCrop(raw);
  const w = Math.min(width, height * aspect) / zoom;
  const h = w / aspect;
  return { x: (width - w) * x, y: (height - h) * y, width: w, height: h };
}

// Equivale ao recorte do canvas, preservando todos os frames dos GIFs.
export function imageCropStyle(raw) {
  const { x, y, zoom } = normalizeImageCrop(raw);
  return `width:${zoom * 100}%;height:${zoom * 100}%;left:${(1 - zoom) * x * 100}%;top:${(1 - zoom) * y * 100}%;object-position:${x * 100}% ${y * 100}%;`;
}
