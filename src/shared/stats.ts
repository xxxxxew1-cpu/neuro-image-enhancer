import { LUMA } from './params';

/** Global image statistics computed on a small (e.g. 64×64) RGBA buffer. */
export interface ImageStats {
  /** Mean luma, 0..1. */
  meanLuma: number;
  /** 1st-percentile luma, 0..1. */
  p1: number;
  /** 99th-percentile luma, 0..1. */
  p99: number;
  /** Mean HSV saturation, 0..1. */
  meanSaturation: number;
}

/**
 * Compute global stats from an RGBA byte buffer. A downscaled thumbnail is
 * plenty — these are all global quantities.
 */
export function computeStats(rgba: Uint8ClampedArray | Uint8Array): ImageStats {
  const px = rgba.length / 4;
  const hist = new Float64Array(256);
  let lumaSum = 0;
  let satSum = 0;
  for (let i = 0; i < px; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const l = LUMA.r * r + LUMA.g * g + LUMA.b * b; // 0..255
    lumaSum += l;
    hist[Math.min(255, Math.max(0, Math.round(l)))]++;
    const max = r > g ? (r > b ? r : b) : g > b ? g : b;
    const min = r < g ? (r < b ? r : b) : g < b ? g : b;
    satSum += max === 0 ? 0 : (max - min) / max;
  }
  const meanLuma = lumaSum / px / 255;
  const meanSaturation = satSum / px;

  // Percentiles from the cumulative histogram.
  const lowCount = px * 0.01;
  const highCount = px * 0.99;
  let cum = 0;
  let p1 = 0;
  let p99 = 255;
  let foundP1 = false;
  for (let v = 0; v < 256; v++) {
    cum += hist[v];
    if (!foundP1 && cum >= lowCount) {
      p1 = v;
      foundP1 = true;
    }
    if (cum >= highCount) {
      p99 = v;
      break;
    }
  }
  return { meanLuma, p1: p1 / 255, p99: p99 / 255, meanSaturation };
}
