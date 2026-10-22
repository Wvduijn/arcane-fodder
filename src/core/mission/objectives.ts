/**
 * Mission objectives (plan §4.4, GDD §13): progress by TargetId. MVP: destroy N huts.
 *
 * API:
 * - `createObjectives(defs)`: every objective at 0.
 * - `recordTarget(state, target)`: one target of that id destroyed (`hut:destroyed`). Counts toward
 *   the first objective for that target that isn't complete yet; a target no objective wants, or one
 *   past the count, changes nothing (`counted: false`). When counted, emit
 *   `mission:target-destroyed` with `progress` and `required` (all objectives together, so the
 *   portal lights rune `progress − 1`); `complete` is true on the step that completes them all.
 * - `targetsDestroyed(state)`, `targetsRequired(state)`: totals for the HUD ("Huts n/2") and results.
 * - `objectivesComplete(state)`: every objective met (a mission with none is complete).
 */
import type { ObjectiveDef, TargetId } from '@core/types';

export interface ObjectiveProgress {
  readonly def: ObjectiveDef;
  readonly done: number;
}

export interface ObjectivesState {
  readonly objectives: readonly ObjectiveProgress[];
}

export interface TargetRecord {
  readonly state: ObjectivesState;
  readonly counted: boolean;
  readonly progress: number;
  readonly required: number;
  /** All objectives met by this target. */
  readonly complete: boolean;
}

export function createObjectives(defs: readonly ObjectiveDef[]): ObjectivesState {
  return { objectives: defs.map((def) => ({ def, done: 0 })) };
}

export function recordTarget(state: ObjectivesState, target: TargetId): TargetRecord {
  // A Set, not `===`: with one TargetId in the MVP the comparison is constant to the type checker.
  const wanted: ReadonlySet<TargetId> = new Set([target]);
  const i = state.objectives.findIndex((o) => wanted.has(o.def.target) && o.done < o.def.count);
  if (i < 0) {
    return {
      state,
      counted: false,
      progress: targetsDestroyed(state),
      required: targetsRequired(state),
      complete: false,
    };
  }
  const next: ObjectivesState = {
    objectives: state.objectives.map((o, j) => (j === i ? { ...o, done: o.done + 1 } : o)),
  };
  return {
    state: next,
    counted: true,
    progress: targetsDestroyed(next),
    required: targetsRequired(next),
    complete: objectivesComplete(next),
  };
}

export function targetsDestroyed(state: ObjectivesState): number {
  return state.objectives.reduce((sum, o) => sum + o.done, 0);
}

export function targetsRequired(state: ObjectivesState): number {
  return state.objectives.reduce((sum, o) => sum + o.def.count, 0);
}

export function objectivesComplete(state: ObjectivesState): boolean {
  return state.objectives.every((o) => o.done >= o.def.count);
}
