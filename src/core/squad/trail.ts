/**
 * Breadcrumb trail of the leader's path (GDD §1). Immutable: every update returns a new Trail.
 *
 * Crumbs are dropped at exact `spacingPx` intervals of distance walked, interpolated inside long
 * frames. Distances along the trail are arc lengths: the head (the leader's current position)
 * is at 0, crumb i at `headArcPx + i × spacingPx`. Between two points the trail is a straight line.
 *
 * API:
 * - `createTrail(options, start)`: an empty trail, a single crumb at `start`.
 * - `seedStraight(options, start, behind, lengthPx)`: a straight trail from `start` back along `behind`.
 * - `advanceTrail(trail, to)`: the leader walked from `trail.head` straight to `to`.
 * - `pointAtDistance(trail, d)`: the point `d` px behind the head along the trail (clamped to the tail).
 * - `trailLength(trail)`: arc length from the head to the tail.
 * - `rebaseTo(trail, point, slotArcPx)`: cuts the trail `slotArcPx` behind the head (where the new
 *   leader's slot was) and runs it straight to `point`. Used on succession.
 * - `trailKeepLengthPx(tuning, squadSize)`: how much trail a squad of that size needs.
 */
import type { TrailTuning, Vec2 } from '@core/types';
import { distance, lerp, normalize } from '@core/math/vec2';

export interface TrailOptions {
  /** Distance walked between two crumbs. */
  readonly spacingPx: number;
  /** Older crumbs are dropped once the trail is longer than this. */
  readonly keepLengthPx: number;
}

export interface Trail extends TrailOptions {
  /** The leader's current position. */
  readonly head: Vec2;
  /** Newest first. Never empty. */
  readonly crumbs: readonly Vec2[];
  /** Distance walked since the newest crumb, in [0, spacingPx). */
  readonly headArcPx: number;
}

/** A trail with a single crumb at `start`, which is also the head. */
export function createTrail(options: TrailOptions, start: Vec2): Trail {
  assertOptions(options);
  return { ...pickOptions(options), head: start, crumbs: [start], headArcPx: 0 };
}

/**
 * A straight trail of at least `lengthPx` (whole crumbs, then trimmed to `keepLengthPx`), headed at
 * `start` and running in the direction `behind` (from the leader toward the tail). For spawning.
 */
export function seedStraight(
  options: TrailOptions,
  start: Vec2,
  behind: Vec2,
  lengthPx: number,
): Trail {
  assertOptions(options);
  const dir = normalize(behind);
  if (dir.x === 0 && dir.y === 0) throw new RangeError('seedStraight needs a non-zero direction');
  const count = Math.ceil(Math.max(0, lengthPx) / options.spacingPx) + 1;
  const crumbs = Array.from({ length: count }, (_, i) => ({
    x: start.x + dir.x * i * options.spacingPx,
    y: start.y + dir.y * i * options.spacingPx,
  }));
  return trim({ ...pickOptions(options), head: start, crumbs, headArcPx: 0 });
}

/**
 * The leader walked in a straight line from `trail.head` to `to`. Crumbs land at exact spacing along
 * that line. If `to` equals the head, the same trail is returned (no duplicate crumbs).
 */
export function advanceTrail(trail: Trail, to: Vec2): Trail {
  const from = trail.head;
  const segment = distance(from, to);
  if (segment === 0) return trail;
  const fresh: Vec2[] = [];
  let walked = trail.spacingPx - trail.headArcPx;
  while (walked <= segment) {
    fresh.push(lerpVec(from, to, walked / segment));
    walked += trail.spacingPx;
  }
  const headArcPx = segment - (walked - trail.spacingPx);
  fresh.reverse();
  return trim({ ...trail, head: to, crumbs: [...fresh, ...trail.crumbs], headArcPx });
}

/** The point `d` px behind the head, along the trail. `d <= 0` is the head; past the tail, the tail. */
export function pointAtDistance(trail: Trail, d: number): Vec2 {
  const first = crumbAt(trail, 0);
  if (d <= 0) return trail.head;
  if (d < trail.headArcPx) return lerpVec(trail.head, first, d / trail.headArcPx);
  const along = (d - trail.headArcPx) / trail.spacingPx;
  const i = Math.floor(along);
  const last = trail.crumbs.length - 1;
  if (i >= last) return crumbAt(trail, last);
  return lerpVec(crumbAt(trail, i), crumbAt(trail, i + 1), along - i);
}

/** Arc length from the head to the oldest crumb. */
export function trailLength(trail: Trail): number {
  return trail.headArcPx + (trail.crumbs.length - 1) * trail.spacingPx;
}

/**
 * Re-heads the trail at `point` for succession. `slotArcPx` is how far behind the head the new
 * leader's slot was (its old index × follower spacing). Everything ahead of that cut is dropped,
 * and the trail runs straight from the first crumb behind the cut to `point`. Cutting by arc, not
 * by nearest point, stays exact when the trail folds back on itself (reversals): a new leader on
 * its slot leaves every other slot where it was, and one off its slot moves them by at most that
 * offset. `slotArcPx` is clamped to the trail.
 */
export function rebaseTo(trail: Trail, point: Vec2, slotArcPx: number): Trail {
  const behindCut = Math.ceil((slotArcPx - trail.headArcPx) / trail.spacingPx);
  const keepFrom = Math.min(Math.max(0, behindCut), trail.crumbs.length - 1);
  const crumbs = trail.crumbs.slice(keepFrom);
  const restart: Trail = { ...trail, head: crumbs[0] ?? trail.head, crumbs, headArcPx: 0 };
  return advanceTrail(restart, point);
}

/**
 * Trail length a squad of `squadSize` needs: the last slot, (size − 1) × follower spacing, plus one
 * follower spacing of margin so the last slot never sits on the clamped tail while walking.
 */
export function trailKeepLengthPx(tuning: TrailTuning, squadSize: number): number {
  return Math.max(1, squadSize) * tuning.followerSpacingPx;
}

/** Drops crumbs that lie wholly past `keepLengthPx`; keeps one crumb at or past it. */
function trim(trail: Trail): Trail {
  const needed =
    Math.max(0, Math.ceil((trail.keepLengthPx - trail.headArcPx) / trail.spacingPx)) + 1;
  if (trail.crumbs.length <= needed) return trail;
  return { ...trail, crumbs: trail.crumbs.slice(0, needed) };
}

/** Crumb `i`. Crumbs are never empty; the head fallback only satisfies noUncheckedIndexedAccess. */
function crumbAt(trail: Trail, i: number): Vec2 {
  return trail.crumbs[i] ?? trail.head;
}

function lerpVec(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function pickOptions(options: TrailOptions): TrailOptions {
  return { spacingPx: options.spacingPx, keepLengthPx: options.keepLengthPx };
}

function assertOptions(options: TrailOptions): void {
  if (!(options.spacingPx > 0) || !(options.keepLengthPx >= 0)) {
    throw new RangeError('Trail needs spacingPx > 0 and keepLengthPx >= 0');
  }
}
