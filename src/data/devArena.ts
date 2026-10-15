/** Dev arena world bounds, M01's size (M2 Q3). Temporary: M7's TilemapLoader reads the size from the map JSON. */
import type { DevSquadConfig, Rect } from '@core/types';

export const DEV_ARENA = {
  x: 0,
  y: 0,
  width: 2048,
  height: 1536,
} as const satisfies Rect;

/**
 * Dev arena squad (M3). Temporary: M7's mission data supplies the roster.
 * nameSeed is arbitrary but fixed; each restart uses nameSeed + attempt (GDD Q17).
 */
export const DEV_SQUAD = {
  size: 4,
  nameSeed: 1337,
} as const satisfies DevSquadConfig;
