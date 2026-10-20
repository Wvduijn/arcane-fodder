/**
 * Derived spell availability (GDD §4, §5): `available = unique(grantsSpell of each living class)`.
 * Nothing stores "has Fireball"; slots are recomputed from the squad's living classes.
 *
 * API:
 * - `spellSlots(livingClasses, classes, spells)`: one slot per spell in data, in slot order (slot 1
 *   first), each `{ slot, spell, available }`. A spell is available while at least one living
 *   member's class grants it. A slot keeps its number whoever is left (only Stormcallers: slot 1 is
 *   Fireball, unavailable; slot 2 is Lightning). Throws on two spells sharing a slot (data error).
 * - `lostSpells(before, after)`: spells available in `before` and not in `after`, in slot order.
 *   Emit `spell:lost` for each. Diffing consecutive derivations gives each spell once: once lost it
 *   is unavailable in every later derivation, because the squad only shrinks in a mission (no
 *   recruitment in the MVP, GDD §5).
 * - `createSpellSlotReader(classes, spells)`: `spellSlots`, memoised on the composition (the set of
 *   living classes): the same array object comes back until a class dies out, so a HUD can compare
 *   by reference. Order and duplicates of the input do not matter.
 *
 * Decisions: slots come from `SpellDef.slot`, not from class order at runtime, so they never shift
 * when a class dies out (D3). Volunteer! (M6) removes the member from the living list on activation,
 * which is all this module needs.
 */
import type { ClassDef, MageClassId, SpellDef, SpellId } from '@core/types';

export interface SpellSlot {
  readonly slot: SpellDef['slot'];
  readonly spell: SpellId;
  readonly available: boolean;
}

export type SpellSlotClasses = Readonly<Record<MageClassId, Pick<ClassDef, 'grantsSpell'>>>;
export type SpellSlotSpells = Readonly<Record<SpellId, Pick<SpellDef, 'id' | 'slot'>>>;

export function spellSlots(
  livingClasses: readonly MageClassId[],
  classes: SpellSlotClasses,
  spells: SpellSlotSpells,
): readonly SpellSlot[] {
  const granted = new Set(livingClasses.map((c) => classes[c].grantsSpell));
  return ordered(spells).map((def) => ({
    slot: def.slot,
    spell: def.id,
    available: granted.has(def.id),
  }));
}

export function lostSpells(before: readonly SpellSlot[], after: readonly SpellSlot[]): SpellId[] {
  const stillAvailable = new Set(after.filter((s) => s.available).map((s) => s.spell));
  return before.filter((s) => s.available && !stillAvailable.has(s.spell)).map((s) => s.spell);
}

export function createSpellSlotReader(
  classes: SpellSlotClasses,
  spells: SpellSlotSpells,
): (livingClasses: readonly MageClassId[]) => readonly SpellSlot[] {
  ordered(spells);
  let key: string | null = null;
  let cached: readonly SpellSlot[] = [];
  return (livingClasses) => {
    const next = [...new Set(livingClasses)].sort().join(',');
    if (next !== key) {
      key = next;
      cached = spellSlots(livingClasses, classes, spells);
    }
    return cached;
  };
}

/** Spells in slot order. Throws on a shared slot. */
function ordered(spells: SpellSlotSpells): Pick<SpellDef, 'id' | 'slot'>[] {
  const list = Object.values(spells).sort((a, b) => a.slot - b.slot);
  list.forEach((def, i) => {
    const prev = list[i - 1];
    if (prev?.slot === def.slot) {
      throw new RangeError(`Spells ${prev.id} and ${def.id} share slot ${String(def.slot)}`);
    }
  });
  return list;
}
