import type { EntityId, MageClassId, MissionDef, MissionResult, WizardRecord } from '@core/types';
import { fallenWizard } from '@core/hatHill';
import {
  beginPlay,
  buildResult,
  createMission,
  endMission,
  isDefeat,
  recordDeath,
  tickMission,
  markDebugAssisted,
  saveBestTime,
  type MissionPhase,
  type MissionState,
} from '@core/mission/mission';
import {
  createObjectives,
  recordTarget,
  targetsDestroyed,
  targetsRequired,
  type ObjectivesState,
} from '@core/mission/objectives';
import type { EventBus, GameEventListener } from '../bus/EventBus';
import type { SaveRepository } from '../save/SaveRepository';
import type { System } from './System';
import type { HatHillRecorder } from './VolunteerSystem';

/** What the mission reads from the squad (SquadSystem and VolunteerSystem together). */
export interface MissionSquad {
  /** Living squad members (sprinting volunteers excluded). */
  readonly memberCount: number;
  /** Active volunteer runners. */
  readonly runnerIds: readonly EntityId[];
  nameOf(id: EntityId): string;
  classOf(id: EntityId): MageClassId;
}

/** Results appear this long after victory or defeat, enemies frozen in between (M7.md "my calls"). */
export const RESULTS_DELAY_MS = 1000;

export interface MissionDebug {
  readonly phase: MissionPhase;
  readonly timeMs: number;
  readonly kills: number;
  readonly lost: number;
  readonly targetsDestroyed: number;
  readonly targetsRequired: number;
  readonly outcome: string | null;
  readonly resultShown: boolean;
  readonly debugAssisted: boolean;
}

/**
 * The run of one mission (plan §4.4, GDD §13–§14) on core's mission and objective state:
 * intro → playing → ended, the timer (it only runs while playing; a paused scene doesn't step it,
 * so pause is excluded), kills (enemy units only), the lost record, objectives from `hut:destroyed`
 * (→ `mission:target-destroyed`), victory on `portal:extracted`, defeat when the squad is gone and
 * no volunteer runs. Hat Hill (CD Q7): combat deaths are written when they happen (volunteers by
 * VolunteerSystem at detonation), left-behind wizards at extraction. At the end: `mission:ended`,
 * the best time on a victory, and {@link RESULTS_DELAY_MS} later the result goes to `onResult`.
 *
 * Two frame slots: {@link update} first (timer), {@link lateStep} after the portal step (end checks
 * after the frame's deaths, GDD §2).
 */
export class MissionSystem implements System {
  private state: MissionState;
  private objectives: ObjectivesState;
  private saved: WizardRecord[] = [];
  private leftBehind: WizardRecord[] = [];
  private result: MissionResult | null = null;
  private sinceEndMs = 0;
  private resultShown = false;

  constructor(
    private readonly mission: MissionDef,
    private readonly squad: MissionSquad,
    private readonly hatHill: HatHillRecorder,
    private readonly saves: SaveRepository,
    private readonly bus: EventBus,
    private readonly onResult: (result: MissionResult) => void,
  ) {
    this.state = createMission(mission.id);
    this.objectives = createObjectives(mission.objectives);
    bus.on('unit:died', this.handleDied);
    bus.on('hut:destroyed', this.handleHutDestroyed);
    bus.on('portal:extracted', this.handleExtracted);
  }

  get phase(): MissionPhase {
    return this.state.phase;
  }

  get playing(): boolean {
    return this.state.phase === 'playing';
  }

  get targetsDestroyed(): number {
    return targetsDestroyed(this.objectives);
  }

  get targetsRequired(): number {
    return targetsRequired(this.objectives);
  }

  get debugState(): MissionDebug {
    return {
      phase: this.state.phase,
      timeMs: this.state.timeMs,
      kills: this.state.kills,
      lost: this.state.lost.length,
      targetsDestroyed: this.targetsDestroyed,
      targetsRequired: this.targetsRequired,
      outcome: this.state.outcome,
      resultShown: this.resultShown,
      debugAssisted: this.state.debugAssisted,
    };
  }

  /**
   * Debug shortcuts (H, O, I, U and the overlay's K, L, G, B, T, C, J): this run's victory saves
   * no best time and claims none.
   */
  markDebugAssisted(): void {
    this.state = markDebugAssisted(this.state);
  }

  /** The intro pan ended or was skipped: control and the timer start. */
  beginPlay(): void {
    this.state = beginPlay(this.state);
  }

  update(dt: number): void {
    this.state = tickMission(this.state, dt, false);
    if (this.state.phase !== 'ended' || this.resultShown || !this.result) return;
    this.sinceEndMs += dt;
    if (this.sinceEndMs < RESULTS_DELAY_MS) return;
    this.resultShown = true;
    this.onResult(this.result);
  }

  /** After the frame's deaths and the extraction check: defeat (GDD §14, M6 carry-over). */
  lateStep(): void {
    if (this.state.phase !== 'playing') return;
    if (isDefeat(this.squad.memberCount, this.squad.runnerIds.length)) this.end('defeat');
  }

  destroy(): void {
    this.bus.off('unit:died', this.handleDied);
    this.bus.off('hut:destroyed', this.handleHutDestroyed);
    this.bus.off('portal:extracted', this.handleExtracted);
    this.saved = [];
    this.leftBehind = [];
    this.result = null;
  }

  private end(outcome: 'victory' | 'defeat'): void {
    this.state = endMission(this.state, outcome);
    const previousBestMs = this.saves.load().bestTimes[this.mission.id] ?? null;
    // Core keeps a debug-assisted run's stored best and never writes one (M7 gate n2).
    this.result = buildResult(this.state, {
      saved: this.saved,
      leftBehind: this.leftBehind,
      targetsDestroyed: this.targetsDestroyed,
      targetsRequired: this.targetsRequired,
      previousBestMs,
    });
    // Written only when core changed it (an unassisted, faster victory): no storage write otherwise.
    const current = this.saves.load();
    const next = saveBestTime(current, this.state);
    if (next !== current) this.saves.save(next);
    this.sinceEndMs = 0;
    this.bus.emit('mission:ended', { result: outcome });
  }

  private record(id: EntityId): WizardRecord {
    return { name: this.squad.nameOf(id), classId: this.squad.classOf(id) };
  }

  private readonly handleDied: GameEventListener<'unit:died'> = ({ id, team, cause }) => {
    if (this.state.phase === 'ended') return;
    const wizard = team === 'squad' ? this.record(id) : null;
    this.state = recordDeath(this.state, { team, cause }, wizard);
    // Volunteers are written by VolunteerSystem at detonation; combat deaths here (CD Q7).
    if (wizard && cause === 'combat') {
      this.hatHill.recordFallen(
        fallenWizard(wizard.name, wizard.classId, this.mission.id, 'combat'),
      );
    }
  };

  private readonly handleHutDestroyed: GameEventListener<'hut:destroyed'> = ({ target, at }) => {
    const step = recordTarget(this.objectives, target);
    this.objectives = step.state;
    if (!step.counted) return;
    this.bus.emit('mission:target-destroyed', {
      target,
      progress: step.progress,
      required: step.required,
      at,
    });
  };

  private readonly handleExtracted: GameEventListener<'portal:extracted'> = ({
    saved,
    leftBehind,
  }) => {
    if (this.state.phase !== 'playing') return;
    this.saved = saved.map((id) => this.record(id));
    this.leftBehind = leftBehind.map((id) => this.record(id));
    for (const wizard of this.leftBehind) {
      this.hatHill.recordFallen(
        fallenWizard(wizard.name, wizard.classId, this.mission.id, 'left-behind'),
      );
    }
    this.end('victory');
  };
}
