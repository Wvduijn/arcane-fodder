import type Phaser from 'phaser';
import type {
  CombatTuning,
  DeathCause,
  DeathVariantId,
  EntityId,
  MageClassId,
  MovementTuning,
  Rect,
  SpellTuning,
  TrailTuning,
  Vec2,
  VolunteerTuning,
} from '@core/types';
import type { IdAllocator } from '@core/ids';
import { clampToRect, insetRect, stepPosition } from '@core/math/movement';
import { attemptSeed, generateRecruitNames } from '@core/names/recruitNames';
import { createRng } from '@core/rng/rng';
import { stepSquad } from '@core/squad/follow';
import type { CollisionGrid } from '@core/world/collisionGrid';
import {
  createSquad,
  killSquadMembers,
  knockSquadMember,
  type SquadMember,
  type SquadState,
} from '@core/squad/squad';
import {
  activateVolunteer,
  createVolunteer,
  detonateFallen,
  stepVolunteers,
  type VolunteerOutcome,
  type VolunteerRequest,
  type VolunteerState,
  type VolunteerStep,
  type VolunteerStepInput,
} from '@core/squad/volunteer';
import { COMBAT } from '@data/combat';
import { MOVEMENT } from '@data/movement';
import { RECRUIT_NAMES } from '@data/names';
import { TRAIL } from '@data/trail';
import type { EventBus } from '../bus/EventBus';
import { unitDepth } from '../depths';
import type { LeaderSource, Positioned, UnitLookup } from '../entities/Positioned';
import type { GameInput } from '../input/GameInput';
import {
  CHARACTER_ANCHOR,
  CHARACTER_EXTENT_ABOVE_FEET_PX,
  PLACEHOLDER_WIZARD_SCALE,
  WizardTextures,
} from '../placeholders';
import type { System } from './System';

/** Followers spawn in a straight line below the leader. */
const SPAWN_BEHIND: Vec2 = { x: 0, y: 1 };

/** While `held`, nobody walks (Convergence channel, GDD §10); ConvergenceSystem implements it. */
export interface SquadHold {
  readonly held: boolean;
}

/** A squad-team unit in the world: a squad member or a sprinting volunteer (enemy targeting). */
export interface SquadUnit {
  readonly id: EntityId;
  readonly position: Vec2;
}

export interface SquadSystemOptions {
  /** Restart number, 0 for the first try. Names use attemptSeed(nameSeed, attempt) (GDD Q17). */
  readonly attempt: number;
  /** The scene run's one allocator (shared with enemies), so ids stay unique and ascending (GDD §0). */
  readonly ids: IdAllocator;
  /** Class of each recruit, leader first (MissionDef.squad). Squad size = its length. */
  readonly classes: readonly MageClassId[];
  /** MissionDef.nameSeed; restart n names with nameSeed + n (GDD Q17). */
  readonly nameSeed: number;
  readonly trail?: TrailTuning;
  readonly movement?: MovementTuning;
  readonly combat?: CombatTuning;
  /** Read every frame; never held when omitted. */
  readonly hold?: SquadHold;
  /** Map blockers and solids (M7): the leader slides, followers are pushed out. Open ground when omitted. */
  readonly collision?: CollisionGrid;
}

/** One wizard death as the killer resolved it. Debug kills: `combat`, `blood`, not gibbed. */
export interface SquadDeath {
  readonly id: EntityId;
  readonly cause: DeathCause;
  readonly deathVariant: DeathVariantId;
  readonly gibbed: boolean;
}

/**
 * The squad (GDD §1, §2). Core's {@link SquadState} is the one authoritative state: the leader
 * (index 0) moves from input (`stepPosition`, then the walkable clamp), followers move through
 * core's `stepSquad`, and deaths go through `killSquadMembers`. Sprites only mirror the state.
 * While {@link SquadHold} is held (a Convergence channel), core holds everyone in place.
 *
 * Volunteer! (GDD §11): core's {@link VolunteerState} lives here too, so every wizard in the world
 * has one owner. VolunteerSystem drives it ({@link volunteer}, {@link stepVolunteers}); a detached
 * volunteer leaves the roster and trail but keeps its sprite and stays a squad-team unit
 * ({@link units}, {@link positionOf}) that enemies can hit, until its `unit:died` in {@link kill}.
 *
 * Walkable is the world inset by the sprite's extent above the feet at the top (so the whole
 * sprite stays on the map) and by the body radius on the other sides; leader and followers share
 * it. Recruits get seeded names, unique within the squad, kept here by id (presentation), and a
 * class each (MissionDef.squad, leader first) that picks the placeholder texture.
 */
export class SquadSystem implements System, LeaderSource, UnitLookup {
  /** The rect every wizard's feet are clamped to. */
  readonly walkable: Rect;
  private squad: SquadState;
  private volunteers: VolunteerState = createVolunteer();
  /**
   * Last known feet of every detached volunteer still alive in the world: running, or detonated
   * and waiting for this frame's death flush.
   */
  private readonly detached = new Map<EntityId, Vec2>();
  private readonly hold: SquadHold | null;
  private readonly names: ReadonlyMap<EntityId, string>;
  private readonly classes: ReadonlyMap<EntityId, MageClassId>;
  private readonly sprites = new Map<EntityId, Phaser.GameObjects.Image>();
  /** Where each dead wizard fell (death puff, M8's dropped hat). */
  private readonly fallen = new Map<EntityId, Vec2>();
  private readonly trail: TrailTuning;
  private readonly movement: MovementTuning;
  private readonly combat: CombatTuning;
  private readonly collision: CollisionGrid | null;

  constructor(
    scene: Phaser.Scene,
    private readonly input: GameInput,
    private readonly bus: EventBus,
    world: Rect,
    start: Vec2,
    options: SquadSystemOptions,
  ) {
    const { classes } = options;
    const size = classes.length;
    this.trail = options.trail ?? TRAIL;
    this.movement = options.movement ?? MOVEMENT;
    this.combat = options.combat ?? COMBAT;
    this.hold = options.hold ?? null;
    this.collision = options.collision ?? null;

    const body = this.movement.wizardBodyRadiusPx;
    this.walkable = insetRect(world, {
      top: CHARACTER_EXTENT_ABOVE_FEET_PX,
      right: body,
      bottom: body,
      left: body,
    });

    const recruits = classes.map((mageClass) => ({ id: options.ids.next(), mageClass }));
    const memberIds = recruits.map(({ id }) => id);
    const nameRng = createRng(attemptSeed(options.nameSeed, options.attempt));
    const names = generateRecruitNames(nameRng, RECRUIT_NAMES, size);
    this.names = new Map(memberIds.map((id, i) => [id, names[i] ?? '']));
    this.classes = new Map(recruits.map(({ id, mageClass }) => [id, mageClass]));

    this.squad = createSquad(
      {
        ids: memberIds,
        leaderPosition: clampToRect(start, this.walkable, 0),
        behind: SPAWN_BEHIND,
      },
      this.trail,
    );

    for (const member of this.squad.members) {
      const sprite = scene.add
        .image(member.position.x, member.position.y, WizardTextures[this.classOf(member.id)])
        .setOrigin(CHARACTER_ANCHOR.x, CHARACTER_ANCHOR.y)
        .setScale(PLACEHOLDER_WIZARD_SCALE);
      this.sprites.set(member.id, sprite);
    }
    this.syncSprites();
  }

  /** Index 0, or null once the squad is wiped. */
  get leader(): Positioned | null {
    return this.squad.members[0] ?? null;
  }

  /** Read-only state for the debug overlay and automation. */
  get state(): SquadState {
    return this.squad;
  }

  get trailTuning(): TrailTuning {
    return this.trail;
  }

  /** Read-only volunteer state (cooldown, runners) for VolunteerSystem, the HUD and debug. */
  get volunteerState(): VolunteerState {
    return this.volunteers;
  }

  /** True while the hold source holds the squad. */
  get held(): boolean {
    return this.hold?.held === true;
  }

  /** Every squad-team unit in the world: the members in trail order, then sprinting volunteers. */
  get units(): readonly SquadUnit[] {
    const list: SquadUnit[] = this.squad.members.map(({ id, position }) => ({ id, position }));
    for (const [id, position] of this.detached) list.push({ id, position });
    return list;
  }

  nameOf(id: EntityId): string {
    return this.names.get(id) ?? '';
  }

  /** Class of any recruit of this run, alive or dead. */
  classOf(id: EntityId): MageClassId {
    const mageClass = this.classes.get(id);
    if (mageClass === undefined) throw new Error(`Unknown wizard ${String(id)}`);
    return mageClass;
  }

  /** Live sprite of a wizard, for views (hit flash). Undefined once it died. */
  spriteOf(id: EntityId): Phaser.GameObjects.Image | undefined {
    return this.sprites.get(id);
  }

  positionOf(id: EntityId): Readonly<Vec2> | undefined {
    return (
      this.squad.members.find((member) => member.id === id)?.position ??
      this.detached.get(id) ??
      this.fallen.get(id)
    );
  }

  /** True for a volunteer that left the squad and has not died yet. */
  isDetached(id: EntityId): boolean {
    return this.detached.has(id);
  }

  /**
   * An F press through core `activateVolunteer`: on `started` the picked follower leaves the
   * roster and the trail (its sprite stays), and starts sprinting. Events are the caller's.
   */
  volunteer(
    request: VolunteerRequest,
    tuning: VolunteerTuning,
    spells: SpellTuning,
  ): VolunteerOutcome {
    const result = activateVolunteer(
      this.volunteers,
      this.squad,
      request,
      tuning,
      spells,
      this.trail,
    );
    this.volunteers = result.state;
    this.squad = result.squad;
    if (result.outcome.kind === 'started') {
      this.detached.set(result.outcome.id, result.outcome.from);
    }
    return result.outcome;
  }

  /**
   * One frame of sprints through core `stepVolunteers`. A detonated volunteer keeps its sprite
   * where it went off until the caller's kill reaches {@link kill} in this frame's flush.
   */
  stepVolunteers(input: VolunteerStepInput, tuning: VolunteerTuning): VolunteerStep {
    const step = stepVolunteers(this.volunteers, input, tuning);
    this.volunteers = step.state;
    for (const runner of step.state.runners) {
      if (this.detached.has(runner.id)) this.detached.set(runner.id, runner.position);
    }
    for (const { id, at } of step.detonations) {
      if (this.detached.has(id)) this.detached.set(id, at);
    }
    for (const [id, position] of this.detached) this.syncSprite({ id, position });
    return step;
  }

  update(dt: number): void {
    const leader = this.squad.members[0];
    if (!leader) return;
    const stepped = stepPosition(
      leader.position,
      this.input.moveVector,
      this.movement.squadMoveSpeed,
      dt,
    );
    const leaderPosition = clampToRect(stepped, this.walkable, 0);
    this.squad = stepSquad(
      this.squad,
      {
        leaderPosition,
        walkable: this.walkable,
        dtMs: dt,
        held: this.held,
        ...(this.collision
          ? {
              collision: {
                grid: this.collision,
                bodyRadiusPx: this.movement.wizardBodyRadiusPx,
              },
            }
          : {}),
      },
      this.trail,
      this.movement,
    );
    this.syncSprites();
  }

  /**
   * Volunteers that died mid-sprint since the last step (core `detonateFallen`), taken off the
   * runners with a `death` detonation where they fell. Called just before the frame's death flush,
   * so the blast lands on the frame they fell and `volunteer:detonated` comes before `unit:died`.
   */
  detonateFallen(isAlive: (id: EntityId) => boolean): VolunteerStep {
    const step = detonateFallen(this.volunteers, isAlive);
    this.volunteers = step.state;
    return step;
  }

  /**
   * Kills every listed member and detached volunteer on the same frame (debug keys, and
   * CombatSystem with what core resolved). The state is updated first, so listeners already see
   * the new leader. Then `unit:died` per death in ascending id order, and `squad:leader-changed`
   * only when a survivor was promoted; a wipe emits no leader change. Dead or unknown ids are
   * ignored. Dead sprites are removed (corpses and the dropped hat come in M8). A volunteer killed
   * mid-sprint was already detonated by {@link detonateFallen} earlier in the same flush.
   */
  kill(deaths: readonly SquadDeath[]): void {
    const byId = new Map(deaths.map((death) => [death.id, death]));
    const before = this.squad.members;
    const result = killSquadMembers(this.squad, [...byId.keys()], this.trail);
    this.squad = result.state;
    for (const id of result.killed) {
      const position = before.find((member) => member.id === id)?.position;
      if (position) this.fallen.set(id, position);
    }
    const volunteers = [...byId.keys()].filter((id) => this.detached.has(id));
    for (const id of volunteers) {
      const position = this.detached.get(id);
      if (position) this.fallen.set(id, position);
      this.detached.delete(id);
    }
    const killed = [...result.killed, ...volunteers].sort((a, b) => a - b);
    for (const id of killed) {
      this.sprites.get(id)?.destroy();
      this.sprites.delete(id);
    }
    for (const id of killed) {
      const death = byId.get(id);
      if (!death) continue;
      const { cause, deathVariant, gibbed } = death;
      this.bus.emit('unit:died', { id, team: 'squad', cause, deathVariant, gibbed });
    }
    if (result.leaderChanged) this.bus.emit('squad:leader-changed', { id: result.newLeader });
  }

  /**
   * Starts an eased push on a living wizard, leader included (Kaboom, GDD §8), over
   * `knockbackMs`. Core's `stepSquad` plays it out: input or follow resume when it ends (M5 Q4).
   * No-op for dead or unknown ids.
   */
  knockBack(id: EntityId, direction: Vec2, distancePx: number): void {
    this.squad = knockSquadMember(this.squad, id, direction, distancePx, this.combat.knockbackMs);
  }

  /**
   * Debug T only (M5 Q5): the living squad stands in single file at `leaderPosition` (clamped to
   * walkable), followers toward `behind`, as at spawn. Ids, order and HP are unchanged; running
   * knockbacks are dropped.
   */
  teleport(leaderPosition: Vec2, behind: Vec2): void {
    const ids = this.squad.members.map((member) => member.id);
    if (ids.length === 0) return;
    this.squad = createSquad(
      { ids, leaderPosition: clampToRect(leaderPosition, this.walkable, 0), behind },
      this.trail,
    );
    this.syncSprites();
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
    this.fallen.clear();
    this.detached.clear();
    this.volunteers = createVolunteer();
  }

  private syncSprites(): void {
    for (const member of this.squad.members) this.syncSprite(member);
  }

  /** Every wizard, the leader included, y-sorts by its feet. */
  private syncSprite({ id, position }: Pick<SquadMember, 'id' | 'position'>): void {
    this.sprites.get(id)?.setPosition(position.x, position.y).setDepth(unitDepth(position.y));
  }
}
