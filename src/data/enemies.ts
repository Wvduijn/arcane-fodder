/**
 * MVP goblins (GDD §12, body radius GDD §0). Grunt windupMs and archer retargetMs approved by the
 * creative director on 2026-10-16 (M4 Q3). All are starting values, tuned at playtest.
 */
import type { EnemyDef, EnemyId } from '@core/types';

export const ENEMIES = {
  /** "Swarms you. Answer with area damage." */
  'goblin-grunt': {
    id: 'goblin-grunt',
    maxHp: 24,
    moveSpeed: 85,
    bodyRadiusPx: 12,
    aggroRadiusPx: 220,
    retargetMs: 500,
    takesKnockback: true,
    behaviour: { kind: 'swarm' },
    attack: {
      kind: 'melee',
      element: 'physical',
      damage: 6,
      knockbackPx: 0,
      canGib: false,
      /** Body contact (bodyRadiusPx + MOVEMENT.wizardBodyRadiusPx) plus reach (GDD §12). */
      rangePx: 28,
      cooldownMs: 900,
      windupMs: 150,
    },
  },
  /** "Outranges you. Push in, or snipe with Lightning." */
  'goblin-archer': {
    id: 'goblin-archer',
    maxHp: 18,
    moveSpeed: 70,
    bodyRadiusPx: 10,
    aggroRadiusPx: 260,
    retargetMs: 500,
    takesKnockback: true,
    behaviour: { kind: 'keep-range', retreatBelowPx: 120, advanceAbovePx: 200 },
    attack: {
      kind: 'projectile',
      element: 'physical',
      damage: 5,
      knockbackPx: 0,
      canGib: false,
      rangePx: 220,
      cooldownMs: 1800,
      projectileSpeed: 200,
      projectileRadiusPx: 4,
      drawMs: 300,
    },
  },
} as const satisfies Record<EnemyId, EnemyDef>;
