/**
 * Map-driven spawning helpers (M7, tiled-conventions §4.1, §4.3): which enemy spawns are active,
 * trigger zones, and where exactly a scattered enemy lands.
 *
 * API:
 * - `initialSpawns(map)`: the `enemy-spawn` objects without a trigger (active at mission start).
 *   Archer posts are always spawned at the start (one archer each, conventions §4.1).
 * - `spawnsForTrigger(map, triggerName)`: the `enemy-spawn` objects whose `trigger` is that zone
 *   (`activate-group`).
 * - `createTriggers(zones)` / `stepTriggers(state, leader)`: a trigger fires when the leader's
 *   centre enters its rect (edges count as inside). `once` (default) fires on the first entry
 *   only; otherwise on every entry (outside → inside). Fired triggers come back in map order.
 *   No leader (wiped): nothing fires, and the leader counts as outside.
 * - `scatterPositions(centre, count, radiusPx, rng, placement)`: `count` positions spread uniformly
 *   over the disc of `radiusPx` around `centre`, in a fixed order from the seeded rng. With
 *   `placement.grid`, a position where a body of `placement.bodyRadiusPx` would overlap a solid
 *   (a blocker tile, or a dynamic solid: a keg, a hut) moves to the nearest free tile centre with that clearance (or the centre, if none).
 */
import type { Rect, Vec2 } from '@core/types';
import type { Rng } from '@core/rng/rng';
import type { CollisionGrid } from '@core/world/collisionGrid';
import type { EnemySpawnObject, MissionMap, TriggerZone } from '@core/mission/mapData';

export interface TriggerState {
  readonly zones: readonly TriggerZone[];
  /** Names that fired and are `once`: never again. */
  readonly spent: ReadonlySet<string>;
  /** Names the leader stood in at the last step. */
  readonly inside: ReadonlySet<string>;
}

export interface TriggerStep {
  readonly state: TriggerState;
  readonly fired: readonly TriggerZone[];
}

export interface Placement {
  readonly grid?: CollisionGrid;
  readonly bodyRadiusPx: number;
}

export function initialSpawns(map: MissionMap): EnemySpawnObject[] {
  return map.enemySpawns.filter((s) => s.trigger === null);
}

export function spawnsForTrigger(map: MissionMap, triggerName: string): EnemySpawnObject[] {
  return map.enemySpawns.filter((s) => s.trigger === triggerName);
}

export function createTriggers(zones: readonly TriggerZone[]): TriggerState {
  return { zones, spent: new Set(), inside: new Set() };
}

export function stepTriggers(state: TriggerState, leader: Vec2 | null): TriggerStep {
  const inside = new Set<string>();
  const fired: TriggerZone[] = [];
  let spent: Set<string> | null = null;
  for (const zone of state.zones) {
    if (!leader || !inRect(leader, zone.rect)) continue;
    inside.add(zone.name);
    if (state.inside.has(zone.name) || state.spent.has(zone.name)) continue;
    fired.push(zone);
    if (zone.once) {
      spent ??= new Set(state.spent);
      spent.add(zone.name);
    }
  }
  return { state: { zones: state.zones, spent: spent ?? state.spent, inside }, fired };
}

export function scatterPositions(
  centre: Vec2,
  count: number,
  radiusPx: number,
  rng: Rng,
  placement: Placement,
): Vec2[] {
  return Array.from({ length: Math.max(0, count) }, () => {
    const r = radiusPx * Math.sqrt(rng.next());
    const angle = 2 * Math.PI * rng.next();
    const p = { x: centre.x + r * Math.cos(angle), y: centre.y + r * Math.sin(angle) };
    const grid = placement.grid;
    if (!grid?.overlapsSolid(p, placement.bodyRadiusPx)) return p;
    return grid.nearestFreeTile(p, { clearancePx: placement.bodyRadiusPx }) ?? centre;
  });
}

function inRect(p: Vec2, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}
