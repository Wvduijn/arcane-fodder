/**
 * Authoritative squad state: who is in the squad, in what order, where they stand, and the trail
 * they follow (GDD §1, §2). Immutable. `stepSquad` in follow.ts moves it each frame.
 *
 * API:
 * - `createSquad(spawn, tuning)`: a squad in single file behind the leader, every follower on its slot.
 * - `killSquadMembers(state, ids, tuning)`: one frame's deaths. The survivors compact; when the leader
 *   dies, the lowest surviving index leads and the trail is rebased to it (GDD §2).
 * - `slotDistancePx(tuning, index)`: how far behind the leader, along the trail, slot `index` is.
 * - `slotPosition(state, index, tuning)`: where slot `index` currently is (debug lines, slot error).
 * - `knockSquadMember(state, id, direction, distancePx, durationMs)`: adds a knockback push to a
 *   living member, leader included (Kaboom, GDD §8, M5). A no-op for an unknown or dead id (dead
 *   wizards are not in the squad) and for a zero distance or direction. `stepSquad` (follow.ts)
 *   plays the push out; see there for how it replaces input and follow while it runs.
 */
import type { EntityId, TrailTuning, Vec2 } from '@core/types';
import { startKnockback, type Knockback } from '@core/combat/knockback';
import { createRoster, killMembers, type RosterKillResult } from '@core/squad/roster';
import {
  pointAtDistance,
  rebaseTo,
  seedStraight,
  trailKeepLengthPx,
  type Trail,
} from '@core/squad/trail';

export interface SquadMember {
  readonly id: EntityId;
  readonly position: Vec2;
  /** Movement over the last step in px/s. Exactly {0,0} when the wizard stood still. */
  readonly velocity: Vec2;
  /** Running knockback pushes (knockback.ts). Empty when none. */
  readonly knockbacks: readonly Knockback[];
}

export interface SquadState {
  /** Index 0 is the leader, 1..n follow in trail order. Empty when the squad is wiped. */
  readonly members: readonly SquadMember[];
  /** The leader's path. Its head is the leader's position. */
  readonly trail: Trail;
}

export interface SquadSpawn {
  /** Leader first. Must be unique. */
  readonly ids: readonly EntityId[];
  readonly leaderPosition: Vec2;
  /** Direction from the leader toward the last follower, e.g. {x: 0, y: 1} lines them up below. */
  readonly behind: Vec2;
}

/** Leader change part of a kill result: when `leaderChanged`, `newLeader` is always set. */
export type LeaderChange =
  | { readonly leaderChanged: true; readonly newLeader: EntityId }
  | { readonly leaderChanged: false; readonly newLeader: EntityId | null };

export type SquadKillResult = {
  readonly state: SquadState;
  /** Ids actually removed, in ascending EntityId order. Emit `unit:died` for each. */
  readonly killed: readonly EntityId[];
} & LeaderChange;

const ZERO: Vec2 = { x: 0, y: 0 };

/** A squad standing in single file along `spawn.behind`, every follower exactly on its slot. */
export function createSquad(spawn: SquadSpawn, tuning: TrailTuning): SquadState {
  const roster = createRoster(spawn.ids);
  const trail = seedStraight(
    {
      spacingPx: tuning.breadcrumbSpacingPx,
      keepLengthPx: trailKeepLengthPx(tuning, roster.length),
    },
    spawn.leaderPosition,
    spawn.behind,
    slotDistancePx(tuning, roster.length - 1),
  );
  const members = roster.map((id, index) => ({
    id,
    position: pointAtDistance(trail, slotDistancePx(tuning, index)),
    velocity: ZERO,
    knockbacks: [],
  }));
  return { members, trail };
}

/**
 * Removes every listed member on the same frame (unknown or dead ids are ignored). Followers
 * behind a dead wizard move up a slot index; they walk to the new slot in `stepSquad`, they don't
 * snap. When the leader dies, the trail is cut where the new leader's slot was and re-headed at
 * the new leader, who keeps its position.
 */
export function killSquadMembers(
  state: SquadState,
  ids: readonly EntityId[],
  tuning: TrailTuning,
): SquadKillResult {
  const result = killMembers(
    state.members.map((m) => m.id),
    ids,
  );
  const change = leaderChangeOf(result);
  if (result.killed.length === 0) return { state, killed: result.killed, ...change };
  const survivors = new Set(result.roster);
  const members = state.members.filter((m) => survivors.has(m.id));
  let trail = state.trail;
  const leader = members[0];
  if (change.leaderChanged && leader) {
    const oldIndex = state.members.findIndex((m) => m.id === leader.id);
    trail = rebaseTo(state.trail, leader.position, slotDistancePx(tuning, oldIndex));
  }
  return { state: { members, trail }, killed: result.killed, ...change };
}

/** Adds a knockback push to a living member. See the module comment. */
export function knockSquadMember(
  state: SquadState,
  id: EntityId,
  direction: Vec2,
  distancePx: number,
  durationMs: number,
): SquadState {
  const push = startKnockback(direction, distancePx, durationMs);
  if (!push || !state.members.some((m) => m.id === id)) return state;
  return {
    ...state,
    members: state.members.map((m) =>
      m.id === id ? { ...m, knockbacks: [...m.knockbacks, push] } : m,
    ),
  };
}

/** Distance behind the leader, along the trail, of slot `index` (0 is the leader itself). */
export function slotDistancePx(tuning: TrailTuning, index: number): number {
  return index * tuning.followerSpacingPx;
}

/** Current position of slot `index` on the squad's trail. */
export function slotPosition(state: SquadState, index: number, tuning: TrailTuning): Vec2 {
  return pointAtDistance(state.trail, slotDistancePx(tuning, index));
}

function leaderChangeOf(result: RosterKillResult): LeaderChange {
  return result.leaderChanged
    ? { leaderChanged: true, newLeader: result.newLeader }
    : { leaderChanged: false, newLeader: result.newLeader };
}
