/** M7 T11b: area blasts hit a hut by its footprint's closest point (GDD §0 area-hit table). */
import { describe, expect, it } from 'vitest';
import type { AreaBlastDef, EntityId, Vec2 } from '@core/types';
import {
  applyAreaStatus,
  bodiesInRadius,
  resolveAreaEvent,
  ringTouches,
  type AreaContext,
} from '@core/combat/area';
import { CombatWorld } from '@core/combat/world';
import { hutUnitSpec } from '@core/structures/hut';
import { GIBS } from '@data/combat';
import { CONVERGENCES } from '@data/convergences';
import { SPELLS } from '@data/spells';
import { STATUSES } from '@data/statuses';
import { HUT } from '@data/structures';
import { VOLUNTEER } from '@data/volunteer';

const v = (x: number, y: number): Vec2 => ({ x, y });
const id = (n: number) => n as EntityId;
const HUT_ID = id(50);
const AT = v(500, 500);
const HALF = HUT.footprintPx / 2;
/** The footprint's south-east corner. */
const CORNER = v(AT.x + HALF, AT.y + HALF);

const LIGHTNING: AreaBlastDef = SPELLS.lightning;
const METEOR = CONVERGENCES.meteor.pattern;

function hutWorld(): { world: CombatWorld; ctx: AreaContext } {
  const world = new CombatWorld();
  world.add(hutUnitSpec(HUT_ID, HUT));
  return { world, ctx: { world, statuses: STATUSES, gibs: GIBS } };
}

const hits = (centre: Vec2, blast: AreaBlastDef) => {
  const { ctx } = hutWorld();
  const r = resolveAreaEvent(
    { centre, blast, sourceId: id(1), teams: ['enemy'] },
    [{ id: HUT_ID, position: AT }],
    ctx,
  );
  return r.hits.map((h) => h.target);
};

/** On the diagonal out of the corner, `gap` px from it. */
const diagonal = (gap: number) => v(CORNER.x + gap / Math.SQRT2, CORNER.y + gap / Math.SQRT2);

describe('hut footprint area hits (GDD §0)', () => {
  it('the footprint is set on the hut unit', () => {
    expect(hutUnitSpec(HUT_ID, HUT).footprintPx).toBe(HUT.footprintPx);
  });

  it('a corner-diagonal blast that misses the inscribed circle but touches the square hits', () => {
    const centre = diagonal(LIGHTNING.radiusPx - 0.5);
    // The old body rule (inscribed circle) would miss it…
    expect(Math.hypot(centre.x - AT.x, centre.y - AT.y)).toBeGreaterThan(
      LIGHTNING.radiusPx + HUT.bodyRadiusPx,
    );
    // …the footprint rule hits.
    expect(hits(centre, LIGHTNING)).toEqual([HUT_ID]);
  });

  it('a blast just outside the square misses', () => {
    expect(hits(diagonal(LIGHTNING.radiusPx + 0.5), LIGHTNING)).toEqual([]);
    expect(hits(v(CORNER.x + LIGHTNING.radiusPx + 0.01, AT.y), LIGHTNING)).toEqual([]);
  });

  it('touching the face exactly hits (≤), as does a centre inside the footprint', () => {
    expect(hits(v(CORNER.x + LIGHTNING.radiusPx, AT.y), LIGHTNING)).toEqual([HUT_ID]);
    expect(hits(v(AT.x + 10, AT.y - 20), LIGHTNING)).toEqual([HUT_ID]);
  });

  it('applies to every blast: Fireball, Volunteer, Convergence', () => {
    for (const blast of [SPELLS.fireball, VOLUNTEER.blast, METEOR.blast]) {
      expect(hits(diagonal(blast.radiusPx - 0.5), blast)).toEqual([HUT_ID]);
      expect(hits(diagonal(blast.radiusPx + 0.5), blast)).toEqual([]);
    }
  });

  it('burning ground (applyAreaStatus) uses the footprint too', () => {
    const { ctx } = hutWorld();
    const status = (centre: Vec2) =>
      applyAreaStatus(
        { centre, radiusPx: 20, status: 'burning', sourceId: id(1), teams: ['enemy'] },
        [{ id: HUT_ID, position: AT }],
        ctx,
      ).map((s) => s.target);
    expect(status(diagonal(21))).toEqual([]);
    expect(status(diagonal(19))).toEqual([HUT_ID]);
  });

  it('units keep the body rule', () => {
    const world = new CombatWorld();
    world.add({ id: id(5), team: 'enemy', maxHp: 24, bodyRadiusPx: 12 });
    const r = resolveAreaEvent(
      { centre: v(0, 0), blast: LIGHTNING, sourceId: id(1), teams: ['enemy'] },
      [{ id: id(5), position: v(LIGHTNING.radiusPx + 12, 0) }],
      { world, statuses: STATUSES, gibs: GIBS },
    );
    expect(r.hits.map((h) => h.target)).toEqual([5]);
    expect(ringTouches(v(0, 0), 8, { position: v(20.01, 0), bodyRadiusPx: 12 })).toBe(false);
  });

  it('bodiesInRadius honours a footprint body (barrage target picking)', () => {
    const hut = {
      id: HUT_ID,
      position: AT,
      bodyRadiusPx: HUT.bodyRadiusPx,
      alive: true,
      footprintPx: HUT.footprintPx,
    };
    expect(bodiesInRadius(diagonal(19), 20, [hut])).toEqual([HUT_ID]);
    expect(bodiesInRadius(diagonal(21), 20, [hut])).toEqual([]);
  });
});
