/**
 * The versioned save model (plan §7.4, M6 Q2). Pure: the `platform/storage` repository reads and
 * writes the string, and nothing else touches storage.
 *
 * API:
 * - `SaveDataV1`, `Settings`: the current shape. `SaveData` is always the latest version.
 * - `SAVE_VERSION`: the version `serializeSave` writes.
 * - `defaultSave()`: a fresh save: default settings (gore on, GDD Q23), no best times, empty Hat Hill.
 * - `migrate(raw)`: any parsed value to the latest `SaveData`. Never throws. Tolerant, field by field:
 *   a missing or broken field falls back to its default, and only the broken entries of a list or
 *   map are dropped (one bad Hat Hill entry never loses the hill). Anything that isn't an object
 *   gives `defaultSave()`. A save without a version, or with version 1, reads as V1; so does a newer
 *   version, as far as its fields match (best effort, rather than wiping it). The legacy cause
 *   spelling `'volunteered'` (plan §7.4 draft) reads as `'volunteer'`.
 * - `parseSave(json)`: `migrate(JSON.parse(json))`; null, empty or invalid JSON gives `defaultSave()`.
 * - `readSave(json)`: `parseSave` plus `storedVersion`, the version the stored data claims (an
 *   integer ≥ 1), or null when there was none (no save, garbage, no or broken version field).
 * - `canOverwrite(storedVersion)`: false when the stored save is newer than this build
 *   (`> SAVE_VERSION`). The repository then keeps it read-only for the session: writing it back as
 *   V1 would lose the newer fields for good (T7 review m1). Null or older: true.
 * - `serializeSave(save)`: the JSON string to store.
 *
 * Unknown ids are dropped on load: a Hat Hill entry whose `missionId`, `classId` or `cause` is no
 * longer in types.ts disappears. So a mission id, once saved, stays in `MissionId` (M7 keeps
 * `'dev-arena'`), or a migration renames it here first.
 */
import type { DeathCause, FallenWizard, MageClassId, MissionId } from '@core/types';

export const SAVE_VERSION = 1;

export interface Settings {
  /** "Gore: on/off" (GDD §12a, Q23). Off: collapse plus a grey puff, no corpses, decals or gibs. */
  readonly gore: boolean;
}

export interface SaveDataV1 {
  readonly version: 1;
  readonly settings: Settings;
  /** Fastest victory per mission, in ms (pause excluded). Absent until the first win (M7). */
  readonly bestTimes: Readonly<Partial<Record<MissionId, number>>>;
  /** Oldest first. */
  readonly hatHill: readonly FallenWizard[];
}

export type SaveData = SaveDataV1;

export const DEFAULT_SETTINGS: Settings = { gore: true };

export function defaultSave(): SaveData {
  return { version: SAVE_VERSION, settings: DEFAULT_SETTINGS, bestTimes: {}, hatHill: [] };
}

export function migrate(raw: unknown): SaveData {
  if (!isRecord(raw)) return defaultSave();
  const { settings, bestTimes, hatHill } = raw;
  return {
    version: SAVE_VERSION,
    settings: settingsOf(settings),
    bestTimes: bestTimesOf(bestTimes),
    hatHill: hatHillOf(hatHill),
  };
}

export function parseSave(json: string | null): SaveData {
  if (json === null || json === '') return defaultSave();
  try {
    return migrate(JSON.parse(json));
  } catch {
    return defaultSave();
  }
}

export interface ReadSave {
  readonly save: SaveData;
  readonly storedVersion: number | null;
}

export function readSave(json: string | null): ReadSave {
  if (json === null || json === '') return { save: defaultSave(), storedVersion: null };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { save: defaultSave(), storedVersion: null };
  }
  return { save: migrate(raw), storedVersion: versionOf(raw) };
}

export function canOverwrite(storedVersion: number | null): boolean {
  return storedVersion === null || storedVersion <= SAVE_VERSION;
}

export function serializeSave(save: SaveData): string {
  return JSON.stringify(save);
}

// Exhaustive by type: adding a class, mission or cause to types.ts fails here until it is listed.
const CLASS_IDS: Readonly<Record<MageClassId, true>> = { pyromancer: true, stormcaller: true };
const MISSION_IDS: Readonly<Record<MissionId, true>> = {
  'dev-arena': true,
  'm01-goblin-woods': true,
};
const CAUSES: Readonly<Record<DeathCause, true>> = {
  combat: true,
  volunteer: true,
  'left-behind': true,
};
const LEGACY_CAUSES: Readonly<Record<'volunteered', DeathCause>> = { volunteered: 'volunteer' };

function settingsOf(raw: unknown): Settings {
  if (!isRecord(raw)) return DEFAULT_SETTINGS;
  const { gore } = raw;
  return { gore: typeof gore === 'boolean' ? gore : DEFAULT_SETTINGS.gore };
}

function bestTimesOf(raw: unknown): SaveData['bestTimes'] {
  if (!isRecord(raw)) return {};
  const out: Partial<Record<MissionId, number>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (
      isKey(MISSION_IDS, key) &&
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value > 0
    ) {
      out[key] = value;
    }
  }
  return out;
}

function hatHillOf(raw: unknown): FallenWizard[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry: unknown) => {
    const fallen = fallenOf(entry);
    return fallen ? [fallen] : [];
  });
}

function fallenOf(raw: unknown): FallenWizard | null {
  if (!isRecord(raw)) return null;
  const { name, classId, missionId, cause: rawCause } = raw;
  const cause = causeOf(rawCause);
  if (typeof name !== 'string' || name.trim() === '') return null;
  if (typeof classId !== 'string' || !isKey(CLASS_IDS, classId)) return null;
  if (typeof missionId !== 'string' || !isKey(MISSION_IDS, missionId)) return null;
  if (cause === null) return null;
  return { name, classId, missionId, cause };
}

function causeOf(raw: unknown): DeathCause | null {
  if (typeof raw !== 'string') return null;
  if (isKey(LEGACY_CAUSES, raw)) return LEGACY_CAUSES[raw];
  return isKey(CAUSES, raw) ? raw : null;
}

function versionOf(raw: unknown): number | null {
  if (!isRecord(raw)) return null;
  const { version } = raw;
  return typeof version === 'number' && Number.isInteger(version) && version >= 1 ? version : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKey<K extends string>(set: Readonly<Record<K, unknown>>, key: string): key is K {
  return Object.prototype.hasOwnProperty.call(set, key);
}
