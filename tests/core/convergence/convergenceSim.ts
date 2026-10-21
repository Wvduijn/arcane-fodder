/**
 * Headless M6 sim (T8, D1–D3): SpellSim's dev arena (squad, DEV_ENCOUNTER, DEV_KEG_PACK, DEV_KEGS,
 * idle enemies, no autos) plus the Convergence meter, channel and strikes and Volunteer!, in the
 * M6 frame order (M6.md "Frame order"):
 *   squad (held while channelling) → Convergence (strikes and burning ground, then the channel,
 *   then this frame's R press) → Volunteer (sprint and detonations, then this frame's F press) →
 *   Spell → Keg → knockback → the frame's deaths → slot derivation and `spell:lost`.
 * Every blast goes through `resolveAreaWithReactions` with SpellSim's handling (Combust, keg lights
 * before the keg step, knockback, one death flush). The meter is fed like ConvergenceSystem feeds it
 * from `unit:damaged` / `unit:died`: every landed hit with its credit (the event's source; each
 * reaction's own `sourceId`), every resolved death. A runner is marked `deathCause: 'volunteer'` at
 * activation, and runners killed in a frame detonate before its flush (volunteer.ts).
 * After each frame, statuses step (StatusSystem): Burning ticks hit through `applyHit` with the
 * applier's credit, so the meter sees them, and their kills get one more flush.
 */
import type { EnemyId, EntityId, MageClassId, Vec2 } from '@core/types';
import type { AreaBody } from '@core/combat/area';
import { applyAreaStatus } from '@core/combat/area';
import { applyHit } from '@core/combat/damage';
import { killUnit } from '@core/combat/death';
import { stepStatuses } from '@core/combat/status';
import { resolveAreaWithReactions, resolveUnitHit } from '@core/combat/reactions';
import {
  createConvergence,
  startChannel,
  stepConvergence,
  type ChannelOutcome,
  type ConvergenceBlast,
  type ConvergenceState,
  type Release,
} from '@core/convergence/channel';
import { ConvergenceMeter } from '@core/convergence/meter';
import { createRng, type Rng } from '@core/rng/rng';
import {
  activateVolunteer,
  createVolunteer,
  detonateFallen,
  stepVolunteers,
  volunteerBlast,
  type Detonation,
  type VolunteerOutcome,
  type VolunteerState,
} from '@core/squad/volunteer';
import { CLASSES } from '@data/classes';
import { GIBS } from '@data/combat';
import { STATUSES } from '@data/statuses';
import { CONVERGENCE, CONVERGENCES } from '@data/convergences';
import { DEV_SQUAD } from '@data/devArena';
import { ENEMIES } from '@data/enemies';
import { MOVEMENT } from '@data/movement';
import { SPELL_TUNING } from '@data/spells';
import { TRAIL } from '@data/trail';
import { VOLUNTEER } from '@data/volunteer';
import type { CastOutcome } from '@core/spells/caster';
import { SpellSim, type FrameInput, type Timed } from '../spells/spellSim';

export interface WizardHit {
  readonly target: EntityId;
  readonly dealt: number;
  readonly source: EntityId | null;
}

export class M6Sim extends SpellSim {
  readonly convergenceId: EntityId;
  readonly convergenceReactionId: EntityId;
  readonly meter: ConvergenceMeter;
  convergence: ConvergenceState = createConvergence();
  volunteer: VolunteerState = createVolunteer();
  /** Where the pointer is (world). */
  aim: Vec2 | null = null;

  readonly channelOutcomes: Timed<ChannelOutcome>[] = [];
  readonly released: Timed<Release>[] = [];
  readonly cancelled: number[] = [];
  readonly strikeBlasts: Timed<ConvergenceBlast>[] = [];
  readonly volunteerOutcomes: Timed<VolunteerOutcome>[] = [];
  readonly detonations: Timed<Detonation>[] = [];
  /** Every landed hit with dealt > 0 on a wizard. */
  readonly wizardHits: Timed<WizardHit>[] = [];
  /** `convergence:charged` times. */
  readonly charged: number[] = [];
  /** Every landed status tick, with its credit. */
  readonly ticks: Timed<WizardHit>[] = [];

  private readonly rng: Rng;
  private pressR = false;
  private pressF = false;

  constructor(
    dtMs: number,
    classes: readonly MageClassId[] = DEV_SQUAD.classes,
    seed = 1,
    enemyMaxHp: Partial<Record<EnemyId, number>> = {},
  ) {
    super(dtMs, classes, enemyMaxHp);
    this.rng = createRng(seed);
    this.convergenceId = this.ids.next();
    this.convergenceReactionId = this.ids.next();
    this.meter = new ConvergenceMeter(CONVERGENCE, this.convergenceId);
    this.hooks = {
      held: () => this.convergence.channel !== null,
      beforeSpells: (dtMs) => {
        this.convergenceStep(dtMs);
        this.volunteerStep(dtMs);
      },
      extraUnits: () => this.volunteer.runners.map((r) => ({ id: r.id, position: r.position })),
      credit: (hits, source) => {
        for (const h of hits) {
          const team = this.world.get(h.target)?.team;
          if (!h.landed || team === undefined) continue;
          if (team === 'squad' && h.dealt > 0) {
            this.wizardHits.push({
              t: this.t,
              value: { target: h.target, dealt: h.dealt, source },
            });
          }
          if (this.meter.onDamaged({ id: h.target, team, amount: h.dealt, source })) {
            this.charged.push(this.t);
          }
        }
      },
      onDeaths: (deaths) => {
        for (const d of deaths) if (this.meter.onDied(d)) this.charged.push(this.t);
      },
    };
  }

  /** One frame (SpellSim's order), then the status step and its flush. */
  override frame(input: FrameInput = {}): CastOutcome | null {
    const outcome = super.frame(input);
    for (const tick of stepStatuses(this.world, STATUSES, this.dtMs).ticks) {
      const hit = applyHit(this.world, tick.target, tick.hit, GIBS);
      if (!hit.landed) continue;
      this.ticks.push({
        t: this.t,
        value: { target: tick.target, dealt: hit.dealt, source: tick.hit.sourceId },
      });
      this.hooks.credit?.([hit], tick.hit.sourceId);
      if (hit.killed) this.pendingDeaths.push(hit.death);
    }
    this.flush();
    return outcome;
  }

  /** R/Space on the next frame. */
  pressConvergence(aim: Vec2): void {
    this.aim = aim;
    this.pressR = true;
  }

  /** F on the next frame. */
  pressVolunteer(aim: Vec2): void {
    this.aim = aim;
    this.pressF = true;
  }

  /** Living enemies as area bodies (barrage picks, volunteer contact). */
  enemyBodies(): AreaBody[] {
    return this.enemies.map((e) => ({
      id: e.id,
      position: e.position,
      bodyRadiusPx: ENEMIES[e.enemy].bodyRadiusPx,
      alive: this.world.isAlive(e.id),
    }));
  }

  private convergenceStep(dtMs: number): void {
    const step = stepConvergence(
      this.convergence,
      {
        dtMs,
        leader: this.leader,
        aim: this.aim,
        livingClasses: this.livingClasses(),
        targets: this.enemyBodies(),
      },
      {
        defs: Object.values(CONVERGENCES),
        classes: CLASSES,
        tuning: CONVERGENCE,
        spells: SPELL_TUNING,
        ids: { sourceId: this.convergenceId, reactionSourceId: this.convergenceReactionId },
        rng: this.rng,
      },
    );
    this.convergence = step.state;
    if (step.released) this.released.push({ t: this.t, value: step.released });
    if (step.cancelled) this.cancelled.push(this.t);
    for (const blast of step.blasts) {
      this.strikeBlasts.push({ t: this.t, value: blast });
      const r = resolveAreaWithReactions(blast.event, this.ctx());
      this.hooks.credit?.(r.area.hits, blast.event.sourceId);
      this.handle(r, r.area, true);
    }
    for (const burn of step.burns) {
      applyAreaStatus(burn, this.ctx().units, this.ctx());
    }
    if (this.pressR) {
      this.pressR = false;
      const r = startChannel(
        this.convergence,
        { meterFull: this.meter.full, leader: this.leader, aim: this.aim },
        SPELL_TUNING,
      );
      this.convergence = r.state;
      if (r.outcome.kind === 'started') this.meter.spend();
      this.channelOutcomes.push({ t: this.t, value: r.outcome });
    }
  }

  private volunteerStep(dtMs: number): void {
    const step = stepVolunteers(
      this.volunteer,
      {
        dtMs,
        isAlive: (id) => this.world.isAlive(id),
        contacts: this.enemyBodies(),
        runnerRadiusPx: MOVEMENT.wizardBodyRadiusPx,
      },
      VOLUNTEER,
    );
    this.volunteer = step.state;
    this.detonate(step.detonations, true);
    if (this.pressF) {
      this.pressF = false;
      const r = activateVolunteer(
        this.volunteer,
        this.squad,
        { channelRunning: this.convergence.channel !== null, aim: this.aim },
        VOLUNTEER,
        SPELL_TUNING,
        TRAIL,
      );
      this.volunteer = r.state;
      this.squad = r.squad;
      if (r.outcome.kind === 'started') this.world.setDeathCause(r.outcome.id, 'volunteer');
      this.volunteerOutcomes.push({ t: this.t, value: r.outcome });
    }
  }

  /** An enemy's attack landing on `target` (a goblin hitting the runner), then the flush. */
  enemyHit(enemy: EntityId, target: EntityId): void {
    const kind = this.enemies.find((e) => e.id === enemy)?.enemy;
    if (!kind) throw new Error(`No enemy ${String(enemy)}`);
    const r = resolveUnitHit(target, { ...ENEMIES[kind].attack, sourceId: enemy }, this.ctx());
    if (r.hit.killed) this.pendingDeaths.push(r.hit.death);
    this.handle(r, null, false);
    this.flush();
  }

  /** Runners killed this frame go off before the flush (volunteer.ts `detonateFallen`). */
  protected override flush(): void {
    const fallen = detonateFallen(this.volunteer, (id) => this.world.isAlive(id));
    this.volunteer = fallen.state;
    this.detonate(fallen.detonations, false);
    super.flush();
  }

  private detonate(detonations: readonly Detonation[], beforeStep: boolean): void {
    for (const d of detonations) {
      this.detonations.push({ t: this.t, value: d });
      const event = volunteerBlast(d, VOLUNTEER);
      const r = resolveAreaWithReactions(event, this.ctx());
      this.hooks.credit?.(r.area.hits, event.sourceId);
      this.handle(r, r.area, beforeStep);
      const death = killUnit(this.world, d.id, 'volunteer');
      if (death) this.pendingDeaths.push(death);
    }
  }
}
