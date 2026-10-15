/**
 * Seeded random-input fuzz for follow steering (review M3-T6 M1): random 8-direction legs with
 * stops, jittered frame times, the dev arena's walls, and the leader killed every 4 s.
 */
import { describe, expect, it } from 'vitest';
import type { EntityId, Rect, Vec2 } from '@core/types';
import { clampToRect, insetRect, moveVectorFromAxes, stepPosition } from '@core/math/movement';
import { distance } from '@core/math/vec2';
import { createRng } from '@core/rng/rng';
import { stepSquad } from '@core/squad/follow';
import { createSquad, killSquadMembers, type SquadState } from '@core/squad/squad';
import { DEV_ARENA } from '@data/devArena';
import { MOVEMENT } from '@data/movement';
import { TRAIL } from '@data/trail';
import { DIR, overlapPx, slotErrorPx } from './sim';

const FPS = [144, 60, 30] as const;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const RUN_MS = 60_000;
const KILL_EVERY_MS = 4000;
const SQUAD_SIZE = 4;
const STEP_CAP =
  MOVEMENT.squadMoveSpeed * (TRAIL.catchUpMultiplier + TRAIL.separationMaxSpeedFactor);
const EPS = 1e-9;
const STILL: Vec2 = { x: 0, y: 0 };
const DIRECTIONS = Object.values(DIR);
/** Probability that a leg is a stop instead of a walk. */
const STOP_CHANCE = 0.1;
/** Frame times vary by ±40% around the nominal frame rate. */
const DT_JITTER = 0.4;
/** The feet rect as game code builds it: HUD band on top, body radius elsewhere. */
const R = MOVEMENT.wizardBodyRadiusPx;
const WALLED: Rect = insetRect(DEV_ARENA, { top: 46, right: R, bottom: R, left: R });
/** Open ground: far too big to reach a wall in a minute. */
const OPEN: Rect = { x: -50_000, y: -50_000, width: 100_000, height: 100_000 };

interface FuzzResult {
  maxOverlapPx: number;
  maxSlotErrorPx: number;
  maxStepSpeed: number;
  edgeFrames: number;
  kills: number;
}

function fuzz(
  walkable: Rect,
  seed: number,
  fps: number,
  legMinMs: number,
  legMaxMs: number,
): FuzzResult {
  const rng = createRng(seed * 1000 + fps);
  let nextId = 1;
  /** A fresh squad at a seeded random spot, with room below the leader for the seeded trail. */
  const spawn = (): SquadState => {
    const trailPx = (SQUAD_SIZE - 1) * TRAIL.followerSpacingPx;
    return createSquad(
      {
        ids: Array.from({ length: SQUAD_SIZE }, () => nextId++ as EntityId),
        leaderPosition: {
          x: walkable.x + rng.next() * walkable.width,
          y: walkable.y + rng.next() * (walkable.height - trailPx),
        },
        behind: { x: 0, y: 1 },
      },
      TRAIL,
    );
  };
  const result: FuzzResult = {
    maxOverlapPx: 0,
    maxSlotErrorPx: 0,
    maxStepSpeed: 0,
    edgeFrames: 0,
    kills: 0,
  };
  let state = spawn();
  let dir = STILL;
  let legEnd = 0;
  let nextKill = KILL_EVERY_MS;
  for (let t = 0; t < RUN_MS;) {
    if (t >= legEnd) {
      legEnd = t + rng.int(legMinMs, legMaxMs);
      dir = rng.next() < STOP_CHANCE ? STILL : rng.pick(DIRECTIONS);
    }
    const dtMs = (1000 / fps) * (1 - DT_JITTER + rng.next() * 2 * DT_JITTER);
    const leader = state.members[0];
    if (!leader) throw new Error('squad unexpectedly empty');
    const move = moveVectorFromAxes(dir.x, dir.y);
    const leaderPosition = clampToRect(
      stepPosition(leader.position, move, MOVEMENT.squadMoveSpeed, dtMs),
      walkable,
      0,
    );
    const next = stepSquad(state, { leaderPosition, walkable: walkable, dtMs }, TRAIL, MOVEMENT);
    next.members.forEach((m, k) => {
      const before = state.members[k];
      if (k === 0 || !before) return;
      result.maxStepSpeed = Math.max(
        result.maxStepSpeed,
        distance(before.position, m.position) / (dtMs / 1000),
      );
    });
    state = next;
    t += dtMs;
    const onEdge =
      leaderPosition.x === walkable.x ||
      leaderPosition.y === walkable.y ||
      leaderPosition.x === walkable.x + walkable.width ||
      leaderPosition.y === walkable.y + walkable.height;
    if (onEdge) result.edgeFrames++;
    result.maxOverlapPx = Math.max(result.maxOverlapPx, overlapPx(state, R));
    result.maxSlotErrorPx = Math.max(result.maxSlotErrorPx, slotErrorPx(state, TRAIL));
    if (t >= nextKill) {
      nextKill += KILL_EVERY_MS;
      result.kills++;
      // Kill the leader; once two remain, a fresh squad takes over, so kills keep coming.
      const leaderId = state.members[0]?.id;
      state =
        state.members.length > 2 && leaderId !== undefined
          ? killSquadMembers(state, [leaderId], TRAIL).state
          : spawn();
    }
  }
  return result;
}

const LEGS = [
  ['500–1500 ms legs', 500, 1500],
  ['300–1000 ms legs', 300, 1000],
] as const;

describe('stepSquad fuzz: random legs, jittered dt, leader killed every 4 s', () => {
  for (const [label, legMin, legMax] of LEGS) {
    it.each(FPS)(
      `open ground, ${label}: overlap ≤ 6 px, slot error ≤ 96 px, step cap at %i fps`,
      (fps) => {
        for (const seed of SEEDS) {
          const r = fuzz(OPEN, seed, fps, legMin, legMax);
          expect(r.maxOverlapPx, `seed ${String(seed)}`).toBeLessThanOrEqual(6);
          expect(r.maxSlotErrorPx, `seed ${String(seed)}`).toBeLessThanOrEqual(96);
          expect(r.maxStepSpeed, `seed ${String(seed)}`).toBeLessThanOrEqual(STEP_CAP + EPS);
          expect(r.kills).toBeGreaterThanOrEqual(14);
        }
      },
    );
  }

  // Known limit (D6): a follower pinned between the leader and a wall or corner, with a follower
  // ahead of it blocking the way along the wall, has no overlap-free step, and the leader walks
  // over it. Over 240 one-minute walled runs about 2.5% exceed 6 px (worst seen 18 px). Every
  // run still keeps the step cap, and the large majority stays within 6 px.
  for (const [label, legMin, legMax] of LEGS) {
    it.each(FPS)(
      `arena walls, ${label}: step cap always, overlap ≤ 6 px in ≥ 90%% of runs at %i fps`,
      (fps) => {
        const runs = [...SEEDS, ...SEEDS.map((s) => s + 100)];
        let within = 0;
        let seedsOnEdge = 0;
        for (const seed of runs) {
          const r = fuzz(WALLED, seed, fps, legMin, legMax);
          expect(r.maxStepSpeed, `seed ${String(seed)}`).toBeLessThanOrEqual(STEP_CAP + EPS);
          expect(r.maxOverlapPx, `seed ${String(seed)}`).toBeLessThan(2 * R);
          if (r.maxOverlapPx <= 6) within++;
          if (r.edgeFrames > 0) seedsOnEdge++;
        }
        expect(within / runs.length).toBeGreaterThanOrEqual(0.9);
        // The runs must actually exercise the walls.
        expect(seedsOnEdge).toBeGreaterThanOrEqual(runs.length / 2);
      },
    );
  }
});
