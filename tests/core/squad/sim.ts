/** Squad simulation harness for the GDD §1 Verify tests: drives stepSquad and records metrics. */
import type { EntityId, MovementTuning, Rect, TrailTuning, Vec2 } from '@core/types';
import { clampToRect, insetRect, moveVectorFromAxes, stepPosition } from '@core/math/movement';
import { distance } from '@core/math/vec2';
import { stepSquad } from '@core/squad/follow';
import { createSquad, slotPosition, type SquadState } from '@core/squad/squad';

/** Leader input (axes, each -1..1) at time `tMs` since the start of the run. */
export type Pattern = (tMs: number) => Vec2;

export interface SimMetrics {
  /** Largest body-circle overlap between any two members, in px. */
  maxOverlapPx: number;
  /** Largest follower distance from its slot, in px. */
  maxSlotErrorPx: number;
  /** Largest follower step divided by that step's dt, in px/s. */
  maxStepSpeed: number;
  /** Largest follower step relative to the allowed cap (≤ 1 holds the bound). */
  maxStepRatio: number;
}

export interface SimOptions {
  readonly trail: TrailTuning;
  readonly movement: MovementTuning;
  readonly arena: Rect;
  readonly size: number;
  readonly dtMs: number;
  readonly durationMs: number;
  readonly pattern: Pattern;
  /** Called after every step with the new state, the time and whether the leader just stood still. */
  readonly onStep?: (state: SquadState, tMs: number, leaderStill: boolean) => void;
  readonly start?: SquadState;
}

export function spawnSquad(trail: TrailTuning, arena: Rect, size: number): SquadState {
  return createSquad(
    {
      ids: Array.from({ length: size }, (_, i) => (i + 1) as EntityId),
      leaderPosition: { x: arena.x + arena.width / 2, y: arena.y + arena.height / 2 },
      behind: { x: 0, y: 1 },
    },
    trail,
  );
}

export function overlapPx(state: SquadState, bodyRadiusPx: number): number {
  let max = Number.NEGATIVE_INFINITY;
  state.members.forEach((a, i) => {
    for (const b of state.members.slice(i + 1)) {
      max = Math.max(max, 2 * bodyRadiusPx - distance(a.position, b.position));
    }
  });
  return max;
}

export function slotErrorPx(state: SquadState, trail: TrailTuning): number {
  let max = 0;
  state.members.forEach((m, k) => {
    if (k > 0) max = Math.max(max, distance(m.position, slotPosition(state, k, trail)));
  });
  return max;
}

export function runSim(options: SimOptions): { state: SquadState; metrics: SimMetrics } {
  const { trail, movement, arena, dtMs } = options;
  const cap = movement.squadMoveSpeed * (trail.catchUpMultiplier + trail.separationMaxSpeedFactor);
  let state = options.start ?? spawnSquad(trail, arena, options.size);
  const metrics: SimMetrics = {
    maxOverlapPx: Number.NEGATIVE_INFINITY,
    maxSlotErrorPx: 0,
    maxStepSpeed: 0,
    maxStepRatio: 0,
  };
  // The feet rect, as game code builds it: leader and followers share it, clamped with inset 0.
  const r = movement.wizardBodyRadiusPx;
  const walkable = insetRect(arena, { top: r, right: r, bottom: r, left: r });
  const steps = Math.round(options.durationMs / dtMs);
  for (let i = 0; i < steps; i++) {
    const t = i * dtMs;
    const axes = options.pattern(t);
    const move = moveVectorFromAxes(axes.x, axes.y);
    const leader = state.members[0];
    if (!leader) break;
    const leaderPosition = clampToRect(
      stepPosition(leader.position, move, movement.squadMoveSpeed, dtMs),
      walkable,
      0,
    );
    const next = stepSquad(state, { leaderPosition, walkable, dtMs }, trail, movement);
    next.members.forEach((m, k) => {
      const before = state.members[k];
      if (k === 0 || !before) return;
      const speed = distance(before.position, m.position) / (dtMs / 1000);
      metrics.maxStepSpeed = Math.max(metrics.maxStepSpeed, speed);
      metrics.maxStepRatio = Math.max(metrics.maxStepRatio, speed / cap);
    });
    state = next;
    metrics.maxOverlapPx = Math.max(
      metrics.maxOverlapPx,
      overlapPx(state, movement.wizardBodyRadiusPx),
    );
    metrics.maxSlotErrorPx = Math.max(metrics.maxSlotErrorPx, slotErrorPx(state, trail));
    options.onStep?.(state, t + dtMs, move.x === 0 && move.y === 0);
  }
  return { state, metrics };
}

/** Digital 8-direction input cycling through `dirs`, holding each for `holdMs`. */
export function cycle(dirs: readonly Vec2[], holdMs: number): Pattern {
  return (t) => dirs[Math.floor(t / holdMs) % dirs.length] ?? { x: 0, y: 0 };
}

/** Analog circle: the stick turns once every `periodMs`. */
export function analogCircle(periodMs: number): Pattern {
  return (t) => {
    const a = (2 * Math.PI * t) / periodMs;
    return { x: Math.cos(a), y: Math.sin(a) };
  };
}

/**
 * Walks `pattern` for `walkMs`, stands still for `stillMs`, and repeats. The pattern's clock pauses
 * while standing, so the leader resumes the heading it stopped on.
 */
export function stopStart(pattern: Pattern, walkMs: number, stillMs: number): Pattern {
  return (t) => {
    const cycleMs = walkMs + stillMs;
    const inCycle = t % cycleMs;
    if (inCycle >= walkMs) return { x: 0, y: 0 };
    return pattern(Math.floor(t / cycleMs) * walkMs + inCycle);
  };
}

export const DIR = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  upRight: { x: 1, y: -1 },
  downRight: { x: 1, y: 1 },
  upLeft: { x: -1, y: -1 },
  downLeft: { x: -1, y: 1 },
} as const satisfies Record<string, Vec2>;
