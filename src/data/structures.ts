/**
 * Structures (GDD §0 body radius, §8 Powder Keg, §12 Goblin Hut; readability §4). The keg is
 * neutral, never auto-targeted and has no HP. Kegs and huts are solid from M7 (collision layer).
 * Huts joined in M7.
 */
import type { HutDef, KegDef } from '@core/types';

export const KEG = {
  id: 'powder-keg',
  bodyRadiusPx: 8,
  footprintPx: 16,
} as const satisfies KegDef;

/**
 * Goblin Hut (GDD §12): "shut the tap". Spawns grunts while the leader is near, until destroyed.
 * Tiled `goblin-hut` properties may override the spawn fields per hut.
 */
export const HUT = {
  id: 'goblin-hut',
  target: 'goblin-hut',
  maxHp: 300,
  /** 4×4 tiles, the largest goblin object next to 48 px wizards. Rubble keeps it (GDD Q16). */
  footprintPx: 64,
  /** Inscribed in the footprint (half its side), so a body test never reaches past the walls. */
  bodyRadiusPx: 32,
  /** Off-screen huts don't build up armies. */
  activateRadiusPx: 400,
  firstSpawnDelayMs: 1500,
  spawnIntervalMs: 6000,
  maxAlive: 4,
  /** Door glow before each spawn. */
  spawnTellMs: 500,
  spawnEnemy: 'goblin-grunt',
} as const satisfies HutDef;
