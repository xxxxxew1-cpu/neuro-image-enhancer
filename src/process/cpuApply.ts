import type { Adjustments } from '../shared/params';
import { LUMA } from '../shared/params';

export class AbortError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}

/**
 * CPU fallback for the apply step (used when WebGL is unavailable or the image
 * exceeds the GPU texture limit). Mirrors `applyPixel` from
 * `src/shared/params.ts` but inlined over a typed array for speed, and chunked
 * so the worker can (a) report progress and (b) honour an abort request
 * mid-flight (yielding to the event loop lets queued messages run).
 */
export async function applyCPU(
  img: ImageData,
  adj: Adjustments,
  onProgress: (fraction: number) => void,
  isAborted: () => boolean,
): Promise<ImageData> {
  const d = img.data;
  const total = img.width * img.height;
  const B = adj.brightness;
  const C = adj.contrast;
  const S = adj.saturation;
  const lr = LUMA.r;
  const lg = LUMA.g;
  const lb = LUMA.b;

  // ~40 chunks → smooth progress without excessive yielding overhead.
  const chunkPixels = Math.max(50_000, Math.ceil(total / 40));

  for (let start = 0; start < total; start += chunkPixels) {
    if (isAborted()) throw new AbortError();
    const end = Math.min(total, start + chunkPixels);
    for (let i = start; i < end; i++) {
      const o = i * 4;
      let r = d[o] / 255;
      let g = d[o + 1] / 255;
      let b = d[o + 2] / 255;
      // brightness
      r *= B;
      g *= B;
      b *= B;
      // contrast
      r = (r - 0.5) * C + 0.5;
      g = (g - 0.5) * C + 0.5;
      b = (b - 0.5) * C + 0.5;
      // saturation
      const l = lr * r + lg * g + lb * b;
      r = l + (r - l) * S;
      g = l + (g - l) * S;
      b = l + (b - l) * S;
      // clamp + write back
      d[o] = r < 0 ? 0 : r > 1 ? 255 : r * 255;
      d[o + 1] = g < 0 ? 0 : g > 1 ? 255 : g * 255;
      d[o + 2] = b < 0 ? 0 : b > 1 ? 255 : b * 255;
    }
    onProgress(end / total);
    // Yield so the worker can process a pending 'abort' message.
    await new Promise((r) => setTimeout(r, 0));
  }
  return img;
}
