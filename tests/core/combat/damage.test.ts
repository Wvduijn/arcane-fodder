import { describe, expect, it } from 'vitest';
import type { EntityId, StatusId, Team } from '@core/types';
import { applyEventHits, applyHit, type Hit } from '@core/combat/damage';
import {
  deathVariantOf,
  killUnit,
  resolveFrameDeaths,
  type DeathRecord,
  type DeathSource,
} from '@core/combat/death';
import { CombatWorld } from '@core/combat/world';
import { CLASSES } from '@data/classes';
import { GIBS } from '@data/combat';
import { ENEMIES } from '@data/enemies';
import { STATUSES } from '@data/statuses';

const id = (n: number) => n as EntityId;
const GRUNT = ENEMIES['goblin-grunt'];
const ARCHER = ENEMIES['goblin-archer'];

function worldWith(...units: { n: number; maxHp: number; team?: Team }[]): CombatWorld {
  const world = new CombatWorld();
  for (const u of units) {
    world.add({ id: id(u.n), team: u.team ?? 'enemy', maxHp: u.maxHp, bodyRadiusPx: 10 });
  }
  return world;
}

const hitFrom = (source: DeathSource, sourceId: number | null = 99): Hit => ({
  ...source,
  sourceId: sourceId === null ? null : id(sourceId),
});

// Post-MVP sources (M5+), as GDD §12a describes them. Not in data yet; they pin the rules.
const KABOOM: DeathSource = { element: 'fire', damage: 60, canGib: true, deathVariant: 'blood' };
const ARCANE_DETONATION: DeathSource = { element: 'arcane', damage: 80, canGib: true };
const FIREBALL: DeathSource = { element: 'fire', damage: 30, canGib: false };
const THUNDER_BOLT_X15: DeathSource = { element: 'storm', damage: 30, canGib: true };
const burningTick = (status: StatusId): DeathSource => ({
  element: STATUSES[status].element,
  damage: STATUSES[status].tickDamage,
  canGib: false,
});

describe('CombatWorld', () => {
  it('adds units at full HP, alive, and lists them in ascending id order', () => {
    const world = worldWith({ n: 3, maxHp: 24 }, { n: 1, maxHp: 60, team: 'squad' });
    expect(world.units().map((u) => u.id)).toEqual([1, 3]);
    expect(world.get(id(3))).toMatchObject({ hp: 24, maxHp: 24, alive: true, team: 'enemy' });
    expect(world.isAlive(id(1))).toBe(true);
    expect(world.isAlive(id(7))).toBe(false);
  });

  it('rejects duplicate ids and bad maxHp', () => {
    const world = worldWith({ n: 1, maxHp: 10 });
    expect(() => world.add({ id: id(1), team: 'enemy', maxHp: 10, bodyRadiusPx: 1 })).toThrow();
    for (const maxHp of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => world.add({ id: id(2), team: 'enemy', maxHp, bodyRadiusPx: 1 })).toThrow();
    }
  });

  it('never mutates a dead unit', () => {
    const world = worldWith({ n: 1, maxHp: 10 });
    world.markDead(id(1));
    world.setHp(id(1), 5);
    world.setStatus(id(1), {
      status: 'burning',
      remainingMs: 1,
      nextTickInMs: 1,
      sourceId: null,
      appliedThisFrame: null,
    });
    expect(world.get(id(1))).toMatchObject({ hp: 0, alive: false });
    expect(world.get(id(1))?.statuses.size).toBe(0);
    expect(world.markDead(id(1))).toBe(false);
  });

  it('forgets removed units', () => {
    const world = worldWith({ n: 1, maxHp: 10 });
    expect(world.remove(id(1))).toBe(true);
    expect(world.get(id(1))).toBeUndefined();
    expect(world.remove(id(1))).toBe(false);
  });
});

describe('applyHit', () => {
  it('lowers HP by the damage and reports it as dealt', () => {
    const world = worldWith({ n: 1, maxHp: GRUNT.maxHp });
    const r = applyHit(world, id(1), hitFrom(CLASSES.pyromancer.attack), GIBS);
    expect(r).toEqual({ target: 1, dealt: 8, landed: true, killed: false });
    expect(world.get(id(1))?.hp).toBe(16);
  });

  it('clamps to the HP left: dealt excludes overkill (GDD §9)', () => {
    const world = worldWith({ n: 1, maxHp: 5 });
    const r = applyHit(world, id(1), hitFrom(CLASSES.pyromancer.attack), GIBS);
    expect(r.dealt).toBe(5);
    expect(r.killed).toBe(true);
    expect(world.get(id(1))).toMatchObject({ hp: 0, alive: false });
  });

  it('kills at exactly 0 HP and removes every status', () => {
    const world = worldWith({ n: 1, maxHp: 8 });
    world.setStatus(id(1), {
      status: 'burning',
      remainingMs: 1,
      nextTickInMs: 1,
      sourceId: null,
      appliedThisFrame: null,
    });
    const r = applyHit(world, id(1), hitFrom(CLASSES.pyromancer.attack, 4), GIBS);
    expect(r).toEqual({
      target: 1,
      dealt: 8,
      landed: true,
      killed: true,
      death: { id: 1, team: 'enemy', cause: 'combat', deathVariant: 'charred', gibbed: false },
    });
    expect(world.get(id(1))?.statuses.size).toBe(0);
  });

  it('is a no-op on a dead target: no damage after death (D4)', () => {
    const world = worldWith({ n: 1, maxHp: 8 });
    applyHit(world, id(1), hitFrom(CLASSES.pyromancer.attack), GIBS);
    const again = applyHit(world, id(1), hitFrom(CLASSES.stormcaller.attack), GIBS);
    expect(again).toEqual({ target: 1, dealt: 0, landed: false, killed: false });
    expect(world.get(id(1))).toMatchObject({ hp: 0, alive: false });
  });

  it('is a no-op on an unknown target', () => {
    const world = worldWith();
    expect(applyHit(world, id(5), hitFrom(FIREBALL), GIBS)).toEqual({
      target: 5,
      dealt: 0,
      landed: false,
      killed: false,
    });
  });

  it('treats negative damage as 0 (never heals)', () => {
    const world = worldWith({ n: 1, maxHp: 10 });
    const r = applyHit(world, id(1), hitFrom({ ...FIREBALL, damage: -5 }), GIBS);
    expect(r).toMatchObject({ dealt: 0, landed: true, killed: false });
    expect(world.get(id(1))?.hp).toBe(10);
  });
});

describe('death variants (GDD §12a Verify)', () => {
  const kill = (source: DeathSource, team: Team = 'enemy') => {
    const world = worldWith({ n: 1, maxHp: 1, team });
    const r = applyHit(world, id(1), hitFrom(source), GIBS);
    if (!r.killed) throw new Error('expected a kill');
    return r.death.deathVariant;
  };

  it.each([
    ['Pyromancer fire bolt', CLASSES.pyromancer.attack, 'charred'],
    ['Stormcaller spark', CLASSES.stormcaller.attack, 'electrified'],
    ['Grunt melee', GRUNT.attack, 'blood'],
    ['Archer arrow', ARCHER.attack, 'blood'],
    ['Burning tick', burningTick('burning'), 'charred'],
    ['Fireball (M5)', FIREBALL, 'charred'],
    ['Kaboom (M5, override)', KABOOM, 'blood'],
    ['Arcane Detonation (M6)', ARCANE_DETONATION, 'blood'],
    ['Thunderstorm bolt (M6)', THUNDER_BOLT_X15, 'electrified'],
  ] as const)('%s → %s', (_name, source, variant) => {
    expect(kill(source)).toBe(variant);
  });

  it('every MVP damage source in data maps to its element variant', () => {
    const sources: DeathSource[] = [
      ...Object.values(CLASSES).map((c) => c.attack),
      ...Object.values(ENEMIES).map((e) => e.attack),
      ...(Object.keys(STATUSES) as StatusId[]).map(burningTick),
    ];
    const expected = { fire: 'charred', storm: 'electrified', physical: 'blood', arcane: 'blood' };
    for (const source of sources) expect(kill(source)).toBe(expected[source.element]);
  });

  it('wizards always die blood, whatever killed them', () => {
    expect(kill(CLASSES.pyromancer.attack, 'squad')).toBe('blood');
    expect(kill(THUNDER_BOLT_X15, 'squad')).toBe('blood');
    expect(deathVariantOf(KABOOM, 'squad')).toBe('blood');
  });

  it('a kill without a source (debug kill) is blood and never gibs', () => {
    expect(deathVariantOf(null, 'enemy')).toBe('blood');
    const world = worldWith({ n: 2, maxHp: 24 });
    expect(killUnit(world, id(2), 'combat')).toEqual({
      id: 2,
      team: 'enemy',
      cause: 'combat',
      deathVariant: 'blood',
      gibbed: false,
    });
    expect(world.isAlive(id(2))).toBe(false);
    expect(killUnit(world, id(2), 'combat')).toBeNull();
    expect(killUnit(world, id(9), 'combat')).toBeNull();
  });

  it('a Volunteer! kill keeps its cause', () => {
    const world = worldWith({ n: 1, maxHp: 50, team: 'squad' });
    expect(killUnit(world, id(1), 'volunteer')).toMatchObject({ cause: 'volunteer' });
  });
});

describe('gibs (GDD §12a Verify)', () => {
  const gibbed = (source: DeathSource, maxHp: number, team: Team = 'enemy') => {
    const world = worldWith({ n: 1, maxHp, team });
    const r = applyHit(world, id(1), hitFrom(source), GIBS);
    return r.killed && r.death.gibbed;
  };

  it('a Grunt killed by Kaboom gibs; one killed by Fireball does not', () => {
    expect(gibbed(KABOOM, GRUNT.maxHp)).toBe(true);
    expect(gibbed(FIREBALL, GRUNT.maxHp)).toBe(false);
  });

  it('a ×1.5 Thunderstorm bolt (30) gibs an Archer (≥ 27) but not a Grunt (< 36)', () => {
    expect(gibbed(THUNDER_BOLT_X15, ARCHER.maxHp)).toBe(true);
    expect(gibbed(THUNDER_BOLT_X15, GRUNT.maxHp)).toBe(false);
  });

  it('gibs at exactly overkillRatio × maxHp (raw damage, before clamping)', () => {
    const exact = GIBS.overkillRatio * GRUNT.maxHp;
    expect(gibbed({ ...KABOOM, damage: exact }, GRUNT.maxHp)).toBe(true);
    expect(gibbed({ ...KABOOM, damage: exact - 1 }, GRUNT.maxHp)).toBe(false);
  });

  it('no auto-attack, melee or status ever gibs', () => {
    for (const source of [
      CLASSES.pyromancer.attack,
      CLASSES.stormcaller.attack,
      GRUNT.attack,
      ARCHER.attack,
      burningTick('burning'),
    ]) {
      expect(gibbed({ ...source, damage: 1000 }, 1)).toBe(false);
    }
  });

  it('a wizard never gibs', () => {
    expect(gibbed(KABOOM, 1, 'squad')).toBe(false);
  });

  it('a Kaboom killing 6 gibs exactly 4, the lowest ids', () => {
    const world = worldWith(...[6, 2, 4, 1, 5, 3].map((n) => ({ n, maxHp: GRUNT.maxHp })));
    const results = applyEventHits(world, [6, 2, 4, 1, 5, 3].map(id), hitFrom(KABOOM), GIBS);
    expect(results.map((r) => r.target)).toEqual([1, 2, 3, 4, 5, 6]);
    const deaths = results.flatMap((r) => (r.killed ? [r.death] : []));
    expect(deaths).toHaveLength(6);
    expect(deaths.filter((d) => d.gibbed).map((d) => d.id)).toEqual([1, 2, 3, 4]);
    expect(deaths.every((d) => d.deathVariant === 'blood')).toBe(true);
  });

  it('the gib cap counts gibs, not victims: survivors and non-gib kills do not use it up', () => {
    const world = worldWith(
      { n: 1, maxHp: 500 },
      { n: 2, maxHp: 50 },
      ...[3, 4, 5, 6, 7].map((n) => ({ n, maxHp: 18 })),
    );
    const results = applyEventHits(world, [1, 2, 3, 4, 5, 6, 7].map(id), hitFrom(KABOOM), GIBS);
    expect(results[0]?.killed).toBe(false);
    const deaths = results.flatMap((r) => (r.killed ? [r.death] : []));
    expect(deaths.map((d) => [d.id, d.gibbed])).toEqual([
      [2, false],
      [3, true],
      [4, true],
      [5, true],
      [6, true],
      [7, false],
    ]);
  });

  it('hits each target of an event once, even if listed twice', () => {
    const world = worldWith({ n: 1, maxHp: 100 });
    const results = applyEventHits(world, [id(1), id(1)], hitFrom(FIREBALL), GIBS);
    expect(results).toHaveLength(1);
    expect(world.get(id(1))?.hp).toBe(70);
  });
});

describe('resolveFrameDeaths', () => {
  const death = (n: number, cause: DeathRecord['cause'] = 'combat'): DeathRecord => ({
    id: id(n),
    team: 'enemy',
    cause,
    deathVariant: 'blood',
    gibbed: false,
  });

  it('orders a frame’s deaths by ascending EntityId (GDD §0)', () => {
    expect(resolveFrameDeaths([death(5), death(2), death(9), death(1)]).map((d) => d.id)).toEqual([
      1, 2, 5, 9,
    ]);
  });

  it('keeps the first record per id', () => {
    const out = resolveFrameDeaths([death(3, 'volunteer'), death(3, 'combat')]);
    expect(out).toEqual([death(3, 'volunteer')]);
  });

  it('handles an empty frame', () => {
    expect(resolveFrameDeaths([])).toEqual([]);
  });
});
