/**
 * Mission run state (plan §4.4, GDD §14): phase, the paused-aware timer, kills, the record of lost
 * wizards, the defeat rule, the results and the best time. Objectives, portal and surge live in
 * their own modules; the mission system ties them together.
 *
 * Phases: `intro` (the camera pan; control not yet given, no time counts) → `playing` → `ended`.
 *
 * API:
 * - `createMission(missionId)`: `intro`, time 0, no kills, nobody lost.
 * - `beginPlay(state)`: the intro ended or was skipped: `playing`. A no-op otherwise.
 * - `tickMission(state, dtMs, paused)`: time runs only while `playing` and not paused (GDD §14:
 *   pause excluded), so the result's time is mission start (control) to the end.
 * - `recordDeath(state, death, wizard)`: one `unit:died` (or structure) record from the flush.
 *   An enemy *unit* (team `enemy`, no `structure`) is a kill; every enemy death is squad-credited
 *   (GDD §0), so Kaboom, Convergence and Volunteer! kills count too. A hut is never a kill. A
 *   wizard (team `squad`) joins `lost` with its death cause, in order of loss; pass its
 *   name and class as `wizard`. Neutral deaths and records after the end change nothing.
 * - `isDefeat(squadSize, runners)`: GDD §14: the squad is empty AND no volunteer is mid-sprint.
 * - `endMission(state, outcome)`: `ended` with that outcome; the clock stops. Once only: a second
 *   call (defeat after victory, the same frame) changes nothing.
 * - `bestTimeOf(previousMs, outcome, timeMs)`: a victory faster than the previous best (or the first
 *   victory) is a new best; a defeat never is and keeps the previous.
 * - `withBestTime(save, missionId, timeMs)`: the save with that best time, if it is better.
 * - `buildResult(state, input)`: the results screen input (MissionResult). `lost` is everyone lost
 *   in battle or as a volunteer (in order), then the left-behind wizards (cause `left-behind`, in
 *   the order given). Kills and targets as counted. Throws if the mission has not ended.
 */
import type {
  DeathCause,
  LostWizardRecord,
  MissionId,
  MissionOutcome,
  MissionResult,
  StructureId,
  Team,
  WizardRecord,
} from '@core/types';
import type { SaveData } from '@core/save/save';

export type MissionPhase = 'intro' | 'playing' | 'ended';

export interface MissionState {
  readonly missionId: MissionId;
  readonly phase: MissionPhase;
  readonly outcome: MissionOutcome | null;
  /** Pause excluded. */
  readonly timeMs: number;
  /** Enemy units only. */
  readonly kills: number;
  /** In order of loss (combat and volunteer). */
  readonly lost: readonly LostWizardRecord[];
}

/** What `recordDeath` needs from a death record (death.ts `DeathRecord`). */
export interface MissionDeath {
  readonly team: Team;
  readonly cause: DeathCause;
  readonly structure?: StructureId;
}

export interface ResultInput {
  readonly saved: readonly WizardRecord[];
  readonly leftBehind: readonly WizardRecord[];
  readonly targetsDestroyed: number;
  readonly targetsRequired: number;
  /** The stored best time before this run, or null. */
  readonly previousBestMs: number | null;
}

export interface BestTime {
  readonly bestTimeMs: number | null;
  readonly newBest: boolean;
}

export function createMission(missionId: MissionId): MissionState {
  return { missionId, phase: 'intro', outcome: null, timeMs: 0, kills: 0, lost: [] };
}

export function beginPlay(state: MissionState): MissionState {
  return state.phase === 'intro' ? { ...state, phase: 'playing' } : state;
}

export function tickMission(state: MissionState, dtMs: number, paused: boolean): MissionState {
  if (state.phase !== 'playing' || paused || dtMs <= 0) return state;
  return { ...state, timeMs: state.timeMs + dtMs };
}

export function recordDeath(
  state: MissionState,
  death: MissionDeath,
  wizard: WizardRecord | null,
): MissionState {
  if (state.phase === 'ended') return state;
  if (death.team === 'enemy') {
    return death.structure === undefined ? { ...state, kills: state.kills + 1 } : state;
  }
  if (death.team === 'squad' && wizard) {
    const lost: LostWizardRecord = {
      name: wizard.name,
      classId: wizard.classId,
      cause: death.cause,
    };
    return { ...state, lost: [...state.lost, lost] };
  }
  return state;
}

export function isDefeat(squadSize: number, runners: number): boolean {
  return squadSize === 0 && runners === 0;
}

export function endMission(state: MissionState, outcome: MissionOutcome): MissionState {
  return state.phase === 'ended' ? state : { ...state, phase: 'ended', outcome };
}

export function bestTimeOf(
  previousMs: number | null,
  outcome: MissionOutcome,
  timeMs: number,
): BestTime {
  if (outcome !== 'victory') return { bestTimeMs: previousMs, newBest: false };
  if (previousMs === null || timeMs < previousMs) return { bestTimeMs: timeMs, newBest: true };
  return { bestTimeMs: previousMs, newBest: false };
}

export function withBestTime(save: SaveData, missionId: MissionId, timeMs: number): SaveData {
  const previous = save.bestTimes[missionId] ?? null;
  if (!bestTimeOf(previous, 'victory', timeMs).newBest) return save;
  return { ...save, bestTimes: { ...save.bestTimes, [missionId]: timeMs } };
}

export function buildResult(state: MissionState, input: ResultInput): MissionResult {
  const outcome = state.outcome;
  if (state.phase !== 'ended' || outcome === null) {
    throw new RangeError('buildResult needs an ended mission');
  }
  const best = bestTimeOf(input.previousBestMs, outcome, state.timeMs);
  return {
    missionId: state.missionId,
    outcome,
    timeMs: state.timeMs,
    kills: state.kills,
    targetsDestroyed: input.targetsDestroyed,
    targetsRequired: input.targetsRequired,
    saved: input.saved.map(({ name, classId }) => ({ name, classId })),
    lost: [
      ...state.lost,
      ...input.leftBehind.map(({ name, classId }) => ({
        name,
        classId,
        cause: 'left-behind' as const,
      })),
    ],
    bestTimeMs: best.bestTimeMs,
    newBest: best.newBest,
  };
}
