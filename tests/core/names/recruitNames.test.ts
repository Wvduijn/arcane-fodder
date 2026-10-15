import { describe, expect, it } from 'vitest';
import type { RecruitNameTable } from '@core/types';
import { createRng } from '@core/rng/rng';
import { attemptSeed, generateRecruitNames, recruitNameCapacity } from '@core/names/recruitNames';
import { RECRUIT_NAMES } from '@data/names';

const table: RecruitNameTable = {
  firstNames: ['Grimbald', 'Mortimer', 'Aldous', 'Barnaby', 'Cuthbert', 'Eustace'],
  epithets: ['Damp', 'Mostly Fireproof', 'Unlucky', 'Late', 'Brave', 'Smouldering'],
};

const firstOf = (name: string): string => name.split(' the ')[0] ?? '';
const epithetOf = (name: string): string => name.split(' the ')[1] ?? '';

describe('generateRecruitNames', () => {
  it('formats names as "<first> the <epithet>" from the table', () => {
    for (const name of generateRecruitNames(createRng(1), table, 4)) {
      expect(name).toMatch(/^\S+ the .+$/);
      expect(table.firstNames).toContain(firstOf(name));
      expect(table.epithets).toContain(epithetOf(name));
    }
  });

  it('is deterministic: the same seed gives the same names', () => {
    const a = generateRecruitNames(createRng(77), RECRUIT_NAMES, 4);
    const b = generateRecruitNames(createRng(77), RECRUIT_NAMES, 4);
    expect(a).toEqual(b);
  });

  it('gives a fixed sequence for a given seed', () => {
    expect(generateRecruitNames(createRng(1), table, 4)).toEqual([
      'Barnaby the Smouldering',
      'Mortimer the Unlucky',
      'Cuthbert the Brave',
      'Eustace the Damp',
    ]);
  });

  it('never repeats a first name or an epithet within one call', () => {
    for (let seed = 0; seed < 200; seed++) {
      const names = generateRecruitNames(createRng(seed), RECRUIT_NAMES, 8);
      expect(new Set(names).size).toBe(8);
      expect(new Set(names.map(firstOf)).size).toBe(8);
      expect(new Set(names.map(epithetOf)).size).toBe(8);
    }
  });

  it('can use the whole table at capacity', () => {
    const names = generateRecruitNames(createRng(3), table, 6);
    expect(new Set(names.map(firstOf))).toEqual(new Set(table.firstNames));
    expect(new Set(names.map(epithetOf))).toEqual(new Set(table.epithets));
  });

  it('counts duplicate table entries once', () => {
    const dupes: RecruitNameTable = { firstNames: ['Ann', 'Ann', 'Bo'], epithets: ['X', 'Y', 'Z'] };
    expect(recruitNameCapacity(dupes)).toBe(2);
    const names = generateRecruitNames(createRng(9), dupes, 2);
    expect(new Set(names.map(firstOf))).toEqual(new Set(['Ann', 'Bo']));
  });

  it('throws when the table cannot supply the requested count', () => {
    expect(() => generateRecruitNames(createRng(1), table, 7)).toThrow(RangeError);
    const short: RecruitNameTable = { firstNames: ['A', 'B', 'C'], epithets: ['X'] };
    expect(() => generateRecruitNames(createRng(1), short, 2)).toThrow(
      /1 unique names, 2 requested/,
    );
  });

  it('throws on a negative or fractional count, and returns [] for 0', () => {
    expect(() => generateRecruitNames(createRng(1), table, -1)).toThrow(RangeError);
    expect(() => generateRecruitNames(createRng(1), table, 1.5)).toThrow(RangeError);
    expect(generateRecruitNames(createRng(1), table, 0)).toEqual([]);
  });

  it('does not mutate the table', () => {
    const copy = structuredClone(table);
    generateRecruitNames(createRng(1), table, 6);
    expect(table).toEqual(copy);
  });

  it('supplies a full dev squad from the shipped table', () => {
    expect(recruitNameCapacity(RECRUIT_NAMES)).toBeGreaterThanOrEqual(32);
  });
});

describe('attemptSeed', () => {
  it('is base + attempt', () => {
    expect(attemptSeed(1000, 0)).toBe(1000);
    expect(attemptSeed(1000, 3)).toBe(1003);
  });

  it('wraps to an unsigned 32-bit seed', () => {
    expect(attemptSeed(0xffffffff, 1)).toBe(0);
  });

  it('throws on a negative or fractional attempt', () => {
    expect(() => attemptSeed(1, -1)).toThrow(RangeError);
    expect(() => attemptSeed(1, 0.5)).toThrow(RangeError);
  });

  it('gives fresh recruits on a restart, and the same recruits for the same attempt', () => {
    const namesFor = (attempt: number) =>
      generateRecruitNames(createRng(attemptSeed(4242, attempt)), RECRUIT_NAMES, 4);
    expect(namesFor(1)).toEqual(namesFor(1));
    for (let attempt = 0; attempt < 20; attempt++) {
      expect(namesFor(attempt + 1)).not.toEqual(namesFor(attempt));
    }
  });
});
