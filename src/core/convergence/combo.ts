/**
 * Convergence combo resolution (plan §4.1, GDD §10). Pure lookup: which combo a squad gets and how
 * hard it hits, resolved from the wizards alive at the moment of the strike (GDD Q5).
 *
 * API:
 * - `resolveCombo(livingClasses, classes, convergences, scaling)`: `{ combo, power }`, or null when
 *   nobody is alive or no combo's `requires` are all present.
 *   1. `elements = unique(element of each living class)`.
 *   2. The candidates are the defs whose `requires` are all in `elements`.
 *   3. The winner is the highest `priority`. Ties (none in MVP data: Meteor and Thunderstorm share
 *      priority 1 but never both match without Firestorm) go to the def with more `requires`, then
 *      to the lowest `id` in string order, so reordering the data never changes the result.
 *   4. `power = scaling[livingMages − 1]`, the last entry for squads larger than the table. It
 *      multiplies damage only, never radius (GDD §10).
 * - `powerFor(livingMages, scaling)`: step 4 alone. Null for 0 mages. Throws on an empty table.
 *
 * Every member counts as a mage (all MVP classes are mages), so `livingMages` is
 * `livingClasses.length`, duplicates included.
 */
import type { ClassDef, ConvergenceDef, Element, MageClassId } from '@core/types';

export type ComboClasses = Readonly<Record<MageClassId, Pick<ClassDef, 'element'>>>;

export interface ResolvedCombo {
  readonly combo: ConvergenceDef;
  readonly power: number;
}

export function resolveCombo(
  livingClasses: readonly MageClassId[],
  classes: ComboClasses,
  convergences: readonly ConvergenceDef[],
  scaling: readonly number[],
): ResolvedCombo | null {
  const power = powerFor(livingClasses.length, scaling);
  if (power === null) return null;
  const elements = new Set<Element>(livingClasses.map((c) => classes[c].element));
  let best: ConvergenceDef | null = null;
  for (const def of convergences) {
    if (!def.requires.every((e) => elements.has(e))) continue;
    if (best === null || outranks(def, best)) best = def;
  }
  return best === null ? null : { combo: best, power };
}

export function powerFor(livingMages: number, scaling: readonly number[]): number | null {
  if (scaling.length === 0) throw new RangeError('Convergence scaling table is empty');
  if (livingMages < 1) return null;
  return scaling[Math.min(livingMages, scaling.length) - 1] ?? null;
}

/** Step 3: priority, then more requirements, then the lower id. */
function outranks(a: ConvergenceDef, b: ConvergenceDef): boolean {
  if (a.priority !== b.priority) return a.priority > b.priority;
  if (a.requires.length !== b.requires.length) return a.requires.length > b.requires.length;
  return a.id < b.id;
}
