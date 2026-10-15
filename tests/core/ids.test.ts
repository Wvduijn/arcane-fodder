import { describe, expect, it } from 'vitest';
import { createIdAllocator } from '@core/ids';

describe('createIdAllocator', () => {
  it('hands out ascending ids starting at 1', () => {
    const ids = createIdAllocator();
    expect([ids.next(), ids.next(), ids.next()]).toEqual([1, 2, 3]);
  });

  it('never repeats an id', () => {
    const ids = createIdAllocator();
    const seen = new Set(Array.from({ length: 1000 }, () => ids.next()));
    expect(seen.size).toBe(1000);
  });

  it('starts at a custom first id', () => {
    expect(createIdAllocator(100).next()).toBe(100);
  });

  it('keeps separate allocators independent', () => {
    const a = createIdAllocator();
    const b = createIdAllocator();
    a.next();
    a.next();
    expect(b.next()).toBe(1);
  });

  it('throws on a first id that is not a positive integer', () => {
    expect(() => createIdAllocator(0)).toThrow(RangeError);
    expect(() => createIdAllocator(-3)).toThrow(RangeError);
    expect(() => createIdAllocator(1.5)).toThrow(RangeError);
  });
});
