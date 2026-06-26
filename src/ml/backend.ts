/**
 * TensorFlow.js runtime setup for the worker.
 *
 * The model is tiny (64×64 input, ~3 scalar outputs), so the pure-JS CPU
 * backend is more than fast enough (single-digit-ms inference) and works in
 * every browser and every worker without shipping/serving any `.wasm` assets
 * or requiring cross-origin isolation. The heavy, full-resolution pixel work
 * is NOT done by tfjs — it is a hand-written WebGL shader (see
 * `src/process/webglApply.ts`) with a pure-JS fallback.
 */
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';

let readyPromise: Promise<string> | null = null;

/** Initialise the backend once; resolves with the active backend name. */
export function initBackend(): Promise<string> {
  if (!readyPromise) {
    readyPromise = (async () => {
      await tf.setBackend('cpu');
      await tf.ready();
      return tf.getBackend();
    })();
  }
  return readyPromise;
}

export { tf };
