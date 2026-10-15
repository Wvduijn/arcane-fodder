/** Dev arena world bounds, M01's size (M2 Q3). Temporary: M7's TilemapLoader reads the size from the map JSON. */
import type { Rect } from '@core/types';

export const DEV_ARENA = {
  x: 0,
  y: 0,
  width: 2048,
  height: 1536,
} as const satisfies Rect;
