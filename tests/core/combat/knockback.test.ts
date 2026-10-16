import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@core/types';
import { pushWithin, startKnockback, stepKnockbacks, type Knockback } from '@core/combat/knockback';
import { length } from '@core/math/vec2';
import { CLASSES } from '@data/classes';
import { COMBAT } from '@data/combat';

const v = (x: number, y: number): Vec2 => ({ x, y });
const PX = CLASSES.pyromancer.attack.knockbackPx;
const MS = COMBAT.knockbackMs;

/** Runs pushes to completion at `dtMs`; returns each frame's displacement length and the total. */
function play(list: Knockback[], dtMs: number) {
  let active: readonly Knockback[] = list;
  const frames: number[] = [];
  let total = v(0, 0);
  for (let i = 0; i < 10_000 && active.length > 0; i++) {
    const step = stepKnockbacks(active, dtMs);
    frames.push(length(step.displacement));
    total = v(total.x + step.displacement.x, total.y + step.displacement.y);
    active = step.active;
  }
  return { frames, total };
}

describe('knockback', () => {
  it('returns null for no distance or no direction', () => {
    expect(startKnockback(v(1, 0), 0, MS)).toBeNull();
    expect(startKnockback(v(0, 0), PX, MS)).toBeNull();
  });

  it('normalises the direction', () => {
    expect(startKnockback(v(3, 4), PX, MS)?.direction).toEqual(v(0.6, 0.8));
  });

  it.each([30, 60, 144, 1000 / COMBAT.maxFrameDtMs])(
    'moves exactly knockbackPx in total at %f fps, eased, never a jump',
    (fps) => {
      const dt = 1000 / fps;
      const kb = startKnockback(v(0, -1), PX, MS);
      if (!kb) throw new Error('expected a knockback');
      const { frames, total } = play([kb], dt);
      expect(total.x).toBeCloseTo(0, 9);
      expect(total.y).toBeCloseTo(-PX, 9);
      expect(frames.length).toBe(Math.ceil(MS / dt - 1e-9));
      for (const f of frames) expect(f).toBeLessThanOrEqual((2 * PX * dt) / MS + 1e-9);
    },
  );

  it('eases out: the first frame moves more than the last', () => {
    const kb = startKnockback(v(1, 0), PX, MS);
    if (!kb) throw new Error('expected a knockback');
    const { frames } = play([kb], 1000 / 60);
    expect(frames[0]).toBeGreaterThan(frames[frames.length - 1] ?? Infinity);
  });

  it('adds up several pushes', () => {
    const a = startKnockback(v(1, 0), PX, MS);
    const b = startKnockback(v(0, 1), PX, MS);
    if (!a || !b) throw new Error('expected knockbacks');
    const { total } = play([a, b], 1000 / 60);
    expect(total.x).toBeCloseTo(PX, 9);
    expect(total.y).toBeCloseTo(PX, 9);
  });

  it('pushes in one step with a duration of 0', () => {
    const kb = startKnockback(v(1, 0), PX, 0);
    if (!kb) throw new Error('expected a knockback');
    const step = stepKnockbacks([kb], 16);
    expect(step.displacement.x).toBeCloseTo(PX, 12);
    expect(step.active).toEqual([]);
  });

  it('does nothing for dt <= 0', () => {
    const kb = startKnockback(v(1, 0), PX, MS);
    if (!kb) throw new Error('expected a knockback');
    const step = stepKnockbacks([kb], 0);
    expect(step.displacement).toEqual(v(0, 0));
    expect(step.active).toEqual([kb]);
  });

  it('pushWithin sums with movement and keeps the body inside the bounds', () => {
    const bounds = { x: 0, y: 0, width: 200, height: 100 };
    expect(pushWithin(v(50, 50), v(3, -2), bounds, 12)).toEqual(v(53, 48));
    expect(pushWithin(v(190, 50), v(6, 0), bounds, 12)).toEqual(v(188, 50));
    expect(pushWithin(v(50, 14), v(0, -6), bounds, 12)).toEqual(v(50, 12));
  });
});
