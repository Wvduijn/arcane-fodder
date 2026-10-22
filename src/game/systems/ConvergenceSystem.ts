import type {
  ClassDef,
  ConvergenceDef,
  ConvergenceId,
  ConvergenceTuning,
  EntityId,
  MageClassId,
  SpellTuning,
  Vec2,
} from '@core/types';
import type { AreaBody } from '@core/combat/area';
import {
  channelPhase,
  createConvergence,
  pendingStrikeCount,
  startChannel,
  stepConvergence,
  type ChannelPhase,
  type ConvergenceContext,
  type ConvergenceIds,
  type ConvergenceState,
} from '@core/convergence/channel';
import { resolveCombo } from '@core/convergence/combo';
import { ConvergenceMeter } from '@core/convergence/meter';
import { createRng } from '@core/rng/rng';
import { CLASSES } from '@data/classes';
import { CONVERGENCE, CONVERGENCES } from '@data/convergences';
import { SPELL_TUNING } from '@data/spells';
import type { EventBus, GameEventListener } from '../bus/EventBus';
import type { ConvergenceHudSource } from '../hud/HudModel';
import type { GameInput } from '../input/GameInput';
import type { ChannelView, ConvergenceFxSource } from '../views/ConvergenceFxView';
import type { CombatSystem } from './CombatSystem';
import type { EnemyRoster, StructureRoster } from './EnemyRoster';
import type { SquadHold, SquadSystem } from './SquadSystem';
import type { System } from './System';
import type { ChannelGate } from './VolunteerSystem';

/** Debug readout (plan §7.4 overlay, D5) and DebugSnapshot's last release (T13). */
export interface ConvergenceDebug {
  readonly meter: number;
  readonly meterMax: number;
  readonly phase: ChannelPhase;
  /** Channel time so far, null when none runs. */
  readonly channelElapsedMs: number | null;
  /** The tracked, clamped aim while channelling. */
  readonly channelAim: Vec2 | null;
  readonly previewCombo: ConvergenceId | null;
  readonly pendingStrikes: number;
  readonly burningZones: number;
  readonly lastRelease: {
    readonly combo: ConvergenceId;
    readonly power: number;
    readonly at: Vec2;
  } | null;
  readonly channels: number;
  readonly denied: number;
  readonly cancelled: number;
  readonly impacts: number;
  readonly charged: number;
  readonly sourceId: EntityId;
  readonly reactionSourceId: EntityId;
}

export interface ConvergenceSystemOptions {
  /** Huts (M7): included with their footprint. None when omitted. */
  readonly structures?: StructureRoster;
  /** The run's two credit ids (from the run's allocator), so its strikes never charge (Q3). */
  readonly ids: ConvergenceIds;
  /** Seeds the barrage target picks. */
  readonly rngSeed: number;
  readonly defs?: Readonly<Record<ConvergenceId, ConvergenceDef>>;
  readonly tuning?: ConvergenceTuning;
  readonly spells?: SpellTuning;
  readonly classes?: Readonly<Record<MageClassId, ClassDef>>;
}

/**
 * Convergence (GDD §9, §10) on core's meter and channel. Frame order: after targeting, before
 * Volunteer! and spells (M6.md). Each frame: step core's channel and strikes (aim tracking and
 * clamp, release at the exact end time, Meteor's fall and burning ground, barrage timelines), then
 * take this frame's R/Space press with `GameInput.aimWorld` (world space; core clamps it).
 *
 * Every strike blast is `convergence:impact` and one area event through `CombatSystem.resolveArea`
 * (enemies only: Combust, keg triggers, gib caps and the frame's flush all apply); burning-ground
 * ticks go through `CombatSystem.applyAreaStatus`. The meter charges from `unit:damaged` and
 * `unit:died` (core skips the run's Convergence id: no snowballing, Q3). While the channel runs it
 * holds the squad ({@link SquadHold}: no walking, no autos) and gates spells and Volunteer!
 * ({@link ChannelGate}). Damage never cancels it (ADR 0005 Q1); a wipe does.
 */
export class ConvergenceSystem
  implements System, SquadHold, ChannelGate, ConvergenceHudSource, ConvergenceFxSource
{
  private state: ConvergenceState = createConvergence();
  private readonly meter: ConvergenceMeter;
  private readonly ctx: ConvergenceContext;
  private readonly defs: Readonly<Record<ConvergenceId, ConvergenceDef>>;
  private readonly classes: Readonly<Record<MageClassId, ClassDef>>;
  private debug: Pick<
    ConvergenceDebug,
    'lastRelease' | 'channels' | 'denied' | 'cancelled' | 'impacts' | 'charged'
  > = { lastRelease: null, channels: 0, denied: 0, cancelled: 0, impacts: 0, charged: 0 };

  constructor(
    private readonly input: GameInput,
    private readonly squad: SquadSystem,
    private readonly enemies: EnemyRoster,
    private readonly combat: CombatSystem,
    private readonly bus: EventBus,
    private readonly options: ConvergenceSystemOptions,
  ) {
    this.defs = options.defs ?? CONVERGENCES;
    this.classes = options.classes ?? CLASSES;
    const tuning = options.tuning ?? CONVERGENCE;
    this.meter = new ConvergenceMeter(tuning, options.ids.sourceId);
    this.ctx = {
      defs: Object.values(this.defs),
      classes: this.classes,
      tuning,
      spells: options.spells ?? SPELL_TUNING,
      ids: options.ids,
      rng: createRng(options.rngSeed),
    };
    bus.on('unit:damaged', this.handleDamaged);
    bus.on('unit:died', this.handleDied);
    bus.on('hut:destroyed', this.handleHutDestroyed);
    bus.on('portal:opened', this.handlePortalOpened);
  }

  /** The squad is held while the channel runs (GDD §10). */
  get held(): boolean {
    return this.state.channel !== null;
  }

  get channelling(): boolean {
    return this.state.channel !== null;
  }

  get meterFraction(): number {
    return this.meter.fraction;
  }

  get meterFull(): boolean {
    return this.meter.full;
  }

  get channel(): ChannelView | null {
    const { channel } = this.state;
    if (!channel) return null;
    return {
      wizards: this.squad.state.members,
      aim: channel.aim,
      previewCombo: this.previewCombo(),
      elapsedMs: channel.elapsedMs,
      channelMs: this.ctx.tuning.channelMs,
    };
  }

  classOf(id: EntityId): MageClassId {
    return this.squad.classOf(id);
  }

  get debugState(): ConvergenceDebug {
    const { channel } = this.state;
    return {
      ...this.debug,
      meter: this.meter.value,
      meterMax: this.meter.max,
      phase: channelPhase(this.state),
      channelElapsedMs: channel ? channel.elapsedMs : null,
      channelAim: channel ? { ...channel.aim } : null,
      previewCombo: channel ? this.previewCombo() : null,
      pendingStrikes: pendingStrikeCount(this.state),
      burningZones: this.state.zones.length,
      sourceId: this.options.ids.sourceId,
      reactionSourceId: this.options.ids.reactionSourceId,
    };
  }

  update(dt: number): void {
    const leader = this.leader();
    const aim = this.input.aimWorld;
    const step = stepConvergence(
      this.state,
      {
        dtMs: dt,
        leader,
        aim: aim ? { x: aim.x, y: aim.y } : null,
        livingClasses: this.livingClasses(),
        targets: this.targets(),
      },
      this.ctx,
    );
    this.state = step.state;
    if (step.cancelled) {
      this.debug = { ...this.debug, cancelled: this.debug.cancelled + 1 };
      this.bus.emit('convergence:cancelled', {});
    }
    if (step.released) {
      const { combo, power, at } = step.released;
      this.debug = { ...this.debug, lastRelease: { combo, power, at: { ...at } } };
      this.bus.emit('convergence:released', { combo, power, at });
    }
    for (const { combo, element, event } of step.blasts) {
      this.debug = { ...this.debug, impacts: this.debug.impacts + 1 };
      this.bus.emit('convergence:impact', {
        combo,
        element,
        at: event.centre,
        radiusPx: event.blast.radiusPx,
      });
      this.combat.resolveArea(event);
    }
    for (const burn of step.burns) {
      this.combat.applyAreaStatus(burn);
    }
    if (this.input.consume('convergence')) this.activate();
  }

  /** Debug C: the meter straight to full (`convergence:charged` once, as any fill). */
  fillMeter(): void {
    if (this.meter.fill()) this.charged();
  }

  destroy(): void {
    this.bus.off('unit:damaged', this.handleDamaged);
    this.bus.off('unit:died', this.handleDied);
    this.bus.off('hut:destroyed', this.handleHutDestroyed);
    this.bus.off('portal:opened', this.handlePortalOpened);
    this.state = createConvergence();
  }

  private activate(): void {
    const aim = this.input.aimWorld;
    const result = startChannel(
      this.state,
      {
        meterFull: this.meter.full,
        leader: this.leader(),
        aim: aim ? { x: aim.x, y: aim.y } : null,
      },
      this.ctx.spells,
    );
    const { outcome } = result;
    if (outcome.kind === 'denied') {
      this.debug = { ...this.debug, denied: this.debug.denied + 1 };
      this.bus.emit('convergence:denied', {});
      return;
    }
    if (outcome.kind !== 'started') return;
    this.state = result.state;
    this.meter.spend();
    this.debug = { ...this.debug, channels: this.debug.channels + 1 };
    this.bus.emit('convergence:channel-started', { leader: outcome.leader });
  }

  /** The combo the squad alive now would get: the preview ring's radius. */
  private previewCombo(): ConvergenceId | null {
    const resolved = resolveCombo(
      this.livingClasses(),
      this.classes,
      this.ctx.defs,
      this.ctx.tuning.scaling,
    );
    return resolved?.combo.id ?? null;
  }

  private leader(): { readonly id: EntityId; readonly position: Vec2 } | null {
    const leader = this.squad.state.members[0];
    return leader ? { id: leader.id, position: leader.position } : null;
  }

  private livingClasses(): MageClassId[] {
    return this.squad.state.members.map((member) => this.squad.classOf(member.id));
  }

  /** Living enemy units (huts in M7): what a barrage strike may pick. */
  private targets(): AreaBody[] {
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

  private charged(): void {
    this.debug = { ...this.debug, charged: this.debug.charged + 1 };
    this.bus.emit('convergence:charged', {});
  }

  private readonly handleDamaged: GameEventListener<'unit:damaged'> = (event) => {
    if (this.meter.onDamaged(event)) this.charged();
  };

  private readonly handleDied: GameEventListener<'unit:died'> = (event) => {
    if (this.meter.onDied(event)) this.charged();
  };

  /** +chargePerHutDestroyed (GDD §12). */
  private readonly handleHutDestroyed = (): void => {
    if (this.meter.onHutDestroyed()) this.charged();
  };

  /** +chargeOnPortalOpen at the start of the opening (GDD §13). */
  private readonly handlePortalOpened = (): void => {
    if (this.meter.onPortalOpened()) this.charged();
  };
}
