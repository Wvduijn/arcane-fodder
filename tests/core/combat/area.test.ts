import { describe, expect, it } from 'vitest';
import type { AreaBlastDef, EntityId, Team, Vec2 } from '@core/types';
import {
  applyAreaStatus,
  bodiesInRadius,
  resolveAreaEvent,
  type AreaBody,
  type AreaContext,
  type AreaEvent,
  type UnitPosition,
} from '@core/combat/area';
import { CombatWorld } from '@core/combat/world';
import { CLASSES } from '@data/classes';
import { GIBS } from '@data/combat';
import { ENEMIES } from '@data/enemies';
import { MOVEMENT } from '@data/movement';
import { REACTIONS } from '@data/reactions';
import { SPELLS } from '@data/spells';
import { STATUSES } from '@data/statuses';
import { KEG } from '@data/structures';

const id = (n: number) => n as EntityId;
const v = (x: number, y: number): Vec2 => ({ x, y });
const GRUNT = ENEMIES['goblin-grunt'];
const ARCHER = ENEMIES['goblin-archer'];
const WIZARD_R = MOVEMENT.wizardBodyRadiusPx;
const KEG_R = KEG.bodyRadiusPx;
const FIREBALL: AreaBlastDef = SPELLS.fireball;
const LIGHTNING: AreaBlastDef = SPELLS.lightning;
const KABOOM: AreaBlastDef = REACTIONS.kaboom.blast;
const SQUAD_FACTOR = REACTIONS.kaboom.squadDamageMultiplier;

interface UnitSpec {
  readonly n: number;
  readonly at: Vec2;
  readonly team?: Team;
  readonly maxHp?: number;
  readonly bodyRadiusPx?: number;
}

function setup(...specs: UnitSpec[]): { ctx: AreaContext; units: UnitPosition[] } {
  const world = new CombatWorld();
  for (const s of specs) {
    world.add({
      id: id(s.n),
      team: s.team ?? 'enemy',
      maxHp: s.maxHp ?? GRUNT.maxHp,
      bodyRadiusPx: s.bodyRadiusPx ?? GRUNT.bodyRadiusPx,
    });
  }
  return {
    ctx: { world, statuses: STATUSES, gibs: GIBS },
    units: specs.map((s) => ({ id: id(s.n), position: s.at })),
  };
}

const body = (n: number, at: Vec2, bodyRadiusPx: number, alive = true): AreaBody => ({
  id: id(n),
  position: at,
  bodyRadiusPx,
  alive,
});

describe('bodiesInRadius (GDD §0 area hit rule)', () => {
  const reach = (radiusPx: number, bodyRadiusPx: number, d: number) =>
    bodiesInRadius(v(0, 0), radiusPx, [body(1, v(d, 0), bodyRadiusPx)]).length === 1;

  it('Fireball reaches a grunt centre at 56 px, not beyond', () => {
    expect(reach(FIREBALL.radiusPx, GRUNT.bodyRadiusPx, 56)).toBe(true);
    expect(reach(FIREBALL.radiusPx, GRUNT.bodyRadiusPx, 56.01)).toBe(false);
  });

  it('Lightning reaches 18 px on an archer and 20 px on a grunt', () => {
    expect(reach(LIGHTNING.radiusPx, ARCHER.bodyRadiusPx, 18)).toBe(true);
    expect(reach(LIGHTNING.radiusPx, ARCHER.bodyRadiusPx, 18.01)).toBe(false);
    expect(reach(LIGHTNING.radiusPx, GRUNT.bodyRadiusPx, 20)).toBe(true);
    expect(reach(LIGHTNING.radiusPx, GRUNT.bodyRadiusPx, 20.01)).toBe(false);
  });

  it('Kaboom reaches a wizard at 82 px and another keg at 80 px', () => {
    expect(reach(KABOOM.radiusPx, WIZARD_R, 82)).toBe(true);
    expect(reach(KABOOM.radiusPx, WIZARD_R, 82.01)).toBe(false);
    expect(reach(KABOOM.radiusPx, KEG_R, 80)).toBe(true);
    expect(reach(KABOOM.radiusPx, KEG_R, 80.01)).toBe(false);
  });

  it('works in every direction (distance, not per-axis)', () => {
    const at = (reachPx: number) => {
      const d = reachPx / Math.SQRT2;
      return bodiesInRadius(v(10, 10), 44, [body(1, v(10 - d, 10 + d), 12)]);
    };
    expect(at(55.99)).toEqual([1]);
    expect(at(56.01)).toEqual([]);
  });

  it('lists ids ascending and skips dead bodies', () => {
    const bodies = [
      body(5, v(1, 0), 12),
      body(2, v(0, 1), 12),
      body(9, v(-1, 0), 12, false),
      body(3, v(500, 0), 12),
      body(4, v(0, -1), 12),
    ];
    expect(bodiesInRadius(v(0, 0), 44, bodies)).toEqual([2, 4, 5]);
  });
});

describe('resolveAreaEvent', () => {
  it('Fireball damages enemies in range only, never wizards', () => {
    const { ctx, units } = setup(
      { n: 1, at: v(0, 0), team: 'squad', maxHp: 60, bodyRadiusPx: WIZARD_R },
      { n: 2, at: v(30, 0) },
      { n: 3, at: v(57, 0) },
    );
    const r = resolveAreaEvent(
      { centre: v(0, 0), blast: FIREBALL, sourceId: id(1), teams: ['enemy'] },
      units,
      ctx,
    );
    expect(r.hits.map((h) => [h.target, h.dealt])).toEqual([[2, 24]]);
    expect(ctx.world.get(id(1))?.hp).toBe(60);
    expect(ctx.world.get(id(3))?.hp).toBe(GRUNT.maxHp);
  });

  it('resolves hits in ascending id order whatever the input order', () => {
    const { ctx, units } = setup(
      { n: 7, at: v(10, 0), maxHp: 100 },
      { n: 3, at: v(-10, 0), maxHp: 100 },
      { n: 5, at: v(0, 10), maxHp: 100 },
    );
    const r = resolveAreaEvent(
      { centre: v(0, 0), blast: FIREBALL, sourceId: null, teams: ['enemy'] },
      units,
      ctx,
    );
    expect(r.hits.map((h) => h.target)).toEqual([3, 5, 7]);
    expect(r.statuses.map((s) => s.target)).toEqual([3, 5, 7]);
    expect(r.knockbacks.map((k) => k.target)).toEqual([3, 5, 7]);
  });

  it('Kaboom: wizards take damage × multiplier, enemies full; Burning on enemies only', () => {
    const { ctx, units } = setup(
      { n: 1, at: v(70, 0), team: 'squad', maxHp: 60, bodyRadiusPx: WIZARD_R },
      { n: 2, at: v(90, 0), team: 'squad', maxHp: 60, bodyRadiusPx: WIZARD_R },
      { n: 3, at: v(0, 40), maxHp: 100 },
    );
    const r = resolveAreaEvent(
      {
        centre: v(0, 0),
        blast: KABOOM,
        sourceId: id(50),
        teams: ['squad', 'enemy'],
        damageMultiplier: { squad: SQUAD_FACTOR },
        statusTeams: ['enemy'],
      },
      units,
      ctx,
    );
    expect(r.hits.map((h) => [h.target, h.dealt])).toEqual([
      [1, 30],
      [3, 60],
    ]);
    expect(ctx.world.get(id(2))?.hp).toBe(60);
    expect(r.statuses).toEqual([{ target: id(3), status: 'burning', result: 'applied' }]);
    expect(ctx.world.get(id(1))?.statuses.size).toBe(0);
    // Wizards are pushed too (GDD §8).
    expect(r.knockbacks.map((k) => k.target)).toEqual([1, 3]);
  });

  it('caps gibs per event at maxGibbedPerEvent, lowest ids first; Kaboom kills are blood', () => {
    const grunts = Array.from({ length: 6 }, (_, i) => ({ n: i + 1, at: v(i * 10, 0) }));
    const { ctx, units } = setup(...grunts);
    const r = resolveAreaEvent(
      { centre: v(20, 0), blast: KABOOM, sourceId: id(50), teams: ['enemy'] },
      units,
      ctx,
    );
    expect(r.deaths).toHaveLength(6);
    expect(r.deaths.filter((d) => d.gibbed).map((d) => d.id)).toEqual(
      [1, 2, 3, 4].slice(0, GIBS.maxGibbedPerEvent),
    );
    expect(r.deaths.every((d) => d.deathVariant === 'blood')).toBe(true);
    // The dead get neither status nor knockback.
    expect(r.statuses).toEqual([]);
    expect(r.knockbacks).toEqual([]);
  });

  it('the gib cap counts the whole event across damage multipliers', () => {
    const grunts = Array.from({ length: 6 }, (_, i) => ({ n: i + 1, at: v(i * 10, 0) }));
    const { ctx, units } = setup(...grunts, {
      n: 7,
      at: v(0, 10),
      team: 'squad',
      maxHp: 20,
      bodyRadiusPx: WIZARD_R,
    });
    const r = resolveAreaEvent(
      {
        centre: v(20, 0),
        blast: KABOOM,
        sourceId: id(50),
        teams: ['squad', 'enemy'],
        damageMultiplier: { squad: SQUAD_FACTOR },
      },
      units,
      ctx,
    );
    expect(r.deaths.filter((d) => d.gibbed)).toHaveLength(GIBS.maxGibbedPerEvent);
    // Wizards never gib and always die blood (GDD §12a).
    expect(r.deaths.find((d) => d.id === id(7))).toMatchObject({
      gibbed: false,
      deathVariant: 'blood',
    });
  });

  it('a Fireball kill is charred and never gibs', () => {
    const { ctx, units } = setup({ n: 1, at: v(0, 0), maxHp: 10 });
    const r = resolveAreaEvent(
      { centre: v(0, 0), blast: FIREBALL, sourceId: null, teams: ['enemy'] },
      units,
      ctx,
    );
    expect(r.deaths).toEqual([
      { id: id(1), team: 'enemy', cause: 'combat', deathVariant: 'charred', gibbed: false },
    ]);
  });

  it('skips dead units and units without a position', () => {
    const { ctx, units } = setup({ n: 1, at: v(0, 0) }, { n: 2, at: v(5, 0) });
    ctx.world.markDead(id(1));
    ctx.world.add({ id: id(3), team: 'enemy', maxHp: 24, bodyRadiusPx: 12 });
    const r = resolveAreaEvent(
      { centre: v(0, 0), blast: FIREBALL, sourceId: null, teams: ['enemy'] },
      units,
      ctx,
    );
    expect(r.hits.map((h) => h.target)).toEqual([2]);
    expect(ctx.world.get(id(1))).toMatchObject({ alive: false, hp: 0 });
    expect(ctx.world.get(id(3))?.hp).toBe(24);
  });

  it('statusExcept keeps the status off one unit but still damages it (Combust origin)', () => {
    const { ctx, units } = setup(
      { n: 1, at: v(0, 0), maxHp: 100 },
      { n: 2, at: v(40, 0), maxHp: 100 },
    );
    const r = resolveAreaEvent(
      { centre: v(0, 0), blast: FIREBALL, sourceId: null, teams: ['enemy'], statusExcept: id(1) },
      units,
      ctx,
    );
    expect(r.hits.map((h) => h.target)).toEqual([1, 2]);
    expect(r.statuses.map((s) => s.target)).toEqual([2]);
    expect(ctx.world.get(id(1))?.statuses.has('burning')).toBe(false);
  });

  it('reports refreshes, credits the source, and starts no status without `applies`', () => {
    const { ctx, units } = setup({ n: 1, at: v(0, 0), maxHp: 100 });
    const fireball: AreaEvent = {
      centre: v(0, 0),
      blast: FIREBALL,
      sourceId: id(9),
      teams: ['enemy'],
    };
    resolveAreaEvent(fireball, units, ctx);
    const again = resolveAreaEvent(fireball, units, ctx);
    expect(again.statuses).toEqual([{ target: id(1), status: 'burning', result: 'refreshed' }]);
    expect(ctx.world.get(id(1))?.statuses.get('burning')?.sourceId).toBe(9);
    const bolt = resolveAreaEvent(
      { centre: v(0, 0), blast: LIGHTNING, sourceId: null, teams: ['enemy'] },
      units,
      ctx,
    );
    expect(bolt.statuses).toEqual([]);
  });

  it('pushes survivors straight away from the centre; none on the centre or at 0 px', () => {
    const { ctx, units } = setup(
      { n: 1, at: v(0, 0), maxHp: 100 },
      { n: 2, at: v(30, 40), maxHp: 100 },
    );
    const r = resolveAreaEvent(
      { centre: v(0, 0), blast: FIREBALL, sourceId: null, teams: ['enemy'] },
      units,
      ctx,
    );
    expect(r.knockbacks).toHaveLength(1);
    const [k] = r.knockbacks;
    expect(k?.target).toBe(2);
    expect(k?.direction.x).toBeCloseTo(0.6, 12);
    expect(k?.direction.y).toBeCloseTo(0.8, 12);
    expect(k?.distancePx).toBe(FIREBALL.knockbackPx);
    const bolt = resolveAreaEvent(
      { centre: v(25, 35), blast: LIGHTNING, sourceId: null, teams: ['enemy'] },
      units,
      ctx,
    );
    expect(bolt.hits).toHaveLength(1);
    expect(bolt.knockbacks).toEqual([]);
  });

  it('a unit listed twice is hit once', () => {
    const { ctx, units } = setup({ n: 1, at: v(0, 0), maxHp: 100 });
    const r = resolveAreaEvent(
      { centre: v(0, 0), blast: FIREBALL, sourceId: null, teams: ['enemy'] },
      [...units, ...units],
      ctx,
    );
    expect(r.hits).toHaveLength(1);
    expect(ctx.world.get(id(1))?.hp).toBe(100 - FIREBALL.damage);
  });

  it('works with the class autos as blast shapes (no special casing of the source)', () => {
    const { ctx, units } = setup({ n: 1, at: v(0, 0) });
    const spark = { ...CLASSES.stormcaller.attack, radiusPx: 0 };
    const r = resolveAreaEvent(
      { centre: v(0, 0), blast: spark, sourceId: null, teams: ['enemy'] },
      units,
      ctx,
    );
    expect(r.hits.map((h) => h.dealt)).toEqual([CLASSES.stormcaller.attack.damage]);
  });
});

describe('resolveAreaEvent: multiplied damage', () => {
  const event = (factor: number, blast: AreaBlastDef = KABOOM): AreaEvent => ({
    centre: v(0, 0),
    blast,
    sourceId: id(50),
    teams: ['squad', 'enemy'],
    damageMultiplier: { squad: factor, enemy: factor },
  });

  it('rounds a multiplied hit to whole HP (GDD §0), halves up', () => {
    const cases: [number, number, number][] = [
      [60, 0.45, 27],
      [61, 0.5, 31],
      [60, 0.333, 20],
      [59, 0.5, 30],
    ];
    for (const [damage, factor, expected] of cases) {
      const { ctx, units } = setup({ n: 1, at: v(0, 0), team: 'squad', maxHp: 100 });
      const r = resolveAreaEvent(event(factor, { ...KABOOM, damage }), units, ctx);
      expect(r.hits[0]?.dealt).toBe(expected);
      expect(Number.isInteger(ctx.world.get(id(1))?.hp)).toBe(true);
    }
  });

  it('the data Kaboom gives a wizard exactly 30 (GDD §8)', () => {
    const { ctx, units } = setup({ n: 1, at: v(0, 0), team: 'squad', maxHp: 100 });
    const r = resolveAreaEvent(event(SQUAD_FACTOR), units, ctx);
    expect(r.hits[0]?.dealt).toBe(30);
  });

  it('gibs on the multiplied damage: a halved Kaboom (30) is under a grunt gib (1.5 × 24 = 36)', () => {
    const { ctx, units } = setup({ n: 1, at: v(0, 0), maxHp: GRUNT.maxHp });
    const full = resolveAreaEvent(event(1), units, ctx);
    expect(full.deaths[0]?.gibbed).toBe(true);
    const again = setup({ n: 1, at: v(0, 0), maxHp: GRUNT.maxHp });
    const halved = resolveAreaEvent(event(0.5), again.units, again.ctx);
    expect(KABOOM.damage * 0.5).toBeLessThan(GIBS.overkillRatio * GRUNT.maxHp);
    expect(halved.deaths[0]).toMatchObject({ gibbed: false, deathVariant: 'blood' });
  });
});

describe('applyAreaStatus (Meteor burning ground, M6)', () => {
  const event = (n = 900) =>
    ({
      centre: v(0, 0),
      radiusPx: 90,
      status: 'burning',
      sourceId: id(n),
      teams: ['enemy'],
    }) as const;

  it('applies the status to living enemies the ring touches (body rule), ascending id', () => {
    const { ctx, units } = setup(
      { n: 3, at: v(90 + GRUNT.bodyRadiusPx, 0) },
      { n: 1, at: v(0, 10) },
      { n: 2, at: v(90 + GRUNT.bodyRadiusPx + 0.01, 0) },
      { n: 4, at: v(5, 0), team: 'squad', bodyRadiusPx: WIZARD_R },
    );
    const r = applyAreaStatus(event(), units, ctx);
    expect(r).toEqual([
      { target: 1, status: 'burning', result: 'applied' },
      { target: 3, status: 'burning', result: 'applied' },
    ]);
    expect(ctx.world.get(id(1))?.statuses.get('burning')?.sourceId).toBe(900);
    expect(ctx.world.get(id(4))?.statuses.size).toBe(0);
  });

  it('no damage, and a second tick refreshes', () => {
    const { ctx, units } = setup({ n: 1, at: v(0, 0) });
    applyAreaStatus(event(), units, ctx);
    expect(applyAreaStatus(event(), units, ctx)).toEqual([
      { target: 1, status: 'burning', result: 'refreshed' },
    ]);
    expect(ctx.world.get(id(1))?.hp).toBe(GRUNT.maxHp);
  });

  it('skips dead units and units without a position', () => {
    const { ctx } = setup({ n: 1, at: v(0, 0) }, { n: 2, at: v(0, 0) });
    ctx.world.markDead(id(1));
    expect(applyAreaStatus(event(), [{ id: id(1), position: v(0, 0) }], ctx)).toEqual([]);
  });
});
