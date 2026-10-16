import { describe, expect, it } from 'vitest';
import type { EntityId, ProjectileAttackDef } from '@core/types';
import {
  createAutoAttack,
  stepAutoAttack,
  type AutoAttackState,
  type AutoAttackStep,
} from '@core/combat/autoAttack';
import type { TargetCandidate } from '@core/targeting/selectTarget';
import { CLASSES } from '@data/classes';
import { COMBAT } from '@data/combat';

const PYRO = CLASSES.pyromancer.attack;
const SPARK = CLASSES.stormcaller.attack;
const ORIGIN = { x: 0, y: 0 };

const goblin = (n: number, x: number, alive = true): TargetCandidate => ({
  id: n as EntityId,
  position: { x, y: 0 },
  kind: 'unit',
  alive,
});

const step = (
  state: AutoAttackState,
  candidates: readonly TargetCandidate[],
  dtMs = 1000 / 60,
  attack: ProjectileAttackDef = PYRO,
): AutoAttackStep =>
  stepAutoAttack(state, {
    position: ORIGIN,
    attack,
    retargetMs: COMBAT.retargetMs,
    candidates,
    dtMs,
  });

describe('stepAutoAttack', () => {
  it('fires on the frame a target is acquired, aimed at its current position (GDD §3)', () => {
    const s = step(createAutoAttack(), [goblin(5, 100)]);
    expect(s.fire).toEqual({ target: 5, aimAt: { x: 100, y: 0 } });
    expect(s.state.target).toBe(5);
  });

  it('does not fire without a target in range, but the cooldown keeps ticking', () => {
    let s = step(createAutoAttack(), [goblin(5, 100)]);
    s = step(s.state, [goblin(5, PYRO.rangePx + 1)], 1000);
    expect(s.fire).toBeNull();
    expect(s.state.target).toBeNull();
    s = step(s.state, [goblin(5, 100)]);
    expect(s.fire).not.toBeNull();
  });

  it.each([30, 60, 144])('fires once per cooldownMs at %i fps', (fps) => {
    let state = createAutoAttack();
    let shots = 0;
    const dt = 1000 / fps;
    for (let i = 0; i * dt < 9500; i++) {
      const s = step(state, [goblin(5, 100)], i === 0 ? 0 : dt, SPARK);
      state = s.state;
      if (s.fire) shots++;
    }
    // 0, 400, ..., 9200.
    expect(shots).toBe(24);
  });

  it('retargets every retargetMs to the nearest', () => {
    let s = step(createAutoAttack(), [goblin(5, 100)]);
    s = step(s.state, [goblin(5, 100), goblin(6, 50)], COMBAT.retargetMs - 20);
    expect(s.state.target).toBe(5);
    s = step(s.state, [goblin(5, 100), goblin(6, 50)], 20);
    expect(s.state.target).toBe(6);
  });

  it('retargets at once when the target dies (D4: never shoots a dead unit)', () => {
    let s = step(createAutoAttack(), [goblin(5, 100), goblin(6, 150)]);
    s = step(s.state, [goblin(5, 100, false), goblin(6, 150)], PYRO.cooldownMs);
    expect(s.state.target).toBe(6);
    expect(s.fire).toEqual({ target: 6, aimAt: { x: 150, y: 0 } });
  });

  it('retargets at once when the target leaves range', () => {
    let s = step(createAutoAttack(), [goblin(5, 100), goblin(6, 150)]);
    s = step(s.state, [goblin(5, PYRO.rangePx + 5), goblin(6, 150)], 10);
    expect(s.state.target).toBe(6);
  });

  it('never targets a keg', () => {
    const keg: TargetCandidate = { ...goblin(5, 20), kind: 'keg' };
    expect(step(createAutoAttack(), [keg]).fire).toBeNull();
  });
});
