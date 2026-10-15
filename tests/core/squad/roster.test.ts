import { describe, expect, it } from 'vitest';
import type { EntityId } from '@core/types';
import { createRoster, killMembers, leaderOf } from '@core/squad/roster';

const ids = (...n: number[]): EntityId[] => n as EntityId[];
const id = (n: number): EntityId => n as EntityId;

describe('createRoster', () => {
  it('keeps the given order, index 0 leading', () => {
    const roster = createRoster(ids(4, 2, 9));
    expect(roster).toEqual([4, 2, 9]);
    expect(leaderOf(roster)).toBe(4);
  });

  it('copies its input', () => {
    const input = ids(1, 2);
    const roster = createRoster(input);
    input.push(id(3));
    expect(roster).toEqual([1, 2]);
  });

  it('throws on duplicate ids', () => {
    expect(() => createRoster(ids(1, 2, 1))).toThrow(RangeError);
  });

  it('has no leader when empty', () => {
    expect(leaderOf(createRoster([]))).toBeNull();
  });
});

describe('killMembers', () => {
  const squad = createRoster(ids(1, 2, 3, 4));

  it('removes a follower and compacts, without a leader change', () => {
    const r = killMembers(squad, ids(3));
    expect(r.roster).toEqual([1, 2, 4]);
    expect(r.killed).toEqual([3]);
    expect(r.leaderChanged).toBe(false);
    expect(r.newLeader).toBe(1);
  });

  it('promotes index 1 when the leader dies', () => {
    const r = killMembers(squad, ids(1));
    expect(r.roster).toEqual([2, 3, 4]);
    expect(r.leaderChanged).toBe(true);
    expect(r.newLeader).toBe(2);
  });

  it('promotes the lowest surviving index when the leader and index 1 die on the same frame', () => {
    const r = killMembers(squad, ids(2, 1));
    expect(r.roster).toEqual([3, 4]);
    expect(r.newLeader).toBe(3);
    expect(r.leaderChanged).toBe(true);
  });

  it('uses roster order, not id order, to pick the new leader', () => {
    const r = killMembers(createRoster(ids(7, 9, 3, 5)), ids(7, 9));
    expect(r.newLeader).toBe(3);
    expect(r.roster).toEqual([3, 5]);
  });

  it('reports killed ids in ascending id order', () => {
    const r = killMembers(createRoster(ids(7, 9, 3, 5)), ids(9, 3, 7));
    expect(r.killed).toEqual([3, 7, 9]);
  });

  it('leaves a cleanly empty roster when the last members die', () => {
    const r = killMembers(squad, ids(4, 3, 2, 1));
    expect(r.roster).toEqual([]);
    expect(r.leaderChanged).toBe(false);
    expect(r.newLeader).toBeNull();
  });

  it('kills the leader 3 times in a row, then the 4th wizard empties the squad', () => {
    let roster = squad;
    const promoted: EntityId[] = [];
    for (let i = 0; i < 3; i++) {
      const r = killMembers(roster, [leaderOf(roster) ?? id(-1)]);
      expect(r.leaderChanged).toBe(true);
      if (r.leaderChanged) promoted.push(r.newLeader);
      roster = r.roster;
    }
    expect(promoted).toEqual([2, 3, 4]);
    const last = killMembers(roster, ids(4));
    expect(last.roster).toEqual([]);
    expect(last.newLeader).toBeNull();
    expect(last.leaderChanged).toBe(false);
  });

  it('ignores unknown, already dead and repeated ids', () => {
    const unknown = killMembers(squad, ids(99));
    expect(unknown.roster).toBe(squad);
    expect(unknown.killed).toEqual([]);
    expect(unknown.leaderChanged).toBe(false);

    const once = killMembers(squad, ids(3));
    const again = killMembers(once.roster, ids(3, 3));
    expect(again.roster).toBe(once.roster);
    expect(again.killed).toEqual([]);

    const repeated = killMembers(squad, ids(2, 2, 99));
    expect(repeated.roster).toEqual([1, 3, 4]);
    expect(repeated.killed).toEqual([2]);
  });

  it('is a no-op on an empty roster and for an empty id list', () => {
    const empty = createRoster([]);
    expect(killMembers(empty, ids(1)).roster).toBe(empty);
    expect(killMembers(empty, ids(1)).newLeader).toBeNull();
    expect(killMembers(squad, []).roster).toBe(squad);
  });

  it('does not mutate the input roster', () => {
    killMembers(squad, ids(1, 3));
    expect(squad).toEqual([1, 2, 3, 4]);
  });
});
