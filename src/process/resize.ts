/** Hard cap from the spec: process images up to 15 megapixels. */
export const MAX_PIXELS = 15_000_000;

export interface Capped {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** True when the source was larger than {@link MAX_PIXELS} and got downscaled. */
  scaled: boolean;
}

function newCanvas(w: number, h: number): OffscreenCanvas {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas недоступен в этом браузере.');
  }
  return new OffscreenCanvas(w, h);
}

/**
 * If the bitmap exceeds the megapixel cap, downscale it (preserving aspect
 * ratio) so the rest of the pipeline honours the time budget. The original
 * bitmap is closed to free memory promptly.
 */
export function capPixels(bitmap: ImageBitmap, maxPixels = MAX_PIXELS): Capped {
  const total = bitmap.width * bitmap.height;
  if (total <= maxPixels) {
    return { bitmap, width: bitmap.width, height: bitmap.height, scaled: false };
  }
  const scale = Math.sqrt(maxPixels / total);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = newCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const scaled = canvas.transferToImageBitmap();
  bitmap.close();
  return { bitmap: scaled, width: w, height: h, scaled: true };
}

/**
 * Downscale to a `size × size` thumbnail and return its pixels. Used both as
 * the model input and for the classical statistics — global brightness /
 * contrast / saturation survive aggressive downscaling intact.
 */
export function toThumbnail(bitmap: ImageBitmap, size: number): ImageData {
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}
