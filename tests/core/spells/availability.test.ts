import { describe, expect, it } from 'vitest';
import type { MageClassId, SpellId } from '@core/types';
import {
  createSpellSlotReader,
  lostSpells,
  spellSlots,
  type SpellSlot,
  type SpellSlotSpells,
} from '@core/spells/availability';
import { createRng } from '@core/rng/rng';
import { CLASSES } from '@data/classes';
import { SPELLS as SPELL_DATA } from '@data/spells';

// Slot numbers as GDD §4 fixes them (slot 1 Fireball, slot 2 Lightning).
const SPELLS = {
  fireball: { id: 'fireball', slot: 1 },
  lightning: { id: 'lightning', slot: 2 },
} as const satisfies SpellSlotSpells;

const P: MageClassId = 'pyromancer';
const S: MageClassId = 'stormcaller';
const slots = (living: readonly MageClassId[]) => spellSlots(living, CLASSES, SPELLS);
const available = (s: readonly SpellSlot[]) => s.filter((x) => x.available).map((x) => x.spell);

/** Removes one member of a class (a death or a Volunteer! activation). */
const without = (living: readonly MageClassId[], cls: MageClassId): MageClassId[] => {
  const i = living.indexOf(cls);
  return i < 0 ? [...living] : [...living.slice(0, i), ...living.slice(i + 1)];
};

describe('spellSlots', () => {
  const compositions: [string, MageClassId[], SpellId[]][] = [
    ['P', [P], ['fireball']],
    ['S', [S], ['lightning']],
    ['PP', [P, P], ['fireball']],
    ['SS', [S, S], ['lightning']],
    ['PS', [P, S], ['fireball', 'lightning']],
    ['PPS', [P, P, S], ['fireball', 'lightning']],
    ['PSS', [P, S, S], ['fireball', 'lightning']],
    ['PPSS', [P, P, S, S], ['fireball', 'lightning']],
  ];

  it.each(compositions)('%s: slot state matches the classes present', (_, living, expected) => {
    const s = slots(living);
    expect(s.map((x) => [x.slot, x.spell])).toEqual([
      [1, 'fireball'],
      [2, 'lightning'],
    ]);
    expect(available(s)).toEqual(expected);
  });

  it('keeps slot numbers fixed whatever the order of the living list', () => {
    expect(slots([S, P])).toEqual(slots([P, S]));
    expect(slots([S, S])).toEqual([
      { slot: 1, spell: 'fireball', available: false },
      { slot: 2, spell: 'lightning', available: true },
    ]);
  });

  it('the spell data gives the same slots as the GDD (slot 1 Fireball, slot 2 Lightning)', () => {
    expect(spellSlots([P, S], CLASSES, SPELL_DATA)).toEqual(slots([P, S]));
  });

  it('a wiped squad has both slots, both unavailable', () => {
    expect(available(slots([]))).toEqual([]);
    expect(slots([])).toHaveLength(2);
  });

  it('orders by slot, not by the order of the data record', () => {
    const reversed = { lightning: SPELLS.lightning, fireball: SPELLS.fireball };
    expect(spellSlots([P], CLASSES, reversed).map((x) => x.spell)).toEqual([
      'fireball',
      'lightning',
    ]);
  });

  it('throws when two spells share a slot', () => {
    const clash = { ...SPELLS, lightning: { id: 'lightning', slot: 1 } } as const;
    expect(() => spellSlots([P], CLASSES, clash)).toThrow(RangeError);
    expect(() => createSpellSlotReader(CLASSES, clash)).toThrow(RangeError);
  });
});

describe('lostSpells', () => {
  /** Plays out removals one at a time, collecting what each step loses. */
  const play = (start: MageClassId[], removals: MageClassId[]) => {
    let living = start;
    let before = slots(living);
    const lost: SpellId[][] = [];
    for (const cls of removals) {
      living = without(living, cls);
      const after = slots(living);
      lost.push(lostSpells(before, after));
      before = after;
    }
    return lost;
  };

  it('P,S,P,S losing two members, either order, keeps both spells', () => {
    expect(play([P, S, P, S], [P, S])).toEqual([[], []]);
    expect(play([P, S, P, S], [S, P])).toEqual([[], []]);
  });

  it('P,P,S,S losing both Stormcallers loses Lightning once, on the second', () => {
    expect(play([P, P, S, S], [S, S])).toEqual([[], ['lightning']]);
  });

  it('the last Pyromancer dying loses Fireball once; later deaths never repeat it', () => {
    expect(play([P, S, P, S], [P, P, S, S])).toEqual([[], ['fireball'], [], ['lightning']]);
  });

  it('two classes dying out on the same frame report both, in slot order', () => {
    expect(lostSpells(slots([S, P]), slots([]))).toEqual(['fireball', 'lightning']);
  });

  it('no change, no loss', () => {
    expect(lostSpells(slots([P, S]), slots([P, S]))).toEqual([]);
  });

  it('a lost spell never comes back: seeded random kill orders of PPSS', () => {
    const rng = createRng(5);
    for (let run = 0; run < 200; run++) {
      let living: MageClassId[] = [P, P, S, S];
      let before = slots(living);
      const lostSoFar = new Set<SpellId>();
      while (living.length > 0) {
        const i = Math.floor(rng.next() * living.length);
        living = [...living.slice(0, i), ...living.slice(i + 1)];
        const after = slots(living);
        for (const spell of lostSpells(before, after)) {
          expect(lostSoFar.has(spell)).toBe(false);
          lostSoFar.add(spell);
        }
        for (const spell of lostSoFar) expect(available(after)).not.toContain(spell);
        before = after;
      }
      expect([...lostSoFar].sort()).toEqual(['fireball', 'lightning']);
    }
  });
});

describe('createSpellSlotReader', () => {
  it('returns the same array until the composition changes', () => {
    const read = createSpellSlotReader(CLASSES, SPELLS);
    const a = read([P, S, P, S]);
    expect(read([S, P])).toBe(a);
    expect(read([P, S, S])).toBe(a);
    const b = read([S, S]);
    expect(b).not.toBe(a);
    expect(available(b)).toEqual(['lightning']);
    expect(read([S])).toBe(b);
    expect(read([])).not.toBe(b);
  });
});
