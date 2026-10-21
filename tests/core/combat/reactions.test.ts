import { describe, expect, it } from 'vitest';
import type { AreaBlastDef, EntityId, Team, Vec2 } from '@core/types';
import type { UnitPosition } from '@core/combat/area';
import type { Hit } from '@core/combat/damage';
import {
  resolveAreaWithReactions,
  resolveKaboom,
  resolveUnitHit,
  type ReactionContext,
} from '@core/combat/reactions';
import { applyStatus } from '@core/combat/status';
import { CombatWorld } from '@core/combat/world';
import { createKeg, kegBodies, stepKegs, triggerKeg, type KegState } from '@core/structures/keg';
import { CLASSES } from '@data/classes';
import { GIBS } from '@data/combat';
import { ENEMIES } from '@data/enemies';
import { MOVEMENT } from '@data/movement';
import { REACTIONS } from '@data/reactions';
import { SPELLS } from '@data/spells';
import { STATUSES } from '@data/statuses';
import { KEG } from '@data/structures';

const v = (x: number, y: number): Vec2 => ({ x, y });
const id = (n: number) => n as EntityId;
const GRUNT = ENEMIES['goblin-grunt'];
const ARCHER = ENEMIES['goblin-archer'];
const COMBUST = REACTIONS.combust;
const KABOOM = REACTIONS.kaboom;
const SPARK = CLASSES.stormcaller.attack;
const BOLT = CLASSES.pyromancer.attack;
const PYRO = id(90);
const STORM = id(91);
const FPS = [30, 60, 144] as const;
/** Volunteer! detonation stand-in (M6): any arcane blast. */
const ARCANE_BLAST: AreaBlastDef = {
  element: 'arcane',
  damage: 80,
  radiusPx: 48,
  knockbackPx: 0,
  canGib: true,
};

interface UnitSpec {
  readonly n: number;
  readonly at: Vec2;
  readonly team?: Team;
  readonly maxHp?: number;
  readonly burning?: boolean;
}

function setup(units: UnitSpec[], kegs: KegState[] = []) {
  const world = new CombatWorld();
  for (const u of units) {
    const wizard = u.team === 'squad';
    world.add({
      id: id(u.n),
      team: u.team ?? 'enemy',
      maxHp: u.maxHp ?? (wizard ? CLASSES.pyromancer.maxHp : GRUNT.maxHp),
      bodyRadiusPx: wizard ? MOVEMENT.wizardBodyRadiusPx : GRUNT.bodyRadiusPx,
    });
    if (u.burning) applyStatus(world, id(u.n), STATUSES.burning, PYRO);
  }
  const positions: UnitPosition[] = units.map((u) => ({ id: id(u.n), position: u.at }));
  const ctxWith = (kegList: readonly KegState[]): ReactionContext => ({
    world,
    statuses: STATUSES,
    gibs: GIBS,
    combust: COMBUST,
    kaboom: KABOOM,
    units: positions,
    kegs: kegBodies(kegList, KEG),
  });
  return { world, ctx: ctxWith(kegs), ctxWith };
}

const hitOf = (attack: typeof SPARK | typeof BOLT, sourceId: EntityId): Hit => ({
  ...attack,
  sourceId,
});
const hp = (world: CombatWorld, n: number) => world.get(id(n))?.hp;
const burning = (world: CombatWorld, n: number) =>
  world.get(id(n))?.statuses.has('burning') ?? false;

describe('Combust (GDD §7)', () => {
  it('verify: a burning grunt with 2 neighbours 40 px away, hit by a spark', () => {
    const { world, ctx } = setup([
      { n: 1, at: v(100, 100), burning: true, maxHp: 100 },
      { n: 2, at: v(140, 100), maxHp: 100 },
      { n: 3, at: v(100, 140), maxHp: 100 },
    ]);
    const r = resolveUnitHit(id(1), hitOf(SPARK, STORM), ctx);
    expect(r.reactions).toHaveLength(1);
    expect(r.reactions[0]).toMatchObject({
      reaction: 'combust',
      at: v(100, 100),
      origin: 1,
      spreadTo: [2, 3],
      consumed: true,
    });
    expect(burning(world, 1)).toBe(false);
    expect(burning(world, 2)).toBe(true);
    expect(burning(world, 3)).toBe(true);
    // All 3 take the Combust's 10; the origin also took the spark.
    expect(hp(world, 1)).toBe(100 - SPARK.damage - COMBUST.blast.damage);
    expect(hp(world, 2)).toBe(100 - COMBUST.blast.damage);
    expect(hp(world, 3)).toBe(100 - COMBUST.blast.damage);
    // Credit to the storm hit's source.
    expect(world.get(id(2))?.statuses.get('burning')?.sourceId).toBe(STORM);
  });

  it('reaches grunt centres up to 44 px away, not beyond', () => {
    const { world, ctx } = setup([
      { n: 1, at: v(0, 0), burning: true, maxHp: 100 },
      { n: 2, at: v(44, 0), maxHp: 100 },
      { n: 3, at: v(-44.01, 0), maxHp: 100 },
    ]);
    resolveUnitHit(id(1), hitOf(SPARK, STORM), ctx);
    expect(hp(world, 2)).toBe(100 - COMBUST.blast.damage);
    expect(hp(world, 3)).toBe(100);
  });

  it('Lightning on a burning goblin always Combusts, even when it kills it (D4)', () => {
    const { world, ctx } = setup([
      { n: 1, at: v(0, 0), burning: true },
      { n: 2, at: v(30, 0) },
    ]);
    const r = resolveAreaWithReactions(
      { centre: v(0, 0), blast: SPELLS.lightning, sourceId: STORM, teams: ['enemy'] },
      ctx,
    );
    expect(r.deaths.map((d) => [d.id, d.deathVariant])).toEqual([[1, 'electrified']]);
    expect(r.reactions.map((x) => [x.reaction, x.origin, x.spreadTo])).toEqual([
      ['combust', 1, [2]],
    ]);
    expect(hp(world, 2)).toBe(GRUNT.maxHp - COMBUST.blast.damage);
    expect(burning(world, 2)).toBe(true);
  });

  it('a survivor of the spark killed by the Combust blast dies charred', () => {
    // Survives the spark by exactly the Combust's damage.
    const maxHp = SPARK.damage + COMBUST.blast.damage;
    const { ctx } = setup([{ n: 1, at: v(0, 0), burning: true, maxHp }]);
    const r = resolveUnitHit(id(1), hitOf(SPARK, STORM), ctx);
    expect(r.deaths.map((d) => [d.id, d.deathVariant])).toEqual([[1, 'charred']]);
    expect(r.reactions).toHaveLength(1);
  });

  it('a second storm hit on the same unit in the same frame is plain', () => {
    const { world, ctx } = setup([{ n: 1, at: v(0, 0), burning: true, maxHp: 100 }]);
    const first = resolveUnitHit(id(1), hitOf(SPARK, STORM), ctx);
    const second = resolveUnitHit(id(1), hitOf(SPARK, STORM), ctx);
    expect(first.reactions).toHaveLength(1);
    expect(second.reactions).toEqual([]);
    expect(hp(world, 1)).toBe(100 - 2 * SPARK.damage - COMBUST.blast.damage);
  });

  it('no Combust without Burning, or from a non-storm hit, or on a missed hit', () => {
    const { world, ctx } = setup([
      { n: 1, at: v(0, 0), maxHp: 100 },
      { n: 2, at: v(200, 0), burning: true, maxHp: 100 },
    ]);
    expect(resolveUnitHit(id(1), hitOf(SPARK, STORM), ctx).reactions).toEqual([]);
    expect(resolveUnitHit(id(2), hitOf(BOLT, PYRO), ctx).reactions).toEqual([]);
    // Fireball and the Combust blast itself are fire: no chain without storm hits.
    expect(
      resolveAreaWithReactions(
        { centre: v(200, 0), blast: SPELLS.fireball, sourceId: PYRO, teams: ['enemy'] },
        ctx,
      ).reactions,
    ).toEqual([]);
    world.markDead(id(2));
    expect(resolveUnitHit(id(2), hitOf(SPARK, STORM), ctx).reactions).toEqual([]);
  });

  it('never hurts wizards', () => {
    const { world, ctx } = setup([
      { n: 1, at: v(0, 0), burning: true, maxHp: 100 },
      { n: 2, at: v(20, 0), team: 'squad' },
    ]);
    resolveUnitHit(id(1), hitOf(SPARK, STORM), ctx);
    expect(hp(world, 2)).toBe(CLASSES.pyromancer.maxHp);
  });

  it('every burning unit in a Lightning ring Combusts, in ascending id order', () => {
    const { ctx } = setup([
      { n: 5, at: v(4, 0), burning: true, maxHp: 200 },
      { n: 2, at: v(-4, 0), burning: true, maxHp: 200 },
    ]);
    const r = resolveAreaWithReactions(
      { centre: v(0, 0), blast: SPELLS.lightning, sourceId: STORM, teams: ['enemy'] },
      ctx,
    );
    expect(r.reactions.map((x) => x.origin)).toEqual([2, 5]);
  });

  it('reactionSourceId credits the Combust and its spread, not the hit (M6 Q3)', () => {
    const STRIKE = id(900);
    const REACTION = id(901);
    const { ctx, world } = setup([
      { n: 1, at: v(0, 0), burning: true, maxHp: 200 },
      { n: 2, at: v(30, 0), maxHp: 200 },
    ]);
    const r = resolveAreaWithReactions(
      {
        centre: v(0, 0),
        blast: SPELLS.lightning,
        sourceId: STRIKE,
        reactionSourceId: REACTION,
        teams: ['enemy'],
      },
      ctx,
    );
    expect(r.reactions).toHaveLength(1);
    expect(r.area.hits.map((h) => h.target)).toEqual([1]);
    expect(r.reactions[0]?.area.hits.map((h) => h.target)).toEqual([1, 2]);
    expect(r.reactions[0]?.sourceId).toBe(REACTION);
    expect(world.get(id(2))?.statuses.get('burning')?.sourceId).toBe(REACTION);
    const plain = setup([
      { n: 1, at: v(0, 0), burning: true, maxHp: 200 },
      { n: 2, at: v(30, 0) },
    ]);
    const plainResult = resolveAreaWithReactions(
      { centre: v(0, 0), blast: SPELLS.lightning, sourceId: STRIKE, teams: ['enemy'] },
      plain.ctx,
    );
    expect(plainResult.reactions[0]?.sourceId).toBe(STRIKE);
    expect(plain.world.get(id(2))?.statuses.get('burning')?.sourceId).toBe(STRIKE);
  });

  it('a keg in the Combust radius is triggered (32 + 8 px), one beyond is not', () => {
    const near = createKeg(id(20), v(40, 0));
    const far = createKeg(id(21), v(-40.01, 0));
    const { ctx } = setup([{ n: 1, at: v(0, 0), burning: true, maxHp: 100 }], [near, far]);
    expect(resolveUnitHit(id(1), hitOf(SPARK, STORM), ctx).kegs).toEqual([20]);
  });
});

describe('keg triggers by source (GDD §8, Q6, Q12)', () => {
  const keg = createKeg(id(20), v(0, 0));

  it('Fireball, Lightning and an arcane blast trigger a keg in their ring', () => {
    const { ctx } = setup([], [keg]);
    for (const blast of [SPELLS.fireball, SPELLS.lightning, ARCANE_BLAST]) {
      const r = resolveAreaWithReactions(
        { centre: v(5, 0), blast, sourceId: PYRO, teams: ['enemy'] },
        ctx,
      );
      expect(r.kegs).toEqual([20]);
    }
  });

  it('Lightning reaches a keg 16 px away (8 + 8), not farther', () => {
    const { ctx } = setup([], [keg]);
    const at = (x: number) =>
      resolveAreaWithReactions(
        { centre: v(x, 0), blast: SPELLS.lightning, sourceId: STORM, teams: ['enemy'] },
        ctx,
      ).kegs;
    expect(at(16)).toEqual([20]);
    expect(at(16.01)).toEqual([]);
  });

  it('arrows, melee and wizard autos never trigger a keg', () => {
    const { ctx } = setup(
      [
        { n: 1, at: v(0, 0), team: 'squad' },
        { n: 2, at: v(2, 0), maxHp: 100 },
      ],
      [keg],
    );
    const arrow = { ...ARCHER.attack, sourceId: id(2) };
    const melee = { ...GRUNT.attack, sourceId: id(2) };
    expect(resolveUnitHit(id(1), arrow, ctx).kegs).toEqual([]);
    expect(resolveUnitHit(id(1), melee, ctx).kegs).toEqual([]);
    expect(resolveUnitHit(id(2), hitOf(SPARK, STORM), ctx).kegs).toEqual([]);
    expect(resolveUnitHit(id(2), hitOf(BOLT, PYRO), ctx).kegs).toEqual([]);
  });

  it('a fusing or spent keg is not listed again', () => {
    const fusing = triggerKeg(keg, KABOOM).keg;
    const { ctx } = setup([], [fusing]);
    expect(
      resolveAreaWithReactions(
        { centre: v(0, 0), blast: SPELLS.fireball, sourceId: PYRO, teams: ['enemy'] },
        ctx,
      ).kegs,
    ).toEqual([]);
  });
});

describe('Kaboom (GDD §8)', () => {
  it('verify: a wizard at 70 px takes 30, a wizard at 90 px nothing', () => {
    const { world, ctx } = setup([
      { n: 1, at: v(70, 0), team: 'squad' },
      { n: 2, at: v(0, 90), team: 'squad' },
    ]);
    const r = resolveKaboom({ id: id(20), position: v(0, 0) }, ctx);
    expect(hp(world, 1)).toBe(CLASSES.pyromancer.maxHp - 30);
    expect(hp(world, 2)).toBe(CLASSES.pyromancer.maxHp);
    // Wizards don't burn but are pushed.
    expect(burning(world, 1)).toBe(false);
    expect(r.area.knockbacks.map((k) => [k.target, k.distancePx])).toEqual([
      [1, KABOOM.blast.knockbackPx],
    ]);
  });

  it('hits enemies for full damage, burns survivors, kills as blood, credits the keg', () => {
    const { world, ctx } = setup([
      { n: 1, at: v(30, 0), maxHp: 200 },
      { n: 2, at: v(-30, 0) },
    ]);
    const r = resolveKaboom({ id: id(20), position: v(0, 0) }, ctx);
    expect(hp(world, 1)).toBe(200 - KABOOM.blast.damage);
    expect(burning(world, 1)).toBe(true);
    expect(world.get(id(1))?.statuses.get('burning')?.sourceId).toBe(20);
    expect(r.deaths).toEqual([
      { id: id(2), team: 'enemy', cause: 'combat', deathVariant: 'blood', gibbed: true },
    ]);
    expect(r.reactions).toEqual([
      {
        reaction: 'kaboom',
        at: v(0, 0),
        origin: id(20),
        spreadTo: [],
        consumed: false,
        sourceId: id(20),
        area: r.area,
      },
    ]);
  });

  it('never Combusts a burning unit (it is fire)', () => {
    const { ctx } = setup([{ n: 1, at: v(10, 0), burning: true, maxHp: 200 }]);
    expect(resolveKaboom({ id: id(20), position: v(0, 0) }, ctx).reactions).toHaveLength(1);
  });

  it('lists other idle kegs within 80 px, never itself', () => {
    const self = createKeg(id(20), v(0, 0));
    const near = createKeg(id(21), v(80, 0));
    const far = createKeg(id(22), v(0, 80.01));
    const { ctx } = setup([], [self, near, far]);
    expect(resolveKaboom(self, ctx).kegs).toEqual([21]);
  });

  it.each(FPS)(
    'verify: a chain of 3 at 64 px goes off in order, fuseMs apart, at %i fps',
    (fps) => {
      const dt = 1000 / fps;
      let kegs: KegState[] = [0, 1, 2].map((i) => createKeg(id(20 + i), v(i * 64, 0)));
      const wizard = { n: 1, at: v(64, 70), team: 'squad' as const, maxHp: 200 };
      const { world, ctxWith } = setup([wizard]);
      // A Fireball lights the first keg (frame 0).
      const lit = resolveAreaWithReactions(
        { centre: v(-20, 0), blast: SPELLS.fireball, sourceId: PYRO, teams: ['enemy'] },
        ctxWith(kegs),
      );
      expect(lit.kegs).toEqual([20]);
      kegs = kegs.map((k) => (lit.kegs.includes(k.id) ? triggerKeg(k, KABOOM).keg : k));

      const booms: [EntityId, number][] = [];
      for (let t = dt; t < 2000; t += dt) {
        const step = stepKegs(kegs, dt);
        kegs = [...step.kegs];
        for (const keg of step.exploded) {
          booms.push([keg.id, t]);
          const r = resolveKaboom(keg, ctxWith(kegs));
          kegs = kegs.map((k) => (r.kegs.includes(k.id) ? triggerKeg(k, KABOOM).keg : k));
        }
      }
      expect(booms.map(([k]) => k)).toEqual([20, 21, 22]);
      booms.forEach(([, t], i) => {
        const expected = (i + 1) * KABOOM.fuseMs;
        expect(t).toBeGreaterThanOrEqual(expected - 1e-6);
        expect(t).toBeLessThan(expected + (i + 1) * dt);
      });
      for (let i = 1; i < booms.length; i++) {
        const gap = (booms[i]?.[1] ?? 0) - (booms[i - 1]?.[1] ?? 0);
        expect(gap).toBeGreaterThanOrEqual(KABOOM.fuseMs - 1e-6);
        expect(gap).toBeLessThan(KABOOM.fuseMs + dt);
      }
      expect(kegs.every((k) => k.phase === 'spent')).toBe(true);
      // The wizard 70 px from keg 21, and 95 px from 20 and 22, takes exactly one half blast.
      expect(hp(world, 1)).toBe(200 - KABOOM.blast.damage * KABOOM.squadDamageMultiplier);
    },
  );
});
