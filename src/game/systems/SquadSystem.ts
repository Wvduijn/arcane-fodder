import type Phaser from 'phaser';
import type { DeathCause, EntityId, MovementTuning, Rect, TrailTuning, Vec2 } from '@core/types';
import { createIdAllocator } from '@core/ids';
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
import type { LeaderSource, Positioned } from '../entities/Positioned';
import type { GameInput } from '../input/GameInput';
import {
  CHARACTER_ANCHOR,
  CHARACTER_EXTENT_ABOVE_FEET_PX,
  PLACEHOLDER_WIZARD_SCALE,
  PlaceholderTextures,
} from '../placeholders';
import type { System } from './System';

/** Followers spawn in a straight line below the leader. */
const SPAWN_BEHIND: Vec2 = { x: 0, y: 1 };

export interface SquadSystemOptions {
  /** Restart number, 0 for the first try. Names use attemptSeed(nameSeed, attempt) (GDD Q17). */
  readonly attempt: number;
  readonly size?: number;
  readonly nameSeed?: number;
  readonly trail?: TrailTuning;
  readonly movement?: MovementTuning;
}

/**
 * The squad (GDD §1, §2). Core's {@link SquadState} is the one authoritative state: the leader
 * (index 0) moves from input (`stepPosition`, then the walkable clamp), followers move through
 * core's `stepSquad`, and deaths go through `killSquadMembers`. Sprites only mirror the state.
 *
 * Walkable is the world inset by the sprite's extent above the feet at the top (so the whole
 * sprite stays on the map) and by the body radius on the other sides; leader and followers share
 * it. Recruits get seeded names, unique within the squad, kept here by id (presentation).
 */
export class SquadSystem implements System, LeaderSource {
  /** The rect every wizard's feet are clamped to. */
  readonly walkable: Rect;
  private squad: SquadState;
  private readonly names: ReadonlyMap<EntityId, string>;
  private readonly sprites = new Map<EntityId, Phaser.GameObjects.Image>();
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
    const size = options.size ?? DEV_SQUAD.size;
    this.trail = options.trail ?? TRAIL;
    this.movement = options.movement ?? MOVEMENT;

    const body = this.movement.wizardBodyRadiusPx;
    this.walkable = insetRect(world, {
      top: CHARACTER_EXTENT_ABOVE_FEET_PX,
      right: body,
      bottom: body,
      left: body,
    });

    // One allocator per scene run, so ids restart at 1 and stay ascending (GDD §0).
    const ids = createIdAllocator();
    const memberIds = Array.from({ length: size }, () => ids.next());
    const nameRng = createRng(attemptSeed(options.nameSeed ?? DEV_SQUAD.nameSeed, options.attempt));
    const names = generateRecruitNames(nameRng, RECRUIT_NAMES, size);
    this.names = new Map(memberIds.map((id, i) => [id, names[i] ?? '']));

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
        .image(member.position.x, member.position.y, PlaceholderTextures.Wizard)
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
   * Kills every listed member on the same frame (debug keys now, with cause `combat`; combat from
   * M4). The state is updated first, so listeners already see the new leader. Then `unit:died`
   * per death in ascending id order, and `squad:leader-changed` only when a survivor was promoted;
   * a wipe emits no leader change. Dead sprites are removed (corpses come in M4+).
   */
  kill(ids: readonly EntityId[], cause: DeathCause): void {
    const result = killSquadMembers(this.squad, ids, this.trail);
    this.squad = result.state;
    for (const id of result.killed) {
      this.sprites.get(id)?.destroy();
      this.sprites.delete(id);
    }
    for (const id of result.killed) {
      this.bus.emit('unit:died', { id, team: 'squad', cause });
    }
    if (result.leaderChanged) this.bus.emit('squad:leader-changed', { id: result.newLeader });
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
  }

  private syncSprites(): void {
    for (const member of this.squad.members) this.syncSprite(member);
  }

  /** Every wizard, the leader included, y-sorts by its feet. */
  private syncSprite({ id, position }: SquadMember): void {
    this.sprites.get(id)?.setPosition(position.x, position.y).setDepth(unitDepth(position.y));
  }
}
