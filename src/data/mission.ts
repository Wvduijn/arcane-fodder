/**
 * Portal and final surge (GDD §13). Shared by every mission; per-mission numbers (extraction
 * radius, surge wave) live in each MissionDef. Starting values, tuned at playtest.
 */
import type { PortalTuning, SurgeTuning } from '@core/types';

export const PORTAL = {
  /** Last rune → enterable: burst and swirl, the surge spawns at its start. */
  openingMs: 1500,
  /** The leader's centre this close to the portal centre ends the mission. */
  triggerRadiusPx: 24,
  /** Start → portal → start before control begins, skippable (level doc m01 §2). */
  introPanMs: 3000,
} as const satisfies PortalTuning;

export const SURGE = {
  /** A surge point this close to any wizard is skipped; its share moves to the next point. */
  minSpawnDistancePx: 160,
  /**
   * Surge enemies alive at once; held-back spawns release as they die. Serves the GDD §12 peak of
   * ≤ 12 on screen, which counts every enemy, so leftover section goblins can push past it (checked at T18).
   */
  maxAlive: 12,
} as const satisfies SurgeTuning;
