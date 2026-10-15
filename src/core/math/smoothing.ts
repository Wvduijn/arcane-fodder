/** Frame-rate independent smoothing helpers. */

/**
 * Fraction (0..1) of the remaining gap to close this frame, for exponential smoothing with the
 * given half-life: 1 - 2^(-dt / halfLife). Applying it twice for 8 ms equals once for 16 ms.
 * A dt <= 0 returns 0 (no time passed, no movement), checked first. A halfLife <= 0 returns 1 (snap).
 */
export function dampFactor(halfLifeMs: number, dtMs: number): number {
  if (dtMs <= 0) return 0;
  if (halfLifeMs <= 0) return 1;
  return 1 - Math.pow(2, -dtMs / halfLifeMs);
}
