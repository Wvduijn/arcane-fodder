/**
 * The final surge (GDD §12 power curve, §13; ADR 0007). Starts at `portal:opened` and spawns the
 * wave from every `surge-spawn` map object whose `wave` is the mission's `finalSurge.waveId`
 * (`spawnPoints: 'all-remaining'`).
 *
 * Schedule, per step (`elapsedMs` counts from the opening):
 * 1. Points come due in schedule order: ascending `delayMs`, then map order.
 * 2. A due point with a living wizard closer than `minSpawnDistancePx` (centre to point, strictly
 *    closer) is skipped: its share (its own enemies, plus any share carried into it) moves to the
 *    next point in schedule order, and spawns there when that one comes due. A skipped *last* point
 *    keeps its share and hands it to the nearest point of the wave that is far enough from every
 *    wizard, retried every step until one is.
 * 3. A point that is far enough releases its share (and any carried share) as single-enemy orders,
 *    in that order, into the queue.
 * 4. The cap: at most `maxAlive` surge enemies alive at once (counted with `recordSurgeSpawn`; dead
 *    ones drop out at each step). Queued orders beyond it are held back and released, oldest first,
 *    as surge enemies die. A held order is re-checked when it releases: if a wizard has come within
 *    `minSpawnDistancePx` of its point, it goes to the nearest far-enough point of the wave instead
 *    (or waits while there is none).
 * Every order carries `aggro` (`'always'` for surge-01: it converges from spawn, GDD §13). The
 * caller scatters it within `radiusPx` of `position` (spawns.ts), creates the enemy, and calls
 * `recordSurgeSpawn`.
 *
 * API:
 * - `createSurge(points, waveId, aggro)`: not started; only the wave's points, in schedule order.
 * - `stepSurge(state, input)`: one step → `{ state, orders }`. `orders` are this step's spawns.
 *   A surge that has not started (`startSurge`) does nothing.
 * - `startSurge(state)`: the opening began.
 * - `recordSurgeSpawn(state, id)`: one spawned surge enemy, counted toward the cap.
 * - `surgeFinished(state)`: started, every point handled, nothing carried, queued or held. It stays
 *   false for as long as a carried or held order has no far-enough point (the squad standing within
 *   `minSpawnDistancePx` of every point of the wave): such an order waits, indefinitely if need be,
 *   and spawns on the first step a point is far enough again.
 */
import type { EnemyId, EntityId, SurgeTuning, Vec2, WaveAggro } from '@core/types';
import { distance } from '@core/math/vec2';
import type { SurgeSpawnObject } from '@core/mission/mapData';

export interface SurgeShare {
  readonly enemy: EnemyId;
  readonly count: number;
}

export interface SurgePoint {
  readonly name: string;
  readonly position: Vec2;
  readonly radiusPx: number;
  readonly delayMs: number;
  readonly share: SurgeShare;
}

/** One enemy to spawn now. */
export interface SurgeOrder {
  readonly enemy: EnemyId;
  /** The point it spawns at (after any skip). */
  readonly point: string;
  readonly position: Vec2;
  readonly radiusPx: number;
  readonly aggro: WaveAggro;
}

export interface SurgeState {
  readonly started: boolean;
  readonly elapsedMs: number;
  readonly aggro: WaveAggro;
  /** Every point of the wave, schedule order. */
  readonly points: readonly SurgePoint[];
  /** Index of the next point to come due. */
  readonly nextPoint: number;
  /** Shares skipped points handed on, waiting for the next point (or, after the last, any). */
  readonly carried: readonly SurgeShare[];
  /** Orders waiting for the cap, oldest first. */
  readonly queue: readonly SurgeOrder[];
  /** Spawned surge enemies alive at the last step. */
  readonly alive: readonly EntityId[];
}

export interface SurgeStepInput {
  readonly dtMs: number;
  /** Living wizards (squad and runners). */
  readonly wizards: readonly Vec2[];
  readonly isAlive: (id: EntityId) => boolean;
  readonly tuning: SurgeTuning;
}

export interface SurgeStep {
  readonly state: SurgeState;
  readonly orders: readonly SurgeOrder[];
}

/** Float slack for delays built from summed frame deltas (not a tuning value). */
const EPSILON_MS = 1e-6;

export function createSurge(
  objects: readonly SurgeSpawnObject[],
  waveId: string,
  aggro: WaveAggro,
): SurgeState {
  const points = objects
    .map((o, order) => ({ o, order }))
    .filter(({ o }) => o.wave === waveId)
    .sort((a, b) => a.o.delayMs - b.o.delayMs || a.order - b.order)
    .map(({ o }) => ({
      name: o.name,
      position: o.position,
      radiusPx: o.radiusPx,
      delayMs: o.delayMs,
      share: { enemy: o.enemy, count: o.count },
    }));
  return {
    started: false,
    elapsedMs: 0,
    aggro,
    points,
    nextPoint: 0,
    carried: [],
    queue: [],
    alive: [],
  };
}

export function startSurge(state: SurgeState): SurgeState {
  return state.started ? state : { ...state, started: true, elapsedMs: 0 };
}

export function stepSurge(state: SurgeState, input: SurgeStepInput): SurgeStep {
  if (!state.started) return { state, orders: [] };
  const { tuning } = input;
  const elapsedMs = state.elapsedMs + Math.max(0, input.dtMs);
  const alive = state.alive.filter((id) => input.isAlive(id));
  const farEnough = (p: Vec2) =>
    input.wizards.every((w) => distance(w, p) >= tuning.minSpawnDistancePx);
  const nearestValid = (from: Vec2): SurgePoint | null => {
    let best: SurgePoint | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const p of state.points) {
      if (!farEnough(p.position)) continue;
      const d = distance(from, p.position);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  };

  let nextPoint = state.nextPoint;
  let carried = [...state.carried];
  const queue = [...state.queue];
  const orderAt = (point: SurgePoint, share: SurgeShare): SurgeOrder[] =>
    Array.from({ length: share.count }, () => ({
      enemy: share.enemy,
      point: point.name,
      position: point.position,
      radiusPx: point.radiusPx,
      aggro: state.aggro,
    }));

  // 1–3. Points coming due.
  for (;;) {
    const point = state.points[nextPoint];
    if (!point || point.delayMs > elapsedMs + EPSILON_MS) break;
    nextPoint++;
    const shares = [point.share, ...carried];
    if (farEnough(point.position)) {
      carried = [];
      for (const share of shares) queue.push(...orderAt(point, share));
    } else {
      carried = shares;
    }
  }
  // A skipped last point: hand its share to the nearest far-enough point, when there is one.
  const last = state.points[state.points.length - 1];
  if (nextPoint >= state.points.length && carried.length > 0 && last) {
    const target = nearestValid(last.position);
    if (target) {
      for (const share of carried) queue.push(...orderAt(target, share));
      carried = [];
    }
  }

  // 4. Release under the cap, re-checking the spawn distance.
  const orders: SurgeOrder[] = [];
  let room = tuning.maxAlive - alive.length;
  let i = 0;
  while (room > 0 && i < queue.length) {
    const order = queue[i];
    if (!order) break;
    if (farEnough(order.position)) {
      orders.push(order);
    } else {
      const moved = nearestValid(order.position);
      if (!moved) {
        i++;
        continue;
      }
      orders.push({
        ...order,
        point: moved.name,
        position: moved.position,
        radiusPx: moved.radiusPx,
      });
    }
    queue.splice(i, 1);
    room--;
  }

  return {
    state: { ...state, elapsedMs, nextPoint, carried, queue, alive },
    orders,
  };
}

export function recordSurgeSpawn(state: SurgeState, id: EntityId): SurgeState {
  return { ...state, alive: [...state.alive, id] };
}

export function surgeFinished(state: SurgeState): boolean {
  return (
    state.started &&
    state.nextPoint >= state.points.length &&
    state.carried.length === 0 &&
    state.queue.length === 0
  );
}
