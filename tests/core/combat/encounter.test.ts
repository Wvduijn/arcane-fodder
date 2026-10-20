/**
 * M4 D2/D4: the P,S,P,S dev squad beats the dev encounter's grunt pack with zero input, at 30, 60
 * and 144 fps and over 3 seeds, with no dead unit ever moving, acting, ticking or being hit.
 * The no-input win runs with reactions on (approved Combust retune: grunts still land swings). The
 * succession and 1-HP cases keep the M4 rules (`reactions: false`): they test succession, not feel.
 * M5 D4: the same no-input fight with reactions shows at least one Combust in every run, lights no
 * keg, and leaves DEV_KEG_PACK idle; succession under reactions uses grunts spawned near contact.
 */
import { describe, expect, it } from 'vitest';
import { D2_GROUP, runEncounter } from './encounterSim';
import type { DevEncounterSpawn } from '@core/types';
import { DEV_ENCOUNTER, DEV_KEG_PACK, DEV_SQUAD } from '@data/devArena';
import { ENEMIES } from '@data/enemies';

const FPS = [30, 60, 144] as const;
const SEEDS = [1, 2, 3] as const;
/** D2: the fight must be over within this. */
const MAX_MS = 30_000;
/** Spawn offset jitter per seed, small enough to keep the pack inside grunt aggro of the leader. */
const JITTER_PX = 6;

const cases = FPS.flatMap((fps) => SEEDS.map((seed) => [fps, seed] as const));

describe('M4 D2: no-input win against the dev encounter', () => {
  it.each(cases)(
    'at %i fps, seed %i: every grunt dies, ≥ 1 wizard survives, D4 holds',
    (fps, seed) => {
      // Reactions on (M5): with the approved Combust retune the grunts still reach the squad.
      const r = runEncounter({ dtMs: 1000 / fps, seed, jitterPx: JITTER_PX, maxMs: MAX_MS });

      expect(r.violations).toEqual([]);
      expect(r.clearedAtMs).not.toBeNull();
      expect(r.clearedAtMs ?? Infinity).toBeLessThan(MAX_MS);
      expect(r.wizardsAlive).toBeGreaterThanOrEqual(1);

      const groupSize = DEV_ENCOUNTER.filter((s) => D2_GROUP.includes(s.enemy)).length;
      const groupKills = r.kills.filter((k) => k.team === 'enemy');
      expect(groupKills).toHaveLength(groupSize);
      // Autos never gib; every kill shows its killing element (fire bolt / Burning or spark).
      for (const k of groupKills) {
        expect(k.gibbed).toBe(false);
        expect(['charred', 'electrified']).toContain(k.deathVariant);
      }
      // Wizard deaths stay plain.
      for (const k of r.kills.filter((d) => d.team === 'squad')) {
        expect(k).toMatchObject({ deathVariant: 'blood', gibbed: false });
      }

      // Burning was seen on targets and ticked.
      expect(r.burningApplied).toBeGreaterThan(0);
      expect(r.burningTicks).toBeGreaterThan(0);
      expect(r.meleeSwings).toBeGreaterThan(0);

      // The archers are placed out of aggro for the manual push check (M4 Q1): untouched, idle.
      expect(r.enemiesAlive.map((e) => [e.enemy, e.state])).toEqual(
        DEV_ENCOUNTER.filter((s) => !D2_GROUP.includes(s.enemy)).map((s) => [s.enemy, 'idle']),
      );
      expect(r.wizardsLost + r.wizardsAlive).toBe(DEV_SQUAD.classes.length);
    },
  );

  it.each(cases)(
    'at %i fps, seed %i: a leader killed by goblins goes through succession (D5), D4 holds',
    (fps, seed) => {
      // Leader at 6 HP: the first landed grunt swing kills it.
      const r = runEncounter({
        dtMs: 1000 / fps,
        seed,
        jitterPx: JITTER_PX,
        maxMs: MAX_MS,
        reactions: false,
        wizardMaxHp: [ENEMIES['goblin-grunt'].attack.damage],
      });
      expect(r.violations).toEqual([]);
      const wizardDeaths = r.kills.filter((k) => k.team === 'squad');
      expect(wizardDeaths[0]).toEqual({
        id: 1,
        team: 'squad',
        cause: 'combat',
        deathVariant: 'blood',
        gibbed: false,
      });
      expect(r.leaderChanges).toBeGreaterThanOrEqual(1);
      expect(r.clearedAtMs).not.toBeNull();
      expect(r.wizardsAlive).toBeGreaterThanOrEqual(1);
    },
  );

  it.each(FPS)(
    'at %i fps: a squad of 1-HP wizards dies one by one, D4 and succession hold',
    (fps) => {
      const r = runEncounter({
        dtMs: 1000 / fps,
        seed: 1,
        jitterPx: JITTER_PX,
        maxMs: MAX_MS,
        reactions: false,
        wizardMaxHp: [1, 1, 1, 1],
      });
      expect(r.violations).toEqual([]);
      expect(r.wizardsLost).toBeGreaterThanOrEqual(2);
      // The sim flags any leader death with survivors that did not promote the right wizard.
      expect(r.leaderChanges).toBeGreaterThanOrEqual(1);
      for (const k of r.kills.filter((d) => d.team === 'squad')) {
        expect(k).toMatchObject({ deathVariant: 'blood', gibbed: false });
      }
    },
  );

  it('is deterministic: the same seed and frame rate give the same fight', () => {
    const a = runEncounter({
      dtMs: 1000 / 60,
      seed: 7,
      jitterPx: JITTER_PX,
      maxMs: MAX_MS,
      reactions: false,
    });
    const b = runEncounter({
      dtMs: 1000 / 60,
      seed: 7,
      jitterPx: JITTER_PX,
      maxMs: MAX_MS,
      reactions: false,
    });
    expect(b).toEqual(a);
  });
});

/** GDD §3 "No-input targets" with reactions on: pack clear time in s, squad Combusts per s. */
const CLEAR_S = { min: 2.3, max: 5.0 } as const;
const COMBUSTS_PER_S = { min: 1.0, max: 3.0 } as const;

/** Succession fixture for M5: the six grunts of DEV_ENCOUNTER's grid, front row 40 px from the leader. */
const NEAR_CONTACT: readonly DevEncounterSpawn[] = [-32, 0, 32].flatMap((x) =>
  [-40, -72].map((y) => ({ enemy: 'goblin-grunt' as const, offset: { x, y } })),
);

/**
 * Chained-succession fixture for M5: NEAR_CONTACT plus one grunt on each side of the leader, so
 * goblins kill several leaders in a row while Combust blasts and their deaths share the frame flush.
 */
const NEAR_CONTACT_FLANKED: readonly DevEncounterSpawn[] = [
  ...NEAR_CONTACT,
  { enemy: 'goblin-grunt', offset: { x: -40, y: 0 } },
  { enemy: 'goblin-grunt', offset: { x: 40, y: 0 } },
];

describe('M5 D4: the no-input fight with reactions', () => {
  it.each(cases)(
    'at %i fps, seed %i: ≥ 1 Combust, the grunts die, no keg is lit, the keg pack stays idle',
    (fps, seed) => {
      const r = runEncounter({
        dtMs: 1000 / fps,
        seed,
        jitterPx: JITTER_PX,
        maxMs: MAX_MS,
        bystanders: DEV_KEG_PACK,
      });
      expect(r.violations).toEqual([]);
      expect(r.combusts).toBeGreaterThanOrEqual(1);
      expect(r.clearedAtMs).not.toBeNull();
      expect(r.wizardsAlive).toBeGreaterThanOrEqual(1);
      // GDD §3 "No-input targets" (§16 request 12, review M5-T6 M1), CD-approved Combust retune:
      // the grunts land a swing before the pack is gone, the fight lasts 2.3–5 s, and Combust pops
      // 1–3 times a second for the squad (0.5–1.5 per P+S pair).
      const clearS = (r.clearedAtMs ?? Infinity) / 1000;
      expect(r.swingsLanded).toBeGreaterThanOrEqual(1);
      expect(r.firstLandedSwingMs ?? Infinity).toBeLessThan(r.clearedAtMs ?? -Infinity);
      expect(clearS).toBeGreaterThanOrEqual(CLEAR_S.min);
      expect(clearS).toBeLessThanOrEqual(CLEAR_S.max);
      const combustsPerS = r.combusts / clearS;
      expect(combustsPerS).toBeGreaterThanOrEqual(COMBUSTS_PER_S.min);
      expect(combustsPerS).toBeLessThanOrEqual(COMBUSTS_PER_S.max);
      // Autos, arrows and melee never light a keg (GDD Q12); nothing else fires here.
      expect(r.kegsLit).toBe(0);
      // Combust kills are charred, spark kills electrified; nothing gibs.
      for (const k of r.kills.filter((d) => d.team === 'enemy')) {
        expect(k.gibbed).toBe(false);
        expect(['charred', 'electrified']).toContain(k.deathVariant);
      }
      // The archers and DEV_KEG_PACK are out of every aggro: alive and idle.
      const idle = [...DEV_ENCOUNTER.filter((s) => !D2_GROUP.includes(s.enemy)), ...DEV_KEG_PACK];
      expect(r.enemiesAlive.map((e) => [e.enemy, e.state])).toEqual(
        idle.map((s) => [s.enemy, 'idle']),
      );
    },
  );

  it.each(cases)(
    'at %i fps, seed %i: grunts near contact kill the leader, succession and D4 hold',
    (fps, seed) => {
      const r = runEncounter({
        dtMs: 1000 / fps,
        seed,
        jitterPx: JITTER_PX,
        maxMs: MAX_MS,
        encounter: NEAR_CONTACT,
        wizardMaxHp: [ENEMIES['goblin-grunt'].attack.damage],
      });
      expect(r.violations).toEqual([]);
      expect(r.meleeSwings).toBeGreaterThan(0);
      expect(r.kills.find((k) => k.team === 'squad')).toEqual({
        id: 1,
        team: 'squad',
        cause: 'combat',
        deathVariant: 'blood',
        gibbed: false,
      });
      expect(r.leaderChanges).toBeGreaterThanOrEqual(1);
      expect(r.combusts).toBeGreaterThanOrEqual(1);
      expect(r.clearedAtMs).not.toBeNull();
      expect(r.wizardsAlive).toBeGreaterThanOrEqual(1);
    },
  );

  it.each(cases)(
    'at %i fps, seed %i: 1-HP wizards die one by one under reactions, succession and D4 hold',
    (fps, seed) => {
      const r = runEncounter({
        dtMs: 1000 / fps,
        seed,
        jitterPx: JITTER_PX,
        maxMs: MAX_MS,
        encounter: NEAR_CONTACT_FLANKED,
        wizardMaxHp: [1, 1, 1, 1],
      });
      // The sim flags a wrong successor or a leader death without a leader change.
      expect(r.violations).toEqual([]);
      expect(r.wizardsLost).toBeGreaterThanOrEqual(2);
      expect(r.leaderChanges).toBeGreaterThanOrEqual(2);
      expect(r.combusts).toBeGreaterThanOrEqual(1);
      for (const k of r.kills.filter((d) => d.team === 'squad')) {
        expect(k).toMatchObject({ deathVariant: 'blood', gibbed: false });
      }
    },
  );

  it('is deterministic with reactions', () => {
    const options = { dtMs: 1000 / 60, seed: 7, jitterPx: JITTER_PX, maxMs: MAX_MS };
    expect(runEncounter(options)).toEqual(runEncounter(options));
  });
});
