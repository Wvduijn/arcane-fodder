import { canOverwrite, readSave, serializeSave, type SaveData } from '@core/save/save';
import type { SaveRepository } from '@game/save/SaveRepository';

/**
 * Storage key of the save. The `v1` is the storage format (one JSON document); the data version
 * lives inside it (`SaveData.version`) and core's `migrate` upgrades it on load, so the key only
 * changes if the format itself ever does.
 */
export const SAVE_KEY = 'arcane-fodder.save.v1';

/** The browser storage subset this repository uses (a test can pass a fake). */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * {@link SaveRepository} on `window.localStorage`, the only code in the game that touches browser
 * storage (CLAUDE.md). Every storage call is guarded: storage that is missing or throws (private
 * mode, disabled cookies, quota) degrades to an in-memory save for the session, never a crash. The
 * save is read and migrated once, on first `load`, and cached; writes go to the cache first. A save
 * written by a newer build (core `canOverwrite` false) is read as far as it matches but never
 * overwritten: this session keeps its changes in memory only.
 */
export class LocalStorageSaveRepository implements SaveRepository {
  private cached: SaveData | null = null;
  /** False when the stored save is newer than this build. Known after the first read. */
  private writable = true;
  private writeFailures = 0;

  constructor(
    private readonly storage: KeyValueStorage | null = browserStorage(),
    private readonly key: string = SAVE_KEY,
  ) {}

  /** Writes the platform refused this session (debug). */
  get failedWrites(): number {
    return this.writeFailures;
  }

  /** False when a newer build's save is stored, so this session never writes (debug). */
  get canWrite(): boolean {
    this.load();
    return this.writable;
  }

  load(): SaveData {
    if (!this.cached) {
      const { save, storedVersion } = readSave(this.read());
      this.cached = save;
      this.writable = canOverwrite(storedVersion);
    }
    return this.cached;
  }

  save(data: SaveData): boolean {
    this.load();
    this.cached = data;
    if (!this.storage || !this.writable) return false;
    try {
      this.storage.setItem(this.key, serializeSave(data));
      return true;
    } catch {
      this.writeFailures++;
      return false;
    }
  }

  update(change: (current: SaveData) => SaveData): SaveData {
    const next = change(this.load());
    this.save(next);
    return next;
  }

  private read(): string | null {
    if (!this.storage) return null;
    try {
      return this.storage.getItem(this.key);
    } catch {
      return null;
    }
  }
}

/** `window.localStorage`, or null where reading the property itself throws (sandboxed frames). */
function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
