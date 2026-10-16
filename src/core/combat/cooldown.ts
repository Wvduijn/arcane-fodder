/**
 * Attack cooldowns (GDD §3). Frame-rate independent: the time a cooldown overshoots zero on the
 * frame it runs out is carried into the next trigger, so a weapon fires at the same average rate at
 * 30, 60 and 144 fps. The carry only survives until the next tick: a cooldown that sits ready (no
 * target) drops it, so it never banks shots and a late first shot is never early.
 *
 * API:
 * - `READY`: a cooldown that can fire now. Every attack starts ready (GDD §3: the first attack fires
 *   as soon as a target is acquired).
 * - `tickCooldown(cd, dtMs)`: counts down. Cooldowns tick while moving and without a target.
 * - `isReady(cd)`: remaining ≤ 0.
 * - `triggerCooldown(cd, cooldownMs)`: fire now; the next shot is `cooldownMs` minus the carry away.
 */

export interface Cooldown {
  /** ms until ready. ≤ 0 when ready; the negative part is this frame's overshoot (carry). */
  readonly remainingMs: number;
}

export const READY: Cooldown = { remainingMs: 0 };

/**
 * Counts down by `dtMs`. On the frame it runs out it may cross below zero by at most that frame's
 * dt (the carry); a tick on a cooldown that was already ready drops the carry to 0.
 */
export function tickCooldown(cd: Cooldown, dtMs: number): Cooldown {
  if (dtMs <= 0) return cd;
  if (cd.remainingMs <= 0) return cd.remainingMs === 0 ? cd : READY;
  return { remainingMs: cd.remainingMs - dtMs };
}

export function isReady(cd: Cooldown): boolean {
  return cd.remainingMs <= 0;
}

/** Starts the next cooldown, keeping the overshoot so the long-run rate is exact. */
export function triggerCooldown(cd: Cooldown, cooldownMs: number): Cooldown {
  return { remainingMs: cooldownMs + Math.min(0, cd.remainingMs) };
}
