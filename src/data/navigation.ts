/**
 * Enemy navigation (M7, CD Q2). A flow field toward the wizards on the tile grid; enemies follow it
 * only when the straight line to their target is blocked. Starting value, tuned at playtest.
 */
import type { NavigationTuning } from '@core/types';

export const NAVIGATION = {
  /** Goblins react to the squad rounding a tree within a quarter second; the BFS stays cheap. */
  flowFieldRebuildMs: 250,
} as const satisfies NavigationTuning;
