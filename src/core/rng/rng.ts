/**
 * Seeded pseudo-random numbers (mulberry32). Core code takes an `Rng` as a dependency and never
 * calls Math.random, so every roll is reproducible from its seed.
 *
 * API:
 * - `createRng(seed)`: a new generator. The seed is truncated to an unsigned 32-bit integer.
 * - `rng.next()`: a float in [0, 1).
 * - `rng.int(min, max)`: an integer in [min, max], both inclusive.
 * - `rng.pick(list)`: one element of a non-empty list.
 */

export interface Rng {
  /** A float in [0, 1). Advances the sequence by one step. */
  next(): number;
  /**
   * An integer in [min, max], both inclusive. Throws unless both are integers with min <= max.
   * Uniform only for ranges up to 2^32 wide (next() has 2^32 distinct values).
   */
  int(min: number, max: number): number;
  /** One element of `list`, uniformly. Throws on an empty list. */
  pick<T>(list: readonly T[]): T;
}

/** A mulberry32 generator. Equal seeds give equal sequences; the seed is taken as `seed >>> 0`. */
export function createRng(seed: number): Rng {
  return new Mulberry32(seed >>> 0);
}

class Mulberry32 implements Rng {
  constructor(private state: number) {}

  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
      throw new RangeError(
        `Rng.int needs integers with min <= max, got ${String(min)}..${String(max)}`,
      );
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(list: readonly T[]): T {
    if (list.length === 0) throw new RangeError('Rng.pick needs a non-empty list');
    return list[this.int(0, list.length - 1)] as T;
  }
}
