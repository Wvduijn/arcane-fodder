import { describe, expect, it } from 'vitest';
import type { EntityId, Vec2 } from '@core/types';
import { createAutoAttack, stepAutoAttack } from '@core/combat/autoAttack';
import { applyHit } from '@core/combat/damage';
import { isStructureDeath, killUnit } from '@core/combat/death';
import { applyStatus, stepStatuses } from '@core/combat/status';
import { CombatWorld } from '@core/combat/world';
import {
  createHut,
  defaultDoor,
  hutFootprint,
  hutSpawnPoint,
  hutUnitSpec,
  recordHutSpawn,
  resolveHutDef,
  stepHut,
  type HutState,
  type HutStep,
} from '@core/structures/hut';
import { CollisionGrid } from '@core/world/collisionGrid';
import { CLASSES } from '@data/classes';
import { COMBAT, GIBS } from '@data/combat';
import { ENEMIES } from '@data/enemies';
import { STATUSES } from '@data/statuses';
import { HUT } from '@data/structures';

const v = (x: number, y: number): Vec2 => ({ x, y });
const id = (n: number) => n as EntityId;
const HUT_ID = id(100);
const AT = v(500, 500);
const FPS = [30, 60, 144] as const;
const GRUNT_R = ENEMIES['goblin-grunt'].bodyRadiusPx;
const NEAR = v(500, 500 + HUT.activateRadiusPx);
const FAR = v(500, 500 + HUT.activateRadiusPx + 1);

interface Timeline {
  readonly activatedAt: number[];
  readonly tellsAt: number[];
  readonly spawnsAt: number[];
  readonly hut: HutState;
}

/**
 * Runs a hut for `ms` at `fps`, the leader from `leaderAt(t)`. Every spawn gets a fresh id; it dies
 * when `diesAt(spawnIndex, t)` says so.
 */
function run(
  ms: number,
  fps: number,
  leaderAt: (t: number) => Vec2 | null = () => NEAR,
  diesAt: (index: number, t: number) => boolean = () => false,
  hutAlive: (t: number) => boolean = () => true,
  start: HutState = createHut(HUT_ID, AT, HUT, defaultDoor(AT, HUT, GRUNT_R)),
): Timeline {
  const dt = 1000 / fps;
  let hut = start;
  const activatedAt: number[] = [];
  const tellsAt: number[] = [];
  const spawnsAt: number[] = [];
  const spawnedIds: EntityId[] = [];
  let nextId = 1000;
  for (let t = dt; t <= ms + 1e-9; t += dt) {
    const step: HutStep = stepHut(hut, {
      leader: leaderAt(t),
      dtMs: dt,
      isAlive: (x) => {
        if (x === HUT_ID) return hutAlive(t);
        const i = spawnedIds.indexOf(x);
        return i >= 0 && !diesAt(i, t);
      },
    });
    hut = step.hut;
    if (step.activated) activatedAt.push(t);
    if (step.tellStarted) tellsAt.push(t);
    if (step.spawn) {
      spawnsAt.push(t);
      const enemy = id(nextId++);
      spawnedIds.push(enemy);
      hut = recordHutSpawn(hut, enemy);
    }
  }
  return { activatedAt, tellsAt, spawnsAt, hut };
}

describe('hut spawner timeline (GDD §12)', () => {
  it('stays inactive while the leader is beyond the activation radius', () => {
    const t = run(20_000, 60, () => FAR);
    expect(t.activatedAt).toEqual([]);
    expect(t.spawnsAt).toEqual([]);
    expect(t.hut.phase).toBe('inactive');
  });

  it.each(FPS)('activates at ≤ 400 px; first grunt at 1.5 s, then every 6 s (%i fps)', (fps) => {
    const dt = 1000 / fps;
    const t = run(20_000, fps);
    expect(t.activatedAt).toHaveLength(1);
    const on = t.activatedAt[0] ?? 0;
    expect(on).toBeCloseTo(dt, 6);
    const expected = [1500, 7500, 13500, 19500];
    expect(t.spawnsAt).toHaveLength(expected.length);
    t.spawnsAt.forEach((at, i) => {
      expect(at - on).toBeGreaterThanOrEqual((expected[i] ?? 0) - 1e-6);
      expect(at - on).toBeLessThan((expected[i] ?? 0) + dt + 1e-6);
    });
  });

  it.each(FPS)('the door glows 500 ms before each spawn (%i fps)', (fps) => {
    const dt = 1000 / fps;
    const t = run(20_000, fps);
    expect(t.tellsAt).toHaveLength(t.spawnsAt.length);
    t.spawnsAt.forEach((spawn, i) => {
      const lead = spawn - (t.tellsAt[i] ?? 0);
      expect(lead).toBeGreaterThan(HUT.spawnTellMs - dt - 1e-6);
      expect(lead).toBeLessThanOrEqual(HUT.spawnTellMs + dt + 1e-6);
    });
  });

  it('never has more than maxAlive (4) of its spawns alive; a death frees a slot after a full tell', () => {
    // Nobody dies for 60 s: exactly 4 spawns.
    expect(run(60_000, 60).spawnsAt).toHaveLength(HUT.maxAlive);
    // The first spawn dies at 30 s: one more spawn, a tell (500 ms) after.
    const t = run(
      60_000,
      60,
      () => NEAR,
      (i, time) => i === 0 && time >= 30_000,
    );
    expect(t.spawnsAt).toHaveLength(HUT.maxAlive + 1);
    const last = t.spawnsAt.at(-1) ?? 0;
    expect(last - 30_000).toBeGreaterThanOrEqual(HUT.spawnTellMs - 1000 / 60 - 1e-6);
    expect(last - 30_000).toBeLessThanOrEqual(HUT.spawnTellMs + 2 * (1000 / 60));
  });

  it('pauses while the leader is away, and resumes where it was', () => {
    // Near until 1 s, away 1–11 s, near again: the first spawn comes 0.5 s after returning.
    const t = run(13_000, 60, (time) => (time <= 1000 || time > 11_000 ? NEAR : FAR));
    expect(t.spawnsAt).toHaveLength(1);
    const first = t.spawnsAt[0] ?? 0;
    expect(first).toBeGreaterThan(11_400);
    expect(first).toBeLessThan(11_600);
  });

  it('a started tell always spawns, even if the leader walks off', () => {
    // The tell starts at ~1 s; the leader leaves right after.
    const t = run(5_000, 60, (time) => (time <= 1_020 ? NEAR : FAR));
    expect(t.tellsAt).toHaveLength(1);
    expect(t.spawnsAt).toHaveLength(1);
  });

  it('activateRadius 0 means always active; a wiped squad (no leader) pauses it', () => {
    const always = createHut(HUT_ID, AT, resolveHutDef(HUT, { activateRadiusPx: 0 }), AT);
    expect(run(2_000, 60, () => v(5000, 5000), undefined, undefined, always).spawnsAt).toHaveLength(
      1,
    );
    expect(run(2_000, 60, () => null, undefined, undefined, always).spawnsAt).toHaveLength(0);
  });

  it('destroyed: spawning stops, the step that notices says so once', () => {
    const t = run(
      20_000,
      60,
      () => NEAR,
      undefined,
      (time) => time < 8_000,
    );
    expect(t.spawnsAt).toHaveLength(2);
    expect(t.hut.phase).toBe('destroyed');
    let hut = t.hut;
    const again = stepHut(hut, { leader: NEAR, dtMs: 16, isAlive: () => false });
    expect(again.destroyed).toBe(false);
    expect(again.hut).toBe(hut);
    hut = createHut(HUT_ID, AT, HUT, AT);
    const first = stepHut(hut, { leader: NEAR, dtMs: 16, isAlive: () => false });
    expect(first.destroyed).toBe(true);
    expect(first.hut.phase).toBe('destroyed');
  });

  it('map overrides win over the data defaults', () => {
    const def = resolveHutDef(HUT, { spawnIntervalMs: 3000, maxAlive: 2 });
    expect(def.spawnIntervalMs).toBe(3000);
    expect(def.maxAlive).toBe(2);
    expect(def.firstSpawnDelayMs).toBe(HUT.firstSpawnDelayMs);
    const t = run(20_000, 60, () => NEAR, undefined, undefined, createHut(HUT_ID, AT, def, AT));
    expect(t.spawnsAt).toHaveLength(2);
    expect((t.spawnsAt[1] ?? 0) - (t.spawnsAt[0] ?? 0)).toBeCloseTo(3000, -2);
  });
});

describe('hut geometry and door', () => {
  it('the footprint is a square centred on the hut; the default door sits below it', () => {
    expect(hutFootprint(AT, HUT)).toEqual({ x: 468, y: 468, width: 64, height: 64 });
    // Footprint half (32) plus the grunt's body radius (12): the body touches the wall.
    expect(defaultDoor(AT, HUT, GRUNT_R)).toEqual(v(500, 544));
  });

  it('spawns at the door when free, else at the nearest free tile', () => {
    const grid = CollisionGrid.open(64, 64, 16);
    grid.addSolid({ id: HUT_ID, rect: hutFootprint(AT, HUT), blocksShots: true });
    // Review M7-T10 m1: the default door is used as-is (the view glows where the grunt appears).
    const fallbackDoor = defaultDoor(AT, HUT, GRUNT_R);
    expect(hutSpawnPoint(grid, fallbackDoor, GRUNT_R)).toEqual(fallbackDoor);
    const door = v(500, 560); // a map hut-spawn with room
    expect(hutSpawnPoint(grid, door, 12)).toEqual(door);
    const occupied = hutSpawnPoint(grid, door, 12, (p) => p.x !== door.x || p.y !== door.y);
    expect(occupied).not.toBeNull();
    expect(occupied).not.toEqual(door);
    if (!occupied) return;
    expect(grid.overlapsSolid(occupied, 12)).toBe(false);
    expect(Math.hypot(occupied.x - door.x, occupied.y - door.y)).toBeLessThan(40);
    // A keg on the door tile.
    grid.addSolid({
      id: id(7),
      rect: { x: 492, y: 552, width: 16, height: 16 },
      blocksShots: false,
    });
    const blocked = hutSpawnPoint(grid, door, 12);
    expect(blocked).not.toEqual(door);
    if (blocked) expect(grid.overlapsSolid(blocked, 12)).toBe(false);
  });
});

describe('hut as a structure unit (GDD §12, §14)', () => {
  it('takes damage and Burning; its death is a structure death, never a kill', () => {
    const world = new CombatWorld();
    world.add(hutUnitSpec(HUT_ID, HUT));
    expect(world.get(HUT_ID)).toMatchObject({ team: 'enemy', maxHp: 300, structure: 'goblin-hut' });
    const bolt = { ...CLASSES.pyromancer.attack, sourceId: id(1) };
    expect(applyHit(world, HUT_ID, bolt, GIBS).dealt).toBe(bolt.damage);
    applyStatus(world, HUT_ID, STATUSES.burning, id(1));
    stepStatuses(world, STATUSES, 16); // the frame it was applied
    const ticks = stepStatuses(world, STATUSES, STATUSES.burning.tickMs);
    expect(ticks.ticks.map((t) => t.target)).toEqual([HUT_ID]);
    const result = applyHit(world, HUT_ID, { ...bolt, damage: 1000 }, GIBS);
    expect(result.killed).toBe(true);
    if (!result.killed) return;
    expect(isStructureDeath(result.death)).toBe(true);
    expect(result.death.structure).toBe('goblin-hut');
  });

  it('a unit death carries no structure; killUnit keeps the flag for a hut', () => {
    const world = new CombatWorld();
    world.add({ id: id(5), team: 'enemy', maxHp: 10, bodyRadiusPx: 12 });
    world.add(hutUnitSpec(HUT_ID, HUT));
    const grunt = killUnit(world, id(5), 'combat');
    expect(grunt && isStructureDeath(grunt)).toBe(false);
    expect(grunt).not.toHaveProperty('structure');
    const hut = killUnit(world, HUT_ID, 'combat');
    expect(hut && isStructureDeath(hut)).toBe(true);
  });

  it('autos hit a hut only when no unit is in range (GDD §3)', () => {
    const attack = CLASSES.stormcaller.attack;
    const hut = { id: HUT_ID, position: v(100, 0), kind: 'structure' as const, alive: true };
    const grunt = { id: id(5), position: v(0, attack.rangePx), kind: 'unit' as const, alive: true };
    const pick = (candidates: readonly (typeof hut | typeof grunt)[]) =>
      stepAutoAttack(createAutoAttack(), {
        position: v(0, 0),
        attack,
        retargetMs: COMBAT.retargetMs,
        candidates,
        dtMs: 16,
      }).state.target;
    expect(pick([hut, grunt])).toBe(5);
    expect(pick([hut, { ...grunt, position: v(0, attack.rangePx + 1) }])).toBe(HUT_ID);
    expect(pick([hut, { ...grunt, alive: false }])).toBe(HUT_ID);
  });
});
