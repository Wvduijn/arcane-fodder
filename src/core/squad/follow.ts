/**
 * Follow steering (GDD §1): each follower walks to its trail slot without bunching, jitter,
 * creeping or teleporting.
 *
 * API:
 * - `stepSquad(state, input, tuning, movement)`: the leader is placed at `input.leaderPosition`
 *   (already moved and clamped by the caller), the trail records the move, and every follower
 *   steers one step. Followers are clamped to `input.walkable`, the same feet rect as the leader.
 *
 * Knockback (M5, GDD §8 Kaboom): a member with running pushes (`knockSquadMember`) is moved by this
 * frame's knockback displacement only, clamped to `input.walkable`; its own movement is suspended
 * until the last push ends. For the leader that means `input.leaderPosition` is ignored (input
 * resumes on the frame after); for a follower, steering is skipped (follow resumes after). The
 * trail records the pushed leader like any other move. Others still yield to and separate from a
 * pushed member at its new position. Dead wizards are not in the squad, so they never move.
 *
 * Hold (M6, GDD §10 Convergence channel): with `input.held`, nobody walks. The leader ignores
 * `input.leaderPosition` and every follower stands still (velocity exactly 0), but running
 * knockback pushes still play out (a Kaboom can shove a channelling wizard). Follow resumes from
 * wherever each follower stands on the first step without `held`.
 *
 * Steering, per follower k (velocities in px/s; S = squadMoveSpeed):
 * 1. Follow. The slot's own velocity (feed-forward, so a follower on a moving slot stays on it)
 *    plus a correction for the lag behind it: S × lag / arriveRadius inside the arrive radius,
 *    S beyond it, never more than closes the lag this step. Beyond catchUpDistance the follower
 *    heads straight for the slot at S × catchUpMultiplier. The total is capped at that speed.
 * 2. Yield. Members ahead in the line (lower index, leader included) have right of way: a follower
 *    walks up to touching one and no further. While its slot moves, it steps around it instead.
 * 3. Separation. Each overlapping member ahead pushes the follower away, ramping up over the
 *    first stopRadius px of overlap to the cap S × separationMaxSpeedFactor (total also capped,
 *    and never more than the overlap per step). Only lower indexes push, so the leader is never
 *    pushed and the line settles front to back without two followers fighting.
 * 4. Rest. If the slot didn't move this step and the resulting speed is at most the arrive speed at
 *    the stop radius (S × stopRadius / arriveRadius), the follower stops: velocity exactly 0, same
 *    position. Inside the arrive radius that is exactly "within stopRadius of a resting slot".
 * 5. Fallback. If, while its slot moves, the steered position would still overlap a member ahead
 *    (walls blocking a sidestep, several members in the way, a succession mid-turn), the follower
 *    takes the least-overlapping position it can reach this step instead; see leastOverlapping.
 *
 * Collision (M7, GDD §1): with `input.collision`, every wizard is a circle of `bodyRadiusPx` on the
 * tile grid (collisionGrid.ts). `input.leaderPosition` is then where the leader *wants* to go: it
 * walks there from where it stands and slides along blockers (`moveCircle`). Followers steer by
 * the same rules as above and their resulting move slides the same way, so a follower is pushed
 * out of solids and never cuts through a tree; the breadcrumbs only go where the leader walked,
 * so the trail itself is always walkable (no path-finding, GDD §1). Knockback pushes slide too.
 * Without `collision` nothing changes (open ground, the M3–M6 behaviour).
 *
 * Bound: a step is at most (S × catchUpMultiplier + S × separationMaxSpeedFactor) × dt long.
 * Known limit: a follower pinned between the leader and a corner, or between the leader, a wall and
 * a follower ahead, can still overlap past 6 px; no single step gets it past the leader (that
 * would need path planning). Seen only in small rooms (about one view, 640×360).
 */
import type { MovementTuning, Rect, TrailTuning, Vec2 } from '@core/types';
import { stepKnockbacks } from '@core/combat/knockback';
import { clampToRect } from '@core/math/movement';
import { add, distance, length, normalize, scale, sub } from '@core/math/vec2';
import { advanceTrail, pointAtDistance } from '@core/squad/trail';
import { slotDistancePx, type SquadMember, type SquadState } from '@core/squad/squad';
import type { CollisionGrid } from '@core/world/collisionGrid';

/** Tile collision for the squad step (M7). */
export interface SquadCollision {
  readonly grid: CollisionGrid;
  /** MovementTuning.wizardBodyRadiusPx. */
  readonly bodyRadiusPx: number;
}

export interface SquadStepInput {
  /** The leader's new position, already stepped from input and clamped by the caller. */
  readonly leaderPosition: Vec2;
  /**
   * The rect the feet must stay in, the same one the caller clamps the leader to (already inset for
   * the body radius and HUD). Followers are clamped to it with no further inset, so every
   * breadcrumb the leader drops is reachable.
   */
  readonly walkable: Rect;
  readonly dtMs: number;
  /** The squad stands still: no input, no follow, knockback only (Convergence channel). */
  readonly held?: boolean;
  /** Blockers and dynamic solids (M7). Absent: open ground. */
  readonly collision?: SquadCollision;
}

const ZERO: Vec2 = { x: 0, y: 0 };

/** One frame of squad movement. A dt <= 0 or an empty squad returns `state` unchanged. */
export function stepSquad(
  state: SquadState,
  input: SquadStepInput,
  tuning: TrailTuning,
  movement: MovementTuning,
): SquadState {
  const leader = state.members[0];
  if (input.dtMs <= 0 || !leader) return state;
  const dt = input.dtMs / 1000;
  const leaderMove = knockedBack(leader, input) ?? {
    position:
      input.held === true ? leader.position : slide(leader.position, input.leaderPosition, input),
    knockbacks: leader.knockbacks,
  };
  const trail = advanceTrail(state.trail, leaderMove.position);
  const moved: SquadMember[] = [
    {
      id: leader.id,
      position: leaderMove.position,
      velocity: scale(sub(leaderMove.position, leader.position), 1 / dt),
      knockbacks: leaderMove.knockbacks,
    },
  ];
  for (const [k, member] of state.members.entries()) {
    if (k === 0) continue;
    const pushed = knockedBack(member, input);
    if (pushed) {
      moved.push({
        id: member.id,
        position: pushed.position,
        velocity: scale(sub(pushed.position, member.position), 1 / dt),
        knockbacks: pushed.knockbacks,
      });
      continue;
    }
    if (input.held === true) {
      moved.push({ ...member, velocity: ZERO });
      continue;
    }
    const prevSlot = pointAtDistance(state.trail, slotDistancePx(tuning, k));
    const slot = pointAtDistance(trail, slotDistancePx(tuning, k));
    const slotAtRest = prevSlot.x === slot.x && prevSlot.y === slot.y;

    const ahead = moved.map((m) => m.position);
    const follow = yieldTo(
      member.position,
      followVelocity(member.position, prevSlot, slot, dt, tuning, movement),
      ahead,
      !slotAtRest,
      dt,
      tuning,
    );
    const velocity = add(follow, separation(member.position, ahead, dt, tuning, movement));

    if (slotAtRest && length(velocity) <= restSpeed(tuning, movement)) {
      moved.push({ ...member, velocity: ZERO });
      continue;
    }
    let position = clampToRect(add(member.position, scale(velocity, dt)), input.walkable, 0);
    if (!slotAtRest && overlapWith(position, ahead, tuning) > 0) {
      position = leastOverlapping(
        member.position,
        position,
        ahead,
        input.walkable,
        dt,
        tuning,
        movement,
      );
    }
    position = slide(member.position, position, input);
    moved.push({
      id: member.id,
      position,
      velocity: scale(sub(position, member.position), 1 / dt),
      knockbacks: member.knockbacks,
    });
  }
  return { members: moved, trail };
}

/** This frame's knockback move for a member with running pushes, or null when it has none. */
function knockedBack(
  member: SquadMember,
  input: SquadStepInput,
): Pick<SquadMember, 'position' | 'knockbacks'> | null {
  if (member.knockbacks.length === 0) return null;
  const step = stepKnockbacks(member.knockbacks, input.dtMs);
  const pushed = clampToRect(add(member.position, step.displacement), input.walkable, 0);
  return { position: slide(member.position, pushed, input), knockbacks: step.active };
}

/** The move from `from` to `to`, sliding along solids when the step has collision. */
function slide(from: Vec2, to: Vec2, input: SquadStepInput): Vec2 {
  const c = input.collision;
  return c ? c.grid.moveCircle(from, to, c.bodyRadiusPx) : to;
}

/** Speed at or below which a follower on a resting slot stops: the arrive speed at the stop radius. */
function restSpeed(tuning: TrailTuning, movement: MovementTuning): number {
  return (movement.squadMoveSpeed * tuning.stopRadiusPx) / tuning.arriveRadiusPx;
}

/**
 * Step 1: slot feed-forward plus arrive correction, or a straight catch-up when far away. The
 * correction acts on the lag behind the slot before this step's slot motion, which the
 * feed-forward already covers, so a follower standing on a moving slot stays exactly on it.
 */
function followVelocity(
  position: Vec2,
  prevSlot: Vec2,
  slot: Vec2,
  dt: number,
  tuning: TrailTuning,
  movement: MovementTuning,
): Vec2 {
  const speed = movement.squadMoveSpeed;
  const maxSpeed = speed * tuning.catchUpMultiplier;
  const toSlot = sub(slot, position);
  if (length(toSlot) > tuning.catchUpDistancePx) return scale(normalize(toSlot), maxSpeed);
  const lag = sub(prevSlot, position);
  const dist = length(lag);
  const arrive = dist < tuning.arriveRadiusPx ? (speed * dist) / tuning.arriveRadiusPx : speed;
  const correction = scale(normalize(lag), Math.min(arrive, dist / dt));
  const slotVelocity = scale(sub(slot, prevSlot), 1 / dt);
  return capLength(add(slotVelocity, correction), maxSpeed);
}

/**
 * Step 2: a follower may approach a member ahead only until their bodies touch: the approach speed
 * is capped at gap / dt (0 once overlapping). While the slot moves (`sidestep`), the capped part
 * is turned sideways instead, keeping the same speed, so a follower whose slot passes through a
 * member ahead (the leader reversing) walks around it rather than waiting to be run over. The side
 * follows the velocity's own sideways component; with none (head-on), it is the push direction
 * rotated by +90°, so the choice is deterministic.
 */
function yieldTo(
  position: Vec2,
  velocity: Vec2,
  ahead: readonly Vec2[],
  sidestep: boolean,
  dt: number,
  tuning: TrailTuning,
): Vec2 {
  let v = velocity;
  for (const other of ahead) {
    const away = sub(position, other);
    const d = length(away);
    if (d === 0) continue;
    const n = scale(away, 1 / d);
    const approach = -(v.x * n.x + v.y * n.y);
    const allowed = Math.max(0, d - tuning.separationRadiusPx) / dt;
    if (approach <= allowed) continue;
    const slide = add(v, scale(n, approach));
    if (!sidestep) {
      v = sub(slide, scale(n, allowed));
      continue;
    }
    const speed = length(v);
    const side = n.x * slide.y - n.y * slide.x >= 0 ? 1 : -1;
    const sideways = Math.sqrt(Math.max(0, speed * speed - allowed * allowed));
    v = add(scale(n, -allowed), scale({ x: -n.y * side, y: n.x * side }, sideways));
  }
  return v;
}

/** Step 3: push away from overlapping members ahead, ramped over stopRadius px, capped. */
function separation(
  position: Vec2,
  ahead: readonly Vec2[],
  dt: number,
  tuning: TrailTuning,
  movement: MovementTuning,
): Vec2 {
  const cap = movement.squadMoveSpeed * tuning.separationMaxSpeedFactor;
  let push = ZERO;
  for (const other of ahead) {
    const d = distance(position, other);
    const overlap = tuning.separationRadiusPx - d;
    if (overlap <= 0) continue;
    // Exactly on top of each other: push along +x, so the result stays deterministic.
    const away = d === 0 ? { x: 1, y: 0 } : scale(sub(position, other), 1 / d);
    const strength = Math.min(cap * Math.min(1, overlap / tuning.stopRadiusPx), overlap / dt);
    push = add(push, scale(away, strength));
  }
  return capLength(push, cap);
}

/** Total body overlap, in px, of a follower at `p` with the given members. */
function overlapWith(p: Vec2, ahead: readonly Vec2[], tuning: TrailTuning): number {
  let total = 0;
  for (const other of ahead) total += Math.max(0, tuning.separationRadiusPx - distance(p, other));
  return total;
}

/** Step 5 candidates: 16 evenly spaced directions, in angle order from +x. */
const FALLBACK_DIRECTIONS: readonly Vec2[] = Array.from({ length: 16 }, (_, i) => ({
  x: Math.cos((i * Math.PI) / 8),
  y: Math.sin((i * Math.PI) / 8),
}));

/**
 * Step 5: the steered position `desired` would overlap a member ahead. Candidates, in order: the
 * steered position, standing still, and a full step-cap move in each of 16 directions, all
 * clamped to the walkable rect. Acceptable candidates overlap by at most stopRadiusPx in total, or
 * by the least any candidate achieves if that is more. Of those, it takes the one closest to
 * `desired` (earlier candidate on a tie). The tolerance is absolute, not relative to the best,
 * so overlap can't ratchet up a little every frame.
 */
function leastOverlapping(
  from: Vec2,
  desired: Vec2,
  ahead: readonly Vec2[],
  walkable: Rect,
  dt: number,
  tuning: TrailTuning,
  movement: MovementTuning,
): Vec2 {
  const reach = stepCapSpeed(tuning, movement) * dt;
  const candidates = [
    desired,
    from,
    ...FALLBACK_DIRECTIONS.map((d) =>
      clampToRect({ x: from.x + d.x * reach, y: from.y + d.y * reach }, walkable, 0),
    ),
  ];
  const overlaps = candidates.map((c) => overlapWith(c, ahead, tuning));
  const tolerated = Math.max(Math.min(...overlaps), tuning.stopRadiusPx);
  let best = desired;
  let bestDistance = Number.POSITIVE_INFINITY;
  candidates.forEach((c, i) => {
    if ((overlaps[i] ?? Number.POSITIVE_INFINITY) > tolerated) return;
    const d = distance(c, desired);
    if (d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  });
  return best;
}

/** The longest a follower step may be, per second: catch-up speed plus the separation cap. */
function stepCapSpeed(tuning: TrailTuning, movement: MovementTuning): number {
  return movement.squadMoveSpeed * (tuning.catchUpMultiplier + tuning.separationMaxSpeedFactor);
}

function capLength(v: Vec2, max: number): Vec2 {
  const len = length(v);
  return len > max ? scale(v, max / len) : v;
}
