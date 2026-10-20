/**
 * Granted spells (GDD §4). Slot order is fixed by class order: Fireball (Pyromancer) is slot 1,
 * Lightning (Stormcaller) slot 2. Spells never damage wizards and never gib (GDD §12a). Projectile
 * hit radius from GDD §0. All are starting values, tuned at playtest.
 */
import type { SpellDef, SpellId, SpellTuning } from '@core/types';

export const SPELLS = {
  /** The crowd answer: lob it into a pack. Effective reach on a grunt 56 px. */
  fireball: {
    id: 'fireball',
    slot: 1,
    element: 'fire',
    damage: 28,
    knockbackPx: 24,
    canGib: false,
    applies: 'burning',
    radiusPx: 44,
    cooldownMs: 3500,
    delivery: { kind: 'projectile', speed: 260, projectileRadiusPx: 6 },
  },
  /** The scalpel: one-shots an archer or a grunt. Effective reach 18–20 px. */
  lightning: {
    id: 'lightning',
    slot: 2,
    element: 'storm',
    damage: 30,
    knockbackPx: 0,
    canGib: false,
    radiusPx: 8,
    cooldownMs: 2000,
    delivery: { kind: 'strike', telegraphMs: 250 },
  },
} as const satisfies Record<SpellId, SpellDef>;

export const SPELL_TUNING = {
  maxCastRangePx: 280,
} as const satisfies SpellTuning;
