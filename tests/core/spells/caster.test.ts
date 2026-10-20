import { describe, expect, it } from 'vitest';
import type { EntityId, MageClassId, Vec2 } from '@core/types';
import type { AreaBody } from '@core/combat/area';
import { resolveAreaEvent } from '@core/combat/area';
import { CombatWorld } from '@core/combat/world';
import { createIdAllocator } from '@core/ids';
import { distance } from '@core/math/vec2';
import { spellSlots } from '@core/spells/availability';
import {
  castSpell,
  clampAim,
  cooldownRemainingMs,
  createCaster,
  stepCaster,
  type CasterState,
  type CastRequest,
  type SpellImpact,
} from '@core/spells/caster';
import { CLASSES } from '@data/classes';
import { GIBS } from '@data/combat';
import { ENEMIES } from '@data/enemies';
import { SPELLS, SPELL_TUNING } from '@data/spells';
import { STATUSES } from '@data/statuses';
import { KEG } from '@data/structures';

const v = (x: number, y: number): Vec2 => ({ x, y });
const id = (n: number) => n as EntityId;
const FPS = [30, 60, 144] as const;
const RANGE = SPELL_TUNING.maxCastRangePx;
const GRUNT = ENEMIES['goblin-grunt'];
const FIREBALL_DELIVERY = SPELLS.fireball.delivery;
const LIGHTNING_DELIVERY = SPELLS.lightning.delivery;
const LEADER = { id: id(1), position: v(1000, 1000) };
const BOTH: MageClassId[] = ['pyromancer', 'stormcaller'];

const slotsOf = (living: readonly MageClassId[]) => spellSlots(living, CLASSES, SPELLS);

function request(slot: 1 | 2, aim: Vec2 | null, overrides: Partial<CastRequest> = {}): CastRequest {
  const ids = createIdAllocator(100);
  return {
    slot,
    slots: slotsOf(BOTH),
    leader: LEADER,
    aim,
    nextId: () => ids.next(),
    ...overrides,
  };
}

const cast = (state: CasterState, req: CastRequest) => castSpell(state, req, SPELLS, SPELL_TUNING);

/** Steps until something lands (or `maxMs`), returning the impacts and the time of the frame. */
function flyUntilImpact(
  state: CasterState,
  dtMs: number,
  hitBodies: readonly AreaBody[] = [],
  maxMs = 5000,
): { impacts: readonly SpellImpact[]; atMs: number; state: CasterState } {
  let s = state;
  for (let t = dtMs; t <= maxMs + dtMs; t += dtMs) {
    const step = stepCaster(s, { hitBodies, dtMs });
    s = step.state;
    if (step.impacts.length > 0) return { impacts: step.impacts, atMs: t, state: s };
  }
  return { impacts: [], atMs: Number.POSITIVE_INFINITY, state: s };
}

const body = (n: number, at: Vec2, bodyRadiusPx: number, alive = true): AreaBody => ({
  id: id(n),
  position: at,
  bodyRadiusPx,
  alive,
});

describe('createCaster', () => {
  it('starts with every cooldown ready and nothing in flight', () => {
    const s = createCaster(SPELLS);
    expect(cooldownRemainingMs(s, 'fireball')).toBe(0);
    expect(cooldownRemainingMs(s, 'lightning')).toBe(0);
    expect(s.pending).toEqual([]);
  });
});

describe('clampAim (GDD §4: 280 px from the leader)', () => {
  it('keeps aims in range, pulls far ones in along the line', () => {
    expect(clampAim(v(0, 0), v(100, 50), RANGE)).toEqual(v(100, 50));
    expect(clampAim(v(0, 0), v(RANGE, 0), RANGE)).toEqual(v(RANGE, 0));
    const far = clampAim(v(10, 20), v(10 + 300, 20 + 400), RANGE);
    expect(far.x).toBeCloseTo(10 + 0.6 * RANGE, 9);
    expect(far.y).toBeCloseTo(20 + 0.8 * RANGE, 9);
    expect(clampAim(v(5, 5), v(5, 5), RANGE)).toEqual(v(5, 5));
  });
});

describe('castSpell', () => {
  it('casts Fireball from the leader at the clamped aim and starts its cooldown', () => {
    const r = cast(createCaster(SPELLS), request(1, v(1600, 1000)));
    expect(r.outcome).toEqual({
      kind: 'cast',
      spell: 'fireball',
      from: LEADER.position,
      at: v(1000 + RANGE, 1000),
    });
    expect(cooldownRemainingMs(r.state, 'fireball')).toBe(SPELLS.fireball.cooldownMs);
    expect(cooldownRemainingMs(r.state, 'lightning')).toBe(0);
    expect(r.state.pending).toHaveLength(1);
    expect(r.state.pending[0]).toMatchObject({ kind: 'projectile', id: 100, sourceId: 1 });
  });

  it('casts Lightning as a strike with its telegraph', () => {
    const r = cast(createCaster(SPELLS), request(2, v(1100, 1000)));
    expect(r.outcome).toMatchObject({ kind: 'cast', spell: 'lightning', at: v(1100, 1000) });
    expect(r.state.pending[0]).toMatchObject({
      kind: 'strike',
      remainingMs: LIGHTNING_DELIVERY.telegraphMs,
    });
  });

  it('a lost spell is denied: no cooldown, nothing cast, state untouched', () => {
    const state = createCaster(SPELLS);
    const onlyStorm = slotsOf(['stormcaller']);
    const r = cast(state, request(1, v(1100, 1000), { slots: onlyStorm }));
    expect(r.outcome).toEqual({ kind: 'denied', spell: 'fireball' });
    expect(r.state).toBe(state);
    // Slot 1 stays Fireball when only Stormcallers live; slot 2 still casts.
    expect(cast(state, request(2, v(1100, 1000), { slots: onlyStorm })).outcome.kind).toBe('cast');
  });

  it('denial leaves a running cooldown alone (lost mid-cooldown)', () => {
    const casted = cast(createCaster(SPELLS), request(1, v(1100, 1000))).state;
    const ticked = stepCaster(casted, { hitBodies: [], dtMs: 500 }).state;
    const r = cast(ticked, request(1, v(1100, 1000), { slots: slotsOf(['stormcaller']) }));
    expect(r.outcome.kind).toBe('denied');
    expect(cooldownRemainingMs(r.state, 'fireball')).toBe(SPELLS.fireball.cooldownMs - 500);
  });

  it('is ignored on cooldown, without aim, without a leader, or for an empty slot', () => {
    const state = createCaster(SPELLS);
    const busy = cast(state, request(2, v(1100, 1000))).state;
    expect(cast(busy, request(2, v(1100, 1000))).outcome).toEqual({
      kind: 'ignored',
      spell: 'lightning',
      reason: 'cooldown',
    });
    expect(cast(state, request(1, null)).outcome).toMatchObject({ reason: 'no-aim' });
    expect(cast(state, request(1, v(0, 0), { leader: null })).outcome).toMatchObject({
      reason: 'no-leader',
    });
    expect(cast(state, request(1, v(0, 0), { slots: [] })).outcome).toMatchObject({
      reason: 'no-spell',
    });
    for (const r of [
      cast(busy, request(2, v(1100, 1000))),
      cast(state, request(1, null)),
      cast(state, request(1, v(0, 0), { leader: null })),
    ]) {
      expect(r.state === state || r.state === busy).toBe(true);
    }
  });

  it.each(FPS)('pressing every frame casts at the cooldown rate at %i fps', (fps) => {
    const dt = 1000 / fps;
    for (const [slot, spell] of [
      [1, 'fireball'],
      [2, 'lightning'],
    ] as const) {
      let s = createCaster(SPELLS);
      const castTimes: number[] = [];
      const ids = createIdAllocator();
      for (let t = 0; t < 20_000; t += dt) {
        s = stepCaster(s, { hitBodies: [], dtMs: dt }).state;
        const r = castSpell(
          s,
          request(slot, v(1050, 1000), { nextId: () => ids.next() }),
          SPELLS,
          SPELL_TUNING,
        );
        s = r.state;
        if (r.outcome.kind === 'cast') castTimes.push(t);
      }
      const cd = SPELLS[spell].cooldownMs;
      expect(castTimes).toHaveLength(Math.ceil(20_000 / cd));
      for (let i = 1; i < castTimes.length; i++) {
        const gap = (castTimes[i] ?? 0) - (castTimes[i - 1] ?? 0);
        expect(gap).toBeGreaterThanOrEqual(cd - dt - 1e-6);
        expect(gap).toBeLessThanOrEqual(cd + dt + 1e-6);
      }
      // The carry keeps the long-run rate exact.
      const last = castTimes[castTimes.length - 1] ?? 0;
      expect(Math.abs(last - (castTimes.length - 1) * cd)).toBeLessThanOrEqual(dt + 1e-6);
    }
  });

  it('cooldowns tick while the spell is lost', () => {
    const casted = cast(createCaster(SPELLS), request(1, v(1100, 1000))).state;
    const s = stepCaster(casted, { hitBodies: [], dtMs: SPELLS.fireball.cooldownMs }).state;
    expect(cooldownRemainingMs(s, 'fireball')).toBe(0);
  });
});

describe('stepCaster: Lightning', () => {
  it.each(FPS)('strikes on the frame its telegraph has elapsed, at %i fps', (fps) => {
    const dt = 1000 / fps;
    const r = cast(createCaster(SPELLS), request(2, v(1100, 1000)));
    const { impacts, atMs } = flyUntilImpact(r.state, dt);
    expect(impacts).toEqual([
      { id: id(100), spell: 'lightning', at: v(1100, 1000), sourceId: id(1), hitBody: null },
    ]);
    expect(atMs).toBeGreaterThanOrEqual(LIGHTNING_DELIVERY.telegraphMs - 1e-6);
    expect(atMs).toBeLessThan(LIGHTNING_DELIVERY.telegraphMs + dt);
  });

  it('hits what is in range at strike time, not at cast time', () => {
    const world = new CombatWorld();
    world.add({ id: id(10), team: 'enemy', maxHp: GRUNT.maxHp, bodyRadiusPx: GRUNT.bodyRadiusPx });
    world.add({ id: id(11), team: 'enemy', maxHp: GRUNT.maxHp, bodyRadiusPx: GRUNT.bodyRadiusPx });
    const at = v(1100, 1000);
    const { state } = cast(createCaster(SPELLS), request(2, at));
    // At cast time 10 stands on the spot and 11 is away; by strike time they have swapped.
    const { impacts } = flyUntilImpact(state, 1000 / 60);
    const [impact] = impacts;
    if (!impact) throw new Error('no strike');
    const r = resolveAreaEvent(
      { centre: impact.at, blast: SPELLS.lightning, sourceId: impact.sourceId, teams: ['enemy'] },
      [
        { id: id(10), position: v(1200, 1000) },
        { id: id(11), position: v(1105, 1000) },
      ],
      { world, statuses: STATUSES, gibs: GIBS },
    );
    expect(r.deaths.map((d) => [d.id, d.deathVariant])).toEqual([[11, 'electrified']]);
    expect(world.isAlive(id(10))).toBe(true);
  });
});

describe('stepCaster: Fireball', () => {
  const corners = [v(1, 0), v(0, 1), v(-1, 0), v(0, -1), v(0.6, 0.8), v(-0.8, -0.6)];

  it.each(FPS)('explodes exactly at the clamped aim point at %i fps (D2)', (fps) => {
    const dt = 1000 / fps;
    for (const dir of corners) {
      for (const reach of [40, 200, RANGE, 900]) {
        const aim = v(1000 + dir.x * reach, 1000 + dir.y * reach);
        const r = cast(createCaster(SPELLS), request(1, aim));
        if (r.outcome.kind !== 'cast') throw new Error('not cast');
        const { impacts, atMs } = flyUntilImpact(r.state, dt);
        const [impact] = impacts;
        expect(impact?.hitBody).toBeNull();
        expect(distance(impact?.at ?? v(0, 0), r.outcome.at)).toBeLessThanOrEqual(2);
        expect(distance(r.outcome.at, LEADER.position)).toBeLessThanOrEqual(RANGE + 1e-9);
        const flightMs = (Math.min(reach, RANGE) / FIREBALL_DELIVERY.speed) * 1000;
        expect(atMs).toBeGreaterThanOrEqual(flightMs - 1e-6);
        expect(atMs).toBeLessThan(flightMs + dt + 1e-6);
      }
    }
  });

  it('explodes at the contact point on the first enemy body on its path', () => {
    const r = cast(createCaster(SPELLS), request(1, v(1250, 1000)));
    const grunt = body(10, v(1100, 1000), GRUNT.bodyRadiusPx);
    const behind = body(11, v(1150, 1000), GRUNT.bodyRadiusPx);
    const { impacts } = flyUntilImpact(r.state, 1000 / 60, [behind, grunt]);
    const [impact] = impacts;
    expect(impact?.hitBody).toBe(10);
    const contactX = 1100 - GRUNT.bodyRadiusPx - FIREBALL_DELIVERY.projectileRadiusPx;
    expect(impact?.at.x).toBeCloseTo(contactX, 9);
    expect(impact?.at.y).toBeCloseTo(1000, 9);
  });

  it('explodes on a keg, and flies past dead bodies and anything not listed (wizards)', () => {
    const keg = body(20, v(1200, 1000), KEG.bodyRadiusPx);
    const corpse = body(10, v(1100, 1000), GRUNT.bodyRadiusPx, false);
    const r = cast(createCaster(SPELLS), request(1, v(1250, 1000)));
    const { impacts } = flyUntilImpact(r.state, 1000 / 60, [corpse, keg]);
    expect(impacts[0]?.hitBody).toBe(20);
  });

  it('a body already overlapping the leader is hit at once', () => {
    const r = cast(createCaster(SPELLS), request(1, v(1200, 1000)));
    const hugging = body(10, v(1005, 1000), GRUNT.bodyRadiusPx);
    const { impacts, atMs } = flyUntilImpact(r.state, 1000 / 60, [hugging]);
    expect(impacts[0]?.hitBody).toBe(10);
    expect(atMs).toBeCloseTo(1000 / 60, 9);
    expect(impacts[0]?.at).toEqual(LEADER.position);
  });

  it('an aim on the leader explodes on the leader', () => {
    const r = cast(createCaster(SPELLS), request(1, LEADER.position));
    const { impacts } = flyUntilImpact(r.state, 1000 / 60);
    expect(impacts[0]?.at).toEqual(LEADER.position);
  });
});

describe('stepCaster: in-flight casts (Q4) and order', () => {
  it('a cast resolves after the caster dies and the slot is lost', () => {
    // Stepping never consults the squad or the slots: casting was the last time they mattered.
    const r = cast(createCaster(SPELLS), request(1, v(1100, 1000)));
    const lostAfter = cast(r.state, request(1, v(0, 0), { leader: null, slots: [] }));
    expect(lostAfter.state).toBe(r.state);
    const { impacts } = flyUntilImpact(lostAfter.state, 1000 / 60);
    expect(impacts.map((i) => [i.spell, i.sourceId])).toEqual([['fireball', 1]]);
  });

  it('impacts of one frame come in cast order', () => {
    const ids = createIdAllocator(50);
    const nextId = () => ids.next();
    let s = cast(createCaster(SPELLS), request(1, LEADER.position, { nextId })).state;
    s = cast(s, request(2, v(1010, 1000), { nextId })).state;
    const step = stepCaster(s, { hitBodies: [], dtMs: 300 });
    expect(step.impacts.map((i) => [i.id, i.spell])).toEqual([
      [50, 'fireball'],
      [51, 'lightning'],
    ]);
    expect(step.state.pending).toEqual([]);
  });

  it('a zero dt changes nothing', () => {
    const s = cast(createCaster(SPELLS), request(2, v(1100, 1000))).state;
    expect(stepCaster(s, { hitBodies: [], dtMs: 0 })).toEqual({ state: s, impacts: [] });
  });
});
