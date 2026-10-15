/**
 * Seeded silly names for fresh recruits, "<first> the <epithet>" (M3 Q3).
 *
 * API:
 * - `generateRecruitNames(rng, table, count)`: `count` names. No first name and no epithet repeats
 *   within one call, so names are unique within the squad. Throws if the table can't supply `count`.
 * - `recruitNameCapacity(table)`: the largest `count` the table supports.
 * - `attemptSeed(baseSeed, attempt)`: the seed for a restart, base + attempt (GDD Q17).
 */
import type { RecruitNameTable } from '@core/types';
import type { Rng } from '@core/rng/rng';

/** Number of distinct first names or distinct epithets, whichever is smaller. */
export function recruitNameCapacity(table: RecruitNameTable): number {
  return Math.min(new Set(table.firstNames).size, new Set(table.epithets).size);
}

/**
 * Draws `count` names from `rng`. Duplicate entries in the table count once. The same rng state
 * and table always give the same names. Throws a RangeError if `count` is not a non-negative
 * integer or exceeds {@link recruitNameCapacity}.
 */
export function generateRecruitNames(rng: Rng, table: RecruitNameTable, count: number): string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`Recruit count must be a non-negative integer, got ${String(count)}`);
  }
  const capacity = recruitNameCapacity(table);
  if (count > capacity) {
    throw new RangeError(
      `The name table supplies ${String(capacity)} unique names, ${String(count)} requested`,
    );
  }
  const firsts = drawDistinct(rng, [...new Set(table.firstNames)], count);
  const epithets = drawDistinct(rng, [...new Set(table.epithets)], count);
  return firsts.map((first, i) => `${first} the ${epithets[i] ?? ''}`);
}

/** The name seed for restart number `attempt` (0 for the first try): base + attempt (GDD Q17). */
export function attemptSeed(baseSeed: number, attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new RangeError(`Attempt must be a non-negative integer, got ${String(attempt)}`);
  }
  return (baseSeed + attempt) >>> 0;
}

/** The first `count` entries of a partial Fisher-Yates shuffle of `pool` (which it reorders). */
function drawDistinct<T>(rng: Rng, pool: T[], count: number): T[] {
  for (let i = 0; i < count; i++) {
    const j = rng.int(i, pool.length - 1);
    const picked = pool[j] as T;
    pool[j] = pool[i] as T;
    pool[i] = picked;
  }
  return pool.slice(0, count);
}
