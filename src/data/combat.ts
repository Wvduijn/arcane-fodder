/**
 * Shared combat tuning. Retarget and range factor from GDD §3, gibs from GDD §12a; knockbackMs and
 * maxFrameDtMs approved by the creative director on 2026-10-16 (M4 Q3). Starting values.
 */
import type { CombatTuning, GibTuning } from '@core/types';

export const COMBAT = {
  retargetMs: 250,
  projectileRangeFactor: 1.2,
  knockbackMs: 120,
  maxFrameDtMs: 100,
} as const satisfies CombatTuning;

export const GIBS = {
  overkillRatio: 1.5,
  maxGibbedPerEvent: 4,
} as const satisfies GibTuning;
