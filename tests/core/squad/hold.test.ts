import { describe, expect, it } from 'vitest';
import type { EntityId, Rect, Vec2 } from '@core/types';
import { distance } from '@core/math/vec2';
import { stepSquad, type SquadStepInput } from '@core/squad/follow';
import { createSquad, knockSquadMember, type SquadState } from '@core/squad/squad';
import { COMBAT } from '@data/combat';
import { MOVEMENT } from '@data/movement';
import { TRAIL } from '@data/trail';

const v = (x: number, y: number): Vec2 => ({ x, y });
const id = (n: number) => n as EntityId;
const ARENA: Rect = { x: 0, y: 0, width: 2000, height: 2000 };
const FPS = [30, 60, 144] as const;

const spawn = (): SquadState =>
  createSquad({ ids: [1, 2, 3, 4].map(id), leaderPosition: v(1000, 1000), behind: v(0, 1) }, TRAIL);

/** Steps `ms`, the leader trying to walk east every frame. */
function walkEast(state: SquadState, ms: number, dtMs: number, held: boolean): SquadState {
  let s = state;
  for (let t = 0; t < ms - 1e-9; t += dtMs) {
    const leader = s.members[0]?.position ?? v(0, 0);
    const input: SquadStepInput = {
      leaderPosition: { x: leader.x + (MOVEMENT.squadMoveSpeed * dtMs) / 1000, y: leader.y },
      walkable: ARENA,
      dtMs,
      held,
    };
    s = stepSquad(s, input, TRAIL, MOVEMENT);
  }
  return s;
}

describe('stepSquad held (Convergence channel)', () => {
  it('the leader ignores input and every follower freezes, at any fps', () => {
    for (const fps of FPS) {
      const walking = walkEast(spawn(), 500, 1000 / fps, false);
      const held = walkEast(walking, 1200, 1000 / fps, true);
      held.members.forEach((m, i) => {
        expect(m.position).toEqual(walking.members[i]?.position);
        expect(m.velocity).toEqual({ x: 0, y: 0 });
      });
    }
  });

  it('knockback still plays out while held, the full distance', () => {
    for (const fps of FPS) {
      const s = knockSquadMember(spawn(), id(3), v(1, 0), 36, COMBAT.knockbackMs);
      const before = s.members[2]?.position ?? v(0, 0);
      const leaderBefore = s.members[0]?.position;
      const after = walkEast(s, COMBAT.knockbackMs + 100, 1000 / fps, true);
      expect(distance(after.members[2]?.position ?? v(0, 0), before)).toBeCloseTo(36, 6);
      expect(after.members[2]?.knockbacks).toEqual([]);
      expect(after.members[0]?.position).toEqual(leaderBefore);
    }
  });

  it('a held, knocked-back leader moves by the push only', () => {
    const s = knockSquadMember(spawn(), id(1), v(0, -1), 36, COMBAT.knockbackMs);
    const after = walkEast(s, COMBAT.knockbackMs + 100, 1000 / 60, true);
    expect(after.members[0]?.position.x).toBeCloseTo(1000, 6);
    expect(after.members[0]?.position.y).toBeCloseTo(1000 - 36, 6);
  });

  it('follow resumes on the first step without hold', () => {
    const held = walkEast(spawn(), 1200, 1000 / 60, true);
    const released = walkEast(held, 1000, 1000 / 60, false);
    expect(released.members[0]?.position.x).toBeGreaterThan(1100);
    expect(released.members[1]?.position).not.toEqual(held.members[1]?.position);
  });
});
