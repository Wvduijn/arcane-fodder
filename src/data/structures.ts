/**
 * Structures (GDD §0 body radius, §8 Powder Keg; readability §4). The keg is neutral, never
 * auto-targeted and has no HP. Not solid until M7's collision layer (M5 Q1). Huts join in M7.
 */
import type { KegDef } from '@core/types';

export const KEG = {
  id: 'powder-keg',
  bodyRadiusPx: 8,
  footprintPx: 16,
} as const satisfies KegDef;
