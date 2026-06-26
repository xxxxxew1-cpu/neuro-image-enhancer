import { isHeicMime, sniffMime } from '../shared/sniff';

export interface Decoded {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

// Apply the photo's EXIF orientation so the decoded pixels match how a browser
// would display the original (`<img>` auto-orients). Without this, phone photos
// come out rotated/flipped relative to the source. ('from-image' is the modern
// default, but older engines defaulted to 'none' — set it explicitly.)
const BITMAP_OPTS: ImageBitmapOptions = { imageOrientation: 'from-image' };

/**
 * Decode arbitrary image bytes to an ImageBitmap inside the worker.
 *  - JPG / PNG / BMP / GIF / WEBP → native `createImageBitmap` (every browser).
 *  - HEIC / HEIF → native `createImageBitmap` first (Safari 17.6+ fast path),
 *    then a dynamic, DOM-free `heic-to/next` (libheif WASM) fallback. The WASM
 *    (~3 MB) is only fetched when a HEIC is actually opened, keeping it out of
 *    the initial bundle.
 */
export async function decodeToBitmap(buffer: ArrayBuffer, mime: string): Promise<Decoded> {
  const head = new Uint8Array(buffer.slice(0, 32));
  const detected = sniffMime(head) ?? mime;
  const type = detected || 'application/octet-stream';
  const blob = new Blob([buffer], { type });

  if (isHeicMime(type)) {
    return decodeHeic(blob);
  }

  try {
    const bitmap = await createImageBitmap(blob, BITMAP_OPTS);
    return { bitmap, width: bitmap.width, height: bitmap.height };
  } catch (err) {
    // Mislabeled HEIC sometimes lands here.
    if (sniffMime(head) === 'image/heic') return decodeHeic(blob);
    throw new Error(
      `Не удалось декодировать изображение (${type}). Формат не поддерживается браузером.`,
    );
  }
}

async function decodeHeic(blob: Blob): Promise<Decoded> {
  // Native HEIC decode (Safari) — zero WASM cost when available.
  try {
    const bitmap = await createImageBitmap(blob, BITMAP_OPTS);
    return { bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    /* fall through to the WASM decoder */
  }
  // IMPORTANT: import the `/next` (DOM-free) build — the default entry uses
  // `document` and throws inside a worker.
  const { heicTo } = await import('heic-to/next');
  const bitmap = await heicTo({ blob, type: 'bitmap' });
  return { bitmap, width: bitmap.width, height: bitmap.height };
}
