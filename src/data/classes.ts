/**
 * MVP mage classes and their auto-attacks (GDD §3). Body radius lives in MOVEMENT (GDD §0).
 * moveSpeed is kept per class for post-MVP; the squad moves at MOVEMENT.squadMoveSpeed (GDD Q9).
 * Autos never gib (GDD §12a). All are starting values, tuned at playtest.
 */
import type { ClassDef, MageClassId } from '@core/types';

export const CLASSES = {
  pyromancer: {
    id: 'pyromancer',
    role: 'damage',
    element: 'fire',
    maxHp: 60,
    moveSpeed: 110,
    attack: {
      kind: 'projectile',
      element: 'fire',
      damage: 8,
      knockbackPx: 6,
      canGib: false,
      applies: 'burning',
      rangePx: 180,
      cooldownMs: 900,
      projectileSpeed: 240,
      projectileRadiusPx: 4,
    },
    grantsSpell: 'fireball',
  },
  stormcaller: {
    id: 'stormcaller',
    role: 'damage',
    element: 'storm',
    maxHp: 50,
    moveSpeed: 120,
    attack: {
      kind: 'projectile',
      element: 'storm',
      damage: 4,
      knockbackPx: 0,
      canGib: false,
      rangePx: 160,
      cooldownMs: 400,
      projectileSpeed: 360,
      projectileRadiusPx: 4,
    },
    grantsSpell: 'lightning',
  },
} as const satisfies Record<MageClassId, ClassDef>;
