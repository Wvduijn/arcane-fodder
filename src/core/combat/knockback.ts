/**
 * Knockback (GDD §3, M4 Q2): a hit pushes its target `knockbackPx` along the hit direction, eased
 * out over `CombatTuning.knockbackMs`, so it reads as a shove, never a teleport.
 *
 * API:
 * - `startKnockback(direction, distancePx, durationMs)`: a new push, or null for distance ≤ 0 or a
 *   zero direction. A unit can carry several at once (two bolts in a row); they add up.
 * - `stepKnockbacks(list, dtMs)`: this frame's total displacement and the pushes still running.
 *   Ease-out quad: the total displacement of a push is exactly its distance, whatever the frame
 *   rate, and no frame moves more than 2 × distance × dt / duration. A duration ≤ 0 pushes in one
 *   step.
 * - `pushWithin(position, displacement, bounds, insetPx)`: adds the displacement (movement and
 *   knockback sum) and clamps the body circle inside `bounds`.
 */
import type { Rect, Vec2 } from '@core/types';
import { add, length, normalize, scale } from '@core/math/vec2';
import { clampToRect } from '@core/math/movement';

export interface Knockback {
  /** Unit vector. */
  readonly direction: Vec2;
  readonly distancePx: number;
  readonly durationMs: number;
  readonly elapsedMs: number;
}

export interface KnockbackStep {
  readonly displacement: Vec2;
  readonly active: readonly Knockback[];
}

export function startKnockback(
  direction: Vec2,
  distancePx: number,
  durationMs: number,
): Knockback | null {
  if (!(distancePx > 0) || length(direction) === 0) return null;
  return { direction: normalize(direction), distancePx, durationMs, elapsedMs: 0 };
}

export function stepKnockbacks(list: readonly Knockback[], dtMs: number): KnockbackStep {
  if (dtMs <= 0 || list.length === 0) return { displacement: { x: 0, y: 0 }, active: list };
  let displacement: Vec2 = { x: 0, y: 0 };
  const active: Knockback[] = [];
  for (const k of list) {
    const elapsedMs = k.elapsedMs + dtMs;
    const moved =
      k.distancePx * (progress(elapsedMs, k.durationMs) - progress(k.elapsedMs, k.durationMs));
    displacement = add(displacement, scale(k.direction, moved));
    if (elapsedMs < k.durationMs) active.push({ ...k, elapsedMs });
  }
  return { displacement, active };
}

export function pushWithin(
  position: Vec2,
  displacement: Vec2,
  bounds: Rect,
  insetPx: number,
): Vec2 {
  return clampToRect(add(position, displacement), bounds, insetPx);
}

/** Ease-out quad: fraction of the distance covered after `elapsedMs`. */
function progress(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return elapsedMs > 0 ? 1 : 0;
  const t = Math.min(1, Math.max(0, elapsedMs / durationMs));
  return 1 - (1 - t) * (1 - t);
}
