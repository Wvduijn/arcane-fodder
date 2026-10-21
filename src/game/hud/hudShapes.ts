import Phaser from 'phaser';

/** A horizontal widget-only shake (readability.md §5b denied shake). */
export interface HudShake {
  readonly amplitudePx: number;
  readonly durationMs: number;
  readonly cycles: number;
}

/** §5b: 3 px, 200 ms, 2 full cycles, amplitude easing out linearly, whole px. */
export const DENIED_SHAKE: HudShake = { amplitudePx: 3, durationMs: 200, cycles: 2 } as const;

/**
 * During a Convergence channel the spell slots and the Volunteer slot get an `ink` 40% overlay
 * ("all power is going into the ultimate", readability.md §5c).
 */
export const CHANNEL_DIM_ALPHA = 0.4;

/** Whole-pixel x offset of a shake with `remainingMs` left (0 when none runs). */
export function shakeOffsetPx(remainingMs: number, shake: HudShake): number {
  if (remainingMs <= 0) return 0;
  const { durationMs, amplitudePx, cycles } = shake;
  const t = 1 - remainingMs / durationMs;
  return Math.round(Math.sin(t * cycles * Math.PI * 2) * amplitudePx * (1 - t));
}

/**
 * Polygon of a clockwise pie from 12 o'clock covering `fraction` of a square of half-size `half`
 * (local 0..2·half), clipped to the square: rays are projected onto its edges, corners included.
 */
export function squareSweep(half: number, fraction: number): Phaser.Math.Vector2[] {
  const start = -Math.PI / 2;
  const end = start + fraction * Math.PI * 2;
  const quarter = Math.PI / 4;
  const angles = [start];
  // Every corner (odd multiples of 45°) inside the range keeps the clip exact.
  for (let k = Math.ceil((start - quarter) / (2 * quarter)); ; k++) {
    const corner = quarter + k * 2 * quarter;
    if (corner >= end) break;
    if (corner > start) angles.push(corner);
  }
  angles.push(end);
  const points = [new Phaser.Math.Vector2(half, half)];
  for (const angle of angles) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const t = half / Math.max(Math.abs(dx), Math.abs(dy));
    points.push(new Phaser.Math.Vector2(half + dx * t, half + dy * t));
  }
  return points;
}
