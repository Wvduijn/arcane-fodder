/**
 * Target selection (GDD §0, §3). Used by wizard auto-attacks and by goblin brains.
 *
 * API:
 * - `selectTarget(from, rangePx, candidates, visible?)`: the nearest living candidate whose centre
 *   is within `rangePx` (≤, centre to centre). Units win over structures: a structure (hut) is
 *   picked only when no unit is in range. Kegs are never picked (GDD Q12). Ties break by lowest
 *   EntityId. Null if nothing qualifies. Pass `Infinity` for "no range limit" (a goblin with no
 *   leash). With `visible` (M7, CD Q3), a candidate it rejects (behind a blocker) doesn't qualify,
 *   so a hut is the fallback only when no *visible* unit is in range.
 * - `lineOfSightTo(grid, from, candidate)`: the CD Q3 sight test: blockers and huts block, kegs
 *   don't; a structure's own footprint never hides it.
 * - `shouldRetarget(sinceRetargetMs, retargetMs, targetValid)`: re-pick now? True when the interval
 *   has run out, or at once when the current target is no longer valid (dead, gone, or none).
 *
 * The caller passes only the opposing side's candidates; `alive: false` ones are skipped (D4).
 */
import type { EntityId, Vec2 } from '@core/types';
import { distance } from '@core/math/vec2';
import type { CollisionGrid } from '@core/world/collisionGrid';

/** What a candidate is. Kegs exist so they can be excluded by type (GDD Q12). */
export type TargetKind = 'unit' | 'structure' | 'keg';

export interface TargetCandidate {
  readonly id: EntityId;
  readonly position: Vec2;
  readonly kind: TargetKind;
  readonly alive: boolean;
}

/** Nearest living unit in range, else nearest living structure in range, never a keg. */
export function selectTarget(
  from: Vec2,
  rangePx: number,
  candidates: readonly TargetCandidate[],
  visible?: (candidate: TargetCandidate) => boolean,
): EntityId | null {
  return (
    nearest(from, rangePx, candidates, 'unit', visible) ??
    nearest(from, rangePx, candidates, 'structure', visible)
  );
}

/** Can `from` see the candidate? A structure is seen through its own footprint. */
export function lineOfSightTo(
  grid: CollisionGrid,
  from: Vec2,
  candidate: Pick<TargetCandidate, 'id' | 'position' | 'kind'>,
): boolean {
  return candidate.kind === 'structure'
    ? grid.lineOfSight(from, candidate.position, candidate.id)
    : grid.lineOfSight(from, candidate.position);
}

/** Re-pick when the interval is up, or at once when the target is invalid. */
export function shouldRetarget(
  sinceRetargetMs: number,
  retargetMs: number,
  targetValid: boolean,
): boolean {
  return !targetValid || sinceRetargetMs >= retargetMs;
}

function nearest(
  from: Vec2,
  rangePx: number,
  candidates: readonly TargetCandidate[],
  kind: TargetKind,
  visible: ((candidate: TargetCandidate) => boolean) | undefined,
): EntityId | null {
  let best: EntityId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    if (!c.alive || c.kind !== kind) continue;
    const d = distance(from, c.position);
    if (d > rangePx) continue;
    if (d > bestDistance || (d === bestDistance && best !== null && c.id > best)) continue;
    // Sight is the costly test: only for a candidate that would win.
    if (visible && !visible(c)) continue;
    best = c.id;
    bestDistance = d;
  }
  return best;
}
