/**
 * M5 scripted spell sim (T8; D3, D4, D5) at 30, 60 and 144 fps, in the dev arena with the real data:
 * 1. Fireball into the grunt pack.
 * 2. A Pyromancer bolt sets a survivor burning; a lethal Lightning on it still Combusts (GDD §7).
 * 3. Lightning snipes an archer; its neighbour and the keg beside them are untouched.
 * 4. Lightning on the east keg with the leader 70 px away: Kaboom kills the other archer, the
 *    leader takes 30 and is pushed 36 px; the follower behind takes nothing.
 * 5. Fireball into the keg chain: the middle keg goes, then both outer ones fuseMs later; the
 *    DEV_KEG_PACK grunts die as blood, gibs capped per event.
 * 6. Both Pyromancers die: Fireball is lost once, slot 1 is denied every time and never returns;
 *    slot 2 still casts.
 * Separately, GDD §8 verify (2) on real data: a Fireball from the spawn side at the south keg of the
 * chain gives 3 beats, south → middle → north, fuseMs apart.
 */
import { describe, expect, it } from 'vitest';
import type { EntityId, Vec2 } from '@core/types';
import { distance } from '@core/math/vec2';
import { CLASSES } from '@data/classes';
import { COMBAT, GIBS } from '@data/combat';
import { REACTIONS } from '@data/reactions';
import { SpellSim } from './spellSim';

const FPS = [30, 60, 144] as const;
const v = (x: number, y: number): Vec2 => ({ x, y });
const KABOOM = REACTIONS.kaboom;

/** Steps until `done` holds, failing after `maxMs`. */
function until(sim: SpellSim, done: () => boolean, maxMs = 3000): void {
  const end = sim.t + maxMs;
  while (!done()) {
    if (sim.t > end) throw new Error(`timed out at t=${sim.t.toFixed(1)}`);
    sim.frame();
  }
}

describe('M5 scripted spell sim', () => {
  it.each(FPS)('at %i fps', (fps) => {
    const sim = new SpellSim(1000 / fps);
    const [p1, s1, p2, s2] = sim.squad.members.map((m) => m.id);
    if (p1 === undefined || s1 === undefined || p2 === undefined || s2 === undefined) {
      throw new Error('squad of 4 expected');
    }
    expect([p1, s1, p2, s2].map((id) => sim.classOf(id))).toEqual([
      'pyromancer',
      'stormcaller',
      'pyromancer',
      'stormcaller',
    ]);
    const hpOf = (id: EntityId) => sim.world.get(id)?.hp;
    const deathsSince = (t: number) => sim.deaths.filter((d) => d.t > t).map((d) => d.value);

    // 1. Fireball into the pack, from the spawn.
    const front = sim.enemyAt(v(0, -178));
    const backLeft = sim.enemyAt(v(-32, -210));
    const backRight = sim.enemyAt(v(32, -210));
    expect(sim.frame({ press: { slot: 1, aim: sim.at(v(0, -194)) } })).toMatchObject({
      kind: 'cast',
      spell: 'fireball',
    });
    let mark = sim.t;
    until(sim, () => sim.impacts.length === 1);
    expect(sim.impacts[0]?.value).toMatchObject({ spell: 'fireball', hitBody: front.id });
    const packKills = deathsSince(mark);
    expect(packKills).toHaveLength(4);
    expect(packKills.every((d) => d.deathVariant === 'charred' && !d.gibbed)).toBe(true);
    expect(sim.world.isAlive(backLeft.id)).toBe(true);
    expect(sim.world.isAlive(backRight.id)).toBe(true);
    // Spells never touch wizards.
    for (const id of [p1, s1, p2, s2]) expect(hpOf(id)).toBe(sim.world.get(id)?.maxHp);

    // 2. A bolt sets the back-left grunt burning; a lethal Lightning on it still Combusts.
    sim.autoHit(p1, backLeft.id);
    expect(sim.world.get(backLeft.id)?.statuses.has('burning')).toBe(true);
    mark = sim.t;
    sim.frame({ press: { slot: 2, aim: backLeft.position } });
    until(sim, () => sim.impacts.length === 2);
    expect(deathsSince(mark).map((d) => [d.id, d.deathVariant])).toEqual([
      [backLeft.id, 'electrified'],
    ]);
    const combust = sim.reactions.find((r) => r.t > mark)?.value;
    expect(combust).toMatchObject({ reaction: 'combust', origin: backLeft.id, consumed: true });
    expect(sim.world.isAlive(backRight.id)).toBe(true);

    // 3. Walk east; Lightning snipes one archer.
    const archer = sim.enemyAt(v(400, -24));
    const archer2 = sim.enemyAt(v(400, 24));
    const eastKeg = sim.kegAt(v(440, 0));
    sim.walkTo(sim.at(v(200, 0)));
    sim.waitForCooldown('lightning');
    mark = sim.t;
    sim.frame({ press: { slot: 2, aim: archer.position } });
    until(sim, () => sim.impacts.length === 3);
    expect(deathsSince(mark).map((d) => [d.id, d.deathVariant])).toEqual([
      [archer.id, 'electrified'],
    ]);
    expect(sim.world.isAlive(archer2.id)).toBe(true);
    expect(sim.kegAt(v(440, 0)).phase).toBe('idle');

    // 4. Leader 70 px from the east keg; Lightning lights it.
    sim.walkTo(sim.at(v(370, 0)));
    expect(distance(sim.leader?.position ?? v(0, 0), eastKeg.position)).toBeCloseTo(70, 6);
    const follower = sim.squad.members[1];
    if (!follower) throw new Error('no follower');
    expect(distance(follower.position, eastKeg.position)).toBeGreaterThan(
      KABOOM.blast.radiusPx + 10,
    );
    sim.waitForCooldown('lightning');
    mark = sim.t;
    sim.frame({ press: { slot: 2, aim: eastKeg.position } });
    until(sim, () => sim.reactions.some((r) => r.t > mark && r.value.reaction === 'kaboom'));
    const fuse = sim.fuses.find((f) => f.value === eastKeg.id);
    const boom = sim.reactions.find((r) => r.value.origin === eastKeg.id);
    if (!fuse || !boom) throw new Error('east keg never went off');
    const dt = 1000 / fps;
    // The ring shows for the full fuse (D5), and never a frame more than needed.
    expect(boom.t - fuse.t).toBeGreaterThanOrEqual(KABOOM.fuseMs - 1e-6);
    expect(boom.t - fuse.t).toBeLessThan(KABOOM.fuseMs + dt);
    expect(deathsSince(mark).map((d) => [d.id, d.deathVariant])).toEqual([[archer2.id, 'blood']]);
    expect(hpOf(p1)).toBe(
      CLASSES.pyromancer.maxHp - KABOOM.blast.damage * KABOOM.squadDamageMultiplier,
    );
    expect(hpOf(follower.id)).toBe(sim.world.get(follower.id)?.maxHp);
    const beforePush = sim.at(v(370, 0));
    sim.run(COMBAT.knockbackMs * 2);
    const leader = sim.squad.members.find((m) => m.id === p1);
    expect(leader?.position.x).toBeCloseTo(beforePush.x - KABOOM.blast.knockbackPx, 6);
    expect(leader?.position.y).toBeCloseTo(beforePush.y, 6);

    // 5. Walk west; Fireball into the middle keg of the chain.
    const chain = [v(-400, -64), v(-400, 0), v(-400, 64)].map((o) => sim.kegAt(o));
    const [top, middle, bottom] = chain;
    if (!top || !middle || !bottom) throw new Error('chain of 3 expected');
    const pack = [v(-448, -16), v(-448, 16), v(-480, -16), v(-480, 16)].map((o) => sim.enemyAt(o));
    sim.walkTo(sim.at(v(-200, 0)));
    sim.waitForCooldown('fireball');
    mark = sim.t;
    sim.frame({ press: { slot: 1, aim: middle.position } });
    until(sim, () => chain.every((k) => sim.kegs.find((x) => x.id === k.id)?.phase === 'spent'));
    expect(sim.impacts[sim.impacts.length - 1]?.value).toMatchObject({
      spell: 'fireball',
      hitBody: middle.id,
    });
    const booms = sim.reactions.filter((r) => r.t > mark && r.value.reaction === 'kaboom');
    expect(booms.map((b) => b.value.origin)).toEqual([middle.id, top.id, bottom.id]);
    const [first, second, third] = booms;
    if (!first || !second || !third) throw new Error('3 Kabooms expected');
    expect(second.t).toBe(third.t);
    expect(second.t - first.t).toBeGreaterThanOrEqual(KABOOM.fuseMs - 1e-6);
    expect(second.t - first.t).toBeLessThan(KABOOM.fuseMs + dt);
    const packDeaths = deathsSince(mark).filter((d) => pack.some((e) => e.id === d.id));
    expect(packDeaths).toHaveLength(4);
    expect(packDeaths.every((d) => d.deathVariant === 'blood')).toBe(true);
    expect(packDeaths.filter((d) => d.gibbed).length).toBeLessThanOrEqual(GIBS.maxGibbedPerEvent);
    // The squad stood clear.
    expect(hpOf(p1)).toBe(
      CLASSES.pyromancer.maxHp - KABOOM.blast.damage * KABOOM.squadDamageMultiplier,
    );

    // 6. Both Pyromancers die: Fireball is lost once, slot 1 denied, slot 2 still casts.
    sim.killWizards([p1]);
    expect(sim.lost).toEqual([]);
    sim.killWizards([p2]);
    expect(sim.lost.map((l) => l.value)).toEqual(['fireball']);
    expect(sim.slots).toEqual([
      { slot: 1, spell: 'fireball', available: false },
      { slot: 2, spell: 'lightning', available: true },
    ]);
    const fireballCd = sim.caster.cooldowns.fireball;
    const pendingBefore = sim.caster.pending.length;
    for (let i = 0; i < 20; i++) {
      expect(sim.frame({ press: { slot: 1, aim: sim.at(v(0, 0)) } })).toEqual({
        kind: 'denied',
        spell: 'fireball',
      });
      sim.run(200);
    }
    expect(sim.caster.pending.length).toBe(pendingBefore);
    expect(sim.caster.cooldowns.fireball.remainingMs).toBeLessThanOrEqual(fireballCd.remainingMs);
    expect(
      sim.casts.filter((c) => c.value.kind === 'cast' && c.value.spell === 'fireball'),
    ).toHaveLength(2);
    expect(sim.lost.map((l) => l.value)).toEqual(['fireball']);
    expect(sim.slots[0]).toEqual({ slot: 1, spell: 'fireball', available: false });
    sim.waitForCooldown('lightning');
    expect(sim.frame({ press: { slot: 2, aim: sim.at(v(0, 0)) } })).toMatchObject({
      kind: 'cast',
      spell: 'lightning',
    });
    expect(sim.leader?.id).toBe(s1);
  });

  it.each(FPS)(
    'GDD §8 verify: Fireball at the south keg, 3 beats fuseMs apart, at %i fps',
    (fps) => {
      const dt = 1000 / fps;
      const sim = new SpellSim(dt);
      const [north, middle, south] = [v(-400, -64), v(-400, 0), v(-400, 64)].map((o) =>
        sim.kegAt(o),
      );
      if (!north || !middle || !south) throw new Error('chain of 3 expected');
      const pack = [v(-448, -16), v(-448, 16), v(-480, -16), v(-480, 16)].map((o) =>
        sim.enemyAt(o),
      );
      const wizards = sim.squad.members.map((m) => m.id);
      // From the spawn side: walk west level with the south keg, then shoot along the row.
      sim.walkTo(sim.at(v(-200, 64)));
      const mark = sim.t;
      expect(sim.frame({ press: { slot: 1, aim: south.position } })).toMatchObject({
        kind: 'cast',
      });
      const spent = () =>
        [north, middle, south].every((k) => sim.kegs.find((x) => x.id === k.id)?.phase === 'spent');
      until(sim, spent);
      expect(sim.impacts[0]?.value).toMatchObject({ spell: 'fireball', hitBody: south.id });
      // Only the south keg was lit by the Fireball itself.
      expect(sim.fuses.filter((f) => f.t === sim.impacts[0]?.t).map((f) => f.value)).toEqual([
        south.id,
      ]);
      const booms = sim.reactions.filter((r) => r.t > mark && r.value.reaction === 'kaboom');
      expect(booms.map((b) => b.value.origin)).toEqual([south.id, middle.id, north.id]);
      const fuse = sim.fuses.find((f) => f.value === south.id);
      if (!fuse) throw new Error('south keg never lit');
      const beats = [fuse.t, ...booms.map((b) => b.t)];
      for (let i = 1; i < beats.length; i++) {
        const gap = (beats[i] ?? 0) - (beats[i - 1] ?? 0);
        expect(gap).toBeGreaterThanOrEqual(KABOOM.fuseMs - 1e-6);
        expect(gap).toBeLessThan(KABOOM.fuseMs + dt);
      }
      // The pack dies as blood; the squad, 200 px off, is untouched.
      const packDeaths = sim.deaths.filter((d) => pack.some((e) => e.id === d.value.id));
      expect(packDeaths).toHaveLength(4);
      expect(packDeaths.every((d) => d.value.deathVariant === 'blood')).toBe(true);
      for (const id of wizards) expect(sim.world.get(id)?.hp).toBe(sim.world.get(id)?.maxHp);
    },
  );
});
