import { describe, expect, it } from 'vitest';
import type { EntityId } from '@core/types';
import {
  selectTarget,
  shouldRetarget,
  type TargetCandidate,
  type TargetKind,
} from '@core/targeting/selectTarget';
import { CLASSES } from '@data/classes';
import { COMBAT } from '@data/combat';

const ORIGIN = { x: 0, y: 0 };
const RANGE = CLASSES.pyromancer.attack.rangePx;

const c = (
  n: number,
  x: number,
  y = 0,
  kind: TargetKind = 'unit',
  alive = true,
): TargetCandidate => ({
  id: n as EntityId,
  position: { x, y },
  kind,
  alive,
});

describe('selectTarget', () => {
  it('picks the nearest living unit in range', () => {
    expect(selectTarget(ORIGIN, RANGE, [c(1, 100), c(2, 50), c(3, -70)])).toBe(2);
  });

  it('measures distance to the centre, in 2D', () => {
    expect(selectTarget(ORIGIN, RANGE, [c(1, 60, 60), c(2, 0, -80)])).toBe(2);
  });

  it('breaks ties by the lowest EntityId, whatever the list order', () => {
    expect(selectTarget(ORIGIN, RANGE, [c(9, 50), c(4, -50), c(7, 0, 50)])).toBe(4);
    expect(selectTarget(ORIGIN, RANGE, [c(4, -50), c(9, 50)])).toBe(4);
  });

  it('includes a candidate exactly at range, excludes one just beyond', () => {
    expect(selectTarget(ORIGIN, RANGE, [c(1, RANGE)])).toBe(1);
    expect(selectTarget(ORIGIN, RANGE, [c(1, RANGE + 0.001)])).toBeNull();
  });

  it('skips dead candidates, even when nearer (D4)', () => {
    expect(selectTarget(ORIGIN, RANGE, [c(1, 10, 0, 'unit', false), c(2, 90)])).toBe(2);
    expect(selectTarget(ORIGIN, RANGE, [c(1, 10, 0, 'unit', false)])).toBeNull();
  });

  it('returns null with no candidates', () => {
    expect(selectTarget(ORIGIN, RANGE, [])).toBeNull();
  });

  it('prefers any unit in range over a nearer structure', () => {
    expect(selectTarget(ORIGIN, RANGE, [c(1, 20, 0, 'structure'), c(2, 170)])).toBe(2);
  });

  it('falls back to the nearest structure when no unit is in range (huts, M7)', () => {
    const list = [c(1, 120, 0, 'structure'), c(2, 300), c(3, 60, 0, 'structure')];
    expect(selectTarget(ORIGIN, RANGE, list)).toBe(3);
  });

  it('skips a dead structure in the fallback', () => {
    expect(selectTarget(ORIGIN, RANGE, [c(1, 50, 0, 'structure', false)])).toBeNull();
  });

  it('never picks a keg, even when it is the only thing in range (GDD Q12)', () => {
    expect(selectTarget(ORIGIN, RANGE, [c(1, 10, 0, 'keg')])).toBeNull();
    expect(selectTarget(ORIGIN, RANGE, [c(1, 10, 0, 'keg'), c(2, 100)])).toBe(2);
  });

  it('has no limit with an infinite range (goblin with no leash)', () => {
    expect(selectTarget(ORIGIN, Number.POSITIVE_INFINITY, [c(1, 5000), c(2, 4000)])).toBe(2);
  });
});

describe('shouldRetarget', () => {
  const R = COMBAT.retargetMs;

  it('waits for the interval while the target is valid', () => {
    expect(shouldRetarget(0, R, true)).toBe(false);
    expect(shouldRetarget(R - 1, R, true)).toBe(false);
    expect(shouldRetarget(R, R, true)).toBe(true);
  });

  it('retargets at once when the target died or there is none', () => {
    expect(shouldRetarget(0, R, false)).toBe(true);
  });
});
