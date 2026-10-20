/**
 * Reactions (GDD §7 Combust, §8 Kaboom). Combust consumes Burning on the origin (GDD Q15) and never
 * hurts wizards. Kaboom is triggered by fire, storm and arcane (GDD Q6), hits wizards at half damage
 * (GDD Q2) and dies as blood with gibs (GDD §12a). All are starting values, tuned at playtest.
 */
import type { ReactionDef, ReactionId } from '@core/types';

export const REACTIONS = {
  /** Burning + storm hit: a small pop that spreads Burning to the neighbours. */
  combust: {
    id: 'combust',
    status: 'burning',
    triggerElement: 'storm',
    consumesStatus: true,
    blast: {
      element: 'fire',
      /** 10 → 3, CD 2026-10-19 (M5 T6 M1 sweep): lets the grunt pack reach the squad. */
      damage: 3,
      knockbackPx: 0,
      canGib: false,
      applies: 'burning',
      radiusPx: 32,
    },
  },
  /** Powder keg: 300 ms fuse with the ring, then a big blast that also hits the squad. */
  kaboom: {
    id: 'kaboom',
    triggerElements: ['fire', 'storm', 'arcane'],
    fuseMs: 300,
    blast: {
      element: 'fire',
      damage: 60,
      knockbackPx: 36,
      canGib: true,
      deathVariant: 'blood',
      applies: 'burning',
      radiusPx: 72,
    },
    squadDamageMultiplier: 0.5,
  },
} as const satisfies { readonly [K in ReactionId]: Extract<ReactionDef, { readonly id: K }> };
