/**
 * Encode an OffscreenCanvas to a Blob. PNG is universally supported; for JPEG
 * we double-check the produced `blob.type` because some engines (notably
 * Safari for webp) silently ignore the requested type — if that happens we
 * fall back to PNG so the user always gets a valid file.
 */
export async function encodeCanvas(
  canvas: OffscreenCanvas,
  format: 'image/jpeg' | 'image/png',
  quality: number,
): Promise<Blob> {
  const blob = await canvas.convertToBlob({ type: format, quality });
  if (blob.type !== format && format !== 'image/png') {
    return canvas.convertToBlob({ type: 'image/png' });
  }
  return blob;
}

/** Put ImageData onto a fresh canvas so it can be encoded (CPU path). */
export function canvasFromImageData(img: ImageData): OffscreenCanvas {
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(img, 0, 0);
  return canvas;
}
