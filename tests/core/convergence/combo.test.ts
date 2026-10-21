import { describe, expect, it } from 'vitest';
import type { ConvergenceDef, MageClassId } from '@core/types';
import { powerFor, resolveCombo } from '@core/convergence/combo';
import { createRng } from '@core/rng/rng';
import { CLASSES } from '@data/classes';
import { CONVERGENCE, CONVERGENCES } from '@data/convergences';
import {
  COMPOSITIONS,
  CONVERGENCE_DEFS,
  FIRESTORM,
  METEOR,
  P,
  S,
  THUNDERSTORM,
  TUNING,
} from './fixtures';

const resolve = (living: readonly MageClassId[], defs = CONVERGENCE_DEFS) =>
  resolveCombo(living, CLASSES, defs, TUNING.scaling);

/** Every ordering of a list (≤ 3 items here). */
const permutations = <T>(list: readonly T[]): T[][] =>
  list.length <= 1
    ? [[...list]]
    : list.flatMap((x, i) =>
        permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [x, ...rest]),
      );

describe('resolveCombo', () => {
  it.each(COMPOSITIONS)('%s → %s ×%d', (_name, classes, combo, power) => {
    const r = resolve(classes);
    expect(r?.combo.id).toBe(combo);
    expect(r?.power).toBe(power);
  });

  it.each(COMPOSITIONS)('shipped data: %s → %s ×%d', (_name, classes, combo, power) => {
    const r = resolveCombo(classes, CLASSES, Object.values(CONVERGENCES), CONVERGENCE.scaling);
    expect(r?.combo.id).toBe(combo);
    expect(r?.power).toBe(power);
  });

  it('the order of the living list does not matter', () => {
    const rng = createRng(6);
    for (const [, classes, combo, power] of COMPOSITIONS) {
      for (let i = 0; i < 10; i++) {
        const shuffled = [...classes].sort(() => rng.next() - 0.5);
        expect(resolve(shuffled)).toMatchObject({ combo: { id: combo }, power });
      }
    }
  });

  it('nobody alive → null', () => {
    expect(resolve([])).toBeNull();
  });

  it('no def matches → null', () => {
    expect(resolve([S], [METEOR])).toBeNull();
    expect(resolve([P, S], [])).toBeNull();
  });

  it('no data permutation changes any composition', () => {
    for (const defs of permutations(CONVERGENCE_DEFS)) {
      for (const [, classes, combo, power] of COMPOSITIONS) {
        expect(resolve(classes, defs)).toMatchObject({ combo: { id: combo }, power });
      }
    }
  });

  it('priority ties: more requirements first, then the lower id, in any data order', () => {
    const tiedFirestorm = { ...FIRESTORM, priority: 1 } as const satisfies ConvergenceDef;
    for (const defs of permutations([tiedFirestorm, METEOR, THUNDERSTORM])) {
      expect(resolve([P, S], defs)?.combo.id).toBe('firestorm');
    }
    const meteorOnStorm = { ...METEOR, requires: ['storm'] } as const satisfies ConvergenceDef;
    for (const defs of permutations([meteorOnStorm, THUNDERSTORM])) {
      expect(resolve([S], defs)?.combo.id).toBe('meteor');
    }
  });

  it('a higher priority beats a more specific combo', () => {
    const loudMeteor = { ...METEOR, priority: 20 } as const satisfies ConvergenceDef;
    expect(resolve([P, S], [FIRESTORM, loudMeteor, THUNDERSTORM])?.combo.id).toBe('meteor');
  });

  it('a death changes the result: P,S,S losing the P → Thunderstorm ×1.5 (GDD §10 Verify)', () => {
    expect(resolve([P, S, S])).toMatchObject({ combo: { id: 'firestorm' }, power: 2 });
    expect(resolve([S, S])).toMatchObject({ combo: { id: 'thunderstorm' }, power: 1.5 });
  });
});

describe('powerFor', () => {
  it('index = living mages − 1', () => {
    expect([1, 2, 3, 4].map((n) => powerFor(n, TUNING.scaling))).toEqual([1, 1.5, 2, 2.5]);
  });

  it('0 mages → null; more mages than the table → its last entry', () => {
    expect(powerFor(0, TUNING.scaling)).toBeNull();
    expect(powerFor(7, TUNING.scaling)).toBe(2.5);
  });

  it('throws on an empty table', () => {
    expect(() => powerFor(1, [])).toThrow(RangeError);
  });
});
