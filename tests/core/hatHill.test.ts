import { describe, expect, it } from 'vitest';
import { appendFallen, fallenWizard } from '@core/hatHill';
import { defaultSave, parseSave, serializeSave } from '@core/save/save';

describe('fallenWizard', () => {
  it('builds the Hat Hill entry shape: name, class, mission, cause (D1, D4)', () => {
    expect(fallenWizard('Grimbald the Damp', 'stormcaller', 'dev-arena', 'volunteer')).toEqual({
      name: 'Grimbald the Damp',
      classId: 'stormcaller',
      missionId: 'dev-arena',
      cause: 'volunteer',
    });
  });

  it('stores no epitaph: it is derived from the cause', () => {
    const entry = fallenWizard('Lazarus the Late', 'pyromancer', 'dev-arena', 'combat');
    expect(Object.keys(entry).sort()).toEqual(['cause', 'classId', 'missionId', 'name']);
  });

  it('throws on an empty name', () => {
    expect(() => fallenWizard('  ', 'pyromancer', 'dev-arena', 'combat')).toThrow(RangeError);
  });
});

describe('appendFallen', () => {
  const a = fallenWizard('Grimbald the Damp', 'stormcaller', 'dev-arena', 'volunteer');
  const b = fallenWizard('Lazarus the Late', 'pyromancer', 'dev-arena', 'volunteer');

  it('adds entries at the end, in order, without changing the input', () => {
    const save = defaultSave();
    const once = appendFallen(save, [a]);
    const twice = appendFallen(once, [b]);
    expect(save.hatHill).toEqual([]);
    expect(once.hatHill).toEqual([a]);
    expect(twice.hatHill).toEqual([a, b]);
    expect(twice.settings).toBe(save.settings);
  });

  it('no entries: the same save', () => {
    const save = defaultSave();
    expect(appendFallen(save, [])).toBe(save);
  });

  it('survives a save round-trip (what the repository stores and reloads)', () => {
    const save = appendFallen(defaultSave(), [a, b]);
    expect(parseSave(serializeSave(save))).toEqual(save);
  });
});
