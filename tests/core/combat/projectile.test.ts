import { describe, expect, it } from 'vitest';
import type { EntityId, ProjectileAttackDef, Team, Vec2 } from '@core/types';
import { applyHit } from '@core/combat/damage';
import {
  createProjectile,
  stepProjectile,
  type Projectile,
  type ProjectileBody,
} from '@core/combat/projectile';
import { CombatWorld } from '@core/combat/world';
import { CLASSES } from '@data/classes';
import { COMBAT, GIBS } from '@data/combat';
import { ENEMIES } from '@data/enemies';

const id = (n: number) => n as EntityId;
const v = (x: number, y: number): Vec2 => ({ x, y });
const BOLT = CLASSES.pyromancer.attack;
const SPARK = CLASSES.stormcaller.attack;
const ARROW = ENEMIES['goblin-archer'].attack;
const GRUNT_R: number = ENEMIES['goblin-grunt'].bodyRadiusPx;

const shot = (
  attack: ProjectileAttackDef = BOLT,
  team: Team = 'squad',
  aimAt: Vec2 = v(100, 0),
  from: Vec2 = v(0, 0),
): Projectile =>
  createProjectile({
    id: id(1000),
    ownerId: id(1),
    team,
    from,
    aimAt,
    attack,
    rangeFactor: COMBAT.projectileRangeFactor,
  });

const body = (
  n: number,
  x: number,
  y = 0,
  team: Team = 'enemy',
  alive = true,
  r = GRUNT_R,
): ProjectileBody => ({ id: id(n), team, position: v(x, y), bodyRadiusPx: r, alive });

/** Steps at `dtMs` until the projectile hits or expires (or 1000 steps). */
function fly(p: Projectile, dtMs: number, bodies: readonly ProjectileBody[]) {
  let current = p;
  for (let i = 1; i <= 1000; i++) {
    const step = stepProjectile(current, dtMs, bodies);
    current = step.projectile;
    if (step.hit !== null || step.expired) return { ...step, steps: i };
  }
  throw new Error('projectile never resolved');
}

describe('createProjectile', () => {
  it('aims at the given point, at the attack speed, expiring at rangePx × 1.2', () => {
    const p = shot(BOLT, 'squad', v(30, 40));
    expect(p.direction.x).toBeCloseTo(0.6, 12);
    expect(p.direction.y).toBeCloseTo(0.8, 12);
    expect(p.speedPxPerS).toBe(BOLT.projectileSpeed);
    expect(p.radiusPx).toBe(BOLT.projectileRadiusPx);
    expect(p.maxTravelPx).toBeCloseTo(BOLT.rangePx * COMBAT.projectileRangeFactor, 12);
    expect(p.source).toBe(BOLT);
  });

  it('flies along +x when aimed at its own origin', () => {
    expect(shot(BOLT, 'squad', v(0, 0)).direction).toEqual(v(1, 0));
  });
});

describe('stepProjectile', () => {
  it('flies straight at its speed (no homing)', () => {
    const step = stepProjectile(shot(SPARK, 'squad', v(0, 50)), 100, []);
    expect(step.projectile.position.x).toBeCloseTo(0, 12);
    expect(step.projectile.position.y).toBeCloseTo(36, 12);
    expect(step.projectile.travelledPx).toBeCloseTo(36, 12);
    expect(step).toMatchObject({ hit: null, expired: false });
  });

  it.each([30, 60, 144])('expires at exactly rangePx × 1.2 at %i fps', (fps) => {
    const r = fly(shot(BOLT), 1000 / fps, []);
    expect(r.expired).toBe(true);
    expect(r.hit).toBeNull();
    expect(r.projectile.travelledPx).toBeCloseTo(BOLT.rangePx * COMBAT.projectileRangeFactor, 9);
    expect(r.projectile.position.x).toBeCloseTo(BOLT.rangePx * COMBAT.projectileRangeFactor, 9);
  });

  it('hits a body when the circles touch, stopping at the contact point', () => {
    const r = fly(shot(BOLT), 1000 / 60, [body(5, 100)]);
    expect(r.hit).toBe(5);
    expect(r.expired).toBe(false);
    expect(r.projectile.position.x).toBeCloseTo(100 - GRUNT_R - BOLT.projectileRadiusPx, 9);
  });

  it('cannot tunnel: a 360 px/s spark at a long frame still hits a body between two positions', () => {
    // dt 100 ms: one 36 px step from x=0 to x=36. Body at x=18, reach 14: both ends are 18 away.
    const step = stepProjectile(shot(SPARK), 100, [body(5, 18, 0, 'enemy', true, 10)]);
    expect(step.hit).toBe(5);
    expect(step.projectile.position.x).toBeCloseTo(4, 9);
  });

  it.each([30, 60, 144])('a spark never tunnels through an archer at %i fps', (fps) => {
    for (let x = 20; x < 160; x += 3.7) {
      const r = fly(shot(SPARK), 1000 / fps, [body(5, x, 0, 'enemy', true, 10)]);
      expect(r.hit).toBe(5);
    }
  });

  it('hits the first body along the path, not the lowest id', () => {
    const r = fly(shot(BOLT), 1000 / 30, [body(2, 120), body(9, 60)]);
    expect(r.hit).toBe(9);
  });

  it('breaks a tie at the same contact point by the lowest id', () => {
    const bodies = [body(7, 60, 10), body(3, 60, -10)];
    expect(fly(shot(BOLT), 1000 / 30, bodies).hit).toBe(3);
    expect(fly(shot(BOLT), 1000 / 30, [...bodies].reverse()).hit).toBe(3);
  });

  it('hits a body it already overlaps at the start', () => {
    const step = stepProjectile(shot(BOLT), 16, [body(4, 5)]);
    expect(step.hit).toBe(4);
    expect(step.projectile.position).toEqual(v(0, 0));
  });

  it('misses bodies to the side and behind', () => {
    expect(fly(shot(BOLT), 1000 / 60, [body(1, 100, 30), body(2, -20)]).expired).toBe(true);
  });

  it('passes through wizards and kegs when fired by the squad', () => {
    const bodies = [body(1, 40, 0, 'squad'), body(2, 80, 0, 'neutral'), body(3, 150)];
    expect(fly(shot(BOLT), 1000 / 60, bodies).hit).toBe(3);
  });

  it('an enemy arrow hits wizards, passes through goblins and kegs', () => {
    const bodies = [body(1, 40, 0, 'enemy'), body(2, 80, 0, 'neutral'), body(3, 150, 0, 'squad')];
    expect(fly(shot(ARROW, 'enemy'), 1000 / 60, bodies).hit).toBe(3);
  });

  it('never hits a dead body (D4)', () => {
    const bodies = [body(1, 60, 0, 'enemy', false), body(2, 150)];
    expect(fly(shot(BOLT), 1000 / 60, bodies).hit).toBe(2);
    expect(fly(shot(BOLT), 1000 / 60, [body(1, 60, 0, 'enemy', false)]).expired).toBe(true);
  });

  it('beyond max travel, a body is not hit', () => {
    const max = BOLT.rangePx * COMBAT.projectileRangeFactor;
    const reach = GRUNT_R + BOLT.projectileRadiusPx;
    expect(fly(shot(BOLT), 1000 / 60, [body(1, max + reach + 0.5)]).expired).toBe(true);
    expect(fly(shot(BOLT), 1000 / 60, [body(1, max + reach - 0.5)]).hit).toBe(1);
  });

  it('a dead shooter’s projectile still resolves, credited to the shooter (GDD §3)', () => {
    const world = new CombatWorld();
    world.add({ id: id(1), team: 'squad', maxHp: 60, bodyRadiusPx: 10 });
    world.add({ id: id(5), team: 'enemy', maxHp: 24, bodyRadiusPx: GRUNT_R });
    const p = shot(BOLT);
    world.markDead(id(1));
    const r = fly(p, 1000 / 60, [body(5, 100)]);
    expect(r.hit).toBe(5);
    const result = applyHit(world, id(5), { ...r.projectile.source, sourceId: p.ownerId }, GIBS);
    expect(result).toMatchObject({ landed: true, dealt: BOLT.damage });
  });

  it('a dt <= 0 does not move it', () => {
    const p = shot(BOLT);
    expect(stepProjectile(p, 0, []).projectile.position).toEqual(p.position);
    expect(stepProjectile(p, -5, []).projectile.position).toEqual(p.position);
  });
});
