/**
 * Powder keg state (GDD §8, readability §4): idle → fuse → spent. Kegs are neutral, have no HP and
 * are not in the CombatWorld; their blast is resolved by reactions.ts (`resolveKaboom`).
 *
 * API:
 * - `createKeg(id, position)`: an idle keg.
 * - `triggersKeg(element, kaboom)`: does a hit or area effect of this element light a keg
 *   (fire, storm, arcane; never physical, GDD Q6)? Only area events and reactions ever ask: autos
 *   never target or hit kegs (GDD Q12), so they never trigger one.
 * - `triggerKeg(keg, kaboom, options)`: an idle keg starts its fuse (`kaboom.fuseMs`); emit
 *   `keg:fuse-started`. A fusing or spent keg is returned unchanged (a second trigger does nothing).
 *   `started` says which happened.
 * - `stepKegs(kegs, dtMs)`: fuses count down. A fuse that has fully elapsed ends: the keg is spent
 *   and listed in `exploded` (ascending id); resolve each with `resolveKaboom`, then trigger the kegs
 *   it reports.
 * - `kegBodies(kegs, def)`: the kegs as area bodies for `bodiesInRadius` and Fireball flight.
 *   Only idle kegs count as `alive`, so area code lists only kegs that can still be lit. A fusing
 *   keg still stops a Fireball: pass `solidOnly: true` for that.
 *
 * Fuse timing: a keg is lit at the time of the frame it was hit, and its fuse lasts exactly `fuseMs`
 * from then (it goes off on the first frame at or after that, so a chain is `fuseMs` apart, within
 * one frame, and the ring shows for the full fuse, D5). A step's dt is the time *before* its frame,
 * so a keg lit in a frame before that frame's `stepKegs` (the Spell phase runs before the Keg phase)
 * must skip it: pass `{ beforeStep: true }`. Kegs lit after the step (Combat phase, the Kaboom
 * cascade) use the default.
 */
import type { DamageElement, EntityId, KaboomDef, KegDef, Vec2 } from '@core/types';
import type { AreaBody } from '@core/combat/area';

export type KegPhase = 'idle' | 'fuse' | 'spent';

export interface KegState {
  readonly id: EntityId;
  readonly position: Vec2;
  readonly phase: KegPhase;
  /** ms left on the fuse; 0 unless `phase` is `fuse`. */
  readonly fuseRemainingMs: number;
  /** Lit before this frame's step: that step's dt elapsed before the light, so it is skipped. */
  readonly skipNextStep: boolean;
}

export interface KegTriggerOptions {
  /** Lit in this frame, before this frame's `stepKegs`. Default false. */
  readonly beforeStep?: boolean;
}

export interface KegTrigger {
  readonly keg: KegState;
  /** True when this call lit the fuse. */
  readonly started: boolean;
}

export interface KegStep {
  /** Same order as given. */
  readonly kegs: readonly KegState[];
  /** Fuses that ended this step, ascending id, already spent. */
  readonly exploded: readonly KegState[];
}

/** Float slack for fuse timers built from summed frame deltas (not a tuning value). */
const EPSILON_MS = 1e-6;

export function createKeg(id: EntityId, position: Vec2): KegState {
  return { id, position, phase: 'idle', fuseRemainingMs: 0, skipNextStep: false };
}

export function triggersKeg(element: DamageElement, kaboom: KaboomDef): boolean {
  return kaboom.triggerElements.includes(element);
}

export function triggerKeg(
  keg: KegState,
  kaboom: KaboomDef,
  options: KegTriggerOptions = {},
): KegTrigger {
  if (keg.phase !== 'idle') return { keg, started: false };
  return {
    keg: {
      ...keg,
      phase: 'fuse',
      fuseRemainingMs: kaboom.fuseMs,
      skipNextStep: options.beforeStep ?? false,
    },
    started: true,
  };
}

export function stepKegs(kegs: readonly KegState[], dtMs: number): KegStep {
  if (dtMs <= 0) return { kegs, exploded: [] };
  const exploded: KegState[] = [];
  const next = kegs.map((keg) => {
    if (keg.phase !== 'fuse') return keg;
    if (keg.skipNextStep) return { ...keg, skipNextStep: false };
    const fuseRemainingMs = keg.fuseRemainingMs - dtMs;
    if (fuseRemainingMs > EPSILON_MS) return { ...keg, fuseRemainingMs };
    const spent: KegState = { ...keg, phase: 'spent', fuseRemainingMs: 0, skipNextStep: false };
    exploded.push(spent);
    return spent;
  });
  exploded.sort((a, b) => a.id - b.id);
  return { kegs: next, exploded };
}

export function kegBodies(
  kegs: readonly KegState[],
  def: KegDef,
  options: { readonly solidOnly?: boolean } = {},
): AreaBody[] {
  return kegs.map((keg) => ({
    id: keg.id,
    position: keg.position,
    bodyRadiusPx: def.bodyRadiusPx,
    alive: options.solidOnly ? keg.phase !== 'spent' : keg.phase === 'idle',
  }));
}
