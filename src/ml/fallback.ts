import type { Adjustments } from '../shared/params';
import type { ImageStats } from '../shared/stats';

/** Targets a well-exposed, lively image aims for. Tuned empirically. */
const TARGET = {
  luma: 0.46, //          mid-tone target
  spread: 0.82, //        desired 1..99 percentile luma span
  saturation: 0.42, //    pleasant saturation
};

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Classical auto-correction used (a) while the model loads, (b) when the model
 * is unavailable, and (c) when the model produces out-of-range output. Pure
 * arithmetic on global stats — no dependencies, negligible cost. Conservative
 * clamps keep it from ever making an image worse.
 */
export function heuristicAdjustments(stats: ImageStats): Adjustments {
  // Brightness: scale mean luma toward the target (a gain multiplies the mean).
  const brightness = clamp(TARGET.luma / Math.max(stats.meanLuma, 0.02), 0.6, 1.7);

  // Contrast: stretch the 1..99 percentile span toward the target span.
  const span = Math.max(stats.p99 - stats.p1, 0.05);
  const contrast = clamp(TARGET.spread / span, 0.85, 1.5);

  // Saturation: lift dull images, leave already-saturated ones mostly alone.
  const saturation = clamp(TARGET.saturation / Math.max(stats.meanSaturation, 0.05), 0.85, 1.45);

  return { brightness, contrast, saturation };
}

/** Plausible bounds for model output; anything beyond → distrust the model. */
const SANE = {
  brightness: [0.45, 2.1] as const,
  contrast: [0.55, 1.8] as const,
  saturation: [0.45, 2.1] as const,
};

/** True when every factor sits inside its sane band. */
export function isSane(adj: Adjustments): boolean {
  return (
    adj.brightness >= SANE.brightness[0] &&
    adj.brightness <= SANE.brightness[1] &&
    adj.contrast >= SANE.contrast[0] &&
    adj.contrast <= SANE.contrast[1] &&
    adj.saturation >= SANE.saturation[0] &&
    adj.saturation <= SANE.saturation[1]
  );
}
