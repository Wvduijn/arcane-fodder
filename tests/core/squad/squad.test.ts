import { describe, expect, it } from 'vitest';
import type { EntityId, Vec2 } from '@core/types';
import {
  createSquad,
  killSquadMembers,
  slotDistancePx,
  slotPosition,
  type SquadState,
} from '@core/squad/squad';
import { pointAtDistance } from '@core/squad/trail';
import { TRAIL } from '@data/trail';

const v = (x: number, y: number): Vec2 => ({ x, y });
const ids = (...n: number[]): EntityId[] => n as EntityId[];
const spawn = (size = 4): SquadState =>
  createSquad(
    {
      ids: Array.from({ length: size }, (_, i) => (i + 1) as EntityId),
      leaderPosition: v(500, 400),
      behind: v(0, 1),
    },
    TRAIL,
  );

describe('createSquad', () => {
  it('lines followers up behind the leader, each exactly on its slot', () => {
    const s = spawn();
    expect(s.members.map((m) => m.id)).toEqual([1, 2, 3, 4]);
    s.members.forEach((m, k) => {
      expect(m.position.x).toBeCloseTo(500, 9);
      expect(m.position.y).toBeCloseTo(400 + k * TRAIL.followerSpacingPx, 9);
      expect(m.position).toEqual(slotPosition(s, k, TRAIL));
      expect(m.velocity).toEqual(v(0, 0));
    });
    expect(s.trail.head).toEqual(v(500, 400));
  });

  it('handles a lone leader', () => {
    const s = spawn(1);
    expect(s.members).toHaveLength(1);
    expect(s.members[0]?.position).toEqual(v(500, 400));
  });

  it('rejects duplicate ids', () => {
    expect(() =>
      createSquad({ ids: ids(1, 1), leaderPosition: v(0, 0), behind: v(0, 1) }, TRAIL),
    ).toThrow(RangeError);
  });
});

describe('slotDistancePx / slotPosition', () => {
  it('puts slot k at k × followerSpacingPx along the trail', () => {
    const s = spawn();
    expect(slotDistancePx(TRAIL, 0)).toBe(0);
    expect(slotDistancePx(TRAIL, 3)).toBe(3 * TRAIL.followerSpacingPx);
    expect(slotPosition(s, 2, TRAIL)).toEqual(
      pointAtDistance(s.trail, 2 * TRAIL.followerSpacingPx),
    );
  });
});

describe('killSquadMembers', () => {
  it('removes a follower in place: survivors keep their positions, the trail is unchanged', () => {
    const s = spawn();
    const r = killSquadMembers(s, ids(3), TRAIL);
    expect(r.killed).toEqual([3]);
    expect(r.leaderChanged).toBe(false);
    expect(r.state.members.map((m) => m.id)).toEqual([1, 2, 4]);
    expect(r.state.members[2]?.position).toEqual(s.members[3]?.position);
    expect(r.state.trail).toBe(s.trail);
  });

  it('promotes on leader death and rebases the trail to the new leader', () => {
    const s = spawn();
    const r = killSquadMembers(s, ids(1), TRAIL);
    expect(r.leaderChanged).toBe(true);
    expect(r.newLeader).toBe(2);
    expect(r.state.trail.head).toEqual(s.members[1]?.position);
    // The old slot 2 becomes the new slot 1: the trail compacts without moving anyone's target.
    const oldSlot2 = slotPosition(s, 2, TRAIL);
    const newSlot1 = slotPosition(r.state, 1, TRAIL);
    expect(newSlot1.x).toBeCloseTo(oldSlot2.x, 9);
    expect(newSlot1.y).toBeCloseTo(oldSlot2.y, 9);
  });

  it('promotes the lowest surviving index on same-frame deaths', () => {
    const r = killSquadMembers(spawn(), ids(2, 1), TRAIL);
    expect(r.newLeader).toBe(3);
    expect(r.state.trail.head).toEqual(r.state.members[0]?.position);
  });

  it('leaves a cleanly empty squad when everyone dies', () => {
    const r = killSquadMembers(spawn(), ids(1, 2, 3, 4), TRAIL);
    expect(r.state.members).toEqual([]);
    expect(r.leaderChanged).toBe(false);
    expect(r.newLeader).toBeNull();
  });

  it('returns the same state for unknown or dead ids', () => {
    const s = spawn();
    const r = killSquadMembers(s, ids(42), TRAIL);
    expect(r.state).toBe(s);
    expect(r.killed).toEqual([]);
    const dead = killSquadMembers(s, ids(2), TRAIL).state;
    expect(killSquadMembers(dead, ids(2), TRAIL).state).toBe(dead);
  });
});
