import { describe, expect, it } from 'vitest';
import type { EnemyDef, EntityId, Vec2 } from '@core/types';
import {
  createGoblinBrain,
  stepGoblin,
  type GoblinAction,
  type GoblinBrain,
  type GoblinStep,
  type WizardView,
} from '@core/ai/goblin';
import { isReady } from '@core/combat/cooldown';
import { createEnemy, stepEnemies, type EnemyState } from '@core/enemies/enemyMovement';
import { ENEMIES } from '@data/enemies';
import { MOVEMENT } from '@data/movement';

const GRUNT: EnemyDef = ENEMIES['goblin-grunt'];
const ARCHER: EnemyDef = ENEMIES['goblin-archer'];
const GRUNT_ATTACK = ENEMIES['goblin-grunt'].attack;
const ARCHER_ATTACK = ENEMIES['goblin-archer'].attack;
const ARCHER_BANDS = ENEMIES['goblin-archer'].behaviour;
const WIZ_R = MOVEMENT.wizardBodyRadiusPx;
const SELF = 50 as EntityId;
const ORIGIN: Vec2 = { x: 0, y: 0 };

const wiz = (n: number, x: number, y = 0, alive = true): WizardView => ({
  id: n as EntityId,
  position: { x, y },
  bodyRadiusPx: WIZ_R,
  alive,
});

/** Steps one goblin standing at `position` (bodies are not moved here; brains only). */
function step(
  brain: GoblinBrain,
  def: EnemyDef,
  wizards: readonly WizardView[],
  dtMs = 1000 / 60,
  position: Vec2 = ORIGIN,
  alive = true,
): GoblinStep {
  return stepGoblin(brain, { def, self: { id: SELF, position, alive }, wizards, dtMs });
}

/** Runs `frames` steps with fixed wizards; returns the last step and every action with its time. */
function runFor(
  brain: GoblinBrain,
  def: EnemyDef,
  wizards: (tMs: number) => readonly WizardView[],
  durationMs: number,
  dtMs: number,
) {
  let current = brain;
  let last: GoblinStep | null = null;
  const actions: { t: number; action: GoblinAction }[] = [];
  const states: string[] = [];
  for (let i = 1; i * dtMs <= durationMs + 1e-9; i++) {
    const t = i * dtMs;
    last = step(current, def, wizards(t), dtMs);
    current = last.brain;
    states.push(current.machine.current);
    for (const action of last.actions) actions.push({ t, action });
  }
  if (!last) throw new Error('no steps');
  return { last, actions, states };
}

describe('Grunt: aggro', () => {
  it('stays idle with no wizard within aggroRadiusPx, and stands still', () => {
    const s = step(createGoblinBrain(GRUNT), GRUNT, [wiz(1, GRUNT.aggroRadiusPx + 0.01)]);
    expect(s.brain.machine.current).toBe('idle');
    expect(s.moveDirection).toEqual({ x: 0, y: 0 });
  });

  it('aggros on a wizard exactly at aggroRadiusPx (≤) and starts chasing it', () => {
    const s = step(createGoblinBrain(GRUNT), GRUNT, [wiz(1, GRUNT.aggroRadiusPx)]);
    expect(s.brain.machine.current).toBe('chase');
    expect(s.brain.target).toBe(1);
    expect(s.moveDirection.x).toBeCloseTo(1, 12);
  });

  it('aggros on the nearest wizard, ties by lowest id', () => {
    expect(step(createGoblinBrain(GRUNT), GRUNT, [wiz(3, 100), wiz(2, -150)]).brain.target).toBe(3);
    expect(step(createGoblinBrain(GRUNT), GRUNT, [wiz(3, 100), wiz(2, -100)]).brain.target).toBe(2);
  });

  it('ignores dead wizards for aggro', () => {
    const s = step(createGoblinBrain(GRUNT), GRUNT, [wiz(1, 50, 0, false)]);
    expect(s.brain.machine.current).toBe('idle');
  });
});

describe('Grunt: chase, wind-up, swing, recover', () => {
  it('chases until the bodies touch, then stops walking', () => {
    const contact = GRUNT.bodyRadiusPx + WIZ_R;
    let brain = createGoblinBrain(GRUNT);
    // Far: walk. Make the cooldown irrelevant by staying out of range.
    brain = step(brain, GRUNT, [wiz(1, 100)]).brain;
    expect(step(brain, GRUNT, [wiz(1, 100)]).moveDirection.x).toBeCloseTo(1, 12);
    // Spend the cooldown so it can't wind up, then check it stands at contact.
    const spent = { ...brain, cooldown: { remainingMs: 500 } };
    expect(step(spent, GRUNT, [wiz(1, contact)]).moveDirection).toEqual({ x: 0, y: 0 });
    expect(step(spent, GRUNT, [wiz(1, contact + 1)]).moveDirection.x).toBeCloseTo(1, 12);
  });

  it('starts the wind-up on the frame the target is in range, spending the cooldown then', () => {
    const s = step(createGoblinBrain(GRUNT), GRUNT, [wiz(1, GRUNT_ATTACK.rangePx)]);
    expect(s.brain.machine).toEqual({ current: 'windup', timeInStateMs: 0 });
    expect(isReady(s.brain.cooldown)).toBe(false);
    expect(s.moveDirection).toEqual({ x: 0, y: 0 });
    expect(s.actions).toEqual([]);
  });

  it.each([30, 60, 144])('swings windupMs after the wind-up starts, at %i fps', (fps) => {
    const dt = 1000 / fps;
    const r = runFor(createGoblinBrain(GRUNT), GRUNT, () => [wiz(1, 25)], 400, dt);
    const first = r.actions[0];
    expect(first?.action).toEqual({ kind: 'melee', target: 1, landed: true });
    // Wind-up started on frame 1 (t = dt); release on the first frame ≥ windupMs later.
    expect(first?.t).toBeGreaterThanOrEqual(dt + GRUNT_ATTACK.windupMs - 1e-6);
    expect(first?.t).toBeLessThan(2 * dt + GRUNT_ATTACK.windupMs + 1e-6);
    expect(r.states).toContain('recover');
  });

  it.each([30, 60, 144])('swings once per cooldownMs while in range, at %i fps', (fps) => {
    const r = runFor(createGoblinBrain(GRUNT), GRUNT, () => [wiz(1, 25)], 9000, 1000 / fps);
    // Wind-ups start at ~0, 900, ..., 8100 → releases at +150: 10 swings in 9 s.
    expect(r.actions).toHaveLength(10);
    expect(r.actions.every((a) => a.action.kind === 'melee' && a.action.landed)).toBe(true);
  });

  it('never moves during the wind-up', () => {
    const r = runFor(createGoblinBrain(GRUNT), GRUNT, () => [wiz(1, 27)], 140, 1000 / 60);
    expect(r.last.brain.machine.current).toBe('windup');
    expect(r.last.moveDirection).toEqual({ x: 0, y: 0 });
  });

  it('whiffs when the target leaves range during the wind-up, and the cooldown is still spent', () => {
    const r = runFor(
      createGoblinBrain(GRUNT),
      GRUNT,
      (t) => [wiz(1, t < 50 ? 25 : GRUNT_ATTACK.rangePx + 0.5)],
      200,
      1000 / 60,
    );
    expect(r.actions.map((a) => a.action)).toEqual([{ kind: 'melee', target: 1, landed: false }]);
    expect(isReady(r.last.brain.cooldown)).toBe(false);
    expect(r.last.brain.machine.current).toBe('recover');
  });

  it('whiffs when the target dies during the wind-up, then retargets at once', () => {
    const r = runFor(
      createGoblinBrain(GRUNT),
      GRUNT,
      (t) => [wiz(1, 25, 0, t < 50), wiz(2, -60)],
      200,
      1000 / 60,
    );
    expect(r.actions[0]?.action).toEqual({ kind: 'melee', target: 1, landed: false });
    expect(r.last.brain.target).toBe(2);
  });

  it('keeps its target through the wind-up even if a nearer wizard appears', () => {
    const r = runFor(
      createGoblinBrain(GRUNT),
      GRUNT,
      (t) => (t < 20 ? [wiz(1, 25)] : [wiz(1, 25), wiz(2, -23)]),
      GRUNT_ATTACK.windupMs - 20,
      1000 / 60,
    );
    expect(r.last.brain.machine.current).toBe('windup');
    expect(r.last.brain.target).toBe(1);
  });
});

describe('Grunt: retarget', () => {
  it('re-picks the nearest wizard every retargetMs, with no leash', () => {
    const far = (t: number) =>
      t < 100 ? [wiz(1, 150), wiz(2, -400)] : [wiz(1, 600), wiz(2, -400)];
    const before = runFor(createGoblinBrain(GRUNT), GRUNT, far, GRUNT.retargetMs - 50, 10);
    expect(before.last.brain.target).toBe(1);
    const after = runFor(createGoblinBrain(GRUNT), GRUNT, far, GRUNT.retargetMs + 20, 10);
    expect(after.last.brain.target).toBe(2);
    expect(after.last.brain.machine.current).toBe('chase');
  });

  it('retargets at once when its target dies', () => {
    let s = step(createGoblinBrain(GRUNT), GRUNT, [wiz(1, 100), wiz(2, 150)]);
    expect(s.brain.target).toBe(1);
    s = step(s.brain, GRUNT, [wiz(1, 100, 0, false), wiz(2, 150)]);
    expect(s.brain.target).toBe(2);
  });

  it('goes idle when every wizard is dead', () => {
    let s = step(createGoblinBrain(GRUNT), GRUNT, [wiz(1, 100)]);
    s = step(s.brain, GRUNT, [wiz(1, 100, 0, false)]);
    expect(s.brain.machine.current).toBe('idle');
    expect(s.brain.target).toBeNull();
    expect(s.moveDirection).toEqual({ x: 0, y: 0 });
  });
});

describe('Archer', () => {
  /** An archer that has aggroed on wizard 1 with its cooldown spent, so only the bands act. */
  const reloading = (): GoblinBrain => {
    const aggroed = step(createGoblinBrain(ARCHER), ARCHER, [wiz(1, 250)]).brain;
    return { ...aggroed, cooldown: { remainingMs: 1000 } };
  };

  it('aggros at exactly aggroRadiusPx, not beyond', () => {
    const edge = ARCHER.aggroRadiusPx;
    expect(step(createGoblinBrain(ARCHER), ARCHER, [wiz(1, edge)]).brain.machine.current).toBe(
      'keep-range',
    );
    expect(
      step(createGoblinBrain(ARCHER), ARCHER, [wiz(1, edge + 0.01)]).brain.machine.current,
    ).toBe('idle');
  });

  it('steps back below retreatBelowPx, in above advanceAbovePx, holds in between', () => {
    const dir = (x: number) => step(reloading(), ARCHER, [wiz(1, x)]).moveDirection.x;
    expect(dir(ARCHER_BANDS.retreatBelowPx - 1)).toBeCloseTo(-1, 12);
    expect(dir(ARCHER_BANDS.retreatBelowPx)).toBe(0);
    expect(dir((ARCHER_BANDS.retreatBelowPx + ARCHER_BANDS.advanceAbovePx) / 2)).toBe(0);
    expect(dir(ARCHER_BANDS.advanceAbovePx)).toBe(0);
    expect(dir(ARCHER_BANDS.advanceAbovePx + 1)).toBeCloseTo(1, 12);
  });

  it('starts a draw when the target is within range and the cooldown is ready', () => {
    const s = step(createGoblinBrain(ARCHER), ARCHER, [wiz(1, ARCHER_ATTACK.rangePx)]);
    expect(s.brain.machine.current).toBe('draw');
    expect(s.brain.kind === 'keep-range' && s.brain.aim).toEqual({
      x: ARCHER_ATTACK.rangePx,
      y: 0,
    });
    expect(s.moveDirection).toEqual({ x: 0, y: 0 });
  });

  it('does not draw beyond attack range; it advances instead', () => {
    const s = step(createGoblinBrain(ARCHER), ARCHER, [wiz(1, ARCHER_ATTACK.rangePx + 1)]);
    expect(s.brain.machine.current).toBe('keep-range');
    expect(s.moveDirection.x).toBeCloseTo(1, 12);
  });

  it.each([30, 60, 144])(
    'shoots drawMs after draw start, at the draw-start position (aim lock), at %i fps',
    (fps) => {
      const dt = 1000 / fps;
      // The wizard walks away during the draw: the arrow still goes to where it stood.
      const r = runFor(
        createGoblinBrain(ARCHER),
        ARCHER,
        (t) => [wiz(1, 150, t)],
        ARCHER_ATTACK.drawMs + 3 * dt,
        dt,
      );
      expect(r.actions).toHaveLength(1);
      const shot = r.actions[0];
      expect(shot?.action).toEqual({ kind: 'shoot', from: ORIGIN, aimAt: { x: 150, y: dt } });
      expect(shot?.t).toBeGreaterThanOrEqual(dt + ARCHER_ATTACK.drawMs - 1e-6);
      expect(shot?.t).toBeLessThan(2 * dt + ARCHER_ATTACK.drawMs + 1e-6);
      expect(r.last.brain.machine.current).toBe('keep-range');
      expect(r.last.brain.kind === 'keep-range' && r.last.brain.aim).toBeNull();
    },
  );

  it('still shoots at the locked aim if the target dies during the draw', () => {
    const r = runFor(
      createGoblinBrain(ARCHER),
      ARCHER,
      (t) => [wiz(1, 150, 0, t < 100)],
      ARCHER_ATTACK.drawMs + 50,
      10,
    );
    expect(r.actions.map((a) => a.action)).toEqual([
      { kind: 'shoot', from: ORIGIN, aimAt: { x: 150, y: 0 } },
    ]);
  });

  describe('pushed archers don’t shoot (GDD §12 Verify)', () => {
    it('(1) cooldown ready, target at 110 px: no draw, the archer moves away', () => {
      const s = step(createGoblinBrain(ARCHER), ARCHER, [wiz(1, 110)]);
      expect(s.brain.machine.current).toBe('keep-range');
      expect(isReady(s.brain.cooldown)).toBe(true);
      expect(s.moveDirection.x).toBeCloseTo(-1, 12);
    });

    it('(2) draw starts at 130 px, target closes to 100 mid-draw: fires at the draw-start position', () => {
      const r = runFor(
        createGoblinBrain(ARCHER),
        ARCHER,
        (t) => [wiz(1, t < 100 ? 130 : 100)],
        ARCHER_ATTACK.drawMs + 50,
        10,
      );
      expect(r.actions.map((a) => a.action)).toEqual([
        { kind: 'shoot', from: ORIGIN, aimAt: { x: 130, y: 0 } },
      ]);
    });

    it('(3) target at exactly retreatBelowPx may draw', () => {
      const s = step(createGoblinBrain(ARCHER), ARCHER, [wiz(1, ARCHER_BANDS.retreatBelowPx)]);
      expect(s.brain.machine.current).toBe('draw');
    });

    it('(4) an archer pinned at the arena edge with the target at 100 px never draws', () => {
      const bounds = { x: 0, y: 0, width: 1000, height: 1000 };
      let list: readonly EnemyState[] = [
        createEnemy(SELF, ARCHER, { x: ARCHER.bodyRadiusPx, y: 500 }),
      ];
      const wizards = [wiz(1, ARCHER.bodyRadiusPx + 100, 500)];
      const actions: unknown[] = [];
      const states = new Set<string>();
      for (let i = 0; i < 300; i++) {
        const r = stepEnemies(list, {
          defs: ENEMIES,
          wizards,
          bounds,
          isAlive: () => true,
          dtMs: 1000 / 60,
        });
        list = r.enemies;
        actions.push(...r.actions);
        states.add(list[0]?.brain.machine.current ?? '');
      }
      expect(list[0]?.position.x).toBe(ARCHER.bodyRadiusPx);
      expect(actions).toEqual([]);
      expect([...states]).toEqual(['keep-range']);
    });
  });

  it('shoots once per cooldownMs while in range', () => {
    const r = runFor(createGoblinBrain(ARCHER), ARCHER, () => [wiz(1, 150)], 9000, 1000 / 60);
    // Draws start at ~0, 1800, ..., 7200 → 5 shots in 9 s.
    expect(r.actions).toHaveLength(5);
  });
});

describe('dead goblins (D4)', () => {
  it.each([
    ['grunt', GRUNT],
    ['archer', ARCHER],
  ] as const)('a dead %s never thinks, moves or attacks', (_name, def) => {
    const brain = step(createGoblinBrain(def), def, [wiz(1, 25)]).brain;
    const s = step(brain, def, [wiz(1, 25)], 1000, ORIGIN, false);
    expect(s.brain).toBe(brain);
    expect(s.moveDirection).toEqual({ x: 0, y: 0 });
    expect(s.actions).toEqual([]);
  });
});
