import type Phaser from 'phaser';
import type {
  CombatTuning,
  DevEncounterSpawn,
  EnemyDef,
  EnemyId,
  EntityId,
  Rect,
  Vec2,
} from '@core/types';
import type { IdAllocator } from '@core/ids';
import type { WizardView } from '@core/ai/goblin';
import type { CombatWorld } from '@core/combat/world';
import { createEnemy, knockEnemy, stepEnemies, type EnemyState } from '@core/enemies/enemyMovement';
import { add } from '@core/math/vec2';
import { clampToRect, insetRect } from '@core/math/movement';
import { COMBAT } from '@data/combat';
import { DEV_ENCOUNTER } from '@data/devArena';
import { ENEMIES } from '@data/enemies';
import { MOVEMENT } from '@data/movement';
import { unitDepth } from '../depths';
import {
  CHARACTER_ANCHOR,
  CHARACTER_EXTENT_ABOVE_FEET_PX,
  EnemyTextures,
  PLACEHOLDER_WIZARD_SCALE,
} from '../placeholders';
import type { EnemyAttackIntent, EnemyRoster } from './EnemyRoster';
import type { SquadSystem } from './SquadSystem';
import type { System } from './System';

/**
 * Placeholder attack tells (readability.md §3), as poses on the goblin sprite: the grunt stretches
 * up over its wind-up (weapon raised), the archer leans back and widens over its draw. Scale and
 * angle only, so the white hit flash (tint) stays free. Presentation, not tuning.
 */
const TELL = {
  windupStretch: 0.2,
  drawWiden: 0.15,
  drawLeanDeg: 10,
} as const;

/** Debug readout of one enemy. */
export interface EnemyDebug {
  readonly id: EntityId;
  readonly enemy: EnemyId;
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly state: string;
  readonly timeInStateMs: number;
  readonly target: EntityId | null;
  readonly cooldownMs: number;
  /** Archer aim locked at draw start, else null. */
  readonly aim: Vec2 | null;
  readonly knockbacks: number;
}

export interface EnemyAiSystemOptions {
  /** The scene run's one allocator, shared with the squad and projectiles (GDD §0). */
  readonly ids: IdAllocator;
  /** Spawn offsets are relative to this point (the squad leader's spawn). */
  readonly origin: Vec2;
  readonly encounter?: readonly DevEncounterSpawn[];
  readonly defs?: Readonly<Record<EnemyId, EnemyDef>>;
  readonly tuning?: CombatTuning;
}

/**
 * Goblins (GDD §12). Core's {@link EnemyState} list (ascending id) is the one authoritative state
 * for positions and brains; HP and alive/dead live in the {@link CombatWorld}. Each frame core's
 * `stepEnemies` runs every brain and moves every body (separation, yield to wizards, knockback,
 * bounds); the released attacks are queued for CombatSystem. Sprites only mirror the state: feet
 * position, y-sort, facing and the tell pose.
 *
 * Spawns `DEV_ENCOUNTER` around the squad's spawn at scene start; {@link respawn} (debug G)
 * despawns every goblin and spawns the encounter again with fresh ids.
 */
export class EnemyAiSystem implements System, EnemyRoster {
  /** The rect enemy feet are clamped to (each body circle is inset further by its radius). */
  readonly bounds: Rect;
  private enemies: EnemyState[] = [];
  private readonly sprites = new Map<EntityId, Phaser.GameObjects.Image>();
  /** Last facing per enemy: true when it faces left (textures face right). */
  private readonly facingLeft = new Map<EntityId, boolean>();
  /**
   * Where enemies that died last frame fell, for `unit:died` listeners (death puff). Cleared at the
   * start of every update, so it never grows. Despawned enemies are not kept.
   */
  private readonly fallen = new Map<EntityId, Vec2>();
  private intents: EnemyAttackIntent[] = [];
  private whiffCount = 0;
  private readonly defs: Readonly<Record<EnemyId, EnemyDef>>;
  private readonly tuning: CombatTuning;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: CombatWorld,
    private readonly squad: SquadSystem,
    worldRect: Rect,
    private readonly options: EnemyAiSystemOptions,
  ) {
    this.defs = options.defs ?? ENEMIES;
    this.tuning = options.tuning ?? COMBAT;
    // Same top inset as the squad: the whole sprite stays on the map.
    this.bounds = insetRect(worldRect, {
      top: CHARACTER_EXTENT_ABOVE_FEET_PX,
      right: 0,
      bottom: 0,
      left: 0,
    });
    this.spawnEncounter();
  }

  /** Grunt melee swings that whiffed (target out of range at release). */
  get whiffs(): number {
    return this.whiffCount;
  }

  get debugEnemies(): readonly EnemyDebug[] {
    return this.enemies.map((enemy) => {
      const { brain } = enemy;
      return {
        id: enemy.id,
        enemy: enemy.enemy,
        position: { ...enemy.position },
        velocity: { ...enemy.velocity },
        state: brain.machine.current,
        timeInStateMs: brain.machine.timeInStateMs,
        target: brain.target,
        cooldownMs: Math.max(0, brain.cooldown.remainingMs),
        aim: brain.kind === 'keep-range' && brain.aim ? { ...brain.aim } : null,
        knockbacks: enemy.knockbacks.length,
      };
    });
  }

  ids(): readonly EntityId[] {
    return this.enemies.map((enemy) => enemy.id);
  }

  defOf(id: EntityId): EnemyDef | undefined {
    const enemy = this.find(id);
    return enemy ? this.defs[enemy.enemy] : undefined;
  }

  positionOf(id: EntityId): Readonly<Vec2> | undefined {
    return this.find(id)?.position ?? this.fallen.get(id);
  }

  spriteOf(id: EntityId): Phaser.GameObjects.Image | undefined {
    return this.sprites.get(id);
  }

  takeIntents(): EnemyAttackIntent[] {
    const intents = this.intents;
    this.intents = [];
    return intents;
  }

  knockBack(id: EntityId, direction: Vec2, distancePx: number): void {
    if (!this.world.isAlive(id)) return;
    this.enemies = this.enemies.map((enemy) =>
      enemy.id === id
        ? knockEnemy(enemy, this.defs[enemy.enemy], direction, distancePx, this.tuning.knockbackMs)
        : enemy,
    );
  }

  remove(id: EntityId): void {
    const enemy = this.find(id);
    if (!enemy) return;
    this.fallen.set(id, enemy.position);
    this.despawn(id);
  }

  /** Debug G: every goblin despawns (no deaths), then the encounter spawns again. */
  respawn(): void {
    for (const enemy of [...this.enemies]) {
      this.world.remove(enemy.id);
      this.despawn(enemy.id);
    }
    this.intents = [];
    this.spawnEncounter();
  }

  update(dt: number): void {
    this.fallen.clear();
    const wizards: WizardView[] = this.squad.state.members.map((member) => ({
      id: member.id,
      position: member.position,
      bodyRadiusPx: MOVEMENT.wizardBodyRadiusPx,
      alive: this.world.isAlive(member.id),
    }));
    const result = stepEnemies(this.enemies, {
      defs: this.defs,
      wizards,
      bounds: this.bounds,
      isAlive: (id) => this.world.isAlive(id),
      dtMs: dt,
    });
    this.enemies = [...result.enemies];

    for (const action of result.actions) {
      const enemy = this.find(action.enemyId);
      if (!enemy) continue;
      const { attack } = this.defs[enemy.enemy];
      if (action.kind === 'melee') {
        if (!action.landed) this.whiffCount++;
        else if (attack.kind === 'melee') {
          this.intents.push({
            kind: 'melee',
            attacker: action.enemyId,
            target: action.target,
            attack,
          });
        }
      } else if (attack.kind === 'projectile') {
        this.intents.push({
          kind: 'shoot',
          attacker: action.enemyId,
          from: action.from,
          aimAt: action.aimAt,
          attack,
        });
      }
    }

    for (const enemy of this.enemies) this.syncSprite(enemy);
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
    this.facingLeft.clear();
    this.fallen.clear();
    this.enemies = [];
    this.intents = [];
  }

  private spawnEncounter(): void {
    const encounter = this.options.encounter ?? DEV_ENCOUNTER;
    for (const spawn of encounter) {
      const def = this.defs[spawn.enemy];
      const id = this.options.ids.next();
      const position = clampToRect(
        add(this.options.origin, spawn.offset),
        this.bounds,
        def.bodyRadiusPx,
      );
      this.enemies.push(createEnemy(id, def, position));
      this.world.add({ id, team: 'enemy', maxHp: def.maxHp, bodyRadiusPx: def.bodyRadiusPx });
      const sprite = this.scene.add
        .image(position.x, position.y, EnemyTextures[spawn.enemy])
        .setOrigin(CHARACTER_ANCHOR.x, CHARACTER_ANCHOR.y)
        .setScale(PLACEHOLDER_WIZARD_SCALE);
      this.sprites.set(id, sprite);
    }
    // Fresh ids are always the highest, so the list stays in ascending id order.
    for (const enemy of this.enemies) this.syncSprite(enemy);
  }

  private despawn(id: EntityId): void {
    this.enemies = this.enemies.filter((enemy) => enemy.id !== id);
    this.sprites.get(id)?.destroy();
    this.sprites.delete(id);
    this.facingLeft.delete(id);
  }

  private find(id: EntityId): EnemyState | undefined {
    return this.enemies.find((enemy) => enemy.id === id);
  }

  /** Feet position, y-sort by feet, facing (target, else movement), tell pose. */
  private syncSprite(enemy: EnemyState): void {
    const sprite = this.sprites.get(enemy.id);
    if (!sprite) return;
    const { position, brain } = enemy;
    const target = brain.target === null ? undefined : this.squad.positionOf(brain.target);
    const dx = target ? target.x - position.x : enemy.velocity.x;
    const left = dx === 0 ? (this.facingLeft.get(enemy.id) ?? false) : dx < 0;
    this.facingLeft.set(enemy.id, left);

    const def = this.defs[enemy.enemy];
    const { attack } = def;
    const { current, timeInStateMs } = brain.machine;
    let scaleX = 1;
    let scaleY = 1;
    let angle = 0;
    if (current === 'windup' && attack.kind === 'melee') {
      const p = Math.min(1, timeInStateMs / attack.windupMs);
      scaleY += TELL.windupStretch * p;
      scaleX -= (TELL.windupStretch / 2) * p;
    } else if (current === 'draw' && attack.kind === 'projectile') {
      const p = Math.min(1, timeInStateMs / attack.drawMs);
      scaleX += TELL.drawWiden * p;
      angle = TELL.drawLeanDeg * p * (left ? 1 : -1);
    }
    sprite
      .setPosition(position.x, position.y)
      .setDepth(unitDepth(position.y))
      .setFlipX(left)
      .setScale(PLACEHOLDER_WIZARD_SCALE * scaleX, PLACEHOLDER_WIZARD_SCALE * scaleY)
      .setAngle(angle);
  }
}
