import { describe, expect, it } from 'vitest';
import type { EntityId, Rect, Vec2 } from '@core/types';
import { distance } from '@core/math/vec2';
import { stepSquad } from '@core/squad/follow';
import {
  createSquad,
  killSquadMembers,
  knockSquadMember,
  slotPosition,
  type SquadMember,
  type SquadState,
} from '@core/squad/squad';
import { COMBAT } from '@data/combat';
import { MOVEMENT } from '@data/movement';
import { REACTIONS } from '@data/reactions';
import { TRAIL } from '@data/trail';

const v = (x: number, y: number): Vec2 => ({ x, y });
const id = (n: number) => n as EntityId;
const ARENA: Rect = { x: 0, y: 0, width: 2000, height: 2000 };
/** Kaboom's push (GDD §8: 36 px). */
const KABOOM_PX = REACTIONS.kaboom.blast.knockbackPx;
const PUSH_MS = COMBAT.knockbackMs;
const FPS = [30, 60, 144] as const;

const spawn = (at = v(1000, 1000)): SquadState =>
  createSquad({ ids: [1, 2, 3, 4].map(id), leaderPosition: at, behind: v(0, 1) }, TRAIL);
const member = (s: SquadState, n: number): SquadMember => {
  const m = s.members.find((x) => x.id === id(n));
  if (!m) throw new Error(`No member ${String(n)}`);
  return m;
};

/** Steps `ms` of frames; the leader input is "hold still" unless `leaderTo` moves it each frame. */
function run(
  state: SquadState,
  ms: number,
  dtMs: number,
  leaderTo: (s: SquadState) => Vec2 = (s) => s.members[0]?.position ?? v(0, 0),
  walkable: Rect = ARENA,
): SquadState {
  let s = state;
  for (let t = 0; t < ms - 1e-9; t += dtMs) {
    s = stepSquad(s, { leaderPosition: leaderTo(s), walkable, dtMs }, TRAIL, MOVEMENT);
  }
  return s;
}

/** Steps while any member is being pushed, the leader holding still; checks each frame. */
function runWhilePushed(
  state: SquadState,
  dtMs: number,
  walkable: Rect = ARENA,
  check: (s: SquadState) => void = () => undefined,
): SquadState {
  let s = state;
  for (let frames = 0; s.members.some((m) => m.knockbacks.length > 0); frames++) {
    if (frames * dtMs > PUSH_MS + dtMs) throw new Error('push outlived its duration');
    const leaderPosition = s.members[0]?.position ?? v(0, 0);
    s = stepSquad(s, { leaderPosition, walkable, dtMs }, TRAIL, MOVEMENT);
    check(s);
  }
  return s;
}

describe('knockSquadMember', () => {
  it('adds a push to a living member; pushes add up', () => {
    let s = knockSquadMember(spawn(), id(2), v(1, 0), KABOOM_PX, PUSH_MS);
    s = knockSquadMember(s, id(2), v(0, -1), 10, PUSH_MS);
    expect(member(s, 2).knockbacks).toHaveLength(2);
    expect(member(s, 1).knockbacks).toHaveLength(0);
  });

  it('is a no-op for unknown or dead ids, zero distance and zero direction', () => {
    const s = spawn();
    expect(knockSquadMember(s, id(9), v(1, 0), KABOOM_PX, PUSH_MS)).toBe(s);
    expect(knockSquadMember(s, id(2), v(1, 0), 0, PUSH_MS)).toBe(s);
    expect(knockSquadMember(s, id(2), v(0, 0), KABOOM_PX, PUSH_MS)).toBe(s);
    const killed = killSquadMembers(s, [id(3)], TRAIL).state;
    expect(knockSquadMember(killed, id(3), v(1, 0), KABOOM_PX, PUSH_MS)).toBe(killed);
  });
});

describe('stepSquad with knockback (GDD §8, M5 Q4)', () => {
  it.each(FPS)('the leader is pushed exactly the distance, eased, at %i fps', (fps) => {
    const dt = 1000 / fps;
    const start = spawn();
    let s = knockSquadMember(start, id(1), v(1, 0), KABOOM_PX, PUSH_MS);
    let prev = member(s, 1).position;
    let maxStep = 0;
    // Input tries to walk west the whole time; it is ignored while the push runs.
    const west = (x: SquadState) => v((x.members[0]?.position.x ?? 0) - 5, 1000);
    for (let t = 0; member(s, 1).knockbacks.length > 0; t += dt) {
      s = stepSquad(s, { leaderPosition: west(s), walkable: ARENA, dtMs: dt }, TRAIL, MOVEMENT);
      const p = member(s, 1).position;
      maxStep = Math.max(maxStep, distance(prev, p));
      prev = p;
      expect(t).toBeLessThan(PUSH_MS + dt);
    }
    expect(member(s, 1).position.x).toBeCloseTo(1000 + KABOOM_PX, 9);
    expect(member(s, 1).position.y).toBe(1000);
    // Ease-out, no teleport: never more than 2 × distance × dt / duration in one frame.
    expect(maxStep).toBeLessThanOrEqual((2 * KABOOM_PX * dt) / PUSH_MS + 1e-9);
    // The trail recorded the push: its head is the leader.
    expect(s.trail.head).toEqual(member(s, 1).position);
    // Input resumes on the next frame.
    const after = stepSquad(
      s,
      { leaderPosition: west(s), walkable: ARENA, dtMs: dt },
      TRAIL,
      MOVEMENT,
    );
    expect(member(after, 1).position.x).toBeCloseTo(member(s, 1).position.x - 5, 9);
  });

  it.each(FPS)('a follower is pushed, then follows back to its slot, at %i fps', (fps) => {
    const dt = 1000 / fps;
    const start = spawn();
    const from = member(start, 3).position;
    let s = knockSquadMember(start, id(3), v(-1, 0), KABOOM_PX, PUSH_MS);
    s = runWhilePushed(s, dt);
    expect(member(s, 3).position.x).toBeCloseTo(from.x - KABOOM_PX, 9);
    expect(member(s, 3).position.y).toBeCloseTo(from.y, 9);
    // Follow resumes: back within the stop radius of its slot inside two seconds.
    s = run(s, 2000, dt);
    expect(distance(member(s, 3).position, slotPosition(s, 2, TRAIL))).toBeLessThanOrEqual(
      TRAIL.stopRadiusPx + 1e-6,
    );
  });

  it('a pushed member never leaves the walkable rect', () => {
    const walkable: Rect = { x: 0, y: 0, width: 1000, height: 1100 };
    const start = createSquad(
      { ids: [1, 2].map(id), leaderPosition: v(990, 1000), behind: v(0, 1) },
      TRAIL,
    );
    let s = knockSquadMember(start, id(1), v(1, 0), KABOOM_PX, PUSH_MS);
    s = knockSquadMember(s, id(2), v(1, 1), KABOOM_PX, PUSH_MS);
    s = runWhilePushed(s, 1000 / 60, walkable, (x) => {
      for (const m of x.members) {
        expect(m.position.x).toBeLessThanOrEqual(1000);
        expect(m.position.y).toBeLessThanOrEqual(1100);
      }
    });
    expect(member(s, 1).position).toEqual(v(1000, 1000));
    expect(member(s, 2).position.x).toBe(1000);
  });

  it('a member killed mid-push is gone; survivors keep their pushes', () => {
    let s = knockSquadMember(spawn(), id(1), v(1, 0), KABOOM_PX, PUSH_MS);
    s = knockSquadMember(s, id(2), v(1, 0), KABOOM_PX, PUSH_MS);
    s = run(s, 50, 1000 / 60);
    const result = killSquadMembers(s, [id(1)], TRAIL);
    expect(result.newLeader).toBe(2);
    s = result.state;
    expect(s.members.map((m) => m.id)).toEqual([2, 3, 4]);
    expect(member(s, 2).knockbacks).toHaveLength(1);
    // The new leader finishes its push with input ignored, then input resumes.
    const at = member(s, 2).position;
    s = runWhilePushed(s, 1000 / 60);
    expect(member(s, 2).position.x).toBeGreaterThan(at.x);
    s = stepSquad(s, { leaderPosition: v(900, 900), walkable: ARENA, dtMs: 16 }, TRAIL, MOVEMENT);
    expect(member(s, 2).position).toEqual(v(900, 900));
  });

  it('members without pushes step exactly as before', () => {
    const s = spawn();
    const pushed = knockSquadMember(s, id(4), v(1, 0), KABOOM_PX, PUSH_MS);
    const a = stepSquad(
      s,
      { leaderPosition: v(1003, 1000), walkable: ARENA, dtMs: 16 },
      TRAIL,
      MOVEMENT,
    );
    const b = stepSquad(
      pushed,
      { leaderPosition: v(1003, 1000), walkable: ARENA, dtMs: 16 },
      TRAIL,
      MOVEMENT,
    );
    // Member 4 is last in line, so nobody yields to it: the others are unaffected.
    for (const n of [1, 2, 3]) expect(member(b, n)).toEqual(member(a, n));
    expect(member(b, 4).position).not.toEqual(member(a, 4).position);
  });

  it('a zero dt changes nothing, push included', () => {
    const s = knockSquadMember(spawn(), id(1), v(1, 0), KABOOM_PX, PUSH_MS);
    expect(
      stepSquad(s, { leaderPosition: v(0, 0), walkable: ARENA, dtMs: 0 }, TRAIL, MOVEMENT),
    ).toBe(s);
  });
});
