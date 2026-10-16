import type Phaser from 'phaser';
import type { EntityId, Vec2 } from '@core/types';

/** Anything the camera or debug views can track. */
export interface Positioned {
  readonly position: Readonly<Vec2>;
}

/** Whoever leads right now. Null once the squad is wiped. Read it every frame; it changes on succession. */
export interface LeaderSource {
  readonly leader: Positioned | null;
}

/**
 * Finds a unit's view by id. Squad and enemy systems implement it; views (flash, bars, overlays,
 * death puffs) read through it.
 */
export interface UnitLookup {
  /**
   * Feet position. For a unit that just died: where it fell, at least while its `unit:died` is
   * emitted (enemies forget it on their next update). Undefined for unknown ids.
   */
  positionOf(id: EntityId): Readonly<Vec2> | undefined;
  /** The live sprite; undefined once the unit is dead or for unknown ids. */
  spriteOf(id: EntityId): Phaser.GameObjects.Image | undefined;
}

/** Searches each source in turn. */
export function combineLookups(...sources: readonly UnitLookup[]): UnitLookup {
  return {
    positionOf: (id) => {
      for (const source of sources) {
        const position = source.positionOf(id);
        if (position) return position;
      }
      return undefined;
    },
    spriteOf: (id) => {
      for (const source of sources) {
        const sprite = source.spriteOf(id);
        if (sprite) return sprite;
      }
      return undefined;
    },
  };
}
