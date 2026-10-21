import { describe, expect, it } from 'vitest';
import type { ConvergenceTuning, EntityId } from '@core/types';
import { applyHit } from '@core/combat/damage';
import { applyStatus, stepStatuses } from '@core/combat/status';
import { CombatWorld } from '@core/combat/world';
import { ConvergenceMeter } from '@core/convergence/meter';
import { GIBS } from '@data/combat';
import { STATUSES } from '@data/statuses';
import { id, TUNING } from './fixtures';

const CONVERGENCE = id(900);
const REACTION = id(901);
const WIZARD = id(1);
const KEG = id(50);
const GOBLIN = id(10);

const meter = (tuning: ConvergenceTuning = TUNING) => new ConvergenceMeter(tuning, CONVERGENCE);
const hit = (amount: number, source = WIZARD, target = GOBLIN) =>
  ({ id: target, team: 'enemy', amount, source }) as const;

describe('ConvergenceMeter', () => {
  it('starts at meterStart, not full', () => {
    const m = meter();
    expect(m.value).toBe(40);
    expect(m.max).toBe(100);
    expect(m.full).toBe(false);
    expect(m.fraction).toBeCloseTo(0.4);
  });

  it('charges per HP dealt to enemies (amount is already overkill-free)', () => {
    const m = meter();
    m.onDamaged(hit(30));
    expect(m.value).toBeCloseTo(43);
  });

  it('charges per enemy kill', () => {
    const m = meter();
    m.onDied({ id: GOBLIN, team: 'enemy' });
    expect(m.value).toBe(44);
  });

  it('ignores damage to and deaths of wizards and neutrals', () => {
    const m = meter();
    m.onDamaged({ id: WIZARD, team: 'squad', amount: 50, source: GOBLIN });
    m.onDamaged({ id: KEG, team: 'neutral', amount: 50, source: WIZARD });
    m.onDied({ id: WIZARD, team: 'squad' });
    expect(m.value).toBe(40);
  });

  it('Convergence damage, its Burning ticks and its kills never charge (no snowballing)', () => {
    const m = meter();
    m.onDamaged(hit(150, CONVERGENCE));
    m.onDamaged(hit(3, CONVERGENCE)); // a tick of the Burning it applied
    m.onDied({ id: GOBLIN, team: 'enemy' });
    expect(m.value).toBe(40);
  });

  it('reactions the Convergence causes, Kaboom and Volunteer! do charge (M6 Q3)', () => {
    const m = meter();
    m.onDamaged(hit(10, REACTION));
    m.onDamaged(hit(60, KEG, id(11)));
    m.onDamaged(hit(80, id(4), id(12)));
    expect(m.value).toBeCloseTo(55);
  });

  it('a kill is credited by its last hit, per unit', () => {
    const m = meter();
    m.onDamaged(hit(0, WIZARD, id(11)));
    m.onDamaged(hit(0, CONVERGENCE, id(11)));
    m.onDamaged(hit(0, CONVERGENCE, id(12)));
    m.onDamaged(hit(0, WIZARD, id(12)));
    m.onDied({ id: id(11), team: 'enemy' });
    expect(m.value).toBe(40);
    m.onDied({ id: id(12), team: 'enemy' });
    expect(m.value).toBe(44);
  });

  it('a kill without any hit before it charges (debug kill)', () => {
    const m = meter();
    m.onDied({ id: id(77), team: 'enemy' });
    expect(m.value).toBe(44);
  });

  it('clamps at max and reports charged exactly once per fill', () => {
    const m = meter();
    const charged: boolean[] = [];
    for (let i = 0; i < 20; i++) charged.push(m.onDied({ id: id(100 + i), team: 'enemy' }));
    expect(m.value).toBe(100);
    expect(m.full).toBe(true);
    expect(charged.filter(Boolean)).toHaveLength(1);
    expect(charged.indexOf(true)).toBe(14); // 40 + 15 × 4 = 100
  });

  it('spend: only when full, drops to 0, and the next fill charges again', () => {
    const m = meter();
    expect(m.spend()).toBe(false);
    expect(m.value).toBe(40);
    expect(m.fill()).toBe(true);
    expect(m.fill()).toBe(false);
    expect(m.spend()).toBe(true);
    expect(m.value).toBe(0);
    expect(m.full).toBe(false);
    expect(m.spend()).toBe(false);
    expect(m.onPortalOpened()).toBe(false);
    expect(m.value).toBe(50);
    expect(m.onPortalOpened()).toBe(true);
  });

  it('hut and portal charges (M7)', () => {
    const m = meter();
    m.onHutDestroyed();
    expect(m.value).toBe(50);
    m.onPortalOpened();
    expect(m.value).toBe(100);
  });

  it('zero or negative charge is a no-op', () => {
    const m = meter();
    expect(m.onDamaged(hit(0))).toBe(false);
    expect(m.onDamaged(hit(-5))).toBe(false);
    expect(m.value).toBe(40);
  });

  it('a start at or above max begins full; a bad max throws', () => {
    expect(meter({ ...TUNING, meterStart: 150 }).value).toBe(100);
    expect(meter({ ...TUNING, meterStart: 150 }).full).toBe(true);
    expect(() => meter({ ...TUNING, meterMax: 0 })).toThrow(RangeError);
  });
});

describe('refreshed Burning: the last applier owns its ticks (M6-T0 review)', () => {
  /** A 1000 HP goblin burning from `first`, refreshed by `second`; the meter fed its ticks. */
  function burnTicks(first: EntityId, second: EntityId) {
    const world = new CombatWorld();
    world.add({ id: GOBLIN, team: 'enemy', maxHp: 1000, bodyRadiusPx: 12 });
    const m = meter();
    applyStatus(world, GOBLIN, STATUSES.burning, first);
    applyStatus(world, GOBLIN, STATUSES.burning, second);
    let charged = 0;
    for (let t = 0; t < STATUSES.burning.durationMs; t += 100) {
      for (const tick of stepStatuses(world, STATUSES, 100).ticks) {
        const r = applyHit(world, tick.target, tick.hit, GIBS);
        m.onDamaged({ id: r.target, team: 'enemy', amount: r.dealt, source: tick.hit.sourceId });
        charged += r.dealt;
      }
    }
    return { m, charged };
  }

  it('a Pyromancer refreshing Convergence Burning: its ticks charge', () => {
    const { m, charged } = burnTicks(CONVERGENCE, WIZARD);
    expect(charged).toBeGreaterThan(0);
    expect(m.value).toBeCloseTo(40 + charged * TUNING.chargePerDamage);
  });

  it('the Convergence refreshing a Pyromancer’s Burning: its ticks never charge', () => {
    const { m, charged } = burnTicks(WIZARD, CONVERGENCE);
    expect(charged).toBeGreaterThan(0);
    expect(m.value).toBe(40);
  });

  it('a Combust a Convergence bolt sets off still charges (its reaction id)', () => {
    const m = meter();
    m.onDamaged(hit(15, CONVERGENCE)); // the bolt
    m.onDamaged(hit(3, REACTION)); // its Combust on the same goblin
    m.onDied({ id: GOBLIN, team: 'enemy' }); // killed by the Combust
    expect(m.value).toBeCloseTo(40 + 0.3 + 4);
  });
});
