/** M7 brain additions: aggro `always` (surge, ADR 0007), `alert-group`, archer posts, sight. */
import { describe, expect, it } from 'vitest';
import type { EntityId, Vec2 } from '@core/types';
import { alertGoblin, createGoblinBrain, stepGoblin, type WizardView } from '@core/ai/goblin';
import { alertEnemies, createEnemy } from '@core/enemies/enemyMovement';
import { ENEMIES } from '@data/enemies';
import { MOVEMENT } from '@data/movement';

const GRUNT = ENEMIES['goblin-grunt'];
const ARCHER = ENEMIES['goblin-archer'];
const DT = 1000 / 60;
const v = (x: number, y: number): Vec2 => ({ x, y });
const id = (n: number) => n as EntityId;
const wiz = (n: number, p: Vec2): WizardView => ({
  id: id(n),
  position: p,
  bodyRadiusPx: MOVEMENT.wizardBodyRadiusPx,
  alive: true,
});
const self = (p: Vec2) => ({ id: id(50), position: p, alive: true });

describe("aggro 'always' (GDD §13)", () => {
  const far = [wiz(1, v(2000, 0)), wiz(2, v(-1500, 0))];

  it('a radius brain ignores a wizard beyond aggroRadiusPx', () => {
    const s = stepGoblin(createGoblinBrain(GRUNT), {
      def: GRUNT,
      self: self(v(0, 0)),
      wizards: far,
      dtMs: DT,
    });
    expect(s.brain.machine.current).toBe('idle');
    expect(s.brain.aggro).toBe('radius');
  });

  it("an 'always' brain picks the nearest wizard at any range on its first step", () => {
    for (const def of [GRUNT, ARCHER]) {
      const s = stepGoblin(createGoblinBrain(def, { aggro: 'always' }), {
        def,
        self: self(v(0, 0)),
        wizards: far,
        dtMs: DT,
      });
      expect(s.brain.target).toBe(2);
      expect(s.brain.machine.current).not.toBe('idle');
    }
  });

  it('createEnemy passes the aggro to the brain; alertEnemies switches only the listed ones', () => {
    const a = createEnemy(id(10), GRUNT, v(0, 0), { aggro: 'always' });
    const b = createEnemy(id(11), GRUNT, v(0, 0));
    const c = createEnemy(id(12), GRUNT, v(0, 0));
    expect(a.brain.aggro).toBe('always');
    expect(b.brain.aggro).toBe('radius');
    const [a2, b2, c2] = alertEnemies([a, b, c], new Set([id(11)]));
    expect(a2).toBe(a);
    expect(b2?.brain.aggro).toBe('always');
    expect(c2).toBe(c);
    expect(alertGoblin(a.brain)).toBe(a.brain);
  });
});

describe('archer posts (tiled-conventions §4.1)', () => {
  const post = { position: v(100, 100), holdRadiusPx: 24 };

  it('an idle archer off its post walks back to it', () => {
    const s = stepGoblin(createGoblinBrain(ARCHER), {
      def: ARCHER,
      self: self(v(100, 200)),
      wizards: [],
      dtMs: DT,
      post,
    });
    expect(s.moveDirection).toEqual(v(0, -1));
  });

  it('within holdRadius it stands', () => {
    const s = stepGoblin(createGoblinBrain(ARCHER), {
      def: ARCHER,
      self: self(v(100, 124)),
      wizards: [],
      dtMs: DT,
      post,
    });
    expect(s.moveDirection).toEqual(v(0, 0));
  });

  it('once aggroed the post no longer holds it', () => {
    const wizards = [wiz(1, v(100, 400))];
    let brain = createGoblinBrain(ARCHER);
    let dir = v(0, 0);
    for (let i = 0; i < 3; i++) {
      const s = stepGoblin(brain, {
        def: ARCHER,
        self: self(v(100, 200)),
        wizards,
        dtMs: DT,
        post,
      });
      brain = s.brain;
      dir = s.moveDirection;
    }
    expect(brain.machine.current).not.toBe('idle');
    // 200 px away, in range: it stands and draws instead of walking back to the post (north).
    expect(dir.y).toBeGreaterThanOrEqual(0);
  });
});

describe('archer sight (CD Q3)', () => {
  it('prefers a visible wizard over a nearer hidden one when it picks', () => {
    const hidden = wiz(1, v(150, 0));
    const seen = wiz(2, v(0, 180));
    const s = stepGoblin(createGoblinBrain(ARCHER, { aggro: 'always' }), {
      def: ARCHER,
      self: self(v(0, 0)),
      wizards: [hidden, seen],
      dtMs: DT,
      lineOfSight: (_from, to) => to.x === 0,
    });
    // Aggro takes the nearest (aggro ignores sight); the first retarget prefers the visible one.
    expect(s.brain.target).toBe(1);
    let brain = s.brain;
    for (let t = 0; t <= ARCHER.retargetMs; t += DT) {
      brain = stepGoblin(brain, {
        def: ARCHER,
        self: self(v(0, 0)),
        wizards: [hidden, seen],
        dtMs: DT,
        lineOfSight: (_from, to) => to.x === 0,
      }).brain;
    }
    expect(brain.target).toBe(2);
  });

  it('walks toward a hidden target instead of drawing', () => {
    let brain = createGoblinBrain(ARCHER);
    const wizards = [wiz(1, v(170, 0))];
    for (let i = 0; i < 30; i++) {
      const s = stepGoblin(brain, {
        def: ARCHER,
        self: self(v(0, 0)),
        wizards,
        dtMs: DT,
        lineOfSight: () => false,
      });
      brain = s.brain;
      expect(brain.machine.current).not.toBe('draw');
      if (brain.machine.current === 'keep-range') expect(s.moveDirection).toEqual(v(1, 0));
    }
  });
});
