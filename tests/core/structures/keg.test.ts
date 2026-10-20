import { describe, expect, it } from 'vitest';
import type { DamageElement, EntityId, Vec2 } from '@core/types';
import { createKeg, kegBodies, stepKegs, triggerKeg, triggersKeg } from '@core/structures/keg';
import { REACTIONS } from '@data/reactions';
import { KEG } from '@data/structures';

const v = (x: number, y: number): Vec2 => ({ x, y });
const id = (n: number) => n as EntityId;
const KABOOM = REACTIONS.kaboom;
const FPS = [30, 60, 144] as const;

describe('keg state', () => {
  it('starts idle; a trigger lights the fuse; a second trigger does nothing', () => {
    const keg = createKeg(id(1), v(10, 20));
    expect(keg).toEqual({
      id: 1,
      position: v(10, 20),
      phase: 'idle',
      fuseRemainingMs: 0,
      skipNextStep: false,
    });
    const lit = triggerKeg(keg, KABOOM);
    expect(lit.started).toBe(true);
    expect(lit.keg).toMatchObject({ phase: 'fuse', fuseRemainingMs: KABOOM.fuseMs });
    const half = stepKegs([lit.keg], KABOOM.fuseMs / 2).kegs[0];
    if (!half) throw new Error('keg lost');
    const again = triggerKeg(half, KABOOM);
    expect(again.started).toBe(false);
    expect(again.keg).toBe(half);
  });

  it('lights on fire, storm and arcane, never on physical (GDD §8, Q6)', () => {
    const lights = (e: DamageElement) => triggersKeg(e, KABOOM);
    expect(lights('fire')).toBe(true);
    expect(lights('storm')).toBe(true);
    expect(lights('arcane')).toBe(true);
    expect(lights('physical')).toBe(false);
  });

  it.each(FPS)('the fuse ends after fuseMs, within one frame, at %i fps', (fps) => {
    const dt = 1000 / fps;
    let kegs = [triggerKeg(createKeg(id(1), v(0, 0)), KABOOM).keg];
    let t = 0;
    for (;;) {
      t += dt;
      const s = stepKegs(kegs, dt);
      kegs = [...s.kegs];
      if (s.exploded.length > 0) {
        expect(s.exploded).toEqual([
          { id: 1, position: v(0, 0), phase: 'spent', fuseRemainingMs: 0, skipNextStep: false },
        ]);
        break;
      }
      expect(t).toBeLessThan(KABOOM.fuseMs);
    }
    expect(t).toBeGreaterThanOrEqual(KABOOM.fuseMs - 1e-6);
    expect(t).toBeLessThan(KABOOM.fuseMs + dt);
    // Spent is final: no re-trigger, never explodes again.
    const spent = kegs[0];
    if (!spent) throw new Error('keg lost');
    expect(triggerKeg(spent, KABOOM)).toEqual({ keg: spent, started: false });
    expect(stepKegs(kegs, 1000).exploded).toEqual([]);
  });

  it.each(FPS)('lit before the step of its frame, it skips that step, at %i fps', (fps) => {
    const dt = 1000 / fps;
    // Frame 1 at t = dt: a spell lights the keg, then the keg step runs.
    let kegs = [triggerKeg(createKeg(id(1), v(0, 0)), KABOOM, { beforeStep: true }).keg];
    let t = dt;
    let s = stepKegs(kegs, dt);
    expect(s.kegs[0]).toMatchObject({ fuseRemainingMs: KABOOM.fuseMs, skipNextStep: false });
    kegs = [...s.kegs];
    while (s.exploded.length === 0) {
      t += dt;
      s = stepKegs(kegs, dt);
      kegs = [...s.kegs];
    }
    // Lit at t = dt: goes off on the first frame at or after dt + fuseMs.
    expect(t - dt).toBeGreaterThanOrEqual(KABOOM.fuseMs - 1e-6);
    expect(t - dt).toBeLessThan(KABOOM.fuseMs + dt);
  });

  it('lists simultaneous explosions in ascending id order, kegs in their given order', () => {
    const lit = [3, 1, 2].map((n) => triggerKeg(createKeg(id(n), v(n, 0)), KABOOM).keg);
    const s = stepKegs(lit, KABOOM.fuseMs);
    expect(s.exploded.map((k) => k.id)).toEqual([1, 2, 3]);
    expect(s.kegs.map((k) => k.id)).toEqual([3, 1, 2]);
  });

  it('idle kegs do not tick; a zero dt changes nothing', () => {
    const kegs = [createKeg(id(1), v(0, 0)), triggerKeg(createKeg(id(2), v(0, 0)), KABOOM).keg];
    expect(stepKegs(kegs, 0).kegs).toBe(kegs);
    expect(stepKegs(kegs, 100).kegs[0]).toBe(kegs[0]);
  });

  it('as area bodies: only idle kegs can be lit; fusing ones still stop a Fireball', () => {
    const idle = createKeg(id(1), v(0, 0));
    const fusing = triggerKeg(createKeg(id(2), v(0, 0)), KABOOM).keg;
    const spent = stepKegs([triggerKeg(createKeg(id(3), v(0, 0)), KABOOM).keg], 1000).kegs[0];
    if (!spent) throw new Error('keg lost');
    const kegs = [idle, fusing, spent];
    expect(kegBodies(kegs, KEG).map((b) => b.alive)).toEqual([true, false, false]);
    expect(kegBodies(kegs, KEG, { solidOnly: true }).map((b) => b.alive)).toEqual([
      true,
      true,
      false,
    ]);
    expect(kegBodies(kegs, KEG).every((b) => b.bodyRadiusPx === KEG.bodyRadiusPx)).toBe(true);
  });
});
