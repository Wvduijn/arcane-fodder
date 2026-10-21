import { describe, expect, it } from 'vitest';
import { VOLUNTEER_BARKS } from '@data/barks';

/** M6 Q5 and readability §5c: 12 lines, each fits the bubble on one line. */
describe('VOLUNTEER_BARKS (M6-T1-T2 m2)', () => {
  it('has 12 lines', () => {
    expect(VOLUNTEER_BARKS).toHaveLength(12);
  });

  it('every line is at most 28 characters and not blank', () => {
    for (const bark of VOLUNTEER_BARKS) {
      expect(bark.length, bark).toBeLessThanOrEqual(28);
      expect(bark.trim(), bark).not.toBe('');
    }
  });

  it('has no duplicates', () => {
    expect(new Set(VOLUNTEER_BARKS).size).toBe(VOLUNTEER_BARKS.length);
  });
});
