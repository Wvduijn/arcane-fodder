/**
 * Volunteer! (plan §4.2, GDD §11): the last wizard in the trail leaves the squad, sprints at the aim
 * point and goes off as an Arcane Detonation. Pure: it never touches the CombatWorld. Detonations
 * come back as data; the caller resolves each one with `volunteerBlast` through
 * `resolveAreaWithReactions` (arcane lights kegs, GDD Q6), then kills the volunteer with cause
 * `volunteer` (`killUnit`, death.ts) in the same flush.
 *
 * Death mid-sprint (GDD §11, §14): on `started`, the caller marks the runner
 * `world.setDeathCause(id, 'volunteer')` (world.ts), so whatever kills it records a volunteer's
 * death, once. Before flushing the frame's deaths, the caller runs `detonateFallen` and resolves
 * those blasts into the same flush: the runner a goblin killed goes off on that frame, where it
 * fell, and `volunteer:detonated` comes before its `unit:died` like any other detonation.
 *
 * API:
 * - `createVolunteer()`: cooldown ready, nobody sprinting.
 * - `pickVolunteer(roster)`: the last index, or null when fewer than 2 are in the squad. Never the
 *   leader.
 * - `detachVolunteer(squad, id, tuning)`: the follower leaves the roster and the trail compacts
 *   (followers behind it move up a slot, as on a death). The leader or an unknown id: unchanged.
 *   The unit stays alive in the CombatWorld, so enemies can still hit it. Spell loss falls out of
 *   availability.ts: the derived slots read the roster, so `spell:lost` fires from the usual diff.
 * - `activateVolunteer(state, squad, request, tuning, spells, trail)`: an F press, after
 *   `stepVolunteers`. In this order:
 *   1. No leader (wiped squad): `ignored` (`no-leader`).
 *   2. A channel runs: `denied` (`channel`). 3. Only the leader left: `denied` (`alone`).
 *   4. On cooldown: `denied` (`cooldown`). Emit `volunteer:denied` for every denial (HUD shake).
 *   5. No aim yet: `ignored` (`no-aim`).
 *   6. Otherwise `started`: the picked follower is detached and sprints from where it stands to the
 *      aim, clamped to `spells.maxCastRangePx` from the leader (like a spell), then into
 *      `request.walkable` (the squad's feet rect): the start and the aim are both inside it, so the
 *      straight sprint never leaves it. The cooldown starts. Emit `volunteer:started`.
 * - `stepVolunteers(state, input, tuning)`: one frame. The cooldown ticks; every runner, ascending
 *   id, detonates at the first of (GDD §11):
 *   - `death`: dead in the world (killed since the last step): where it fell, no move.
 *   - `contact`: its body touches a living body of `input.contacts` (enemy units, huts), at the
 *     exact touching point along this frame's straight-line move (swept, no tunnelling). With
 *     `input.collision` (M7), running into a blocker or a solid (keg, hut footprint) is a contact
 *     too, where its body first touches it (within 1/8 px): a rookie never runs through a tree.
 *   - `arrived`: it reaches the aim point.
 *   - `fuse`: `fuseMs` after activation, at the point it had reached by then.
 *   The move is `sprintSpeed` straight at the aim: no separation, no autos, no knockback. When
 *   two land on the same instant, the order above wins. Positions and timing don't depend on dt.
 * - `detonateFallen(state, isAlive)`: every runner dead in the world now detonates (`death`) where
 *   it stands and leaves the state. No time passes; the cooldown is left alone. Call it before the
 *   frame's death flush (see above). `stepVolunteers` still catches any it missed, a frame later.
 * - `volunteerBlast(detonation, tuning)`: the detonation as an area event: enemy units and huts
 *   only (never wizards, GDD Q7), credited to the volunteer (the meter charges, GDD §11).
 * - `volunteerCooldownMs(state)`: ≥ 0, for the HUD.
 * - `pickBark(count, rng, last)`: a bark index, never `last` again when there is more than one.
 */
import type { EntityId, Rect, SpellTuning, TrailTuning, Vec2, VolunteerTuning } from '@core/types';
import type { AreaBody, AreaEvent } from '@core/combat/area';
import {
  isReady,
  READY,
  tickCooldown,
  triggerCooldown,
  type Cooldown,
} from '@core/combat/cooldown';
import { clampToRect } from '@core/math/movement';
import { add, distance, normalize, scale, sub } from '@core/math/vec2';
import type { Rng } from '@core/rng/rng';
import { clampAim } from '@core/spells/caster';
import type { Roster } from '@core/squad/roster';
import { killSquadMembers, type SquadState } from '@core/squad/squad';
import type { CollisionGrid } from '@core/world/collisionGrid';

export interface VolunteerRunner {
  readonly id: EntityId;
  readonly position: Vec2;
  /** The clamped aim point. */
  readonly target: Vec2;
  readonly elapsedMs: number;
}

export interface VolunteerState {
  readonly cooldown: Cooldown;
  /** Ascending id. At most one with MVP tuning (cooldown 12 s, fuse 1.5 s). */
  readonly runners: readonly VolunteerRunner[];
}

export type DetonationReason = 'death' | 'contact' | 'arrived' | 'fuse';

export interface Detonation {
  readonly id: EntityId;
  readonly at: Vec2;
  readonly reason: DetonationReason;
}

export interface VolunteerRequest {
  readonly channelRunning: boolean;
  /** World-space aim, or null before the first pointer. */
  readonly aim: Vec2 | null;
  /** The rect the squad's feet stay in (follow.ts `walkable`). The aim is clamped into it. */
  readonly walkable?: Rect;
}

export type VolunteerOutcome =
  | { readonly kind: 'started'; readonly id: EntityId; readonly from: Vec2; readonly at: Vec2 }
  | { readonly kind: 'denied'; readonly reason: 'channel' | 'alone' | 'cooldown' }
  | { readonly kind: 'ignored'; readonly reason: 'no-leader' | 'no-aim' };

export interface VolunteerActivation {
  readonly state: VolunteerState;
  readonly squad: SquadState;
  readonly outcome: VolunteerOutcome;
}

export interface VolunteerStepInput {
  readonly dtMs: number;
  /** False once the runner died (CombatWorld). */
  readonly isAlive: (id: EntityId) => boolean;
  /** Bodies a runner detonates on touching: living enemy units and huts. Dead ones are skipped. */
  readonly contacts: readonly AreaBody[];
  /** The runner's own body (MovementTuning.wizardBodyRadiusPx). */
  readonly runnerRadiusPx: number;
  /** Blockers and solids (M7): touching one detonates. Absent: open ground. */
  readonly collision?: CollisionGrid;
}

export interface VolunteerStep {
  readonly state: VolunteerState;
  /** Ascending id. */
  readonly detonations: readonly Detonation[];
}

export function createVolunteer(): VolunteerState {
  return { cooldown: READY, runners: [] };
}

export function pickVolunteer(roster: Roster): EntityId | null {
  return roster.length < 2 ? null : (roster[roster.length - 1] ?? null);
}

export function detachVolunteer(squad: SquadState, id: EntityId, tuning: TrailTuning): SquadState {
  if (squad.members[0]?.id === id) return squad;
  return killSquadMembers(squad, [id], tuning).state;
}

export function activateVolunteer(
  state: VolunteerState,
  squad: SquadState,
  request: VolunteerRequest,
  tuning: VolunteerTuning,
  spells: SpellTuning,
  trail: TrailTuning,
): VolunteerActivation {
  const leader = squad.members[0];
  if (!leader) return { state, squad, outcome: { kind: 'ignored', reason: 'no-leader' } };
  if (request.channelRunning) return denied(state, squad, 'channel');
  const id = pickVolunteer(squad.members.map((m) => m.id));
  const runner = squad.members.find((m) => m.id === id);
  if (id === null || !runner) return denied(state, squad, 'alone');
  if (!isReady(state.cooldown)) return denied(state, squad, 'cooldown');
  if (!request.aim) return { state, squad, outcome: { kind: 'ignored', reason: 'no-aim' } };

  const reach = clampAim(leader.position, request.aim, spells.maxCastRangePx);
  const at = request.walkable ? clampToRect(reach, request.walkable, 0) : reach;
  const from = runner.position;
  return {
    state: {
      cooldown: triggerCooldown(state.cooldown, tuning.cooldownMs),
      runners: [...state.runners, { id, position: from, target: at, elapsedMs: 0 }].sort(
        (a, b) => a.id - b.id,
      ),
    },
    squad: detachVolunteer(squad, id, trail),
    outcome: { kind: 'started', id, from, at },
  };
}

export function stepVolunteers(
  state: VolunteerState,
  input: VolunteerStepInput,
  tuning: VolunteerTuning,
): VolunteerStep {
  const { dtMs } = input;
  if (dtMs <= 0) return { state, detonations: [] };
  const runners: VolunteerRunner[] = [];
  const detonations: Detonation[] = [];
  const bodies = input.contacts.filter((b) => b.alive);
  for (const r of state.runners) {
    const step = stepRunner(r, bodies, input, tuning);
    if ('detonation' in step) detonations.push(step.detonation);
    else runners.push(step.runner);
  }
  return {
    state: { cooldown: tickCooldown(state.cooldown, dtMs), runners },
    detonations,
  };
}

export function detonateFallen(
  state: VolunteerState,
  isAlive: (id: EntityId) => boolean,
): VolunteerStep {
  const fallen = state.runners.filter((r) => !isAlive(r.id));
  if (fallen.length === 0) return { state, detonations: [] };
  return {
    state: { ...state, runners: state.runners.filter((r) => isAlive(r.id)) },
    detonations: fallen.map((r) => ({ id: r.id, at: r.position, reason: 'death' })),
  };
}

export function volunteerBlast(detonation: Detonation, tuning: VolunteerTuning): AreaEvent {
  return {
    centre: detonation.at,
    blast: tuning.blast,
    sourceId: detonation.id,
    teams: ['enemy'],
  };
}

export function volunteerCooldownMs(state: VolunteerState): number {
  return Math.max(0, state.cooldown.remainingMs);
}

export function pickBark(count: number, rng: Rng, last: number | null): number {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`pickBark needs at least one bark, got ${String(count)}`);
  }
  if (count === 1 || last === null || last < 0 || last >= count) return rng.int(0, count - 1);
  const i = rng.int(0, count - 2);
  return i >= last ? i + 1 : i;
}

/** Float slack for fuse timers built from summed frame deltas (not a tuning value). */
const EPSILON_MS = 1e-6;
/** Float slack for touching and arriving, in px (not a tuning value). */
const EPSILON_PX = 1e-9;
/** Float slack on a swept wall distance, in px (not a tuning value). */
const SWEEP_SLACK_PX = 1e-6;

function denied(
  state: VolunteerState,
  squad: SquadState,
  reason: 'channel' | 'alone' | 'cooldown',
): VolunteerActivation {
  return { state, squad, outcome: { kind: 'denied', reason } };
}

function stepRunner(
  r: VolunteerRunner,
  bodies: readonly AreaBody[],
  input: VolunteerStepInput,
  tuning: VolunteerTuning,
): { readonly runner: VolunteerRunner } | { readonly detonation: Detonation } {
  const boom = (at: Vec2, reason: DetonationReason) => ({
    detonation: { id: r.id, at, reason },
  });
  if (!input.isAlive(r.id)) return boom(r.position, 'death');

  const fuseLeftMs = Math.max(0, tuning.fuseMs - r.elapsedMs);
  const travelMs = Math.min(input.dtMs, fuseLeftMs);
  const gap = distance(r.position, r.target);
  const reach = Math.min(gap, (tuning.sprintSpeed * travelMs) / 1000);
  const dir = gap > 0 ? normalize(sub(r.target, r.position)) : { x: 0, y: 0 };

  const body = firstContact(r.position, dir, reach, bodies, input.runnerRadiusPx);
  const wall = input.collision?.sweepCircle(
    r.position,
    add(r.position, scale(dir, reach)),
    input.runnerRadiusPx,
  );
  // The sweep's full length is `reach` up to float error: only a shorter one is a contact.
  const blocked = wall !== undefined && wall < reach - SWEEP_SLACK_PX ? wall : null;
  const touch = body !== null && (blocked === null || body <= blocked) ? body : blocked;
  if (touch !== null) return boom(add(r.position, scale(dir, touch)), 'contact');
  if (gap - reach <= EPSILON_PX) return boom(r.target, 'arrived');
  const position = add(r.position, scale(dir, reach));
  if (input.dtMs >= fuseLeftMs - EPSILON_MS) return boom(position, 'fuse');
  return { runner: { ...r, position, elapsedMs: r.elapsedMs + input.dtMs } };
}

/**
 * Distance along `dir` (0..reach) at which a circle of `radius` starting at `from` first touches a
 * body, or null. Already touching: 0.
 */
function firstContact(
  from: Vec2,
  dir: Vec2,
  reach: number,
  bodies: readonly AreaBody[],
  radius: number,
): number | null {
  let best: number | null = null;
  for (const b of bodies) {
    const touchAt = radius + b.bodyRadiusPx;
    const rel = sub(from, b.position);
    const c = rel.x * rel.x + rel.y * rel.y - touchAt * touchAt;
    let s: number | null;
    if (c <= 0) s = 0;
    else {
      // |rel + dir·s|² = touchAt², dir a unit vector (or zero: no move, no contact).
      const half = rel.x * dir.x + rel.y * dir.y;
      const disc = half * half - c;
      s = half >= 0 || disc < 0 ? null : -half - Math.sqrt(disc);
    }
    if (s !== null && s <= reach + EPSILON_PX && (best === null || s < best)) best = s;
  }
  return best;
}
