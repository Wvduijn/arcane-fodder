/**
 * M4 D2/D4: the P,S,P,S dev squad beats the dev encounter's grunt pack with zero input, at 30, 60
 * and 144 fps and over 3 seeds, with no dead unit ever moving, acting, ticking or being hit.
 */
import { describe, expect, it } from 'vitest';
import { D2_GROUP, runEncounter } from './encounterSim';
import { DEV_ENCOUNTER, DEV_SQUAD } from '@data/devArena';
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
    const a = runEncounter({ dtMs: 1000 / 60, seed: 7, jitterPx: JITTER_PX, maxMs: MAX_MS });
    const b = runEncounter({ dtMs: 1000 / 60, seed: 7, jitterPx: JITTER_PX, maxMs: MAX_MS });
    expect(b).toEqual(a);
  });
});
