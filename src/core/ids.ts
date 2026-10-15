/**
 * EntityId allocation. One allocator per scene run hands out every id (wizards, enemies,
 * structures, projectiles), so ids are unique and ascending, which gives the GDD §0 resolve order.
 *
 * API:
 * - `createIdAllocator(firstId = 1)`: a fresh allocator. Ids start at 1, so 0 is never a valid id.
 * - `allocator.next()`: the next unused id.
 */
import type { EntityId } from '@core/types';

export interface IdAllocator {
  /** The next id: firstId, firstId + 1, ... Never repeats within this allocator. */
  next(): EntityId;
}

/** A fresh allocator whose first id is `firstId` (a positive integer). */
export function createIdAllocator(firstId = 1): IdAllocator {
  if (!Number.isSafeInteger(firstId) || firstId < 1) {
    throw new RangeError(`firstId must be a positive integer, got ${String(firstId)}`);
  }
  let nextId = firstId;
  return {
    next: () => nextId++ as EntityId,
  };
}
