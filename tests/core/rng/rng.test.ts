import { describe, expect, it } from 'vitest';
import { createRng } from '@core/rng/rng';

const take = (seed: number, n: number): number[] => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe('createRng', () => {
  it('matches the reference mulberry32 sequence for a fixed seed', () => {
    expect(take(1, 4)).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741,
    ]);
    expect(take(42, 3)).toEqual([0.6011037519201636, 0.44829055899754167, 0.8524657934904099]);
  });

  it('is deterministic: equal seeds give equal sequences', () => {
    expect(take(1234, 50)).toEqual(take(1234, 50));
  });

  it('gives different sequences for different seeds', () => {
    expect(take(1234, 10)).not.toEqual(take(1235, 10));
  });

  it('truncates the seed to an unsigned 32-bit integer', () => {
    expect(take(-1, 5)).toEqual(take(0xffffffff, 5));
    expect(take(2 ** 32 + 7, 5)).toEqual(take(7, 5));
  });

  it('keeps next() in [0, 1)', () => {
    for (const x of take(99, 10_000)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('Rng.int', () => {
  it('stays within [min, max] inclusive and hits both ends', () => {
    const rng = createRng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const n = rng.int(-2, 3);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(-2);
      expect(n).toBeLessThanOrEqual(3);
      seen.add(n);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2, 3]);
  });

  it('returns min when min equals max', () => {
    expect(createRng(5).int(7, 7)).toBe(7);
  });

  it('throws on min > max or non-integer bounds', () => {
    const rng = createRng(5);
    expect(() => rng.int(3, 2)).toThrow(RangeError);
    expect(() => rng.int(0.5, 2)).toThrow(RangeError);
    expect(() => rng.int(0, Number.NaN)).toThrow(RangeError);
  });
});

describe('Rng.pick', () => {
  it('returns elements of the list, deterministically per seed', () => {
    const list = ['a', 'b', 'c', 'd'] as const;
    const draw = (seed: number) => {
      const rng = createRng(seed);
      return Array.from({ length: 20 }, () => rng.pick(list));
    };
    expect(draw(3)).toEqual(draw(3));
    for (const x of draw(3)) expect(list).toContain(x);
  });

  it('throws on an empty list', () => {
    expect(() => createRng(1).pick([])).toThrow(RangeError);
  });
});
