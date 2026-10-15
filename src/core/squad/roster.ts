/**
 * The squad's ordered roster (GDD §1, §2). Index 0 is the leader, 1..n are followers in trail order.
 *
 * API:
 * - `createRoster(ids)`: a roster in the given order. Throws on duplicate ids.
 * - `leaderOf(roster)`: the leader, or null when the roster is empty.
 * - `killMembers(roster, ids)`: removes every listed member at once (one frame's deaths) and
 *   compacts the roster. If the leader died, the lowest surviving index is promoted.
 */
import type { EntityId } from '@core/types';

/** Ordered squad members. Index 0 is the leader. */
export type Roster = readonly EntityId[];

interface KillBase {
  readonly roster: Roster;
  /** Ids actually removed, in ascending EntityId order (GDD §0 deterministic order). */
  readonly killed: readonly EntityId[];
}

/**
 * Result of {@link killMembers}. `leaderChanged` is true only when the leader died and a survivor
 * was promoted, so `newLeader` is then always set: emit `squad:leader-changed` with it. When the
 * last member dies, `leaderChanged` is false and `newLeader` is null.
 */
export type RosterKillResult =
  | (KillBase & { readonly leaderChanged: true; readonly newLeader: EntityId })
  | (KillBase & { readonly leaderChanged: false; readonly newLeader: EntityId | null });

/** A roster in the given order (index 0 leads). Throws on duplicate ids. */
export function createRoster(ids: readonly EntityId[]): Roster {
  if (new Set(ids).size !== ids.length) throw new RangeError('Roster ids must be unique');
  return [...ids];
}

/** The leader, or null when the roster is empty. */
export function leaderOf(roster: Roster): EntityId | null {
  return roster[0] ?? null;
}

/**
 * Removes every id in `ids` that is in the roster, all on the same frame. Survivors keep their
 * relative order, so the lowest surviving index becomes the leader (GDD §2). Unknown, already dead
 * or repeated ids are ignored; if nothing is removed, the same roster is returned.
 */
export function killMembers(roster: Roster, ids: readonly EntityId[]): RosterKillResult {
  const dying = new Set(ids.filter((id) => roster.includes(id)));
  if (dying.size === 0) {
    return { roster, killed: [], leaderChanged: false, newLeader: leaderOf(roster) };
  }
  const survivors = roster.filter((id) => !dying.has(id));
  const killed = [...dying].sort((a, b) => a - b);
  const oldLeader = leaderOf(roster);
  const newLeader = leaderOf(survivors);
  if (newLeader !== null && newLeader !== oldLeader) {
    return { roster: survivors, killed, leaderChanged: true, newLeader };
  }
  return { roster: survivors, killed, leaderChanged: false, newLeader };
}
