import { describe, expect, it } from 'vitest';
import type { Rect, Vec2 } from '@core/types';
import { clampToRect, insetRect, moveVectorFromAxes, stepPosition } from '@core/math/movement';
import { distance, length } from '@core/math/vec2';

const v = (x: number, y: number): Vec2 => ({ x, y });

describe('moveVectorFromAxes', () => {
  it('returns {0,0} for zero input, without NaN', () => {
    const m = moveVectorFromAxes(0, 0);
    expect(m).toEqual(v(0, 0));
    expect(Number.isNaN(m.x)).toBe(false);
    expect(Number.isNaN(m.y)).toBe(false);
  });

  it('keeps cardinal digital input at unit length', () => {
    expect(moveVectorFromAxes(1, 0)).toEqual(v(1, 0));
    expect(moveVectorFromAxes(0, -1)).toEqual(v(0, -1));
  });

  it('normalises every digital diagonal to unit length', () => {
    for (const [x, y] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ] as const) {
      const m = moveVectorFromAxes(x, y);
      expect(length(m)).toBeCloseTo(1);
      expect(Math.sign(m.x)).toBe(x);
      expect(Math.sign(m.y)).toBe(y);
    }
  });

  it('leaves analog input under length 1 unchanged', () => {
    expect(moveVectorFromAxes(0.3, -0.4)).toEqual(v(0.3, -0.4));
    expect(moveVectorFromAxes(0.5, 0)).toEqual(v(0.5, 0));
  });

  it('keeps analog input at exactly length 1 unchanged', () => {
    expect(moveVectorFromAxes(0.6, 0.8)).toEqual(v(0.6, 0.8));
  });

  it('clamps analog input over length 1 to unit length, keeping direction', () => {
    const m = moveVectorFromAxes(1, 0.5);
    expect(length(m)).toBeCloseTo(1);
    expect(m.y / m.x).toBeCloseTo(0.5);
  });
});

describe('stepPosition', () => {
  it('moves speed * dt along the move vector', () => {
    expect(stepPosition(v(10, 20), v(1, 0), 100, 1000)).toEqual(v(110, 20));
    expect(stepPosition(v(0, 0), v(0, -1), 200, 500)).toEqual(v(0, -100));
  });

  it('scales linearly with dt', () => {
    const one = stepPosition(v(0, 0), v(1, 0), 120, 16);
    const two = stepPosition(v(0, 0), v(1, 0), 120, 32);
    expect(two.x).toBeCloseTo(one.x * 2);
  });

  it('two half steps equal one full step', () => {
    const halves = stepPosition(stepPosition(v(5, 5), v(0.6, 0.8), 90, 8), v(0.6, 0.8), 90, 8);
    const full = stepPosition(v(5, 5), v(0.6, 0.8), 90, 16);
    expect(halves.x).toBeCloseTo(full.x);
    expect(halves.y).toBeCloseTo(full.y);
  });

  it('covers the same distance diagonally as cardinally', () => {
    const origin = v(0, 0);
    const cardinal = stepPosition(origin, moveVectorFromAxes(1, 0), 150, 16);
    const diagonal = stepPosition(origin, moveVectorFromAxes(-1, 1), 150, 16);
    expect(distance(origin, diagonal)).toBeCloseTo(distance(origin, cardinal));
  });

  it('does not move for zero input', () => {
    expect(stepPosition(v(3, 4), moveVectorFromAxes(0, 0), 150, 16)).toEqual(v(3, 4));
  });

  it('does not move for dt <= 0', () => {
    expect(stepPosition(v(3, 4), v(1, 0), 150, 0)).toEqual(v(3, 4));
    expect(stepPosition(v(3, 4), v(1, 0), 150, -16)).toEqual(v(3, 4));
  });

  it('does not mutate its inputs', () => {
    const pos = v(1, 1);
    const move = v(1, 0);
    stepPosition(pos, move, 100, 16);
    expect(pos).toEqual(v(1, 1));
    expect(move).toEqual(v(1, 0));
  });
});

describe('clampToRect', () => {
  const rect: Rect = { x: 100, y: 50, width: 400, height: 300 };
  const inset = 12;

  it('leaves a position inside the inset area unchanged', () => {
    expect(clampToRect(v(300, 200), rect, inset)).toEqual(v(300, 200));
  });

  it('clamps at the left edge with inset', () => {
    expect(clampToRect(v(0, 200), rect, inset)).toEqual(v(112, 200));
  });

  it('clamps at the right edge with inset', () => {
    expect(clampToRect(v(999, 200), rect, inset)).toEqual(v(488, 200));
  });

  it('clamps at the top edge with inset', () => {
    expect(clampToRect(v(300, -50), rect, inset)).toEqual(v(300, 62));
  });

  it('clamps at the bottom edge with inset', () => {
    expect(clampToRect(v(300, 999), rect, inset)).toEqual(v(300, 338));
  });

  it('clamps both axes at a corner', () => {
    expect(clampToRect(v(-1, -1), rect, inset)).toEqual(v(112, 62));
  });

  it('keeps positions exactly on the inset boundary', () => {
    expect(clampToRect(v(112, 338), rect, inset)).toEqual(v(112, 338));
  });

  it('clamps to the rect itself with zero inset', () => {
    expect(clampToRect(v(-5, 1000), rect, 0)).toEqual(v(100, 350));
  });

  it('centres on an axis where the rect is smaller than 2 * inset', () => {
    const narrow: Rect = { x: 10, y: 0, width: 20, height: 300 };
    expect(clampToRect(v(0, 500), narrow, inset)).toEqual(v(20, 288));
    expect(clampToRect(v(99, 100), narrow, inset)).toEqual(v(20, 100));
  });

  it('centres on both axes when the rect is undersized on both', () => {
    const tiny: Rect = { x: 0, y: 0, width: 10, height: 6 };
    expect(clampToRect(v(-50, 50), tiny, inset)).toEqual(v(5, 3));
  });

  it('allows exactly one position when the rect is exactly 2 * inset', () => {
    const exact: Rect = { x: 0, y: 0, width: 24, height: 24 };
    expect(clampToRect(v(100, -100), exact, inset)).toEqual(v(12, 12));
  });
});

describe('insetRect', () => {
  const rect: Rect = { x: 100, y: 50, width: 400, height: 300 };
  const uniform = (n: number) => ({ top: n, right: n, bottom: n, left: n });

  it('shrinks the rect by uniform insets', () => {
    expect(insetRect(rect, uniform(10))).toEqual({ x: 110, y: 60, width: 380, height: 280 });
  });

  it('returns an equal rect for zero insets', () => {
    expect(insetRect(rect, uniform(0))).toEqual(rect);
  });

  it('applies asymmetric insets per side', () => {
    expect(insetRect(rect, { top: 46, right: 12, bottom: 12, left: 30 })).toEqual({
      x: 130,
      y: 96,
      width: 358,
      height: 242,
    });
  });

  it('keeps a zero-size axis when the insets exactly fill it', () => {
    const r: Rect = { x: 0, y: 0, width: 20, height: 100 };
    expect(insetRect(r, { top: 0, right: 5, bottom: 0, left: 15 })).toEqual({
      x: 15,
      y: 0,
      width: 0,
      height: 100,
    });
  });

  it('collapses an overflowing axis to zero size, centred on the original rect', () => {
    const r: Rect = { x: 10, y: 0, width: 20, height: 300 };
    expect(insetRect(r, { top: 46, right: 12, bottom: 12, left: 30 })).toEqual({
      x: 20,
      y: 46,
      width: 0,
      height: 242,
    });
  });

  it('collapses both axes independently', () => {
    const tiny: Rect = { x: 0, y: 0, width: 10, height: 6 };
    expect(insetRect(tiny, uniform(12))).toEqual({ x: 5, y: 3, width: 0, height: 0 });
  });

  it('does not mutate its inputs', () => {
    const r: Rect = { x: 1, y: 2, width: 30, height: 40 };
    const insets = { top: 1, right: 2, bottom: 3, left: 4 };
    insetRect(r, insets);
    expect(r).toEqual({ x: 1, y: 2, width: 30, height: 40 });
    expect(insets).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
  });

  it('with clampToRect at inset 0, matches clampToRect with a uniform inset', () => {
    const narrow: Rect = { x: 10, y: 0, width: 20, height: 300 };
    for (const r of [rect, narrow]) {
      for (const pos of [v(-999, -999), v(999, 999), v(300, 200), v(0, 150)]) {
        expect(clampToRect(pos, insetRect(r, uniform(12)), 0)).toEqual(clampToRect(pos, r, 12));
      }
    }
  });
});
