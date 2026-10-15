import { describe, expect, it } from 'vitest';
import type { EntityId, MovementTuning, Rect, TrailTuning, Vec2 } from '@core/types';
import { clampToRect } from '@core/math/movement';
import { distance, length } from '@core/math/vec2';
import { stepSquad } from '@core/squad/follow';
import {
  createSquad,
  killSquadMembers,
  slotPosition,
  type SquadMember,
  type SquadState,
} from '@core/squad/squad';
import { DEV_ARENA } from '@data/devArena';
import { MOVEMENT } from '@data/movement';
import { TRAIL } from '@data/trail';
import {
  analogCircle,
  cycle,
  DIR,
  overlapPx,
  runSim,
  slotErrorPx,
  spawnSquad,
  stopStart,
  type Pattern,
} from './sim';

const v = (x: number, y: number): Vec2 => ({ x, y });
const memberAt = (s: SquadState, k: number): SquadMember => {
  const m = s.members[k];
  if (!m) throw new Error(`No squad member at index ${String(k)}`);
  return m;
};
const FPS = [144, 60, 30] as const;
const MINUTE_MS = 60_000;
const SIZE = 4;
/** GDD §1 Verify limits. */
const MAX_OVERLAP_PX = 6;
const MAX_SLOT_ERROR_PX = 96;
/** Per-step speed cap: catch-up speed plus the separation cap. */
const STEP_CAP =
  MOVEMENT.squadMoveSpeed * (TRAIL.catchUpMultiplier + TRAIL.separationMaxSpeedFactor);
const EPS = 1e-9;

const octagon = cycle(
  [DIR.right, DIR.downRight, DIR.down, DIR.downLeft, DIR.left, DIR.upLeft, DIR.up, DIR.upRight],
  400,
);
const zig = [DIR.upRight, DIR.downRight];
const zag = [DIR.downLeft, DIR.upLeft];
/** A closed zig-zag loop: four zig-zags east, a step down, four west, a step up. 90° and 45° turns. */
const zigZagLoop = cycle(
  [...zig, ...zig, ...zig, ...zig, DIR.down, ...zag, ...zag, ...zag, ...zag, DIR.up],
  400,
);

/** GDD §1 Verify, plus reversals and kiting (the player turning back through the squad). */
const VERIFY: Record<string, Pattern> = {
  'octagon circles': octagon,
  'tight octagon circles': cycle(
    [DIR.right, DIR.downRight, DIR.down, DIR.downLeft, DIR.left, DIR.upLeft, DIR.up, DIR.upRight],
    150,
  ),
  'analog circles': analogCircle(3000),
  'tight analog circles': analogCircle(1200),
  'zig-zags': zigZagLoop,
  'fast zig-zags': (t) => zigZagLoop(t * 2),
  '135° turns': cycle([DIR.right, DIR.upLeft, DIR.down], 600),
  reversals: cycle([DIR.right, DIR.left], 800),
  'vertical reversals': cycle([DIR.up, DIR.down], 1500),
  kiting: cycle(
    [DIR.right, DIR.right, DIR.right, DIR.left, DIR.left, DIR.left, DIR.downLeft, DIR.upRight],
    500,
  ),
};

/** Stop-starts: each stands still for 3 s, enough to check 2 s of stillness after settling. */
const STILL_MS = 3000;
const STOP_START: Record<string, Pattern> = {
  'stop-start circles': stopStart(octagon, 1300, STILL_MS),
  'stop-start analog circles': stopStart(analogCircle(2500), 1100, STILL_MS),
  'stop-start zig-zags': stopStart(zigZagLoop, 1700, STILL_MS),
  'short stop-start zig-zags': stopStart(zigZagLoop, 450, STILL_MS),
  'stop, then walk back through the squad': stopStart(
    cycle([DIR.right, DIR.left], 2000),
    2000,
    STILL_MS,
  ),
  'stop, then walk back vertically': stopStart(
    cycle([DIR.down, DIR.up, DIR.left, DIR.right], 1500),
    1500,
    STILL_MS,
  ),
};

interface StillStats {
  windows: number;
  /** Longest time from the leader stopping until no follower moved again in that window. */
  worstSettleMs: number;
  /** Shortest time a window stayed fully still after settling. */
  shortestStableMs: number;
}

/** Runs a pattern and tracks how followers behave while the leader stands still. */
function runWithStillness(pattern: Pattern, dtMs: number) {
  const stats: StillStats = { windows: 0, worstSettleMs: 0, shortestStableMs: Infinity };
  let stillSince = -1;
  let lastMove = 0;
  let prev: SquadState | null = null;
  const closeWindow = (t: number) => {
    stats.windows++;
    stats.worstSettleMs = Math.max(stats.worstSettleMs, lastMove - stillSince);
    stats.shortestStableMs = Math.min(stats.shortestStableMs, t - lastMove);
    stillSince = -1;
  };
  const result = runSim({
    trail: TRAIL,
    movement: MOVEMENT,
    arena: DEV_ARENA,
    size: SIZE,
    dtMs,
    durationMs: MINUTE_MS,
    pattern,
    onStep: (state, t, leaderStill) => {
      if (leaderStill) {
        if (stillSince < 0) {
          stillSince = t;
          lastMove = t;
        }
        const before = prev;
        const moved = state.members.some((m, k) => {
          const was = before?.members[k]?.position;
          return (
            k > 0 &&
            (m.velocity.x !== 0 ||
              m.velocity.y !== 0 ||
              m.position.x !== was?.x ||
              m.position.y !== was.y)
          );
        });
        if (moved) lastMove = t;
      } else if (stillSince >= 0) {
        closeWindow(t - dtMs);
      }
      prev = state;
    },
  });
  return { ...result, stats };
}

describe('stepSquad: GDD §1 Verify, 60 s simulations', () => {
  for (const [name, pattern] of Object.entries(VERIFY)) {
    describe(name, () => {
      it.each(FPS)('holds overlap, slot distance and step cap at %i fps', (fps) => {
        const { metrics } = runSim({
          trail: TRAIL,
          movement: MOVEMENT,
          arena: DEV_ARENA,
          size: SIZE,
          dtMs: 1000 / fps,
          durationMs: MINUTE_MS,
          pattern,
        });
        expect(metrics.maxOverlapPx).toBeLessThanOrEqual(MAX_OVERLAP_PX);
        expect(metrics.maxSlotErrorPx).toBeLessThanOrEqual(MAX_SLOT_ERROR_PX);
        expect(metrics.maxStepSpeed).toBeLessThanOrEqual(STEP_CAP + EPS);
      });
    });
  }

  for (const [name, pattern] of Object.entries(STOP_START)) {
    describe(name, () => {
      it.each(FPS)('holds the limits and comes to a dead stop at %i fps', (fps) => {
        const { metrics, stats } = runWithStillness(pattern, 1000 / fps);
        expect(metrics.maxOverlapPx).toBeLessThanOrEqual(MAX_OVERLAP_PX);
        expect(metrics.maxSlotErrorPx).toBeLessThanOrEqual(MAX_SLOT_ERROR_PX);
        expect(metrics.maxStepSpeed).toBeLessThanOrEqual(STEP_CAP + EPS);
        expect(stats.windows).toBeGreaterThanOrEqual(10);
        // Settles within 1 s, then velocity is exactly 0 and positions are unchanged for >= 2 s.
        expect(stats.worstSettleMs).toBeLessThanOrEqual(1000);
        expect(stats.shortestStableMs).toBeGreaterThanOrEqual(2000 - 1000 / fps);
      });
    });
  }

  // Rapid reversals (review M3-T6 M1, CD-approved fix): reversing faster than the squad is long
  // folds the trail onto the squad. Before the step-5 fallback this overlapped up to 15 px. A
  // tangled squad can take up to ~1.5 s to walk back to its slots (monotone, no oscillation), so
  // these stand still for 4 s and check 2 s of exact stillness after settling.
  for (const periodMs of [300, 400, 500, 800]) {
    it.each(FPS)(
      `a left-right wiggle every ${String(periodMs)} ms holds the limits and settles at %i fps`,
      (fps) => {
        const { metrics, stats } = runWithStillness(
          stopStart(cycle([DIR.right, DIR.left], periodMs), 2000, 4000),
          1000 / fps,
        );
        expect(metrics.maxOverlapPx).toBeLessThanOrEqual(MAX_OVERLAP_PX);
        expect(metrics.maxSlotErrorPx).toBeLessThanOrEqual(MAX_SLOT_ERROR_PX);
        expect(metrics.maxStepSpeed).toBeLessThanOrEqual(STEP_CAP + EPS);
        expect(stats.worstSettleMs).toBeLessThanOrEqual(2000);
        expect(stats.shortestStableMs).toBeGreaterThanOrEqual(2000 - 1000 / fps);
      },
    );
  }
});

describe('stepSquad: steering rules', () => {
  const arena: Rect = { x: 0, y: 0, width: 2000, height: 2000 };
  const ids = (n: number) => Array.from({ length: n }, (_, i) => (i + 1) as EntityId);
  const squadAt = (size: number, leader = v(1000, 1000)) =>
    createSquad({ ids: ids(size), leaderPosition: leader, behind: v(0, 1) }, TRAIL);
  const step = (state: SquadState, leaderPosition: Vec2, dtMs = 1000 / 60, walkable = arena) =>
    stepSquad(state, { leaderPosition, walkable, dtMs }, TRAIL, MOVEMENT);
  const withMember = (state: SquadState, index: number, position: Vec2): SquadState => ({
    ...state,
    members: state.members.map((m, k) => (k === index ? { ...m, position } : m)),
  });
  const walkLeader = (state: SquadState, dir: Vec2, frames: number, dtMs = 1000 / 60) => {
    let s = state;
    const perStep = (MOVEMENT.squadMoveSpeed * dtMs) / 1000;
    for (let i = 0; i < frames; i++) {
      const p = memberAt(s, 0).position;
      s = step(s, v(p.x + dir.x * perStep, p.y + dir.y * perStep), dtMs);
    }
    return s;
  };
  const leaderOf = (s: SquadState) => memberAt(s, 0);
  const member = memberAt;

  it('returns the same state for dt <= 0', () => {
    const s = squadAt(4);
    expect(step(s, v(1100, 1000), 0)).toBe(s);
    expect(step(s, v(1100, 1000), -16)).toBe(s);
  });

  it('is a no-op on a wiped squad', () => {
    const s = killSquadMembers(squadAt(2), ids(2), TRAIL).state;
    expect(step(s, v(5, 5))).toBe(s);
  });

  it('puts the leader exactly where the caller says, and reports its velocity', () => {
    const s = step(squadAt(4), v(1002, 1000), 20);
    expect(leaderOf(s).position).toEqual(v(1002, 1000));
    expect(leaderOf(s).velocity.x).toBeCloseTo(100);
    expect(leaderOf(s).velocity.y).toBeCloseTo(0);
  });

  it('never pushes the leader, even with a follower on top of it', () => {
    const s = withMember(squadAt(3), 1, v(1001, 1000));
    const next = step(s, v(1000, 1000));
    expect(leaderOf(next).position).toEqual(v(1000, 1000));
  });

  it('does not move anything while a freshly spawned squad stands still', () => {
    let s = squadAt(4);
    const start = s.members.map((m) => m.position);
    for (let i = 0; i < 600; i++) s = step(s, v(1000, 1000));
    expect(s.members.map((m) => m.position)).toEqual(start);
    for (const m of s.members) expect(m.velocity).toEqual(v(0, 0));
  });

  it('keeps a follower on a moving slot (feed-forward), at the leader speed', () => {
    const s = walkLeader(squadAt(4), DIR.up, 120);
    expect(slotErrorPx(s, TRAIL)).toBeLessThan(1e-6);
    expect(length(member(s, 3).velocity)).toBeCloseTo(MOVEMENT.squadMoveSpeed, 6);
  });

  it('catches up at squadMoveSpeed × catchUpMultiplier when farther than catchUpDistancePx', () => {
    const s = withMember(squadAt(2), 1, v(1000, 1126)); // 100 px behind its slot at (1000, 1026)
    const next = step(s, v(1000, 1000));
    expect(length(member(next, 1).velocity)).toBeCloseTo(
      MOVEMENT.squadMoveSpeed * TRAIL.catchUpMultiplier,
      6,
    );
  });

  it('arrives without overshoot and stops dead within stopRadiusPx of a resting slot', () => {
    let s = withMember(squadAt(2), 1, v(1000, 1060));
    const slot = slotPosition(s, 1, TRAIL);
    let prevDist = Infinity;
    for (let i = 0; i < 180; i++) {
      s = step(s, v(1000, 1000));
      const d = distance(member(s, 1).position, slot);
      expect(d).toBeLessThanOrEqual(prevDist);
      expect(member(s, 1).position.y).toBeGreaterThanOrEqual(slot.y);
      prevDist = d;
    }
    expect(prevDist).toBeLessThanOrEqual(TRAIL.stopRadiusPx);
    const settled = member(s, 1).position;
    for (let i = 0; i < 240; i++) s = step(s, v(1000, 1000));
    expect(member(s, 1).position).toEqual(settled);
    expect(member(s, 1).velocity).toEqual(v(0, 0));
  });

  it('pushes overlapping followers apart and lets them settle', () => {
    let s = withMember(squadAt(3), 2, v(1000, 1028)); // 2 px from follower 1: 18 px overlap
    for (let i = 0; i < 300; i++) s = step(s, v(1000, 1000));
    expect(overlapPx(s, MOVEMENT.wizardBodyRadiusPx)).toBeLessThanOrEqual(1.5);
    const settled = s.members.map((m) => m.position);
    for (let i = 0; i < 120; i++) s = step(s, v(1000, 1000));
    expect(s.members.map((m) => m.position)).toEqual(settled);
  });

  it('caps every follower step, even for a follower far from its slot', () => {
    let s = withMember(squadAt(3), 2, v(1500, 1500));
    for (const dtMs of [1000 / 144, 1000 / 60, 1000 / 30, 100]) {
      const next = step(s, v(1000, 1000), dtMs);
      next.members.forEach((m, k) => {
        if (k === 0) return;
        const moved = distance(m.position, member(s, k).position);
        expect(moved).toBeLessThanOrEqual((STEP_CAP * dtMs) / 1000 + EPS);
      });
      s = next;
    }
  });

  it('clamps followers to the walkable rect itself, with no extra inset', () => {
    const small: Rect = { x: 990, y: 990, width: 40, height: 20 };
    let s = withMember(squadAt(2), 1, v(1000, 1020));
    for (let i = 0; i < 60; i++) s = step(s, v(1000, 1000), 1000 / 60, small);
    // The slot (1000, 1026) is outside the rect; the follower stands on the rect's edge.
    expect(member(s, 1).position).toEqual(v(1000, small.y + small.height));
  });

  it.each(FPS)(
    'walking into an edge and stopping: followers reach their slots and stop dead at %i fps',
    (fps) => {
      const dtMs = 1000 / fps;
      const feet: Rect = { x: 10, y: 46, width: 2028, height: 1480 };
      const right = feet.x + feet.width;
      let s = createSquad({ ids: ids(4), leaderPosition: v(1900, 700), behind: v(-1, 0) }, TRAIL);
      const perStep = (MOVEMENT.squadMoveSpeed * dtMs) / 1000;
      // Walk right into the edge, slide down along it, then stand still.
      for (let t = 0; t < 4000; t += dtMs) {
        const p = memberAt(s, 0).position;
        const dir = t < 2000 ? DIR.right : DIR.down;
        const next = clampToRect(v(p.x + dir.x * perStep, p.y + dir.y * perStep), feet, 0);
        s = step(s, next, dtMs, feet);
      }
      expect(memberAt(s, 0).position.x).toBe(right);
      for (let t = 0; t < 1000; t += dtMs) s = step(s, memberAt(s, 0).position, dtMs, feet);
      expect(slotErrorPx(s, TRAIL)).toBeLessThanOrEqual(TRAIL.stopRadiusPx);
      const settled = s.members.map((m) => m.position);
      for (let t = 0; t < 2000; t += dtMs) {
        s = step(s, memberAt(s, 0).position, dtMs, feet);
        for (const m of s.members) expect(m.velocity).toEqual(v(0, 0));
      }
      expect(s.members.map((m) => m.position)).toEqual(settled);
      for (const m of s.members) expect(m.position.x).toBeLessThanOrEqual(right);
    },
  );

  it('is deterministic', () => {
    const run = () =>
      runSim({
        trail: TRAIL,
        movement: MOVEMENT,
        arena: DEV_ARENA,
        size: SIZE,
        dtMs: 1000 / 60,
        durationMs: 5000,
        pattern: cycle([DIR.right, DIR.left, DIR.upRight], 700),
      }).state;
    expect(run()).toEqual(run());
  });

  it('reads all tuning from its arguments', () => {
    const slow: MovementTuning = { squadMoveSpeed: 50, wizardBodyRadiusPx: 10 };
    const wide: TrailTuning = { ...TRAIL, followerSpacingPx: 40 };
    const s = createSquad({ ids: ids(2), leaderPosition: v(0, 0), behind: v(1, 0) }, wide);
    expect(member(s, 1).position).toEqual(v(40, 0));
    const far = { ...s, members: [leaderOf(s), { ...member(s, 1), position: v(200, 0) }] };
    const next = stepSquad(
      far,
      { leaderPosition: v(0, 0), walkable: arena, dtMs: 1000 },
      wide,
      slow,
    );
    expect(member(next, 1).position.x).toBeCloseTo(200 - 50 * TRAIL.catchUpMultiplier, 6);
  });
});

describe('stepSquad: deaths and succession', () => {
  const dtMs = 1000 / 60;
  const perStep = (MOVEMENT.squadMoveSpeed * dtMs) / 1000;
  const maxStep = (STEP_CAP * dtMs) / 1000 + EPS;

  /** Steps the squad with the leader walking `dir`, checking that no follower ever jumps. */
  function walkChecked(state: SquadState, dir: Vec2, frames: number): SquadState {
    let s = state;
    for (let i = 0; i < frames; i++) {
      const leader = s.members[0];
      if (!leader) return s;
      const next = stepSquad(
        s,
        {
          leaderPosition: v(
            leader.position.x + dir.x * perStep,
            leader.position.y + dir.y * perStep,
          ),
          walkable: DEV_ARENA,
          dtMs,
        },
        TRAIL,
        MOVEMENT,
      );
      next.members.forEach((m, k) => {
        const before = s.members[k];
        if (k > 0 && before)
          expect(distance(before.position, m.position)).toBeLessThanOrEqual(maxStep);
      });
      expect(overlapPx(next, MOVEMENT.wizardBodyRadiusPx)).toBeLessThanOrEqual(MAX_OVERLAP_PX);
      s = next;
    }
    return s;
  }

  it('a follower dies: everyone behind walks up a slot, no snap, then stands on the new slots', () => {
    let s = walkChecked(spawnSquad(TRAIL, DEV_ARENA, 4), DIR.up, 60);
    const before = s.members.map((m) => m.position);
    const r = killSquadMembers(s, [2 as EntityId], TRAIL);
    expect(r.leaderChanged).toBe(false);
    s = r.state;
    // Positions don't change at the moment of death.
    expect(s.members.map((m) => m.position)).toEqual([before[0], before[2], before[3]]);
    s = walkChecked(s, DIR.up, 120);
    expect(slotErrorPx(s, TRAIL)).toBeLessThan(TRAIL.stopRadiusPx);
  });

  it('a follower dies while the leader stands still: the others close up and stop', () => {
    let s = spawnSquad(TRAIL, DEV_ARENA, 4);
    s = killSquadMembers(s, [2 as EntityId], TRAIL).state;
    s = walkChecked(s, v(0, 0), 120);
    expect(slotErrorPx(s, TRAIL)).toBeLessThanOrEqual(TRAIL.stopRadiusPx);
    const settled = s.members.map((m) => m.position);
    s = walkChecked(s, v(0, 0), 120);
    expect(s.members.map((m) => m.position)).toEqual(settled);
    for (const m of s.members) expect(m.velocity).toEqual(v(0, 0));
  });

  it('the leader dies while moving: the new leader keeps input, the trail rebases, nobody snaps', () => {
    let s = walkChecked(spawnSquad(TRAIL, DEV_ARENA, 4), DIR.right, 90);
    const heir = memberAt(s, 1);
    const r = killSquadMembers(s, [s.members[0]?.id ?? (0 as EntityId)], TRAIL);
    expect(r.leaderChanged).toBe(true);
    s = r.state;
    expect(s.members[0]?.position).toEqual(heir.position);
    expect(s.trail.head).toEqual(heir.position);
    // Held input keeps moving the new leader from where it stands.
    s = walkChecked(s, DIR.right, 1);
    expect(s.members[0]?.position.x).toBeCloseTo(heir.position.x + perStep, 9);
    s = walkChecked(s, DIR.right, 120);
    expect(slotErrorPx(s, TRAIL)).toBeLessThan(TRAIL.stopRadiusPx);
  });

  it('kills the leader 3 times in a row while moving, then the 4th wizard empties the squad', () => {
    let s = walkChecked(spawnSquad(TRAIL, DEV_ARENA, 4), DIR.right, 60);
    for (const dir of [DIR.up, DIR.left, DIR.downLeft]) {
      const r = killSquadMembers(s, [s.members[0]?.id ?? (0 as EntityId)], TRAIL);
      expect(r.leaderChanged).toBe(true);
      s = walkChecked(r.state, dir, 45);
    }
    expect(s.members).toHaveLength(1);
    const last = killSquadMembers(s, [s.members[0]?.id ?? (0 as EntityId)], TRAIL);
    expect(last.leaderChanged).toBe(false);
    expect(last.newLeader).toBeNull();
    expect(last.state.members).toEqual([]);
  });

  it('the leader and index 1 die on the same frame: index 2 leads from its own position', () => {
    let s = walkChecked(spawnSquad(TRAIL, DEV_ARENA, 4), DIR.down, 60);
    const heir = memberAt(s, 2);
    const r = killSquadMembers(s, [1 as EntityId, 2 as EntityId], TRAIL);
    expect(r.newLeader).toBe(heir.id);
    s = r.state;
    expect(s.members[0]?.position).toEqual(heir.position);
    s = walkChecked(s, DIR.down, 120);
    expect(slotErrorPx(s, TRAIL)).toBeLessThan(TRAIL.stopRadiusPx);
  });
});
