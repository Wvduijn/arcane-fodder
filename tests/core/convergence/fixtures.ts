/**
 * Convergence and Volunteer! test fixtures with the GDD §9–§11 numbers. Rule tests use these so
 * they don't move when game-designer retunes src/data; the sims use the real data.
 */
import type {
  ConvergenceDef,
  ConvergenceTuning,
  EntityId,
  MageClassId,
  VolunteerTuning,
} from '@core/types';

export const P: MageClassId = 'pyromancer';
export const S: MageClassId = 'stormcaller';

/** The 8 living-squad compositions of GDD §5, with the combo and power GDD §10 gives each. */
export const COMPOSITIONS: readonly (readonly [
  name: string,
  classes: readonly MageClassId[],
  combo: ConvergenceDef['id'],
  power: number,
])[] = [
  ['P', [P], 'meteor', 1],
  ['S', [S], 'thunderstorm', 1],
  ['PP', [P, P], 'meteor', 1.5],
  ['SS', [S, S], 'thunderstorm', 1.5],
  ['PS', [P, S], 'firestorm', 1.5],
  ['PPS', [P, P, S], 'firestorm', 2],
  ['PSS', [P, S, S], 'firestorm', 2],
  ['PPSS', [P, P, S, S], 'firestorm', 2.5],
];

const range = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let t = from; t <= to; t += step) out.push(t);
  return out;
};

export const FIRESTORM = {
  id: 'firestorm',
  requires: ['fire', 'storm'],
  priority: 10,
  radiusPx: 140,
  pattern: {
    kind: 'barrage',
    durationMs: 2000,
    strikes: [
      ...range(0, 1500, 300).map((atMs) => ({
        atMs,
        blast: {
          element: 'fire' as const,
          damage: 35,
          knockbackPx: 0,
          canGib: true,
          applies: 'burning' as const,
          radiusPx: 40,
        },
      })),
      ...range(400, 1800, 200).map((atMs) => ({
        atMs,
        blast: {
          element: 'storm' as const,
          damage: 15,
          knockbackPx: 0,
          canGib: true,
          radiusPx: 20,
        },
      })),
    ],
  },
} as const satisfies ConvergenceDef;

export const METEOR = {
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
      knockbackPx: 40,
      canGib: true,
      applies: 'burning',
      radiusPx: 90,
    },
    groundBurn: { radiusPx: 90, durationMs: 4000, tickMs: 500, applies: 'burning' },
  },
} as const satisfies ConvergenceDef;

export const THUNDERSTORM = {
  id: 'thunderstorm',
  requires: ['storm'],
  priority: 1,
  radiusPx: 120,
  pattern: {
    kind: 'barrage',
    durationMs: 2000,
    strikes: range(0, 1800, 200).map((atMs) => ({
      atMs,
      blast: { element: 'storm' as const, damage: 20, knockbackPx: 0, canGib: true, radiusPx: 24 },
    })),
  },
} as const satisfies ConvergenceDef;

export const CONVERGENCE_DEFS: readonly ConvergenceDef[] = [FIRESTORM, METEOR, THUNDERSTORM];

export const TUNING = {
  meterMax: 100,
  meterStart: 40,
  chargePerDamage: 0.1,
  chargePerKill: 4,
  chargePerHutDestroyed: 10,
  chargeOnPortalOpen: 50,
  channelMs: 1200,
  scaling: [1, 1.5, 2, 2.5],
} as const satisfies ConvergenceTuning;

export const VOLUNTEER_TUNING = {
  sprintSpeed: 180,
  fuseMs: 1500,
  cooldownMs: 12000,
  blast: {
    element: 'arcane',
    damage: 80,
    knockbackPx: 30,
    canGib: true,
    radiusPx: 64,
  },
} as const satisfies VolunteerTuning;

export const id = (n: number): EntityId => n as EntityId;
