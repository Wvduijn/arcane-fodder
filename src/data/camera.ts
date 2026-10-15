/**
 * Camera follow tuning. Deadzone and follow half-life approved by the creative director (M2 Q2);
 * look-ahead added at the CD playtest of 2026-10-15. All are starting values, tuned at playtest.
 * lookAheadPx set to 112 by the CD on 2026-10-15: visible lead ≈ lookAheadPx − half-deadzone − follow lag,
 * which gave only ~+2.6 px at 64; at 112 it is ~50 px sideways and ~70 px vertically.
 * successionEaseMs (GDD §2) added in M3: the camera eases to a newly promoted leader instead of jumping.
 */
import type { CameraTuning } from '@core/types';

export const CAMERA = {
  deadzoneWidthPx: 96,
  deadzoneHeightPx: 54,
  followHalfLifeMs: 90,
  lookAheadPx: 112,
  lookAheadHalfLifeMs: 250,
  successionEaseMs: 300,
} as const satisfies CameraTuning;
