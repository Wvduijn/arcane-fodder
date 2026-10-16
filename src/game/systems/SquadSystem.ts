import type Phaser from 'phaser';
import type {
  DeathCause,
  DeathVariantId,
  EntityId,
  MageClassId,
  MovementTuning,
  Rect,
  TrailTuning,
  Vec2,
} from '@core/types';
import type { IdAllocator } from '@core/ids';
import { clampToRect, insetRect, stepPosition } from '@core/math/movement';
import { attemptSeed, generateRecruitNames } from '@core/names/recruitNames';
import { createRng } from '@core/rng/rng';
import { stepSquad } from '@core/squad/follow';
import {
  createSquad,
  killSquadMembers,
  type SquadMember,
  type SquadState,
} from '@core/squad/squad';
import { DEV_SQUAD } from '@data/devArena';
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

export interface SquadSystemOptions {
  /** Restart number, 0 for the first try. Names use attemptSeed(nameSeed, attempt) (GDD Q17). */
  readonly attempt: number;
  /** The scene run's one allocator (shared with enemies), so ids stay unique and ascending (GDD §0). */
  readonly ids: IdAllocator;
  /** Class of each recruit, leader first. Squad size = its length. */
  readonly classes?: readonly MageClassId[];
  readonly nameSeed?: number;
  readonly trail?: TrailTuning;
  readonly movement?: MovementTuning;
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
 *
 * Walkable is the world inset by the sprite's extent above the feet at the top (so the whole
 * sprite stays on the map) and by the body radius on the other sides; leader and followers share
 * it. Recruits get seeded names, unique within the squad, kept here by id (presentation), and a
 * class each (DEV_SQUAD.classes, leader first) that picks the placeholder texture.
 */
export class SquadSystem implements System, LeaderSource, UnitLookup {
  /** The rect every wizard's feet are clamped to. */
  readonly walkable: Rect;
  private squad: SquadState;
  private readonly names: ReadonlyMap<EntityId, string>;
  private readonly classes: ReadonlyMap<EntityId, MageClassId>;
  private readonly sprites = new Map<EntityId, Phaser.GameObjects.Image>();
  /** Where each dead wizard fell (death puff, M8's dropped hat). */
  private readonly fallen = new Map<EntityId, Vec2>();
  private readonly trail: TrailTuning;
  private readonly movement: MovementTuning;

  constructor(
    scene: Phaser.Scene,
    private readonly input: GameInput,
    private readonly bus: EventBus,
    world: Rect,
    start: Vec2,
    options: SquadSystemOptions,
  ) {
    const classes = options.classes ?? DEV_SQUAD.classes;
    const size = classes.length;
    this.trail = options.trail ?? TRAIL;
    this.movement = options.movement ?? MOVEMENT;

    const body = this.movement.wizardBodyRadiusPx;
    this.walkable = insetRect(world, {
      top: CHARACTER_EXTENT_ABOVE_FEET_PX,
      right: body,
      bottom: body,
      left: body,
    });

    const recruits = classes.map((mageClass) => ({ id: options.ids.next(), mageClass }));
    const memberIds = recruits.map(({ id }) => id);
    const nameRng = createRng(attemptSeed(options.nameSeed ?? DEV_SQUAD.nameSeed, options.attempt));
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
    return this.squad.members.find((member) => member.id === id)?.position ?? this.fallen.get(id);
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
      { leaderPosition, walkable: this.walkable, dtMs: dt },
      this.trail,
      this.movement,
    );
    this.syncSprites();
  }

  /**
   * Kills every listed member on the same frame (debug keys, and CombatSystem with what core
   * resolved). The state is updated first, so listeners already see the new leader. Then
   * `unit:died` per death in ascending id order, and `squad:leader-changed` only when a survivor
   * was promoted; a wipe emits no leader change. Dead or unknown ids are ignored. Dead sprites are
   * removed (corpses and the dropped hat come in M8).
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
    for (const id of result.killed) {
      this.sprites.get(id)?.destroy();
      this.sprites.delete(id);
    }
    for (const id of result.killed) {
      const death = byId.get(id);
      if (!death) continue;
      const { cause, deathVariant, gibbed } = death;
      this.bus.emit('unit:died', { id, team: 'squad', cause, deathVariant, gibbed });
    }
    if (result.leaderChanged) this.bus.emit('squad:leader-changed', { id: result.newLeader });
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
    this.fallen.clear();
  }

  private syncSprites(): void {
    for (const member of this.squad.members) this.syncSprite(member);
  }

  /** Every wizard, the leader included, y-sorts by its feet. */
  private syncSprite({ id, position }: SquadMember): void {
    this.sprites.get(id)?.setPosition(position.x, position.y).setDepth(unitDepth(position.y));
  }
}
