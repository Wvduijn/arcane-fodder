/**
 * Hat Hill (plan §4.2, §7.4, GDD §14): one hat per lost wizard, kept in the save. The epitaph
 * ("Fell in battle" / "Volunteered." / "Left behind.") is view text derived from `cause`, never
 * stored. The screen itself is post-MVP; M6 records `volunteer` entries at detonation, M7 adds
 * `combat` entries at death and `left-behind` entries at extraction (CD Q7).
 *
 * API:
 * - `fallenWizard(name, classId, missionId, cause)`: one entry. Throws on an empty name (every
 *   recruit has one, recruitNames.ts).
 * - `appendFallen(save, fallen)`: a new save with the entries added at the end of the hill, in the
 *   given order (oldest first). The input save is not changed. No entries: the same save.
 */
import type { DeathCause, FallenWizard, MageClassId, MissionId } from '@core/types';
import type { SaveData } from '@core/save/save';

export function fallenWizard(
  name: string,
  classId: MageClassId,
  missionId: MissionId,
  cause: DeathCause,
): FallenWizard {
  if (name.trim() === '') throw new RangeError('A fallen wizard needs a name');
  return { name, classId, missionId, cause };
}

export function appendFallen(save: SaveData, fallen: readonly FallenWizard[]): SaveData {
  if (fallen.length === 0) return save;
  return { ...save, hatHill: [...save.hatHill, ...fallen] };
}
