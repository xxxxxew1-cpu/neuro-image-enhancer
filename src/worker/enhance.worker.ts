/// <reference lib="webworker" />
import type {
  Engine,
  MainToWorker,
  TaskStatus,
  WorkerToMain,
} from '../api/types';
import { initBackend } from '../ml/backend';
import { EnhanceModel, MODEL_INPUT_SIZE } from '../ml/model';
import { heuristicAdjustments, isSane } from '../ml/fallback';
import { computeStats } from '../shared/stats';
import { temperAdjustments, type Adjustments } from '../shared/params';
import { decodeToBitmap } from '../process/decode';
import { capPixels, toThumbnail } from '../process/resize';
import { applyWebGL } from '../process/webglApply';
import { AbortError, applyCPU } from '../process/cpuApply';
import { canvasFromImageData, encodeCanvas } from '../process/encode';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let model: EnhanceModel | null = null;
let assetBase = '';
let initPromise: Promise<void> | null = null;
const aborted = new Set<string>();

function post(msg: WorkerToMain, transfer?: Transferable[]): void {
  ctx.postMessage(msg, transfer ?? []);
}

function init(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const backend = await initBackend();
      let modelLoaded = false;
      try {
        const url = new URL('models/enhance/model.json', assetBase).href;
        model = await EnhanceModel.load(url);
        modelLoaded = true;
      } catch {
        model = null; // app still works via the classical fallback
      }
      post({ type: 'ready', backend, modelLoaded });
    })();
  }
  return initPromise;
}

ctx.onmessage = (e: MessageEvent<MainToWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      assetBase = msg.assetBase;
      void init();
      break;
    case 'abort':
      aborted.add(msg.id);
      break;
    case 'process':
      void run(msg.id, msg.buffer, msg.mime, msg.options);
      break;
  }
};

function bitmapToImageData(bitmap: ImageBitmap, w: number, h: number): ImageData {
  const canvas = new OffscreenCanvas(w, h);
  const c = canvas.getContext('2d', { willReadFrequently: true })!;
  c.drawImage(bitmap, 0, 0);
  return c.getImageData(0, 0, w, h);
}

async function run(
  id: string,
  buffer: ArrayBuffer,
  mime: string,
  options: {
    format: 'image/jpeg' | 'image/png';
    quality: number;
    useML: boolean;
    strength: number;
  },
): Promise<void> {
  await init();
  const t0 = performance.now();
  let lastProgress = 0;
  const isAborted = () => aborted.has(id);
  const status = (s: TaskStatus, p: number) => {
    lastProgress = Math.round(p);
    post({ type: 'status', id, status: s, progress: lastProgress });
  };
  const bailIfAborted = (): boolean => {
    if (isAborted()) {
      post({ type: 'status', id, status: 'aborted', progress: lastProgress });
      return true;
    }
    return false;
  };

  try {
    if (bailIfAborted()) return;

    // 1. Decode -------------------------------------------------------------
    status('decoding', 5);
    const decoded = await decodeToBitmap(buffer, mime);
    const capped = capPixels(decoded.bitmap);
    status('decoding', 20);
    if (isAborted()) {
      capped.bitmap.close();
      post({ type: 'status', id, status: 'aborted', progress: lastProgress });
      return;
    }

    // 2. Analyze (pick parameters) -----------------------------------------
    status('analyzing', 22);
    const thumb = toThumbnail(capped.bitmap, MODEL_INPUT_SIZE);
    const stats = computeStats(thumb.data);
    let engine: Engine = 'heuristic';
    let adj: Adjustments = heuristicAdjustments(stats);
    if (options.useML && model) {
      try {
        const ml = model.predict(thumb);
        if (isSane(ml)) {
          adj = ml;
          engine = 'ml';
        }
      } catch {
        /* keep heuristic */
      }
    }
    // Soften toward identity + "do no harm" guard so good photos aren't degraded.
    adj = temperAdjustments(adj, options.strength);
    status('analyzing', 35);
    if (isAborted()) {
      capped.bitmap.close();
      post({ type: 'status', id, status: 'aborted', progress: lastProgress });
      return;
    }

    // 3. Enhance (apply to full resolution) --------------------------------
    status('enhancing', 36);
    let canvas = applyWebGL(capped.bitmap, capped.width, capped.height, adj);
    if (!canvas) {
      // CPU fallback — chunked, cancellable, reports progress.
      const full = bitmapToImageData(capped.bitmap, capped.width, capped.height);
      const out = await applyCPU(full, adj, (f) => status('enhancing', 36 + f * 49), isAborted);
      canvas = canvasFromImageData(out);
    } else {
      status('enhancing', 85);
    }
    capped.bitmap.close();
    if (bailIfAborted()) return;

    // 4. Encode -------------------------------------------------------------
    status('encoding', 90);
    const blob = await encodeCanvas(canvas, options.format, options.quality);
    status('encoding', 99);

    post({
      type: 'result',
      id,
      blob,
      adjustments: adj,
      engine,
      width: capped.width,
      height: capped.height,
      elapsedMs: performance.now() - t0,
    });
  } catch (err) {
    if (err instanceof AbortError || isAborted()) {
      post({ type: 'status', id, status: 'aborted', progress: lastProgress });
    } else {
      post({
        type: 'error',
        id,
        message: err instanceof Error ? err.message : 'Неизвестная ошибка обработки',
      });
    }
  } finally {
    aborted.delete(id);
  }
}
