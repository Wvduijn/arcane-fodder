import type { SaveData } from '@core/save/save';

/**
 * The one way the game reads and writes the save (plan §7.4, M6 Q2). Implementations hold the
 * current save in memory and persist it where the platform allows; core's `migrate` brings any
 * stored version up to the latest. Created once at boot (main.ts) and handed to the game. The game
 * owns this contract and platform/storage implements it, so dependencies point down (plan §7.1).
 */
export interface SaveRepository {
  /** The current save, migrated. Never throws: missing or broken data gives the defaults. */
  load(): SaveData;
  /**
   * Replaces the save and persists it. Returns false when it wasn't written (the platform refused:
   * quota, private mode; or the stored save is from a newer build and must not be overwritten);
   * the in-memory save is still replaced, so the session keeps working.
   */
  save(data: SaveData): boolean;
  /** `save(change(load()))`, returning the new save. */
  update(change: (current: SaveData) => SaveData): SaveData;
}
