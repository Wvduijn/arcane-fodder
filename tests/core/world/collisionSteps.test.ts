/**
 * T8 (M7): collision in the core steps. Squad, enemies, projectiles, Fireball, autos and the
 * volunteer all respect blockers; an open grid gives exactly the old behaviour.
 */
import { describe, expect, it } from 'vitest';
import type { EntityId, Rect, Vec2 } from '@core/types';
import type { WizardView } from '@core/ai/goblin';
import { createAutoAttack, stepAutoAttack } from '@core/combat/autoAttack';
import { createProjectile, stepProjectile, type ProjectileBody } from '@core/combat/projectile';
import {
  createEnemy,
  knockEnemy,
  stepEnemies,
  type EnemyAction,
  type EnemyState,
  type EnemyStepInput,
} from '@core/enemies/enemyMovement';
import { insetRect } from '@core/math/movement';
import { add, distance, normalize, scale, sub } from '@core/math/vec2';
import { castSpell, createCaster, stepCaster } from '@core/spells/caster';
import { stepSquad, type SquadStepInput } from '@core/squad/follow';
import { createSquad, knockSquadMember, slotPosition, type SquadState } from '@core/squad/squad';
import { activateVolunteer, createVolunteer, stepVolunteers } from '@core/squad/volunteer';
import type { TargetCandidate } from '@core/targeting/selectTarget';
import { CollisionGrid } from '@core/world/collisionGrid';
import { FlowField, FlowFieldClock } from '@core/world/flowField';
import { CLASSES } from '@data/classes';
import { COMBAT } from '@data/combat';
import { ENEMIES } from '@data/enemies';
import { MOVEMENT } from '@data/movement';
import { SPELLS, SPELL_TUNING } from '@data/spells';
import { TRAIL } from '@data/trail';
import { VOLUNTEER_TUNING } from '../convergence/fixtures';
import { gridWhere } from './fixtures';

const v = (x: number, y: number): Vec2 => ({ x, y });
const id = (n: number) => n as EntityId;
const R = MOVEMENT.wizardBodyRadiusPx;
const SPEED = MOVEMENT.squadMoveSpeed;
const DT = 1000 / 60;
const GRUNT = ENEMIES['goblin-grunt'];
const ARCHER = ENEMIES['goblin-archer'];

/** 40×40 tiles, a full-height wall at column 20 (x 320..336). */
const SPLIT = gridWhere(40, 40, (tx) => tx === 20);

const squadAt = (leader: Vec2, size: number, behind: Vec2 = v(-1, 0)): SquadState =>
  createSquad(
    { ids: Array.from({ length: size }, (_, i) => id(i + 1)), leaderPosition: leader, behind },
    TRAIL,
  );

const walkableOf = (grid: CollisionGrid): Rect =>
  insetRect(grid.bounds, { top: R, right: R, bottom: R, left: R });

/** One squad frame with the leader steered toward `aim` at squad speed. */
function squadFrame(
  state: SquadState,
  aim: Vec2 | null,
  grid: CollisionGrid | null,
  walkable: Rect,
): SquadState {
  const leader = state.members[0];
  if (!leader) return state;
  const toAim = aim ? sub(aim, leader.position) : v(0, 0);
  const step = Math.min(distance(v(0, 0), toAim), (SPEED * DT) / 1000);
  const input: SquadStepInput = {
    leaderPosition: add(leader.position, scale(normalize(toAim), step)),
    walkable,
    dtMs: DT,
    ...(grid ? { collision: { grid, bodyRadiusPx: R } } : {}),
  };
  return stepSquad(state, input, TRAIL, MOVEMENT);
}

function expectClearOfSolids(grid: CollisionGrid, state: SquadState): void {
  for (const m of state.members) expect(grid.overlapsSolid(m.position, R)).toBe(false);
}

describe('squad step with collision', () => {
  it('an open grid gives exactly the open-ground result (old sims stay valid)', () => {
    const grid = CollisionGrid.open(200, 200, 16);
    const walkable = walkableOf(grid);
    const aims = [v(1800, 1500), v(1500, 1800), v(1700, 1700), v(1600, 1400)];
    let a = squadAt(v(1600, 1600), 4);
    let b = a;
    for (let f = 0; f < 600; f++) {
      const aim = aims[Math.floor(f / 150)] ?? null;
      a = squadFrame(a, aim, null, walkable);
      b = squadFrame(b, aim, grid, walkable);
    }
    expect(b).toEqual(a);
  });

  it('the leader slides along a wall instead of stopping', () => {
    const walkable = walkableOf(SPLIT);
    let s = squadAt(v(250, 400), 1);
    for (let f = 0; f < 180; f++) {
      s = squadFrame(s, v(600, 100), SPLIT, walkable);
      expectClearOfSolids(SPLIT, s);
    }
    const leader = s.members[0];
    expect(leader?.position.x).toBeCloseTo(320 - R, 6);
    // Pressed into the wall, it kept moving north along it.
    expect(leader?.position.y).toBeLessThan(300);
  });

  it('followers keep the breadcrumb rule round an L-shaped corridor and never enter a solid', () => {
    // Open: an east-west band (rows 5..10) joined to a north-south band (columns 25..30).
    const grid = gridWhere(40, 40, (tx, ty) => {
      const east = ty >= 5 && ty <= 10 && tx >= 2 && tx <= 30;
      const south = tx >= 25 && tx <= 30 && ty >= 5 && ty <= 35;
      return !(east || south);
    });
    const walkable = walkableOf(grid);
    let s = squadAt(v(140, 128), 4);
    const route = [v(440, 128), v(440, 520)];
    let leg = 0;
    for (let f = 0; f < 60 * 12; f++) {
      const aim = route[leg] ?? null;
      const leader = s.members[0];
      if (aim && leader && distance(leader.position, aim) < 1) leg++;
      s = squadFrame(s, route[leg] ?? null, grid, walkable);
      expectClearOfSolids(grid, s);
    }
    expect(distance(s.members[0]?.position ?? v(0, 0), v(440, 520))).toBeLessThan(1);
    for (let k = 1; k < s.members.length; k++) {
      const m = s.members[k];
      if (!m) throw new Error('member lost');
      expect(distance(m.position, slotPosition(s, k, TRAIL))).toBeLessThanOrEqual(
        TRAIL.stopRadiusPx + 1e-6,
      );
      expect(m.velocity).toEqual(v(0, 0));
    }
  });

  it('a knockback into a wall stops at the wall', () => {
    const walkable = walkableOf(SPLIT);
    let s = squadAt(v(300, 400), 1);
    s = knockSquadMember(s, id(1), v(1, 0), 60, COMBAT.knockbackMs);
    for (let f = 0; f < 30; f++) s = squadFrame(s, null, SPLIT, walkable);
    expect(s.members[0]?.position.x).toBeCloseTo(320 - R, 6);
  });
});

const wiz = (n: number, p: Vec2): WizardView => ({
  id: id(n),
  position: p,
  bodyRadiusPx: R,
  alive: true,
});

function runEnemies(
  enemies: readonly EnemyState[],
  over: Partial<EnemyStepInput>,
  seconds: number,
  rebuildMs = 250,
  onFrame: (e: readonly EnemyState[], actions: readonly EnemyAction[]) => void = () => undefined,
): EnemyState[] {
  let current = [...enemies];
  const clock = new FlowFieldClock(rebuildMs);
  const base: EnemyStepInput = {
    defs: ENEMIES,
    wizards: [],
    bounds: { x: 0, y: 0, width: 640, height: 640 },
    isAlive: () => true,
    dtMs: DT,
    ...over,
  };
  for (let f = 0; f < seconds * 60; f++) {
    if (base.navigation && clock.step(DT)) {
      base.navigation.build(base.wizards.map((w) => w.position));
    }
    const result = stepEnemies(current, base);
    current = [...result.enemies];
    onFrame(current, result.actions);
  }
  return current;
}

describe('enemy step with collision and navigation (CD Q2)', () => {
  // Wall at column 20 for rows 0..22 (y < 368); open below it.
  const grid = gridWhere(40, 30, (tx, ty) => tx === 20 && ty <= 22);
  const bounds = { x: 0, y: 0, width: 640, height: 480 };
  const target = wiz(1, v(400, 100));

  it('a grunt chasing a wizard behind a wall goes round it with the flow field', () => {
    const field = new FlowField(grid);
    let closest = Number.POSITIVE_INFINITY;
    const end = runEnemies(
      [createEnemy(id(10), GRUNT, v(200, 100))],
      { wizards: [target], bounds, collision: grid, navigation: field },
      20,
      250,
      (e) => {
        const p = e[0]?.position ?? v(0, 0);
        expect(grid.overlapsSolid(p, GRUNT.bodyRadiusPx)).toBe(false);
        closest = Math.min(closest, distance(p, target.position));
      },
    );
    expect(end[0]).toBeDefined();
    expect(closest).toBeLessThanOrEqual(GRUNT.bodyRadiusPx + R + 1e-6);
  });

  it('without the flow field the same grunt stays stuck on the wall (why Q2 exists)', () => {
    const end = runEnemies(
      [createEnemy(id(10), GRUNT, v(200, 100))],
      { wizards: [target], bounds, collision: grid },
      20,
    );
    const p = end[0]?.position ?? v(0, 0);
    expect(p.x).toBeLessThanOrEqual(320 - GRUNT.bodyRadiusPx + 1e-6);
    expect(distance(p, target.position)).toBeGreaterThan(80);
  });

  it('kegs are solid: a grunt walks round one and never overlaps it', () => {
    const open = CollisionGrid.open(40, 20, 16);
    const keg: Rect = { x: 292, y: 92, width: 16, height: 16 };
    open.addSolid({ id: id(99), rect: keg, blocksShots: false });
    const field = new FlowField(open);
    let closest = Number.POSITIVE_INFINITY;
    runEnemies(
      [createEnemy(id(10), GRUNT, v(200, 100))],
      {
        wizards: [wiz(1, v(400, 100))],
        bounds: open.bounds,
        collision: open,
        navigation: field,
      },
      6,
      250,
      (e) => {
        const p = e[0]?.position ?? v(0, 0);
        expect(open.overlapsSolid(p, GRUNT.bodyRadiusPx)).toBe(false);
        closest = Math.min(closest, distance(p, v(400, 100)));
      },
    );
    expect(closest).toBeLessThanOrEqual(GRUNT.bodyRadiusPx + R + 1e-6);
  });

  it('a knocked-back goblin is stopped by the wall, not pushed through', () => {
    let e = createEnemy(id(10), GRUNT, v(300, 100));
    e = knockEnemy(e, GRUNT, v(1, 0), 80, COMBAT.knockbackMs);
    const end = runEnemies([e], { bounds, collision: grid }, 1);
    expect(end[0]?.position.x).toBeLessThanOrEqual(320 - GRUNT.bodyRadiusPx + 1e-6);
  });

  it('an archer never draws at a wizard it cannot see (CD Q3), but does on open ground', () => {
    const wall = gridWhere(40, 20, (tx) => tx === 20);
    const archer = createEnemy(id(10), ARCHER, v(250, 100));
    const wizards = [wiz(1, v(420, 100))];
    let hiddenShots = 0;
    runEnemies([archer], { wizards, bounds: wall.bounds, collision: wall }, 4, 250, (_e, a) => {
      hiddenShots += a.filter((x) => x.kind === 'shoot').length;
    });
    expect(hiddenShots).toBe(0);
    let openShots = 0;
    runEnemies([archer], { wizards, bounds: wall.bounds }, 4, 250, (_e, a) => {
      openShots += a.filter((x) => x.kind === 'shoot').length;
    });
    expect(openShots).toBeGreaterThan(0);
  });
});

describe('projectiles stop on blockers (GDD §3, §12)', () => {
  const wall = gridWhere(30, 20, (tx) => tx === 10); // x 160..176
  const arrowAt = (from: Vec2, aim: Vec2, team: 'enemy' | 'squad' = 'enemy') =>
    createProjectile({
      id: id(500),
      ownerId: id(50),
      team,
      from,
      aimAt: aim,
      attack: team === 'enemy' ? ARCHER.attack : CLASSES.pyromancer.attack,
      rangeFactor: COMBAT.projectileRangeFactor,
    });

  function fly(
    p: ReturnType<typeof arrowAt>,
    bodies: readonly ProjectileBody[],
    grid: CollisionGrid,
  ) {
    let current = p;
    for (let i = 0; i < 1000; i++) {
      const s = stepProjectile(current, 100, bodies, grid);
      if (s.hit !== null || s.expired || s.blocked) return s;
      current = s.projectile;
    }
    throw new Error('never ended');
  }

  it('ends on the first blocker tile it enters, with no hit', () => {
    const s = fly(arrowAt(v(100, 100), v(300, 100)), [], wall);
    expect(s.blocked).toBe(true);
    expect(s.hit).toBeNull();
    expect(s.expired).toBe(false);
    expect(s.projectile.position.x).toBeCloseTo(160, 9);
  });

  it('a body in front of the wall is hit as before; one behind it is safe', () => {
    const front: ProjectileBody = {
      id: id(1),
      team: 'squad',
      position: v(140, 100),
      bodyRadiusPx: R,
      alive: true,
    };
    expect(fly(arrowAt(v(100, 100), v(300, 100)), [front], wall).hit).toBe(1);
    const behind = { ...front, position: v(200, 100) };
    expect(fly(arrowAt(v(100, 100), v(300, 100)), [behind], wall).blocked).toBe(true);
  });

  describe('huts stand on their footprint', () => {
    const grid = CollisionGrid.open(20, 12, 16);
    grid.addSolid({
      id: id(9),
      rect: { x: 128, y: 32, width: 64, height: 64 },
      blocksShots: true,
    });
    const hut: ProjectileBody = {
      id: id(9),
      team: 'enemy',
      position: v(160, 64),
      bodyRadiusPx: 32,
      alive: true,
    };
    // Enters the footprint's bottom face at (131.2, 96), before the body circle.
    const from = v(70, 164);
    const aim = v(160, 64);

    it('a squad shot entering a living hut footprint hits the hut there', () => {
      const s = fly(arrowAt(from, aim, 'squad'), [hut], grid);
      expect(s.hit).toBe(9);
      expect(s.projectile.position.x).toBeCloseTo(131.2, 6);
      expect(s.projectile.position.y).toBeCloseTo(96, 6);
    });

    it('rubble (a dead hut) just stops it', () => {
      const s = fly(arrowAt(from, aim, 'squad'), [{ ...hut, alive: false }], grid);
      expect(s.hit).toBeNull();
      expect(s.blocked).toBe(true);
    });

    it('an enemy arrow stops on a hut and never hits it', () => {
      const s = fly(arrowAt(from, aim, 'enemy'), [hut], grid);
      expect(s.hit).toBeNull();
      expect(s.blocked).toBe(true);
    });
  });

  it('kegs never stop a projectile', () => {
    const grid = CollisionGrid.open(30, 12, 16);
    grid.addSolid({
      id: id(7),
      rect: { x: 150, y: 92, width: 16, height: 16 },
      blocksShots: false,
    });
    const s = fly(arrowAt(v(100, 100), v(300, 100)), [], grid);
    expect(s.expired).toBe(true);
    expect(s.blocked).toBe(false);
  });

  it('a Fireball explodes on the trunk it flies into (GDD §4)', () => {
    const slots = [{ slot: SPELLS.fireball.slot, spell: 'fireball' as const, available: true }];
    const cast = castSpell(
      createCaster(SPELLS),
      {
        slot: SPELLS.fireball.slot,
        slots,
        leader: { id: id(1), position: v(100, 100) },
        aim: v(300, 100),
        nextId: () => id(600),
      },
      SPELLS,
      SPELL_TUNING,
    );
    let state = cast.state;
    for (let i = 0; i < 200; i++) {
      const step = stepCaster(state, { hitBodies: [], dtMs: DT, collision: wall });
      const impact = step.impacts[0];
      if (impact) {
        expect(impact.hitBody).toBeNull();
        expect(impact.at.x).toBeCloseTo(160, 9);
        expect(impact.at.y).toBe(100);
        return;
      }
      state = step.state;
    }
    throw new Error('no impact');
  });
});

describe('wizard autos and sight (CD Q3)', () => {
  const wall = gridWhere(30, 30, (tx, ty) => tx === 10 && ty <= 12); // x 160..176, y < 208
  const attack = CLASSES.pyromancer.attack;
  const unit = (n: number, p: Vec2): TargetCandidate => ({
    id: id(n),
    position: p,
    kind: 'unit',
    alive: true,
  });
  const run = (candidates: readonly TargetCandidate[], state = createAutoAttack()) =>
    stepAutoAttack(state, {
      position: v(100, 100),
      attack,
      retargetMs: COMBAT.retargetMs,
      candidates,
      dtMs: DT,
      collision: wall,
    });

  it('skips a nearer enemy behind a blocker for a visible one', () => {
    const hidden = unit(1, v(200, 100)); // 100 px, behind the wall
    const seen = unit(2, v(100, 230)); // 130 px, clear
    expect(run([hidden, seen]).state.target).toBe(2);
  });

  it('falls back to a visible hut when the only unit in range is hidden', () => {
    const hidden = unit(1, v(200, 100));
    const hut: TargetCandidate = {
      id: id(3),
      position: v(100, 250),
      kind: 'structure',
      alive: true,
    };
    expect(run([hidden, hut]).state.target).toBe(3);
  });

  it('a hut is seen through its own footprint', () => {
    const grid = CollisionGrid.open(30, 30, 16);
    grid.addSolid({ id: id(3), rect: { x: 168, y: 68, width: 64, height: 64 }, blocksShots: true });
    const hut: TargetCandidate = {
      id: id(3),
      position: v(200, 100),
      kind: 'structure',
      alive: true,
    };
    const step = stepAutoAttack(createAutoAttack(), {
      position: v(100, 100),
      attack,
      retargetMs: COMBAT.retargetMs,
      candidates: [hut],
      dtMs: DT,
      collision: grid,
    });
    expect(step.state.target).toBe(3);
    expect(step.fire?.aimAt).toEqual(v(200, 100));
  });

  it('drops a target at once when it goes out of sight', () => {
    const first = run([unit(1, v(100, 200))]);
    expect(first.state.target).toBe(1);
    const moved = run([unit(1, v(200, 100))], { ...first.state, sinceRetargetMs: 0 });
    expect(moved.state.target).toBeNull();
    expect(moved.fire).toBeNull();
  });

  it('kegs never block sight', () => {
    const grid = CollisionGrid.open(30, 30, 16);
    grid.addSolid({
      id: id(8),
      rect: { x: 142, y: 92, width: 16, height: 16 },
      blocksShots: false,
    });
    const step = stepAutoAttack(createAutoAttack(), {
      position: v(100, 100),
      attack,
      retargetMs: COMBAT.retargetMs,
      candidates: [unit(1, v(200, 100))],
      dtMs: DT,
      collision: grid,
    });
    expect(step.state.target).toBe(1);
  });
});

describe('volunteer sprint and blockers', () => {
  it('a runner that hits a tree detonates where its body touches it', () => {
    const wall = gridWhere(60, 60, (tx) => tx === 40); // x 640..656
    const squad = squadAt(v(500, 500), 2, v(0, 1));
    const started = activateVolunteer(
      createVolunteer(),
      squad,
      { channelRunning: false, aim: v(700, 526) },
      VOLUNTEER_TUNING,
      SPELL_TUNING,
      TRAIL,
    );
    expect(started.outcome.kind).toBe('started');
    let state = started.state;
    for (let i = 0; i < 300; i++) {
      const step = stepVolunteers(
        state,
        { dtMs: DT, isAlive: () => true, contacts: [], runnerRadiusPx: R, collision: wall },
        VOLUNTEER_TUNING,
      );
      const d = step.detonations[0];
      if (d) {
        expect(d.reason).toBe('contact');
        expect(d.at.x).toBeGreaterThan(640 - R - 0.125 - 1e-9);
        expect(d.at.x).toBeLessThanOrEqual(640 - R);
        return;
      }
      state = step.state;
    }
    throw new Error('never detonated');
  });
});
