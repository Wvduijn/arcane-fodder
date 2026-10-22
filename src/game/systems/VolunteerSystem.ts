import type { CollisionGrid } from '@core/world/collisionGrid';
import type {
  EntityId,
  FallenWizard,
  MissionId,
  SpellTuning,
  Vec2,
  VolunteerTuning,
} from '@core/types';
import type { AreaBody } from '@core/combat/area';
import { fallenWizard } from '@core/hatHill';
import { createRng, type Rng } from '@core/rng/rng';
import {
  pickBark,
  volunteerBlast,
  type Detonation,
  volunteerCooldownMs,
  type DetonationReason,
  type VolunteerRunner,
} from '@core/squad/volunteer';
import { VOLUNTEER_BARKS } from '@data/barks';
import { MOVEMENT } from '@data/movement';
import { SPELL_TUNING } from '@data/spells';
import { VOLUNTEER } from '@data/volunteer';
import type { EventBus } from '../bus/EventBus';
import type { VolunteerHudSource } from '../hud/HudModel';
import type { GameInput } from '../input/GameInput';
import type { CombatSystem } from './CombatSystem';
import type { EnemyRoster, StructureRoster } from './EnemyRoster';
import type { SquadSystem } from './SquadSystem';
import type { DeathFlushHook } from './StatusSystem';
import type { System } from './System';

/** Whether a Convergence channel runs right now (ConvergenceSystem implements it). */
export interface ChannelGate {
  readonly channelling: boolean;
}

/** Where fallen wizards go (Hat Hill, plan §7.4); the save repository implements it (D4). */
export interface HatHillRecorder {
  recordFallen(entry: FallenWizard): void;
}

/** One sprinting volunteer as views read it (bark bubble, fuse ring, target marker). */
export interface VolunteerRunnerView extends VolunteerRunner {
  readonly name: string;
  readonly bark: string;
}

/** Debug readout (plan §7.4 overlay). */
export interface VolunteerDebug {
  readonly cooldownRemainingMs: number;
  /** Only the leader left (a channel only denies the press). */
  readonly unavailable: boolean;
  readonly runners: readonly VolunteerRunnerView[];
  readonly started: number;
  readonly denied: number;
  readonly detonations: number;
  readonly lastDetonation: {
    readonly id: EntityId;
    readonly at: Vec2;
    readonly reason: DetonationReason;
  } | null;
  readonly hatHillRecorded: number;
}

export interface VolunteerSystemOptions {
  /** Seeds the bark pick (seeded, never the same line twice in a row: M6 Q5). */
  readonly barkSeed: number;
  /** Huts (M7): included with their footprint. None when omitted. */
  readonly structures?: StructureRoster;
  /** Map blockers and solids (M7): a runner touching one detonates. Open ground when omitted. */
  readonly collision?: CollisionGrid;
  readonly missionId: MissionId;
  readonly tuning?: VolunteerTuning;
  readonly spells?: SpellTuning;
  readonly barks?: readonly string[];
}

/**
 * Volunteer! (GDD §11) on core's volunteer.ts, whose state SquadSystem holds. Frame order: after
 * Convergence, before spells (M6.md), so a spell lost to the volunteer is lost on this frame's
 * re-derive. Each frame: step the sprints (core: arrival, enemy contact, fuse or death), then take
 * this frame's F press with `GameInput.aimWorld` (world space; core clamps it).
 *
 * A detonation is `volunteer:detonated`, then the Arcane Detonation as one area event through
 * `CombatSystem.resolveArea` (enemies only, lights kegs, credited to the volunteer so the meter
 * charges), then the volunteer's death through `CombatSystem.kill` with cause `volunteer`, so its
 * `unit:died` comes in this frame's flush. The runner's death cause is set to `volunteer` at
 * activation, so an enemy that kills it mid-sprint records the same cause; it then detonates where
 * it fell in {@link beforeDeathFlush}, on that frame. The Hat Hill entry (cause `volunteer`, M6
 * Q2) is recorded at once.
 */
export class VolunteerSystem implements System, VolunteerHudSource, DeathFlushHook {
  private readonly rng: Rng;
  private readonly tuning: VolunteerTuning;
  private readonly spells: SpellTuning;
  private readonly barks: readonly string[];
  private lastBark: number | null = null;
  private readonly barkOf = new Map<EntityId, string>();
  private debug: Omit<VolunteerDebug, 'cooldownRemainingMs' | 'unavailable' | 'runners'> = {
    started: 0,
    denied: 0,
    detonations: 0,
    lastDetonation: null,
    hatHillRecorded: 0,
  };

  constructor(
    private readonly input: GameInput,
    private readonly squad: SquadSystem,
    private readonly enemies: EnemyRoster,
    private readonly combat: CombatSystem,
    private readonly channel: ChannelGate,
    private readonly hatHill: HatHillRecorder,
    private readonly bus: EventBus,
    private readonly options: VolunteerSystemOptions,
  ) {
    this.rng = createRng(options.barkSeed);
    this.tuning = options.tuning ?? VOLUNTEER;
    this.spells = options.spells ?? SPELL_TUNING;
    this.barks = options.barks ?? VOLUNTEER_BARKS;
  }

  get volunteerUnavailable(): boolean {
    return this.squad.state.members.length < 2;
  }

  get volunteerCooldownRemainingMs(): number {
    return volunteerCooldownMs(this.squad.volunteerState);
  }

  get volunteerCooldownMs(): number {
    return this.tuning.cooldownMs;
  }

  get runners(): readonly VolunteerRunnerView[] {
    return this.squad.volunteerState.runners.map((runner) => ({
      ...runner,
      name: this.squad.nameOf(runner.id),
      bark: this.barkOf.get(runner.id) ?? '',
    }));
  }

  get debugState(): VolunteerDebug {
    return {
      ...this.debug,
      cooldownRemainingMs: this.volunteerCooldownRemainingMs,
      unavailable: this.volunteerUnavailable,
      runners: this.runners,
    };
  }

  update(dt: number): void {
    const step = this.squad.stepVolunteers(
      {
        dtMs: dt,
        isAlive: (id) => this.combat.isAlive(id),
        contacts: this.contacts(),
        runnerRadiusPx: MOVEMENT.wizardBodyRadiusPx,
        ...(this.options.collision ? { collision: this.options.collision } : {}),
      },
      this.tuning,
    );
    for (const detonation of step.detonations) this.detonate(detonation);
    if (this.input.consume('volunteer')) this.activate();
  }

  /**
   * Before the frame's death flush (StatusSystem): a runner killed mid-sprint goes off where it
   * fell on the same frame. Its death was recorded as `volunteer` (cause set at activation), so it
   * dies once, after `volunteer:detonated`.
   */
  beforeDeathFlush(): void {
    const step = this.squad.detonateFallen((id) => this.combat.isAlive(id));
    for (const detonation of step.detonations) this.detonate(detonation);
  }

  destroy(): void {
    this.barkOf.clear();
  }

  /**
   * `volunteer:detonated`, the Arcane Detonation through `resolveArea`, the volunteer's death
   * (a no-op when it already fell) and its Hat Hill entry.
   */
  private detonate(detonation: Detonation): void {
    const { id, at, reason } = detonation;
    const name = this.squad.nameOf(id);
    this.bus.emit('volunteer:detonated', { id, name, at });
    this.combat.resolveArea(volunteerBlast(detonation, this.tuning));
    this.combat.kill(id, 'volunteer');
    this.barkOf.delete(id);
    this.hatHill.recordFallen(
      fallenWizard(name, this.squad.classOf(id), this.options.missionId, 'volunteer'),
    );
    this.debug = {
      ...this.debug,
      detonations: this.debug.detonations + 1,
      lastDetonation: { id, at: { ...at }, reason },
      hatHillRecorded: this.debug.hatHillRecorded + 1,
    };
  }

  private activate(): void {
    const aim = this.input.aimWorld;
    const outcome = this.squad.volunteer(
      {
        channelRunning: this.channel.channelling,
        aim: aim ? { x: aim.x, y: aim.y } : null,
        // The aim is clamped into the arena, so the runner never leaves it.
        walkable: this.squad.walkable,
      },
      this.tuning,
      this.spells,
    );
    if (outcome.kind === 'denied') {
      this.debug = { ...this.debug, denied: this.debug.denied + 1 };
      this.bus.emit('volunteer:denied', {});
      return;
    }
    if (outcome.kind !== 'started') return;
    // However it dies from now on (fuse, contact, an enemy), it dies as a volunteer (GDD §11, §14).
    this.combat.setDeathCause(outcome.id, 'volunteer');
    const index = pickBark(this.barks.length, this.rng, this.lastBark);
    this.lastBark = index;
    const bark = this.barks[index] ?? '';
    this.barkOf.set(outcome.id, bark);
    this.debug = { ...this.debug, started: this.debug.started + 1 };
    this.bus.emit('volunteer:started', {
      id: outcome.id,
      name: this.squad.nameOf(outcome.id),
      bark,
      at: outcome.at,
    });
  }

  /** Living enemy units (huts in M7): what a sprinting volunteer goes off on touching. */
  private contacts(): AreaBody[] {
    const bodies: AreaBody[] = [];
    for (const id of this.enemies.ids()) {
      const position = this.enemies.positionOf(id);
      const def = this.enemies.defOf(id);
      if (!position || !def) continue;
      bodies.push({ id, position, bodyRadiusPx: def.bodyRadiusPx, alive: this.combat.isAlive(id) });
    }
    bodies.push(...(this.options.structures?.areaBodies() ?? []));
    return bodies;
  }
}
