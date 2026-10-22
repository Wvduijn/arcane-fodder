import type { EntityId, Rect } from '@core/types';
import { collisionGridOf, type MissionMap } from '@core/mission/mapData';
import type { CollisionGrid } from '@core/world/collisionGrid';
import type { System } from './System';

/**
 * The run's tile collision (GDD §1, §3, §12; M7 architecture): core's {@link CollisionGrid} built
 * from the map's `blockers` layer, plus the dynamic solids structures register (kegs until their
 * Kaboom, huts and their rubble for good). Collision is applied inside core's steps; every system
 * that moves or shoots gets this one grid. Nothing to step per frame.
 */
export class CollisionSystem implements System {
  readonly grid: CollisionGrid;
  /** Dynamic solids registered now (debug, restart leak log). */
  private readonly solids = new Set<EntityId>();

  constructor(map: MissionMap) {
    this.grid = collisionGridOf(map);
  }

  /** Dynamic solids registered now (debug, restart leak log). */
  get solidCount(): number {
    return this.solids.size;
  }

  /** A structure's footprint becomes solid. `blocksShots`: huts and rubble yes, kegs no (GDD §3). */
  addSolid(id: EntityId, rect: Rect, blocksShots: boolean): void {
    this.grid.addSolid({ id, rect, blocksShots });
    this.solids.add(id);
  }

  /** A keg went off: its tile is free again. A no-op for an unknown id. */
  removeSolid(id: EntityId): void {
    if (this.grid.hasSolid(id)) this.grid.removeSolid(id);
    this.solids.delete(id);
  }

  update(): void {
    // Static per run: structures add and remove their solids when they spawn and go off.
  }

  destroy(): void {
    // The grid is plain data owned by this run; nothing registered outside it.
    this.solids.clear();
  }
}
