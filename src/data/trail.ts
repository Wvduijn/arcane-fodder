/**
 * Breadcrumb-trail follow tuning (GDD §1). Spacing, separation and catch-up from GDD §1; arrive,
 * stop and the separation cap approved by the creative director on 2026-10-15 (M3 Q5).
 * All are starting values, tuned at playtest.
 */
import type { TrailTuning } from '@core/types';

export const TRAIL = {
  breadcrumbSpacingPx: 4,
  followerSpacingPx: 26,
  separationRadiusPx: 20,
  catchUpDistancePx: 48,
  catchUpMultiplier: 1.3,
  arriveRadiusPx: 16,
  stopRadiusPx: 3,
  separationMaxSpeedFactor: 0.5,
} as const satisfies TrailTuning;
