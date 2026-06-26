// Differentiable image ops + synthetic data generation for training.
//
// ⚠️  The math here MUST stay in sync with `src/shared/params.ts`
//     (apply order brightness → contrast → saturation, Rec.601 luma weights,
//      factor = exp(scale * tanhOutput)). The browser applies the SAME math.
//
// NOTE: uses the FUNCTIONAL tf API (tf.mul, tf.add, …) rather than chained
// tensor methods, which are not registered when importing only tfjs-core.
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';

export const LUMA = [0.299, 0.587, 0.114];
export const FACTOR_SCALE = [0.7, 0.5, 0.7]; // brightness, contrast, saturation

/** Map model outputs [-1,1] (tanh) to multiplicative factors via exp(scale·o). */
export function outputsToFactors(outputs) {
  return tf.exp(tf.mul(outputs, tf.tensor1d(FACTOR_SCALE)));
}

/**
 * Apply brightness/contrast/saturation to a batch of images.
 * @param images [n,h,w,3] in [0,1]
 * @param factors [n,3] = (B, C, S) — one scalar each, applied to all channels
 */
export function applyAdjustments(images, factors) {
  return tf.tidy(() => {
    const n = images.shape[0];
    const B = tf.reshape(tf.slice(factors, [0, 0], [n, 1]), [n, 1, 1, 1]);
    const C = tf.reshape(tf.slice(factors, [0, 1], [n, 1]), [n, 1, 1, 1]);
    const S = tf.reshape(tf.slice(factors, [0, 2], [n, 1]), [n, 1, 1, 1]);
    const w = tf.tensor1d(LUMA);

    let x = tf.mul(images, B); //                         brightness
    x = tf.add(tf.mul(tf.sub(x, 0.5), C), 0.5); //        contrast
    const luma = tf.sum(tf.mul(x, w), -1, true); //       saturation around luma
    x = tf.add(luma, tf.mul(tf.sub(x, luma), S));
    return tf.clipByValue(x, 0, 1);
  });
}

/** Random clip-safe degradation factors used to corrupt the clean targets. */
export function sampleDegradeFactors(n) {
  return tf.tidy(() => {
    const B = tf.randomUniform([n, 1], 0.65, 1.5);
    const C = tf.randomUniform([n, 1], 0.72, 1.4);
    const S = tf.randomUniform([n, 1], 0.6, 1.55);
    return tf.concat([B, C, S], 1);
  });
}

/**
 * Procedurally generate "well-exposed" target images: smooth multi-scale
 * colour fields, controlled good statistics (mean luma ~0.4–0.55, moderate
 * contrast & saturation), clip-safe in [0.03, 0.97]. The model learns to map a
 * degraded version back to this good distribution — i.e. to estimate and
 * remove global brightness/contrast/saturation deviations, which is content-
 * agnostic and transfers to real photos. Point this at a real photo corpus
 * (see training/README.md) for higher quality.
 */
export function genClean(n, size) {
  return tf.tidy(() => {
    const c8 = tf.randomUniform([n, 8, 8, 3]);
    const c2 = tf.randomUniform([n, 2, 2, 3]);
    let x = tf.add(
      tf.mul(tf.image.resizeBilinear(c8, [size, size]), 0.6),
      tf.mul(tf.image.resizeBilinear(c2, [size, size]), 0.4),
    );
    x = tf.add(x, tf.randomUniform([n, size, size, 3], -0.05, 0.05)); // mild texture

    // Per-image normalise to the full [0,1] range → GOOD contrast baseline.
    const mn = tf.min(x, [1, 2, 3], true);
    const mx = tf.max(x, [1, 2, 3], true);
    x = tf.div(tf.sub(x, mn), tf.add(tf.sub(mx, mn), 1e-5));

    // Keep punchy contrast (vary slightly around 1.0 — NOT reduced).
    const cc = tf.randomUniform([n, 1, 1, 1], 0.95, 1.15);
    x = tf.add(tf.mul(tf.sub(x, 0.5), cc), 0.5);

    // Shift to a random good mean luma.
    const w = tf.tensor1d(LUMA);
    const meanL = tf.mean(tf.sum(tf.mul(x, w), -1, true), [1, 2, 3], true);
    const target = tf.randomUniform([n, 1, 1, 1], 0.4, 0.55);
    x = tf.add(x, tf.sub(target, meanL));

    // Natural saturation (vary around 1.0 — NOT desaturated).
    const ss = tf.randomUniform([n, 1, 1, 1], 0.85, 1.12);
    const luma2 = tf.sum(tf.mul(x, w), -1, true);
    x = tf.add(luma2, tf.mul(tf.sub(x, luma2), ss));

    return tf.clipByValue(x, 0.02, 0.98);
  });
}

/**
 * One training batch: [degradedInput, cleanTarget]. A fraction of samples get
 * NO degradation (factors = 1) so the model learns to leave already-good images
 * alone (output ≈ identity) — "do no harm".
 */
export function genBatch(n, size, identityFrac = 0.3) {
  return tf.tidy(() => {
    const clean = genClean(n, size);
    let degrade = sampleDegradeFactors(n);
    const k = Math.floor(n * identityFrac);
    if (k > 0) {
      const ones = tf.ones([k, 3]);
      const rest = tf.slice(degrade, [k, 0], [n - k, 3]);
      degrade = tf.concat([ones, rest], 0);
    }
    const input = applyAdjustments(clean, degrade);
    return [input, clean];
  });
}

export { tf };
