/**
 * Single source of truth for the enhancement math.
 *
 * The ML model predicts three normalized scalars in [-1, 1] (via tanh). Those
 * are mapped to multiplicative *factors* (1.0 = no change) and applied to the
 * image. The SAME math is replicated in three places, and they must stay in
 * sync:
 *   - training loss          → tf ops in `training/synth.mjs` + `model.mjs`
 *   - GPU apply (production)  → GLSL shader in `src/process/webglApply.ts`
 *   - CPU apply (fallback)    → JS loop in `src/process/cpuApply.ts`
 *
 * This file is the reference implementation; the others copy its formulas.
 */

/** Multiplicative correction factors. 1.0 means "leave channel untouched". */
export interface Adjustments {
  /** Exposure / brightness gain. */
  brightness: number;
  /** Contrast around mid-grey (0.5). */
  contrast: number;
  /** Colour saturation. */
  saturation: number;
}

/** Rec. 601 luma weights — used for the saturation operation. */
export const LUMA = { r: 0.299, g: 0.587, b: 0.114 } as const;

/**
 * Scales mapping a tanh output o ∈ [-1, 1] to a factor `exp(scale * o)`.
 * exp() keeps the mapping symmetric in log-space (halving and doubling are
 * equidistant) and guarantees strictly positive factors. The same ranges are
 * used to sample synthetic degradations during training, so the model only
 * ever has to predict corrections it can actually represent.
 */
export const FACTOR_SCALE = {
  brightness: 0.7, // exp(±0.7) ≈ [0.50, 2.01]
  contrast: 0.5, //   exp(±0.5) ≈ [0.61, 1.65]
  saturation: 0.7, // exp(±0.7) ≈ [0.50, 2.01]
} as const;

/** The neutral (no-op) adjustment. */
export const IDENTITY: Adjustments = { brightness: 1, contrast: 1, saturation: 1 };

/** Map a normalized model output [-1,1] to a factor for the given channel. */
export function outputToFactor(o: number, scale: number): number {
  return Math.exp(scale * o);
}

/** Map the model's 3 raw outputs (already in [-1,1]) to Adjustments. */
export function outputsToAdjustments(o: readonly [number, number, number]): Adjustments {
  return {
    brightness: outputToFactor(o[0], FACTOR_SCALE.brightness),
    contrast: outputToFactor(o[1], FACTOR_SCALE.contrast),
    saturation: outputToFactor(o[2], FACTOR_SCALE.saturation),
  };
}

/** Inverse of {@link outputToFactor} — used by the UI to show sliders / by tests. */
export function factorToOutput(factor: number, scale: number): number {
  return Math.log(Math.max(factor, 1e-6)) / scale;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Reference per-pixel transform on linear-ish [0,1] RGB. Order is fixed:
 * brightness → contrast → saturation → clamp. The GPU/CPU/training paths all
 * implement exactly this.
 */
export function applyPixel(
  r: number,
  g: number,
  b: number,
  adj: Adjustments,
): [number, number, number] {
  // 1. brightness (gain)
  r *= adj.brightness;
  g *= adj.brightness;
  b *= adj.brightness;
  // 2. contrast around mid-grey
  r = (r - 0.5) * adj.contrast + 0.5;
  g = (g - 0.5) * adj.contrast + 0.5;
  b = (b - 0.5) * adj.contrast + 0.5;
  // 3. saturation around luma
  const luma = LUMA.r * r + LUMA.g * g + LUMA.b * b;
  r = luma + (r - luma) * adj.saturation;
  g = luma + (g - luma) * adj.saturation;
  b = luma + (b - luma) * adj.saturation;
  return [clamp01(r), clamp01(g), clamp01(b)];
}

/**
 * Soften a correction toward identity (factor 1.0) and apply a "do no harm"
 * guard so the enhancer never flattens an already well-balanced image.
 *  - `strength` ∈ [0,1]: 1 = full predicted correction, 0 = no change. The pull
 *    is done in log-space (`f^strength`) so it stays symmetric for >1 and <1.
 *  - contrast has a floor near 1.0 because auto-enhancement reducing contrast
 *    almost always looks worse ("washed out").
 */
export function temperAdjustments(adj: Adjustments, strength = 0.7): Adjustments {
  const s = Math.max(0, Math.min(1, strength));
  const pull = (f: number) => Math.exp(Math.log(Math.max(f, 1e-3)) * s);
  return {
    brightness: pull(adj.brightness),
    contrast: Math.max(pull(adj.contrast), 0.97),
    saturation: pull(adj.saturation),
  };
}

/** Human-readable percentages for the UI ("яркость +12 %"). */
export function describeAdjustments(adj: Adjustments): {
  brightness: string;
  contrast: string;
  saturation: string;
} {
  const pct = (f: number) => {
    const d = Math.round((f - 1) * 100);
    return `${d > 0 ? '+' : ''}${d} %`;
  };
  return {
    brightness: pct(adj.brightness),
    contrast: pct(adj.contrast),
    saturation: pct(adj.saturation),
  };
}
