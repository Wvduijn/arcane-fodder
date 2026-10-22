import { describe, expect, it } from 'vitest';
import type { EntityId, Vec2, WizardRecord } from '@core/types';
import { killUnit, type DeathRecord } from '@core/combat/death';
import { CombatWorld } from '@core/combat/world';
import {
  beginPlay,
  bestTimeOf,
  buildResult,
  createMission,
  endMission,
  isDefeat,
  markDebugAssisted,
  recordDeath,
  saveBestTime,
  tickMission,
  withBestTime,
  type MissionState,
} from '@core/mission/mission';
import type { TriggerZone } from '@core/mission/mapData';
import { createTriggers, scatterPositions, stepTriggers } from '@core/mission/spawns';
import { createRng } from '@core/rng/rng';
import { defaultSave } from '@core/save/save';
import { hutUnitSpec } from '@core/structures/hut';
import { CollisionGrid } from '@core/world/collisionGrid';
import { HUT } from '@data/structures';

const id = (n: number) => n as EntityId;
const v = (x: number, y: number): Vec2 => ({ x, y });
const GRIM: WizardRecord = { name: 'Grimbald the Damp', classId: 'stormcaller' };
const LAZ: WizardRecord = { name: 'Lazarus the Late', classId: 'pyromancer' };
const enemyDeath: DeathRecord = {
  id: id(10),
  team: 'enemy',
  cause: 'combat',
  deathVariant: 'charred',
  gibbed: false,
};

const playing = (): MissionState => beginPlay(createMission('m01-goblin-woods'));

describe('mission timer (GDD §14: pause excluded)', () => {
  it('counts nothing during the intro, then only unpaused playing time', () => {
    let s = createMission('m01-goblin-woods');
    s = tickMission(s, 3000, false);
    expect(s.timeMs).toBe(0);
    s = beginPlay(s);
    expect(s.phase).toBe('playing');
    for (let i = 0; i < 60; i++) s = tickMission(s, 1000 / 60, false);
    for (let i = 0; i < 600; i++) s = tickMission(s, 1000 / 60, true);
    for (let i = 0; i < 60; i++) s = tickMission(s, 1000 / 60, false);
    expect(s.timeMs).toBeCloseTo(2000, 6);
    s = endMission(s, 'victory');
    expect(tickMission(s, 5000, false).timeMs).toBeCloseTo(2000, 6);
  });

  it('beginPlay only leaves the intro', () => {
    const ended = endMission(playing(), 'defeat');
    expect(beginPlay(ended)).toBe(ended);
  });
});

describe('kills: enemy units only', () => {
  it('counts every enemy unit death, never a hut, a wizard or a neutral', () => {
    let s = playing();
    s = recordDeath(s, enemyDeath, null);
    const kaboomKill: DeathRecord = { ...enemyDeath, id: id(11), deathVariant: 'blood' };
    s = recordDeath(s, kaboomKill, null);
    const world = new CombatWorld();
    world.add(hutUnitSpec(id(50), HUT));
    const hut = killUnit(world, id(50), 'combat');
    if (!hut) throw new Error('no hut death');
    s = recordDeath(s, hut, null);
    s = recordDeath(s, { ...enemyDeath, team: 'neutral' }, null);
    s = recordDeath(s, { ...enemyDeath, team: 'squad' }, GRIM);
    expect(s.kills).toBe(2);
  });

  it('records lost wizards in order of loss, with their cause', () => {
    let s = playing();
    s = recordDeath(s, { ...enemyDeath, team: 'squad', cause: 'volunteer' }, GRIM);
    s = recordDeath(s, { ...enemyDeath, team: 'squad', cause: 'combat' }, LAZ);
    expect(s.lost).toEqual([
      { ...GRIM, cause: 'volunteer' },
      { ...LAZ, cause: 'combat' },
    ]);
  });

  it('nothing counts after the end', () => {
    const s = endMission(playing(), 'victory');
    expect(recordDeath(s, enemyDeath, null)).toBe(s);
  });
});

describe('defeat rule (GDD §14, M6 carry-over)', () => {
  it('only with 0 squad AND no volunteer mid-sprint', () => {
    expect(isDefeat(0, 0)).toBe(true);
    expect(isDefeat(0, 1)).toBe(false);
    expect(isDefeat(1, 0)).toBe(false);
  });

  it('the first end wins (no defeat after a victory on the same frame)', () => {
    const won = endMission(playing(), 'victory');
    expect(endMission(won, 'defeat')).toBe(won);
    expect(won.outcome).toBe('victory');
  });
});

describe('results and best time', () => {
  it('victory: saved, lost in order then left behind, kills, targets, a first best time', () => {
    let s = playing();
    s = tickMission(s, 312_000, false);
    s = recordDeath(s, enemyDeath, null);
    s = recordDeath(s, { ...enemyDeath, team: 'squad', cause: 'combat' }, LAZ);
    s = endMission(s, 'victory');
    const result = buildResult(s, {
      saved: [GRIM],
      leftBehind: [{ name: 'Hob the Hatless', classId: 'pyromancer' }],
      targetsDestroyed: 2,
      targetsRequired: 2,
      previousBestMs: null,
    });
    expect(result).toEqual({
      missionId: 'm01-goblin-woods',
      outcome: 'victory',
      timeMs: 312_000,
      kills: 1,
      targetsDestroyed: 2,
      targetsRequired: 2,
      saved: [GRIM],
      lost: [
        { ...LAZ, cause: 'combat' },
        { name: 'Hob the Hatless', classId: 'pyromancer', cause: 'left-behind' },
      ],
      bestTimeMs: 312_000,
      newBest: true,
    });
  });

  it('defeat keeps the previous best and is never a new best', () => {
    const s = endMission(tickMission(playing(), 1000, false), 'defeat');
    const result = buildResult(s, {
      saved: [],
      leftBehind: [],
      targetsDestroyed: 1,
      targetsRequired: 2,
      previousBestMs: 400_000,
    });
    expect(result).toMatchObject({ outcome: 'defeat', bestTimeMs: 400_000, newBest: false });
  });

  it('a best time only improves', () => {
    expect(bestTimeOf(300, 'victory', 299)).toEqual({ bestTimeMs: 299, newBest: true });
    expect(bestTimeOf(300, 'victory', 300)).toEqual({ bestTimeMs: 300, newBest: false });
    expect(bestTimeOf(null, 'defeat', 1)).toEqual({ bestTimeMs: null, newBest: false });
    let save = withBestTime(defaultSave(), 'm01-goblin-woods', 500);
    expect(save.bestTimes['m01-goblin-woods']).toBe(500);
    const same = withBestTime(save, 'm01-goblin-woods', 600);
    expect(same).toBe(save);
    save = withBestTime(save, 'm01-goblin-woods', 450);
    expect(save.bestTimes['m01-goblin-woods']).toBe(450);
  });

  it('a debug-assisted run never claims or writes a best time (review M7-gate n2b)', () => {
    const input = {
      saved: [GRIM],
      leftBehind: [],
      targetsDestroyed: 2,
      targetsRequired: 2,
    };
    const fast = tickMission(playing(), 100_000, false);
    // Marked before the end; sticky (marking again is a no-op).
    const assisted = endMission(markDebugAssisted(markDebugAssisted(fast)), 'victory');
    expect(assisted.debugAssisted).toBe(true);
    expect(buildResult(assisted, { ...input, previousBestMs: 300_000 })).toMatchObject({
      timeMs: 100_000,
      bestTimeMs: 300_000,
      newBest: false,
    });
    expect(buildResult(assisted, { ...input, previousBestMs: null })).toMatchObject({
      bestTimeMs: null,
      newBest: false,
    });
    const save = withBestTime(defaultSave(), 'm01-goblin-woods', 300_000);
    expect(saveBestTime(save, assisted)).toBe(save);
    // Marked after the end (a debug key on the results delay) still counts.
    const late = markDebugAssisted(endMission(fast, 'victory'));
    expect(saveBestTime(save, late)).toBe(save);
    // The same run unassisted writes and claims it.
    const clean = endMission(fast, 'victory');
    expect(clean.debugAssisted).toBe(false);
    expect(saveBestTime(save, clean).bestTimes['m01-goblin-woods']).toBe(100_000);
    expect(buildResult(clean, { ...input, previousBestMs: 300_000 }).newBest).toBe(true);
  });

  it('markDebugAssisted is idempotent, pure and sticky to the end', () => {
    const s = playing();
    const marked = markDebugAssisted(s);
    expect(s.debugAssisted).toBe(false);
    expect(marked.debugAssisted).toBe(true);
    expect(markDebugAssisted(marked)).toBe(marked);
    let after = tickMission(marked, 1000, false);
    after = recordDeath(after, enemyDeath, null);
    after = recordDeath(after, { ...enemyDeath, team: 'squad' }, GRIM);
    after = endMission(after, 'victory');
    expect(after.debugAssisted).toBe(true);
    expect(markDebugAssisted(after)).toBe(after);
  });

  it('saveBestTime writes only an ended, non-assisted victory', () => {
    const save = defaultSave();
    const run = tickMission(playing(), 5000, false);
    expect(saveBestTime(save, createMission('m01-goblin-woods'))).toBe(save);
    expect(saveBestTime(save, run)).toBe(save);
    expect(saveBestTime(save, endMission(run, 'defeat'))).toBe(save);
    expect(saveBestTime(save, endMission(markDebugAssisted(run), 'defeat'))).toBe(save);
    expect(saveBestTime(save, endMission(markDebugAssisted(run), 'victory'))).toBe(save);
    const won = saveBestTime(save, endMission(run, 'victory'));
    expect(won.bestTimes['m01-goblin-woods']).toBe(5000);
    // A slower clean victory keeps the stored best (same save).
    const slower = endMission(tickMission(playing(), 9000, false), 'victory');
    expect(saveBestTime(won, slower)).toBe(won);
  });

  it('buildResult: a debug-assisted defeat keeps the previous best too', () => {
    const s = endMission(markDebugAssisted(tickMission(playing(), 1000, false)), 'defeat');
    const result = buildResult(s, {
      saved: [],
      leftBehind: [],
      targetsDestroyed: 0,
      targetsRequired: 2,
      previousBestMs: 400_000,
    });
    expect(result).toMatchObject({ outcome: 'defeat', bestTimeMs: 400_000, newBest: false });
  });

  it('buildResult refuses a mission that has not ended', () => {
    expect(() =>
      buildResult(playing(), {
        saved: [],
        leftBehind: [],
        targetsDestroyed: 0,
        targetsRequired: 2,
        previousBestMs: null,
      }),
    ).toThrow(RangeError);
  });
});

describe('triggers and spawn scatter', () => {
  const zone = (name: string, once: boolean): TriggerZone => ({
    name,
    rect: { x: 100, y: 100, width: 50, height: 50 },
    once,
    event: { kind: 'activate-group', group: 'g' },
  });

  it('a once trigger fires on the first entry only; a repeating one on every entry', () => {
    let s = createTriggers([zone('once', true), zone('again', false)]);
    const names = (leader: Vec2 | null) => {
      const step = stepTriggers(s, leader);
      s = step.state;
      return step.fired.map((z) => z.name);
    };
    expect(names(v(0, 0))).toEqual([]);
    expect(names(v(100, 100))).toEqual(['once', 'again']);
    expect(names(v(120, 120))).toEqual([]);
    expect(names(v(0, 0))).toEqual([]);
    expect(names(null)).toEqual([]);
    expect(names(v(150, 150))).toEqual(['again']);
  });

  it('scatters deterministically inside the radius, off solids', () => {
    const a = scatterPositions(v(200, 200), 5, 40, createRng(7), { bodyRadiusPx: 12 });
    const b = scatterPositions(v(200, 200), 5, 40, createRng(7), { bodyRadiusPx: 12 });
    expect(a).toEqual(b);
    for (const p of a) expect(Math.hypot(p.x - 200, p.y - 200)).toBeLessThanOrEqual(40);
    const grid = CollisionGrid.open(30, 30, 16);
    grid.addSolid({
      id: id(1),
      rect: { x: 160, y: 160, width: 80, height: 80 },
      blocksShots: false,
    });
    const placed = scatterPositions(v(200, 200), 8, 30, createRng(3), { grid, bodyRadiusPx: 12 });
    for (const p of placed) expect(grid.overlapsSolid(p, 12)).toBe(false);
  });

  it('never drops a body onto a keg at the spawn point (review M7-T4-T5)', () => {
    const grid = CollisionGrid.open(30, 30, 16);
    // A 16 px keg solid centred on the spawn point, the m01 grunts-ambush / keg-09 case.
    grid.addSolid({
      id: id(9),
      rect: { x: 192, y: 192, width: 16, height: 16 },
      blocksShots: false,
    });
    for (let seed = 1; seed <= 20; seed++) {
      const placed = scatterPositions(v(200, 200), 6, 48, createRng(seed), {
        grid,
        bodyRadiusPx: 12,
      });
      expect(placed).toHaveLength(6);
      for (const p of placed) expect(grid.overlapsSolid(p, 12)).toBe(false);
    }
    // Radius 0: every body would land on the keg; all move to free tiles next to it.
    const stacked = scatterPositions(v(200, 200), 3, 0, createRng(1), { grid, bodyRadiusPx: 12 });
    for (const p of stacked) {
      expect(grid.overlapsSolid(p, 12)).toBe(false);
      expect(Math.hypot(p.x - 200, p.y - 200)).toBeLessThan(48);
    }
  });
});
