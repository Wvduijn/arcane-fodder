/**
 * Goblin Hut (GDD §12): "shut the tap". A spawner that is also an enemy unit in the CombatWorld
 * (HP, Burning, area hits; autos pick it only when no unit is in range, selectTarget.ts). Its
 * death record carries `structure` (world.ts, death.ts), so the flush emits `hut:destroyed`,
 * never `unit:died`: huts count as targets, not kills.
 *
 * Spawner timeline, per hut (all numbers from the resolved HutDef):
 * - inactive: until the leader's centre is within `activateRadiusPx` (≤; 0 = always active).
 *   That frame it becomes active and the first spawn is due `firstSpawnDelayMs` later (the frame's
 *   own dt elapsed before activation, so it doesn't count).
 * - active: the countdown runs only while the leader is within the radius; outside it, it pauses
 *   where it is (huts off screen don't build up armies). When `spawnTellMs` is left, the door glow
 *   starts (`tellStarted`), but only if the hut has room (fewer than `maxAlive` of its spawns
 *   alive); a full hut holds the countdown at the tell until one of them dies. A started tell
 *   always runs out and spawns, even if the leader walks away (the tell never lies). At 0 the step
 *   returns `spawn` and the next spawn is due `spawnIntervalMs` later (the remainder carries).
 * - destroyed: once the hut is dead in the world. Nothing more happens; already-spawned grunts
 *   stay. The rubble keeps its solid footprint (the caller never removes the grid solid).
 *
 * API:
 * - `resolveHutDef(def, overrides)`: the data def with a map object's overrides on top (Tiled
 *   properties win, conventions §4.2).
 * - `hutFootprint(position, def)`: the square solid rect (top-left), centred on the hut. Add it to
 *   the CollisionGrid with `blocksShots: true` and the hut's EntityId.
 * - `defaultDoor(position, def, bodyRadiusPx)`: the door when the map has no `hut-spawn`: centred,
 *   just below the footprint's south edge, so a spawned body of `bodyRadiusPx` (the spawn enemy's)
 *   touches the wall without overlapping it. The view glows the same point the grunt appears at
 *   (unless a unit stands there; then `hutSpawnPoint` moves it to the nearest free tile).
 * - `hutUnitSpec(id, def)`: the CombatWorld spec (team `enemy`, `structure: 'goblin-hut'`,
 *   `footprintPx`, so area blasts hit it by its footprint, area.ts).
 * - `createHut(id, position, def, door)`: an inactive hut with no spawns.
 * - `stepHut(hut, input)`: one frame (see above) → `{ hut, activated, tellStarted, spawn,
 *   destroyed }`. `spawn` is `{ enemy, door }` or null; place it with `hutSpawnPoint`, create the
 *   enemy, then `recordHutSpawn`. `destroyed` is true on the one step that notices the death.
 * - `recordHutSpawn(hut, enemyId)`: counts a spawned enemy toward `maxAlive` until it dies.
 * - `hutSpawnPoint(grid, door, radiusPx, isFree)`: the door when a body of `radiusPx` fits there
 *   and `isFree` accepts it (no unit on it); otherwise the nearest free tile centre (GDD §12:
 *   "if it's blocked, they spawn at the nearest free tile"). Null only if the map has no room.
 */
import type { EnemyId, EntityId, HutDef, Rect, Vec2 } from '@core/types';
import type { CombatUnitSpec } from '@core/combat/world';
import { distance } from '@core/math/vec2';
import type { HutOverrides } from '@core/mission/mapData';
import type { CollisionGrid } from '@core/world/collisionGrid';

export type HutPhase = 'inactive' | 'active' | 'destroyed';

export interface HutState {
  readonly id: EntityId;
  readonly position: Vec2;
  readonly door: Vec2;
  /** Resolved (overrides applied). */
  readonly def: HutDef;
  readonly phase: HutPhase;
  /** ms until the next spawn; meaningful while active. */
  readonly untilSpawnMs: number;
  /** The door glow is on: a spawn comes when `untilSpawnMs` runs out. */
  readonly telling: boolean;
  /** Its spawns, still alive at the last step. Ascending id. */
  readonly spawned: readonly EntityId[];
}

export interface HutStepInput {
  /** The leader's position, or null when the squad is gone. */
  readonly leader: Vec2 | null;
  readonly dtMs: number;
  /** CombatWorld liveness, for the hut itself and its spawns. */
  readonly isAlive: (id: EntityId) => boolean;
}

export interface HutSpawn {
  readonly enemy: EnemyId;
  readonly door: Vec2;
}

export interface HutStep {
  readonly hut: HutState;
  readonly activated: boolean;
  readonly tellStarted: boolean;
  readonly spawn: HutSpawn | null;
  readonly destroyed: boolean;
}

/** Float slack for timers built from summed frame deltas (not a tuning value). */
const EPSILON_MS = 1e-6;

export function resolveHutDef(def: HutDef, overrides: HutOverrides): HutDef {
  return { ...def, ...overrides };
}

export function hutFootprint(position: Vec2, def: HutDef): Rect {
  const half = def.footprintPx / 2;
  return {
    x: position.x - half,
    y: position.y - half,
    width: def.footprintPx,
    height: def.footprintPx,
  };
}

export function defaultDoor(position: Vec2, def: HutDef, bodyRadiusPx: number): Vec2 {
  return { x: position.x, y: position.y + def.footprintPx / 2 + bodyRadiusPx };
}

export function hutUnitSpec(id: EntityId, def: HutDef): CombatUnitSpec {
  return {
    id,
    team: 'enemy',
    maxHp: def.maxHp,
    bodyRadiusPx: def.bodyRadiusPx,
    structure: def.id,
    footprintPx: def.footprintPx,
  };
}

export function createHut(id: EntityId, position: Vec2, def: HutDef, door: Vec2): HutState {
  return {
    id,
    position,
    door,
    def,
    phase: 'inactive',
    untilSpawnMs: def.firstSpawnDelayMs,
    telling: false,
    spawned: [],
  };
}

export function stepHut(hut: HutState, input: HutStepInput): HutStep {
  const quiet = { activated: false, tellStarted: false, spawn: null, destroyed: false };
  if (hut.phase === 'destroyed') return { hut, ...quiet };
  if (!input.isAlive(hut.id)) {
    return {
      hut: { ...hut, phase: 'destroyed', telling: false, spawned: [] },
      ...quiet,
      destroyed: true,
    };
  }
  const spawned = hut.spawned.filter((id) => input.isAlive(id));
  const near = isNear(hut, input.leader);
  if (hut.phase === 'inactive') {
    if (!near)
      return { hut: spawned.length === hut.spawned.length ? hut : { ...hut, spawned }, ...quiet };
    return {
      hut: { ...hut, phase: 'active', untilSpawnMs: hut.def.firstSpawnDelayMs, spawned },
      ...quiet,
      activated: true,
    };
  }

  const dt = Math.max(0, input.dtMs);
  const { def } = hut;
  let untilSpawnMs = hut.untilSpawnMs;
  let telling = hut.telling;
  let tellStarted = false;
  let spawn: HutSpawn | null = null;

  if (telling) {
    untilSpawnMs -= dt;
  } else if (near) {
    untilSpawnMs -= dt;
    if (untilSpawnMs <= def.spawnTellMs + EPSILON_MS) {
      if (spawned.length < def.maxAlive) {
        telling = true;
        tellStarted = true;
      } else {
        untilSpawnMs = Math.max(untilSpawnMs, def.spawnTellMs);
      }
    }
  }
  if (telling && !tellStarted && untilSpawnMs <= EPSILON_MS) {
    spawn = { enemy: def.spawnEnemy, door: hut.door };
    telling = false;
    untilSpawnMs = Math.max(0, def.spawnIntervalMs + untilSpawnMs);
  }
  return {
    hut: { ...hut, untilSpawnMs, telling, spawned },
    activated: false,
    tellStarted,
    spawn,
    destroyed: false,
  };
}

export function recordHutSpawn(hut: HutState, enemyId: EntityId): HutState {
  return { ...hut, spawned: [...hut.spawned, enemyId].sort((a, b) => a - b) };
}

export function hutSpawnPoint(
  grid: CollisionGrid,
  door: Vec2,
  radiusPx: number,
  isFree: (p: Vec2) => boolean = () => true,
): Vec2 | null {
  if (
    !grid.isBlockedTile(grid.tileAt(door)) &&
    !grid.overlapsSolid(door, radiusPx) &&
    isFree(door)
  ) {
    return door;
  }
  return grid.nearestFreeTile(door, { clearancePx: radiusPx, isFree });
}

function isNear(hut: HutState, leader: Vec2 | null): boolean {
  if (leader === null) return false;
  const radius = hut.def.activateRadiusPx;
  return radius === 0 || distance(hut.position, leader) <= radius;
}
