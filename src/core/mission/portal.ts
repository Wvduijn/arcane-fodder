/**
 * The portal (GDD §13): sealed → opening → open → extracted.
 *
 * - sealed: visible from the start with `runeCount` dark runes; walking onto it does nothing.
 *   `lightRune` lights the next rune (left to right) per `mission:target-destroyed`.
 * - opening: the last rune lit (or `openPortal`, the debug key). `opened: true` on that call:
 *   emit `portal:opened`, start the final surge and charge the meter (`chargeOnPortalOpen`). It
 *   lasts `PortalTuning.openingMs`; still not enterable.
 * - open: `stepPortal` returns `enterable: true` on the step the opening ends. From then on
 *   `checkExtraction` triggers when the leader's centre is within `triggerRadiusPx` (≤).
 * - extracted: the split is made once; the mission ends in victory. Nothing changes after.
 *
 * Extraction split (GDD §13, Q8): at the trigger, every squad member whose centre is within the
 * mission's `extraction.radiusPx` (≤, centre to centre) is saved; every other member is left
 * behind, and so is every active volunteer runner, wherever it stands (it isn't in the squad,
 * GDD §11). Saved and left behind keep the order they were given in (squad order, then runners).
 * Check it after the frame's deaths (GDD §2: a leader who dies on the trigger frame doesn't count),
 * with the runners still sprinting after that flush: a runner that detonated or died this frame is
 * already on Hat Hill as `volunteer` and must not be left behind as well (`input.isAlive` filters).
 * Runners are the only ones that can be alive outside the squad, so `leftBehind` never repeats a
 * death.
 *
 * API: `createPortal(position, runeCount)`, `lightRune(state)`, `openPortal(state, tuning)`,
 * `stepPortal(state, dtMs)`, `checkExtraction(state, input)`, `extractionSplit(centre, radiusPx,
 * members, runners)`, `isEnterable(state)`.
 */
import type { EntityId, PortalTuning, Vec2 } from '@core/types';
import { distance } from '@core/math/vec2';

export type PortalPhase = 'sealed' | 'opening' | 'open' | 'extracted';

export interface PortalState {
  readonly position: Vec2;
  readonly phase: PortalPhase;
  readonly runeCount: number;
  readonly runesLit: number;
  /** ms left of the opening; 0 outside it. */
  readonly openingLeftMs: number;
}

export interface PortalChange {
  readonly state: PortalState;
  /** The opening started on this call: emit `portal:opened`. */
  readonly opened: boolean;
}

export interface ExtractionMember {
  readonly id: EntityId;
  readonly position: Vec2;
}

export interface ExtractionSplit {
  readonly saved: readonly EntityId[];
  readonly leftBehind: readonly EntityId[];
}

export interface ExtractionInput {
  /** The squad, leader first; empty when wiped. */
  readonly members: readonly ExtractionMember[];
  /**
   * Active volunteer runners: always left behind. Pass the runners after the frame's death flush;
   * `isAlive` drops any that died or detonated this frame anyway, so a volunteer is never also
   * recorded as left behind (review M7-T11 m1).
   */
  readonly runners: readonly EntityId[];
  /** CombatWorld liveness. Default: every listed runner is alive. */
  readonly isAlive?: (id: EntityId) => boolean;
  readonly tuning: PortalTuning;
  /** MissionDef.extraction.radiusPx. */
  readonly radiusPx: number;
}

export interface ExtractionCheck {
  readonly state: PortalState;
  /** The split, on the frame the leader reaches the portal; null otherwise. */
  readonly extraction: ExtractionSplit | null;
}

/** Float slack for the opening timer (not a tuning value). */
const EPSILON_MS = 1e-6;

export function createPortal(position: Vec2, runeCount: number): PortalState {
  return { position, phase: 'sealed', runeCount, runesLit: 0, openingLeftMs: 0 };
}

/** Lights the next rune; the last one starts the opening. A no-op unless sealed. */
export function lightRune(state: PortalState, tuning: PortalTuning): PortalChange {
  if (state.phase !== 'sealed' || state.runesLit >= state.runeCount) {
    return { state, opened: false };
  }
  const lit: PortalState = { ...state, runesLit: state.runesLit + 1 };
  return lit.runesLit >= lit.runeCount ? openPortal(lit, tuning) : { state: lit, opened: false };
}

/** Starts the opening now (last rune, or the debug key). A no-op unless sealed. */
export function openPortal(state: PortalState, tuning: PortalTuning): PortalChange {
  if (state.phase !== 'sealed') return { state, opened: false };
  return {
    state: {
      ...state,
      phase: 'opening',
      runesLit: state.runeCount,
      openingLeftMs: tuning.openingMs,
    },
    opened: true,
  };
}

export function stepPortal(
  state: PortalState,
  dtMs: number,
): { readonly state: PortalState; readonly enterable: boolean } {
  if (state.phase !== 'opening' || dtMs <= 0) return { state, enterable: false };
  const openingLeftMs = state.openingLeftMs - dtMs;
  if (openingLeftMs > EPSILON_MS) return { state: { ...state, openingLeftMs }, enterable: false };
  return { state: { ...state, phase: 'open', openingLeftMs: 0 }, enterable: true };
}

export function isEnterable(state: PortalState): boolean {
  return state.phase === 'open';
}

export function checkExtraction(state: PortalState, input: ExtractionInput): ExtractionCheck {
  const leader = input.members[0];
  if (state.phase !== 'open' || !leader) return { state, extraction: null };
  if (distance(leader.position, state.position) > input.tuning.triggerRadiusPx) {
    return { state, extraction: null };
  }
  const alive = input.isAlive;
  return {
    state: { ...state, phase: 'extracted' },
    extraction: extractionSplit(
      state.position,
      input.radiusPx,
      input.members,
      alive ? input.runners.filter(alive) : input.runners,
    ),
  };
}

export function extractionSplit(
  centre: Vec2,
  radiusPx: number,
  members: readonly ExtractionMember[],
  runners: readonly EntityId[],
): ExtractionSplit {
  const saved: EntityId[] = [];
  const leftBehind: EntityId[] = [];
  const running = new Set(runners);
  for (const m of members) {
    if (!running.has(m.id) && distance(m.position, centre) <= radiusPx) saved.push(m.id);
    else leftBehind.push(m.id);
  }
  for (const id of runners) if (!leftBehind.includes(id)) leftBehind.push(id);
  return { saved, leftBehind };
}
