/**
 * Convergence (GDD §9 meter, §10 channel and strike). The combo is the highest priority whose
 * `requires` are all alive at strike time (GDD Q5). Power = `CONVERGENCE.scaling[livingMages - 1]`
 * multiplies blast damage only: never radius, knockback, Burning ticks or the ground burn. Every
 * strike can gib (GDD §12a); death variants follow the element (no overrides). Barrage strikes
 * have no knockback, so the pack stays in the area for the follow-up strikes. Starting values,
 * tuned at playtest.
 */
import type { AreaBlastDef, ConvergenceDef, ConvergenceId, ConvergenceTuning } from '@core/types';

/** Firestorm's fire half: lands first and primes Burning for the bolts. */
const METEORLET = {
  element: 'fire',
  damage: 35,
  knockbackPx: 0,
  canGib: true,
  applies: 'burning',
  radiusPx: 40,
} as const satisfies AreaBlastDef;

/** Firestorm's storm half: pops the Burning the meteorlets left (Combust). */
const FIRESTORM_BOLT = {
  element: 'storm',
  damage: 15,
  knockbackPx: 0,
  canGib: true,
  radiusPx: 20,
} as const satisfies AreaBlastDef;

const THUNDERSTORM_BOLT = {
  element: 'storm',
  damage: 20,
  knockbackPx: 0,
  canGib: true,
  radiusPx: 24,
} as const satisfies AreaBlastDef;

export const CONVERGENCES = {
  /** Fire + storm: the best one. 6 meteorlets at 0…1500 step 300, 8 bolts at 400…1800 step 200. */
  firestorm: {
    id: 'firestorm',
    requires: ['fire', 'storm'],
    priority: 10,
    radiusPx: 140,
    pattern: {
      kind: 'barrage',
      durationMs: 2000,
      strikes: [
        { atMs: 0, blast: METEORLET },
        { atMs: 300, blast: METEORLET },
        { atMs: 400, blast: FIRESTORM_BOLT },
        { atMs: 600, blast: METEORLET },
        { atMs: 600, blast: FIRESTORM_BOLT },
        { atMs: 800, blast: FIRESTORM_BOLT },
        { atMs: 900, blast: METEORLET },
        { atMs: 1000, blast: FIRESTORM_BOLT },
        { atMs: 1200, blast: METEORLET },
        { atMs: 1200, blast: FIRESTORM_BOLT },
        { atMs: 1400, blast: FIRESTORM_BOLT },
        { atMs: 1500, blast: METEORLET },
        { atMs: 1600, blast: FIRESTORM_BOLT },
        { atMs: 1800, blast: FIRESTORM_BOLT },
      ],
    },
  },
  /** Fire only: one huge impact after a 400 ms shadow, then 4 s of burning ground. */
  meteor: {
    id: 'meteor',
    requires: ['fire'],
    priority: 1,
    radiusPx: 90,
    pattern: {
      kind: 'impact',
      fallMs: 400,
      blast: {
        element: 'fire',
        damage: 150,
        /** Fireball's push: a thump, not a scatter, so survivors stay on the burning ground. */
        knockbackPx: 24,
        canGib: true,
        applies: 'burning',
        radiusPx: 90,
      },
      groundBurn: { radiusPx: 90, durationMs: 4000, tickMs: 500, applies: 'burning' },
    },
  },
  /** Storm only: 10 bolts every 200 ms from release, on random enemies in the area. */
  thunderstorm: {
    id: 'thunderstorm',
    requires: ['storm'],
    priority: 1,
    radiusPx: 120,
    pattern: {
      kind: 'barrage',
      durationMs: 2000,
      strikes: [
        { atMs: 0, blast: THUNDERSTORM_BOLT },
        { atMs: 200, blast: THUNDERSTORM_BOLT },
        { atMs: 400, blast: THUNDERSTORM_BOLT },
        { atMs: 600, blast: THUNDERSTORM_BOLT },
        { atMs: 800, blast: THUNDERSTORM_BOLT },
        { atMs: 1000, blast: THUNDERSTORM_BOLT },
        { atMs: 1200, blast: THUNDERSTORM_BOLT },
        { atMs: 1400, blast: THUNDERSTORM_BOLT },
        { atMs: 1600, blast: THUNDERSTORM_BOLT },
        { atMs: 1800, blast: THUNDERSTORM_BOLT },
      ],
    },
  },
} as const satisfies { readonly [K in ConvergenceId]: ConvergenceDef & { readonly id: K } };

export const CONVERGENCE = {
  meterMax: 100,
  /** 40 → 65 (M6 T8): the dev 6-grunt fight gives 38.4, so the first fight fills it (GDD §9). */
  meterStart: 65,
  chargePerDamage: 0.1,
  chargePerKill: 4,
  chargePerHutDestroyed: 10,
  /** The surge always starts with at least half a meter (GDD Q20). */
  chargeOnPortalOpen: 50,
  channelMs: 1200,
  scaling: [1, 1.5, 2, 2.5],
} as const satisfies ConvergenceTuning;
