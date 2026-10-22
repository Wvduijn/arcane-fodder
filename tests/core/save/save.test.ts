import { describe, expect, it } from 'vitest';
import type { FallenWizard } from '@core/types';
import {
  DEFAULT_SETTINGS,
  SAVE_VERSION,
  canOverwrite,
  defaultSave,
  migrate,
  parseSave,
  readSave,
  serializeSave,
  type SaveData,
} from '@core/save/save';

const GRIMBALD: FallenWizard = {
  name: 'Grimbald the Damp',
  classId: 'stormcaller',
  missionId: 'dev-arena',
  cause: 'volunteer',
};

const full: SaveData = {
  version: 1,
  settings: { gore: false },
  bestTimes: { 'dev-arena': 93_500 },
  hatHill: [GRIMBALD, { ...GRIMBALD, name: 'Lazarus the Late', cause: 'combat' }],
};

describe('defaultSave', () => {
  it('version 1, gore on, no best times, empty Hat Hill', () => {
    expect(defaultSave()).toEqual({
      version: SAVE_VERSION,
      settings: { gore: true },
      bestTimes: {},
      hatHill: [],
    });
    expect(DEFAULT_SETTINGS.gore).toBe(true);
  });

  it('every call is a fresh object', () => {
    expect(defaultSave()).not.toBe(defaultSave());
  });
});

describe('migrate', () => {
  it('a valid V1 round-trips unchanged', () => {
    expect(migrate(full)).toEqual(full);
    expect(parseSave(serializeSave(full))).toEqual(full);
  });

  it.each([null, undefined, 0, 42, 'save', true, [], [full]])(
    'not an object (%j) → defaults',
    (raw) => {
      expect(migrate(raw)).toEqual(defaultSave());
    },
  );

  it('an empty object or a missing version reads as V1 with defaults', () => {
    expect(migrate({})).toEqual(defaultSave());
    expect(migrate({ ...full, version: undefined })).toEqual(full);
  });

  it('a newer version keeps what it can read', () => {
    expect(migrate({ ...full, version: 7, extra: { future: true } })).toEqual(full);
  });

  it('broken fields fall back one by one', () => {
    expect(migrate({ ...full, settings: 'loud' })).toEqual({ ...full, settings: { gore: true } });
    expect(migrate({ ...full, settings: { gore: 'yes' } }).settings).toEqual({ gore: true });
    expect(migrate({ ...full, bestTimes: [1, 2] }).bestTimes).toEqual({});
    expect(migrate({ ...full, hatHill: { 0: GRIMBALD } }).hatHill).toEqual([]);
  });

  it('drops only the broken Hat Hill entries, keeping the order', () => {
    const raw = {
      ...full,
      hatHill: [
        GRIMBALD,
        null,
        'hat',
        { ...GRIMBALD, name: '' },
        { ...GRIMBALD, name: '   ' },
        { ...GRIMBALD, name: 7 },
        { ...GRIMBALD, classId: 'necromancer' },
        { ...GRIMBALD, missionId: 'm99' },
        { ...GRIMBALD, cause: 'boredom' },
        { name: 'Half a wizard' },
        { ...GRIMBALD, name: 'Archibald the Once Fireproof', cause: 'left-behind' },
      ],
    };
    expect(migrate(raw).hatHill).toEqual([
      GRIMBALD,
      { ...GRIMBALD, name: 'Archibald the Once Fireproof', cause: 'left-behind' },
    ]);
  });

  it("reads the legacy cause 'volunteered' as 'volunteer'", () => {
    const raw = { ...full, hatHill: [{ ...GRIMBALD, cause: 'volunteered' }] };
    expect(migrate(raw).hatHill).toEqual([GRIMBALD]);
  });

  it('strips unknown fields from entries', () => {
    const raw = { ...full, hatHill: [{ ...GRIMBALD, hatColour: 'red' }] };
    expect(migrate(raw).hatHill).toEqual([GRIMBALD]);
  });

  it('drops broken or unknown best times only', () => {
    for (const bad of [0, -5, Number.NaN, '93', null]) {
      expect(migrate({ ...full, bestTimes: { 'dev-arena': bad } }).bestTimes).toEqual({});
    }
    expect(migrate({ ...full, bestTimes: { 'dev-arena': 5, m99: 3 } }).bestTimes).toEqual({
      'dev-arena': 5,
    });
  });

  it('keeps Goblin Woods best times and Hat Hill entries (M7), next to the dev arena', () => {
    const woods: FallenWizard = {
      ...GRIMBALD,
      missionId: 'm01-goblin-woods',
      cause: 'left-behind',
    };
    const raw = {
      ...full,
      bestTimes: { 'dev-arena': 5, 'm01-goblin-woods': 312_000 },
      hatHill: [GRIMBALD, woods],
    };
    expect(migrate(raw).bestTimes).toEqual({ 'dev-arena': 5, 'm01-goblin-woods': 312_000 });
    expect(migrate(raw).hatHill).toEqual([GRIMBALD, woods]);
  });

  it('never trusts the prototype chain', () => {
    const raw = JSON.parse('{"bestTimes": {"__proto__": 5, "toString": 3}}') as unknown;
    expect(migrate(raw).bestTimes).toEqual({});
  });
});

describe('parseSave', () => {
  it.each([null, '', '{', 'not json', 'undefined'])('%j → defaults', (json) => {
    expect(parseSave(json)).toEqual(defaultSave());
  });

  it('valid JSON goes through migrate', () => {
    expect(parseSave('{"settings":{"gore":false}}')).toEqual({
      ...defaultSave(),
      settings: { gore: false },
    });
    expect(parseSave('[]')).toEqual(defaultSave());
  });
});

describe('readSave and canOverwrite (T7 review m1)', () => {
  it('reports the stored version', () => {
    expect(readSave(serializeSave(full))).toEqual({ save: full, storedVersion: 1 });
    expect(readSave(JSON.stringify({ ...full, version: 7 }))).toEqual({
      save: full,
      storedVersion: 7,
    });
  });

  it.each([null, '', 'nope', '[]', '{}', '{"version":"2"}', '{"version":1.5}', '{"version":0}'])(
    '%j → no stored version',
    (json) => {
      expect(readSave(json).storedVersion).toBeNull();
    },
  );

  it('a save newer than this build must not be overwritten', () => {
    expect(canOverwrite(null)).toBe(true);
    expect(canOverwrite(SAVE_VERSION)).toBe(true);
    expect(canOverwrite(SAVE_VERSION + 1)).toBe(false);
  });
});
