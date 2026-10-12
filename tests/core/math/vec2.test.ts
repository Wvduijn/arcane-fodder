import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@core/types';
import { add, clamp, distance, length, lerp, normalize, scale, sub } from '@core/math/vec2';

const v = (x: number, y: number): Vec2 => ({ x, y });

describe('add', () => {
  it('adds component-wise', () => {
    expect(add(v(1, 2), v(3, 4))).toEqual(v(4, 6));
  });

  it('handles negatives and the zero vector', () => {
    expect(add(v(-1, 5), v(1, -5))).toEqual(v(0, 0));
    expect(add(v(7, -3), v(0, 0))).toEqual(v(7, -3));
  });

  it('does not mutate its inputs', () => {
    const a = v(1, 1);
    const b = v(2, 2);
    add(a, b);
    expect(a).toEqual(v(1, 1));
    expect(b).toEqual(v(2, 2));
  });
});

describe('sub', () => {
  it('subtracts component-wise', () => {
    expect(sub(v(5, 7), v(2, 3))).toEqual(v(3, 4));
  });

  it('handles negatives', () => {
    expect(sub(v(-1, -1), v(1, 1))).toEqual(v(-2, -2));
  });

  it('returns the zero vector for equal inputs', () => {
    expect(sub(v(4, -4), v(4, -4))).toEqual(v(0, 0));
  });
});

describe('scale', () => {
  it('multiplies both components', () => {
    expect(scale(v(2, -3), 2)).toEqual(v(4, -6));
  });

  it('flips direction for a negative factor', () => {
    expect(scale(v(1, 2), -1)).toEqual(v(-1, -2));
  });

  it('returns a zero-length vector for factor 0', () => {
    expect(length(scale(v(9, 9), 0))).toBe(0);
  });
});

describe('length', () => {
  it('computes the Euclidean length', () => {
    expect(length(v(3, 4))).toBe(5);
  });

  it('is 0 for the zero vector', () => {
    expect(length(v(0, 0))).toBe(0);
  });

  it('is positive for negative components', () => {
    expect(length(v(-3, -4))).toBe(5);
  });
});

describe('normalize', () => {
  it('returns a unit vector in the same direction', () => {
    const n = normalize(v(3, 4));
    expect(n.x).toBeCloseTo(0.6);
    expect(n.y).toBeCloseTo(0.8);
    expect(length(n)).toBeCloseTo(1);
  });

  it('handles negative components', () => {
    const n = normalize(v(0, -10));
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBe(-1);
  });

  it('returns {0,0} for the zero vector instead of NaN', () => {
    const n = normalize(v(0, 0));
    expect(n).toEqual(v(0, 0));
    expect(Number.isNaN(n.x)).toBe(false);
    expect(Number.isNaN(n.y)).toBe(false);
  });

  it('keeps tiny non-zero vectors at unit length', () => {
    expect(length(normalize(v(1e-10, 0)))).toBeCloseTo(1);
  });
});

describe('distance', () => {
  it('computes the distance between two points', () => {
    expect(distance(v(1, 1), v(4, 5))).toBe(5);
  });

  it('is symmetric', () => {
    expect(distance(v(-2, 3), v(5, -1))).toBe(distance(v(5, -1), v(-2, 3)));
  });

  it('is 0 for the same point', () => {
    expect(distance(v(-7, 7), v(-7, 7))).toBe(0);
  });
});

describe('clamp', () => {
  it('returns the value when inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps below min and above max', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('keeps the bounds themselves', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('works with negative ranges', () => {
    expect(clamp(-20, -10, -5)).toBe(-10);
    expect(clamp(0, -10, -5)).toBe(-5);
  });

  it('collapses to the single value when min equals max', () => {
    expect(clamp(42, 3, 3)).toBe(3);
  });

  // Documents current behaviour for invalid input, so a refactor cannot change it silently.
  it('returns max when min > max (swapped range)', () => {
    expect(clamp(5, 10, 0)).toBe(0);
    expect(clamp(-5, 10, 0)).toBe(0);
  });

  it('propagates NaN input', () => {
    expect(clamp(Number.NaN, 0, 1)).toBeNaN();
  });
});

describe('lerp', () => {
  it('returns exactly a at t = 0 and b at t = 1', () => {
    expect(lerp(0.1, 0.3, 0)).toBe(0.1);
    expect(lerp(0.1, 0.3, 1)).toBe(0.3);
  });

  it('returns the midpoint at t = 0.5', () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  it('interpolates across negative values', () => {
    expect(lerp(-10, 10, 0.25)).toBe(-5);
  });

  it('extrapolates outside [0, 1] because t is not clamped', () => {
    expect(lerp(0, 10, 2)).toBe(20);
    expect(lerp(0, 10, -1)).toBe(-10);
  });

  it('returns a for equal endpoints', () => {
    expect(lerp(4, 4, 0.7)).toBeCloseTo(4);
  });
});
