import { describe, expect, it } from 'vitest';
import { appendFallen, fallenWizard } from '@core/hatHill';
import { SAVE_VERSION, defaultSave, serializeSave } from '@core/save/save';
import {
  LocalStorageSaveRepository,
  SAVE_KEY,
  type KeyValueStorage,
} from '@platform/storage/LocalStorageSaveRepository';

/** An in-memory KeyValueStorage that can be told to throw. */
class FakeStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();
  throwOnGet = false;
  throwOnSet = false;
  reads = 0;

  getItem(key: string): string | null {
    this.reads++;
    if (this.throwOnGet) throw new Error('SecurityError');
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.throwOnSet) throw new Error('QuotaExceededError');
    this.items.set(key, value);
  }
}

const fallen = fallenWizard('Grimbald the Damp', 'stormcaller', 'dev-arena', 'volunteer');

describe('LocalStorageSaveRepository (M6 T9)', () => {
  it('uses SAVE_KEY', () => {
    expect(SAVE_KEY).toBe('arcane-fodder.save.v1');
    const storage = new FakeStorage();
    new LocalStorageSaveRepository(storage).save(defaultSave());
    expect([...storage.items.keys()]).toEqual([SAVE_KEY]);
  });

  it('nothing stored: defaults', () => {
    expect(new LocalStorageSaveRepository(new FakeStorage()).load()).toEqual(defaultSave());
  });

  it('round trip: a save written by one repository loads in the next (D4)', () => {
    const storage = new FakeStorage();
    const saved = appendFallen(defaultSave(), [fallen]);
    expect(new LocalStorageSaveRepository(storage).save(saved)).toBe(true);
    expect(new LocalStorageSaveRepository(storage).load()).toEqual(saved);
  });

  it('update appends through load and persists', () => {
    const storage = new FakeStorage();
    const repo = new LocalStorageSaveRepository(storage);
    const next = repo.update((s) => appendFallen(s, [fallen]));
    expect(next.hatHill).toEqual([fallen]);
    expect(new LocalStorageSaveRepository(storage).load().hatHill).toEqual([fallen]);
  });

  it('reads and migrates once, then serves the cache', () => {
    const storage = new FakeStorage();
    const repo = new LocalStorageSaveRepository(storage);
    repo.load();
    repo.load();
    expect(storage.reads).toBe(1);
  });

  it.each(['{', 'garbage', '[]', '"save"', 'null'])('garbage JSON %j: defaults', (raw) => {
    const storage = new FakeStorage();
    storage.items.set(SAVE_KEY, raw);
    expect(new LocalStorageSaveRepository(storage).load()).toEqual(defaultSave());
  });

  it('a partly broken save keeps what is valid', () => {
    const storage = new FakeStorage();
    storage.items.set(
      SAVE_KEY,
      JSON.stringify({ version: 1, settings: { gore: false }, hatHill: [fallen, { name: '' }] }),
    );
    const save = new LocalStorageSaveRepository(storage).load();
    expect(save.settings.gore).toBe(false);
    expect(save.hatHill).toEqual([fallen]);
  });

  it('missing storage: works in memory for the session, writes report false', () => {
    const repo = new LocalStorageSaveRepository(null);
    expect(repo.load()).toEqual(defaultSave());
    const saved = appendFallen(defaultSave(), [fallen]);
    expect(repo.save(saved)).toBe(false);
    expect(repo.load()).toEqual(saved);
  });

  it('getItem throws: defaults, no crash', () => {
    const storage = new FakeStorage();
    storage.throwOnGet = true;
    expect(new LocalStorageSaveRepository(storage).load()).toEqual(defaultSave());
  });

  it('setItem throws: false, counted, the session keeps the new save', () => {
    const storage = new FakeStorage();
    storage.throwOnSet = true;
    const repo = new LocalStorageSaveRepository(storage);
    const saved = appendFallen(defaultSave(), [fallen]);
    expect(repo.save(saved)).toBe(false);
    expect(repo.failedWrites).toBe(1);
    expect(repo.load()).toEqual(saved);
    expect(storage.items.size).toBe(0);
  });

  it('a custom key is honoured', () => {
    const storage = new FakeStorage();
    storage.items.set('other', serializeSave(appendFallen(defaultSave(), [fallen])));
    expect(new LocalStorageSaveRepository(storage, 'other').load().hatHill).toEqual([fallen]);
  });

  it('a save from a newer version is read but never overwritten (T7 review m1)', () => {
    const storage = new FakeStorage();
    const stored = JSON.stringify({
      version: SAVE_VERSION + 6,
      settings: { gore: false },
      hatHill: [fallen],
      futureField: { keep: true },
    });
    storage.items.set(SAVE_KEY, stored);
    const repo = new LocalStorageSaveRepository(storage);
    expect(repo.load().hatHill).toEqual([fallen]);
    expect(repo.load().settings.gore).toBe(false);
    expect(repo.canWrite).toBe(false);

    const next = repo.update((s) => appendFallen(s, [fallen]));
    expect(repo.save(next)).toBe(false);
    expect(repo.load().hatHill).toEqual([fallen, fallen]);
    expect(storage.items.get(SAVE_KEY)).toBe(stored);
    expect(repo.failedWrites).toBe(0);
  });

  it('a current or older save stays writable', () => {
    for (const version of [undefined, SAVE_VERSION]) {
      const storage = new FakeStorage();
      storage.items.set(SAVE_KEY, JSON.stringify({ version, hatHill: [] }));
      const repo = new LocalStorageSaveRepository(storage);
      expect(repo.canWrite).toBe(true);
      expect(repo.save(appendFallen(repo.load(), [fallen]))).toBe(true);
    }
    expect(new LocalStorageSaveRepository(new FakeStorage()).canWrite).toBe(true);
  });
});
