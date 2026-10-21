/**
 * M6 T8 sims in the dev arena (D1–D3), real data:
 * - Convergence per composition on DEV_ENCOUNTER's grunt pack: combo and power, kills, Combusts from
 *   Firestorm's bolts, no wizard damage, and the meter gains nothing from the strike itself.
 * - Deaths mid-channel: P,S,S losing its P leader → Thunderstorm ×1.5, the channel goes on.
 * - Volunteer! into the keg chain: all three kegs blow, the pack dies, no wizard is hurt.
 * - Meter time-to-full in the M4 no-input fight, logged for GDD §16 request 3.
 */
import { describe, expect, it } from 'vitest';
import type { EntityId, MageClassId, Vec2 } from '@core/types';
import { ConvergenceMeter } from '@core/convergence/meter';
import { distance } from '@core/math/vec2';
import { CLASSES } from '@data/classes';
import { CONVERGENCE, CONVERGENCES } from '@data/convergences';
import { DEV_ENCOUNTER, DEV_KEG_PACK } from '@data/devArena';
import { ENEMIES } from '@data/enemies';
import { VOLUNTEER } from '@data/volunteer';
import { runEncounter } from '../combat/encounterSim';
import { M6Sim } from './convergenceSim';
import { COMPOSITIONS, P, S } from './fixtures';

const FPS = [30, 60, 144] as const;
/** Centre of DEV_ENCOUNTER's 3×2 grunt grid (offsets x −32…32, y −210…−178). */
const PACK = { x: 0, y: -194 };

const wizardHp = (sim: M6Sim): number[] =>
  sim.squad.members.map((m) => sim.world.get(m.id)?.hp ?? 0);
const packIds = (sim: M6Sim): EntityId[] =>
  sim.enemies
    .filter((e) => e.enemy === 'goblin-grunt' && distance(e.position, sim.at(PACK)) < 60)
    .map((e) => e.id);

/** A full meter, R at the pack, and long enough for every strike and the burning ground. */
function convergeOnPack(classes: readonly MageClassId[], fps = 60, seed = 1) {
  const sim = new M6Sim(1000 / fps, classes, seed);
  const pack = packIds(sim);
  const hpBefore = wizardHp(sim);
  expect(sim.meter.fill()).toBe(true);
  sim.pressConvergence(sim.at(PACK));
  sim.run(CONVERGENCE.channelMs + 6000);
  return { sim, pack, hpBefore };
}

describe('M6 sim: Convergence per composition on the grunt pack (D1, D2)', () => {
  it.each(COMPOSITIONS)('%s → %s ×%d', (_name, classes, combo, power) => {
    const { sim, pack, hpBefore } = convergeOnPack(classes);
    expect(sim.channelOutcomes.map((o) => o.value.kind)).toEqual(['started']);
    expect(sim.released.map((r) => r.value)).toEqual([{ combo, power, at: sim.at(PACK) }]);

    // Every blast is the combo's, damage × power.
    const def = CONVERGENCES[combo];
    const base =
      def.pattern.kind === 'impact'
        ? [def.pattern.blast.damage]
        : def.pattern.strikes.map((s) => s.blast.damage);
    expect(sim.strikeBlasts.map((b) => b.value.event.blast.damage).sort((a, b) => a - b)).toEqual(
      base.map((d) => Math.round(d * power)).sort((a, b) => a - b),
    );

    // Never wizards: no hit on any wizard, every wizard at full HP.
    expect(sim.wizardHits).toEqual([]);
    expect(wizardHp(sim)).toEqual(hpBefore);
    expect(sim.squad.members).toHaveLength(classes.length);

    // Kills in the pack.
    const dead = pack.filter((id) => !sim.world.isAlive(id));
    expect(dead.length).toBeGreaterThan(0);

    // The strike never charges (GDD §9); any Combust it causes is credited to the reaction id.
    const combusts = sim.reactions.filter((r) => r.value.reaction === 'combust');
    expect(combusts.every((c) => c.value.sourceId === sim.convergenceReactionId)).toBe(true);
    if (combusts.length === 0) expect(sim.meter.value).toBe(0);
    expect(sim.charged).toEqual([]);
  });

  it('Meteor and Firestorm at ×2+ wipe the pack; the archers and the far grunts are untouched', () => {
    for (const classes of [
      [P, P, S, S],
      [P, P, S],
      [P, S, S],
    ] as const) {
      const { sim, pack } = convergeOnPack(classes);
      expect(pack.every((id) => !sim.world.isAlive(id))).toBe(true);
      const far = sim.enemies.filter((e) => !pack.includes(e.id));
      expect(far).toHaveLength(2 + DEV_KEG_PACK.length);
      for (const e of far) expect(sim.world.get(e.id)?.hp).toBe(sim.world.get(e.id)?.maxHp);
      expect(sim.fuses).toEqual([]);
    }
  });

  it('Firestorm ×2.5 on hut stand-ins (300 HP): meteorlets burn, bolts Combust, only Combusts charge', () => {
    for (const fps of FPS) {
      const sim = new M6Sim(1000 / fps, [P, P, S, S], 1, { 'goblin-grunt': 300 });
      const pack = packIds(sim);
      sim.meter.fill();
      sim.pressConvergence(sim.at(PACK));
      sim.run(CONVERGENCE.channelMs + 3000);
      const combusts = sim.reactions.filter((r) => r.value.reaction === 'combust');
      expect(combusts.length).toBeGreaterThan(0);
      expect(combusts.every((c) => c.value.sourceId === sim.convergenceReactionId)).toBe(true);
      expect(combusts.every((c) => pack.includes(c.value.origin))).toBe(true);
      // Combust hits are 3 fire each (0.3 charge) plus 4 per kill they land; strikes add nothing.
      const combustDealt = combusts
        .flatMap((c) => c.value.area.hits)
        .reduce((n, h) => n + h.dealt, 0);
      expect(sim.meter.value).toBeGreaterThanOrEqual(
        combustDealt * CONVERGENCE.chargePerDamage - 1e-9,
      );
      expect(sim.meter.value).toBeGreaterThan(0);
      expect(sim.wizardHits).toEqual([]);
    }
  });

  it('GDD §10 verify: no unit leaves the barrage ring because of a strike (Firestorm, Thunderstorm)', () => {
    for (const classes of [
      [P, P, S, S],
      [S, S],
    ] as const) {
      const sim = new M6Sim(1000 / 60, classes, 1, { 'goblin-grunt': 300 });
      const ring = CONVERGENCES[classes.length === 4 ? 'firestorm' : 'thunderstorm'].radiusPx;
      const centre = sim.at(PACK);
      const inside = sim.enemies
        .filter((e) => distance(e.position, centre) <= ring)
        .map((e) => e.id);
      expect(inside.length).toBeGreaterThan(0);
      sim.meter.fill();
      sim.pressConvergence(centre);
      sim.run(CONVERGENCE.channelMs + 3000);
      expect(sim.strikeBlasts.every((b) => b.value.event.blast.knockbackPx === 0)).toBe(true);
      for (const e of sim.enemies.filter((x) => inside.includes(x.id))) {
        expect(distance(e.position, centre)).toBeLessThanOrEqual(ring);
      }
    }
  });

  it('Meteor on hut stand-ins: its Burning and burning ground tick damage, the meter stays 0', () => {
    for (const fps of FPS) {
      const sim = new M6Sim(1000 / fps, [P, P], 1, { 'goblin-grunt': 300 });
      sim.meter.fill();
      sim.pressConvergence(sim.at(PACK));
      sim.run(CONVERGENCE.channelMs + 6000);
      const dealt = sim.ticks.reduce((n, x) => n + x.value.dealt, 0);
      expect(dealt).toBeGreaterThan(0);
      expect(sim.ticks.every((x) => x.value.source === sim.convergenceId)).toBe(true);
      expect(sim.reactions).toEqual([]);
      expect(sim.meter.value).toBe(0);
      expect(sim.charged).toEqual([]);
    }
  });

  it('Firestorm on hut stand-ins: Burning spread by its Combusts ticks with the reaction id and charges', () => {
    const sim = new M6Sim(1000 / 60, [P, P, S, S], 1, { 'goblin-grunt': 300 });
    sim.meter.fill();
    sim.pressConvergence(sim.at(PACK));
    sim.run(CONVERGENCE.channelMs + 6000);
    const reactionTicks = sim.ticks.filter((x) => x.value.source === sim.convergenceReactionId);
    expect(reactionTicks.length).toBeGreaterThan(0);
    const combustDealt = sim.reactions
      .filter((r) => r.value.reaction === 'combust')
      .flatMap((r) => r.value.area.hits)
      .reduce((n, h) => n + h.dealt, 0);
    const reactionTickDealt = reactionTicks.reduce((n, x) => n + x.value.dealt, 0);
    // Strike ticks add nothing; Combust hits and their Burning's ticks do (kills add more).
    expect(sim.meter.value).toBeGreaterThanOrEqual(
      (combustDealt + reactionTickDealt) * CONVERGENCE.chargePerDamage - 1e-9,
    );
  });

  it('GDD §10 benchmark: a lone target takes all 14 Firestorm strikes at ×2.5 (≥ 832)', () => {
    const sim = new M6Sim(1000 / 60, [P, P, S, S], 1, { 'goblin-grunt': 2000 });
    const lone = sim.enemyAt({ x: 0, y: -210 });
    const others = sim.enemies.filter((e) => e.id !== lone.id).map((e) => e.id);
    for (const id of others) sim.world.markDead(id);
    sim.meter.fill();
    sim.pressConvergence(lone.position);
    sim.run(CONVERGENCE.channelMs + 3000);
    expect(sim.strikeBlasts).toHaveLength(14);
    expect(
      sim.strikeBlasts.every((b) => distance(b.value.event.centre, lone.position) < 1e-9),
    ).toBe(true);
    const strikeDamage = 6 * Math.round(35 * 2.5) + 8 * Math.round(15 * 2.5);
    const taken = 2000 - (sim.world.get(lone.id)?.hp ?? 0);
    // 2000 HP so it survives to count. 832 from the strikes, plus its own Combusts and Burning
    // ticks: a 300 HP hut dies well inside the barrage (the GDD's "about 820" floors the halves).
    expect(taken).toBeGreaterThanOrEqual(strikeDamage);
  });

  it('the same combo and power at 30/60/144 fps', () => {
    for (const [, classes, combo, power] of COMPOSITIONS) {
      for (const fps of FPS) {
        const { sim } = convergeOnPack(classes, fps);
        expect(sim.released.map((r) => r.value)).toMatchObject([{ combo, power }]);
        expect(sim.wizardHits).toEqual([]);
      }
    }
  });

  it('the squad holds still during the channel, then walks again', () => {
    const sim = new M6Sim(1000 / 60, [P, S, P, S]);
    sim.meter.fill();
    sim.pressConvergence(sim.at(PACK));
    sim.frame();
    const before = sim.squad.members.map((m) => m.position);
    const target: Vec2 = sim.at({ x: 200, y: 0 });
    sim.run(CONVERGENCE.channelMs - 100, { moveTo: target });
    expect(sim.squad.members.map((m) => m.position)).toEqual(before);
    sim.run(500, { moveTo: target });
    expect(sim.leader?.position.x).toBeGreaterThan(before[0]?.x ?? 0);
  });

  it('R without a full meter is denied; the meter is not spent', () => {
    const sim = new M6Sim(1000 / 60);
    sim.pressConvergence(sim.at(PACK));
    sim.frame();
    expect(sim.channelOutcomes.map((o) => o.value)).toEqual([
      { kind: 'denied', reason: 'not-full' },
    ]);
    expect(sim.meter.value).toBe(CONVERGENCE.meterStart);
  });
});

describe('M6 sim: deaths mid-channel (D1, D2)', () => {
  it('P,S,S with the P leader killed mid-channel → Thunderstorm ×1.5, retargeted, not cancelled', () => {
    for (const fps of FPS) {
      const sim = new M6Sim(1000 / fps, [P, S, S]);
      const [pyro, next] = sim.squad.members.map((m) => m.id);
      sim.meter.fill();
      sim.pressConvergence(sim.at(PACK));
      sim.run(600);
      if (pyro === undefined) throw new Error('no squad');
      sim.killWizards([pyro]);
      expect(sim.leader?.id).toBe(next);
      sim.run(CONVERGENCE.channelMs + 2500);
      expect(sim.cancelled).toEqual([]);
      expect(sim.released.map((r) => r.value)).toMatchObject([
        { combo: 'thunderstorm', power: 1.5 },
      ]);
      expect(sim.lost.map((l) => l.value)).toEqual(['fireball']);
    }
  });

  it('a wipe mid-channel cancels: nothing strikes', () => {
    const sim = new M6Sim(1000 / 60, [P, S]);
    sim.meter.fill();
    sim.pressConvergence(sim.at(PACK));
    sim.run(500);
    sim.killWizards(sim.squad.members.map((m) => m.id));
    sim.run(CONVERGENCE.channelMs + 2500);
    expect(sim.cancelled).toHaveLength(1);
    expect(sim.released).toEqual([]);
    expect(sim.strikeBlasts).toEqual([]);
  });

  it('F during the channel is denied', () => {
    const sim = new M6Sim(1000 / 60);
    sim.meter.fill();
    sim.pressConvergence(sim.at(PACK));
    sim.run(300);
    sim.pressVolunteer(sim.at(PACK));
    sim.frame();
    expect(sim.volunteerOutcomes.map((o) => o.value)).toEqual([
      { kind: 'denied', reason: 'channel' },
    ]);
    expect(sim.squad.members).toHaveLength(4);
  });
});

describe('M6 sim: Volunteer! into the keg chain (D3)', () => {
  it.each(FPS)('at %i fps: every keg blows, the keg pack dies, no wizard is hurt', (fps) => {
    const sim = new M6Sim(1000 / fps);
    // 120 px from the middle keg (DEV_KEGS: x −400): the trail runs back east, so the last
    // follower starts ~200 px from it, inside a fuse's sprint (270 px). Out of Kaboom reach.
    sim.walkTo(sim.at({ x: -280, y: 0 }));
    const hpBefore = wizardHp(sim);
    const ids = sim.squad.members.map((m) => m.id);
    const runner = ids[ids.length - 1];
    const keg = sim.kegAt({ x: -400, y: 0 });
    const pack = DEV_KEG_PACK.map((g) => sim.enemyAt(g.offset).id);

    sim.pressVolunteer(keg.position);
    sim.run(VOLUNTEER.fuseMs + 1500);

    expect(sim.volunteerOutcomes.map((o) => o.value)).toMatchObject([
      { kind: 'started', id: runner, at: keg.position },
    ]);
    expect(sim.detonations.map((d) => d.value)).toEqual([
      { id: runner, at: keg.position, reason: 'arrived' },
    ]);
    expect(sim.fuses.map((f) => f.value).sort((a, b) => a - b)).toEqual(
      sim.kegs.map((k) => k.id).filter((id) => id !== sim.kegAt({ x: 440, y: 0 }).id),
    );
    expect(sim.reactions.filter((r) => r.value.reaction === 'kaboom')).toHaveLength(3);
    expect(pack.every((id) => !sim.world.isAlive(id))).toBe(true);

    // The volunteer died as a volunteer; nobody else was touched.
    expect(sim.deaths.filter((d) => d.value.team === 'squad').map((d) => d.value)).toEqual([
      { id: runner, team: 'squad', cause: 'volunteer', deathVariant: 'blood', gibbed: false },
    ]);
    expect(sim.wizardHits).toEqual([]);
    expect(wizardHp(sim)).toEqual(hpBefore.slice(0, -1));

    // P,S,P,S: the last Stormcaller volunteered, Lightning stays (GDD §5).
    expect(sim.lost).toEqual([]);
    // Detonation and Kabooms charge the meter (GDD §11, M6 Q3).
    expect(sim.meter.value).toBeGreaterThan(CONVERGENCE.meterStart);
  });

  it('P,P,S,S volunteering twice loses Lightning on the second activation', () => {
    const sim = new M6Sim(1000 / 60, [P, P, S, S]);
    sim.pressVolunteer(sim.at({ x: 0, y: -100 }));
    sim.run(VOLUNTEER.cooldownMs + 100);
    expect(sim.lost).toEqual([]);
    sim.pressVolunteer(sim.at({ x: 0, y: -100 }));
    sim.frame();
    expect(sim.lost.map((l) => l.value)).toEqual(['lightning']);
    expect(sim.slots.find((s) => s.spell === 'lightning')?.available).toBe(false);
    // The second volunteer is still a living unit until it goes off.
    const second = sim.volunteerOutcomes[1]?.value;
    if (second?.kind !== 'started') throw new Error('second volunteer did not start');
    expect(sim.world.isAlive(second.id)).toBe(true);
  });

  it('F with only the leader left is denied, and on cooldown too', () => {
    const solo = new M6Sim(1000 / 60, [P]);
    solo.pressVolunteer(solo.at(PACK));
    solo.frame();
    expect(solo.volunteerOutcomes[0]?.value).toEqual({ kind: 'denied', reason: 'alone' });

    const sim = new M6Sim(1000 / 60);
    sim.pressVolunteer(sim.at({ x: 0, y: -50 }));
    sim.run(1000);
    sim.pressVolunteer(sim.at({ x: 0, y: -50 }));
    sim.frame();
    expect(sim.volunteerOutcomes.map((o) => o.value.kind)).toEqual(['started', 'denied']);
  });

  it.each(FPS)(
    'at %i fps: a goblin killing the runner mid-sprint: one volunteer death, same-frame blast',
    (fps) => {
      const sim = new M6Sim(1000 / fps);
      sim.pressVolunteer(sim.at({ x: 0, y: -150 }));
      sim.run(400);
      const runner = sim.volunteer.runners[0];
      if (!runner) throw new Error('no runner');
      const grunt = sim.enemyAt({ x: 0, y: -178 });
      sim.world.setHp(runner.id, 1);
      sim.enemyHit(grunt.id, runner.id);
      expect(sim.detonations.map((d) => d.value)).toEqual([
        { id: runner.id, at: runner.position, reason: 'death' },
      ]);
      const deaths = sim.deaths.filter((d) => d.value.id === runner.id);
      expect(deaths.map((d) => [d.t, d.value.cause])).toEqual([
        [sim.detonations[0]?.t, 'volunteer'],
      ]);
      sim.run(500);
      expect(sim.detonations).toHaveLength(1);
    },
  );
});

describe('M6 sim: meter time-to-full in the no-input fight (GDD §16 request 3)', () => {
  it('logs when the meter fills from meterStart in the M4 dev fight', () => {
    const rows: string[] = [];
    for (const fps of FPS) {
      for (const seed of [1, 2, 3]) {
        const meter = new ConvergenceMeter(CONVERGENCE, 100_000 as EntityId);
        const r = runEncounter({ dtMs: 1000 / fps, seed, jitterPx: 6, maxMs: 30_000, meter });
        expect(r.violations).toEqual([]);
        rows.push(
          `${String(fps)} fps seed ${String(seed)}: cleared ${String(r.clearedAtMs?.toFixed(0))} ms, ` +
            `meter ${meter.value.toFixed(1)}/${String(CONVERGENCE.meterMax)}, ` +
            `full at ${r.meterFullAtMs === null ? 'never' : `${r.meterFullAtMs.toFixed(0)} ms`}`,
        );
        // Exactly every grunt's kill and HP (overkill excluded, wizard damage ignored): the fight
        // ends when the grunts are dead, archers untouched.
        const grunt = ENEMIES['goblin-grunt'];
        const grunts = DEV_ENCOUNTER.filter((e) => e.enemy === 'goblin-grunt').length;
        const earned =
          CONVERGENCE.meterStart +
          grunts * (CONVERGENCE.chargePerKill + grunt.maxHp * CONVERGENCE.chargePerDamage);
        expect(meter.value).toBeCloseTo(Math.min(CONVERGENCE.meterMax, earned), 9);
        // GDD §9: the first fight fills it (meterStart 65 → 103.4 earned, clamped).
        if (earned >= CONVERGENCE.meterMax) expect(r.meterFullAtMs).not.toBeNull();
        else expect(r.meterFullAtMs).toBeNull();
      }
    }
    console.info(`[M6 T8] meter time-to-full, DEV_ENCOUNTER no-input:\n${rows.join('\n')}`);
  });
});

// Keep the class table honest for the sims: every MVP class feeds one element.
it('every class has an element the Convergence data knows', () => {
  const known = new Set(Object.values(CONVERGENCES).flatMap((c) => c.requires));
  for (const def of Object.values(CLASSES)) expect(known.has(def.element)).toBe(true);
});
