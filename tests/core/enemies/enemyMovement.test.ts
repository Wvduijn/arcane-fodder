import { describe, expect, it } from 'vitest';
import type { EnemyId, EntityId, Rect, Vec2 } from '@core/types';
import type { WizardView } from '@core/ai/goblin';
import {
  createEnemy,
  knockEnemy,
  moveEnemies,
  stepEnemies,
  type EnemyIntent,
  type EnemyState,
  type EnemyStepInput,
} from '@core/enemies/enemyMovement';
import { distance } from '@core/math/vec2';
import { COMBAT } from '@data/combat';
import { CLASSES } from '@data/classes';
import { ENEMIES } from '@data/enemies';
import { MOVEMENT } from '@data/movement';

const id = (n: number) => n as EntityId;
const v = (x: number, y: number): Vec2 => ({ x, y });
const GRUNT = ENEMIES['goblin-grunt'];
const BOUNDS: Rect = { x: 0, y: 0, width: 1000, height: 1000 };
const DT = 1000 / 60;
const STILL: EnemyIntent = { moveDirection: v(0, 0) };

const enemy = (n: number, x: number, y: number, kind: EnemyId = 'goblin-grunt'): EnemyState =>
  createEnemy(id(n), ENEMIES[kind], v(x, y));

const wiz = (n: number, x: number, y: number, alive = true): WizardView => ({
  id: id(n),
  position: v(x, y),
  bodyRadiusPx: MOVEMENT.wizardBodyRadiusPx,
  alive,
});

const input = (over: Partial<EnemyStepInput> = {}): EnemyStepInput => ({
  defs: ENEMIES,
  wizards: [],
  bounds: BOUNDS,
  isAlive: () => true,
  dtMs: DT,
  ...over,
});

const pos = (list: readonly EnemyState[], i: number): Vec2 => {
  const e = list[i];
  if (!e) throw new Error(`no enemy at ${String(i)}`);
  return e.position;
};

describe('moveEnemies: walking', () => {
  it.each([30, 60, 144])(
    'walks at exactly moveSpeed at %i fps, and reports that velocity',
    (fps) => {
      const dt = 1000 / fps;
      const [e] = moveEnemies(
        [enemy(1, 500, 500)],
        [{ moveDirection: v(1, 0) }],
        input({ dtMs: dt }),
      );
      expect(e?.position.x).toBeCloseTo(500 + (GRUNT.moveSpeed * dt) / 1000, 9);
      expect(e?.velocity.x).toBeCloseTo(GRUNT.moveSpeed, 9);
    },
  );

  it('stands still with no intent: velocity exactly zero', () => {
    const [e] = moveEnemies([enemy(1, 500, 500)], [STILL], input());
    expect(e?.position).toEqual(v(500, 500));
    expect(e?.velocity).toEqual(v(0, 0));
  });

  it('keeps the body circle inside the bounds', () => {
    const [e] = moveEnemies([enemy(1, 13, 500)], [{ moveDirection: v(-1, 0) }], input());
    expect(e?.position.x).toBe(GRUNT.bodyRadiusPx);
  });

  it('does nothing for dt <= 0', () => {
    const list = [enemy(1, 500, 500)];
    expect(moveEnemies(list, [{ moveDirection: v(1, 0) }], input({ dtMs: 0 }))).toEqual(list);
  });
});

describe('moveEnemies: separation', () => {
  it('pushes overlapping enemies apart, half each, until they no longer overlap', () => {
    const contact = 2 * GRUNT.bodyRadiusPx;
    let list: readonly EnemyState[] = [enemy(1, 500, 500), enemy(2, 510, 500)];
    for (let i = 0; i < 60; i++) list = moveEnemies(list, [STILL, STILL], input());
    expect(distance(pos(list, 0), pos(list, 1))).toBeCloseTo(contact, 6);
    // Symmetric: the midpoint is unchanged.
    expect((pos(list, 0).x + pos(list, 1).x) / 2).toBeCloseTo(505, 9);
  });

  it('never moves an enemy more than moveSpeed × dt per frame to separate', () => {
    const cap = (GRUNT.moveSpeed * DT) / 1000;
    const list = [enemy(1, 500, 500), enemy(2, 500.5, 500), enemy(3, 500, 500.5)];
    const next = moveEnemies(list, [STILL, STILL, STILL], input());
    next.forEach((e, i) => {
      expect(distance(e.position, pos(list, i))).toBeLessThanOrEqual(cap + 1e-9);
    });
  });

  it('separates coincident enemies deterministically: lower id goes −x', () => {
    const next = moveEnemies([enemy(2, 500, 500), enemy(1, 500, 500)], [STILL, STILL], input());
    expect(pos(next, 1).x).toBeLessThan(500);
    expect(pos(next, 0).x).toBeGreaterThan(500);
  });

  it('does not depend on the order enemies are listed in', () => {
    const a = [enemy(1, 500, 500), enemy(2, 505, 503), enemy(3, 498, 510)];
    const intents = [{ moveDirection: v(1, 0) }, { moveDirection: v(0, 1) }, STILL];
    const forward = moveEnemies(a, intents, input());
    const backward = moveEnemies([...a].reverse(), [...intents].reverse(), input()).reverse();
    forward.forEach((e, i) => {
      expect(e.position).toEqual(pos(backward, i));
    });
  });

  it('a dead enemy is frozen and does not push anyone (D4)', () => {
    const list = [enemy(1, 500, 500), enemy(2, 505, 500)];
    const isAlive = (n: EntityId) => n !== id(2);
    const next = moveEnemies(list, [STILL, { moveDirection: v(1, 0) }], input({ isAlive }));
    expect(next[1]).toBe(list[1]);
    expect(pos(next, 0)).toEqual(v(500, 500));
  });
});

describe('moveEnemies: yielding to wizards (M4 Q2)', () => {
  const contact = GRUNT.bodyRadiusPx + MOVEMENT.wizardBodyRadiusPx;

  it('an enemy walking into a wizard stops at touching distance', () => {
    let list: readonly EnemyState[] = [enemy(1, 400, 500)];
    const wizards = [wiz(1, 500, 500)];
    for (let i = 0; i < 120; i++) {
      list = moveEnemies(list, [{ moveDirection: v(1, 0) }], input({ wizards }));
      expect(distance(pos(list, 0), v(500, 500))).toBeGreaterThanOrEqual(contact - 1e-9);
    }
    expect(pos(list, 0).x).toBeCloseTo(500 - contact, 9);
  });

  it('a wizard stepping into an enemy pushes the enemy out; the wizard is never moved', () => {
    const wizards = [wiz(1, 500, 500)];
    const [e] = moveEnemies([enemy(1, 515, 500)], [STILL], input({ wizards }));
    expect(e?.position.x).toBeCloseTo(500 + contact, 9);
    expect(wizards[0]?.position).toEqual(v(500, 500));
  });

  it('ignores dead wizards', () => {
    const [e] = moveEnemies(
      [enemy(1, 505, 500)],
      [STILL],
      input({ wizards: [wiz(1, 500, 500, false)] }),
    );
    expect(e?.position).toEqual(v(505, 500));
  });
});

describe('knockback on enemies', () => {
  const BOLT = CLASSES.pyromancer.attack;

  it('moves a hit enemy knockbackPx along the hit direction over knockbackMs, eased', () => {
    let list: readonly EnemyState[] = [
      knockEnemy(enemy(1, 500, 500), GRUNT, v(0, -1), BOLT.knockbackPx, COMBAT.knockbackMs),
    ];
    const ys: number[] = [];
    for (let t = 0; t < COMBAT.knockbackMs + 50; t += DT) {
      list = moveEnemies(list, [STILL], input());
      ys.push(pos(list, 0).y);
    }
    expect(pos(list, 0).y).toBeCloseTo(500 - BOLT.knockbackPx, 9);
    expect(list[0]?.knockbacks).toEqual([]);
    // No teleport: every frame moves less than the whole push.
    ys.reduce((prev, y) => {
      expect(prev - y).toBeLessThan(BOLT.knockbackPx / 2);
      return y;
    }, 500);
  });

  it('sums with walking', () => {
    const k = knockEnemy(enemy(1, 500, 500), GRUNT, v(1, 0), BOLT.knockbackPx, 0);
    const [e] = moveEnemies([k], [{ moveDirection: v(0, 1) }], input());
    expect(e?.position.x).toBeCloseTo(500 + BOLT.knockbackPx, 9);
    expect(e?.position.y).toBeCloseTo(500 + (GRUNT.moveSpeed * DT) / 1000, 9);
  });

  it('is clamped to the bounds', () => {
    const k = knockEnemy(enemy(1, 14, 500), GRUNT, v(-1, 0), BOLT.knockbackPx, COMBAT.knockbackMs);
    let list: readonly EnemyState[] = [k];
    for (let i = 0; i < 20; i++) list = moveEnemies(list, [STILL], input());
    expect(pos(list, 0).x).toBe(GRUNT.bodyRadiusPx);
  });

  it('is ignored by an enemy that does not take knockback, or for 0 px', () => {
    const e = enemy(1, 500, 500);
    expect(knockEnemy(e, { ...GRUNT, takesKnockback: false }, v(1, 0), 6, 120)).toBe(e);
    expect(knockEnemy(e, GRUNT, v(1, 0), 0, 120)).toBe(e);
  });
});

describe('stepEnemies', () => {
  it('runs brains then bodies: a grunt aggroes and walks toward the wizard', () => {
    const { enemies, actions } = stepEnemies(
      [enemy(1, 500, 300)],
      input({ wizards: [wiz(9, 500, 500)] }),
    );
    expect(enemies[0]?.brain.machine.current).toBe('chase');
    expect(pos(enemies, 0).y).toBeCloseTo(300 + (GRUNT.moveSpeed * DT) / 1000, 9);
    expect(actions).toEqual([]);
  });

  it('reports released attacks in ascending enemy id order', () => {
    const wizards = [wiz(9, 500, 500)];
    let list: readonly EnemyState[] = [enemy(7, 500, 476), enemy(3, 476, 500)];
    const all: number[] = [];
    for (let i = 0; i < 30; i++) {
      const r = stepEnemies(list, input({ wizards }));
      list = r.enemies;
      all.push(...r.actions.map((a) => a.enemyId));
    }
    expect(all).toEqual([3, 7]);
  });

  it('a dead enemy reports zero velocity and drops its pushes, so a corpse never “walks”', () => {
    const walking = knockEnemy(
      { ...enemy(1, 500, 480), velocity: v(85, 0) },
      GRUNT,
      v(1, 0),
      CLASSES.pyromancer.attack.knockbackPx,
      COMBAT.knockbackMs,
    );
    const [e] = moveEnemies(
      [walking],
      [{ moveDirection: v(1, 0) }],
      input({ isAlive: () => false }),
    );
    expect(e).toMatchObject({ position: v(500, 480), velocity: v(0, 0), knockbacks: [] });
  });

  it('a dead enemy neither thinks, moves nor attacks (D4)', () => {
    const list = [enemy(1, 500, 480)];
    const r = stepEnemies(list, input({ wizards: [wiz(9, 500, 500)], isAlive: () => false }));
    expect(r.enemies[0]).toEqual(list[0]);
    expect(r.actions).toEqual([]);
  });
});
