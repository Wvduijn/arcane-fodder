import Phaser from 'phaser';
import type {
  CombatTuning,
  DamageSourceDef,
  DeathCause,
  EntityId,
  GibTuning,
  ProjectileAttackDef,
  StatusDef,
  StatusId,
  Team,
  Vec2,
} from '@core/types';
import type { IdAllocator } from '@core/ids';
import { normalize, sub } from '@core/math/vec2';
import { applyHit, type Hit, type HitResult } from '@core/combat/damage';
import { killUnit, resolveFrameDeaths, type DeathRecord } from '@core/combat/death';
import {
  createProjectile,
  stepProjectile,
  type Projectile,
  type ProjectileBody,
} from '@core/combat/projectile';
import { applyStatus } from '@core/combat/status';
import type { CombatWorld } from '@core/combat/world';
import { CLASSES } from '@data/classes';
import { COMBAT, GIBS } from '@data/combat';
import { MOVEMENT } from '@data/movement';
import { STATUSES } from '@data/statuses';
import type { EventBus } from '../bus/EventBus';
import { Depth } from '../depths';
import { ImagePool, type PoolStats } from '../fx/ImagePool';
import { PlaceholderTextures, PROJECTILE_ORIGINS } from '../placeholders';
import type { EnemyRoster } from './EnemyRoster';
import type { SquadSystem } from './SquadSystem';
import type { System } from './System';
import type { TargetingSystem } from './TargetingSystem';

type ProjectileTexture = keyof typeof PROJECTILE_ORIGINS;

/**
 * Projectiles fly at feet level (bodies are circles at the feet, GDD §0); the sprite is drawn this
 * far above its hit point so it reads as chest height. Presentation only.
 */
const PROJECTILE_DRAW_LIFT_PX = 14;

interface LiveProjectile {
  projectile: Projectile;
  readonly image: Phaser.GameObjects.Image;
}

/** Counters for the debug overlay and the gate. */
export interface CombatCounters {
  readonly shotsFired: number;
  readonly hitsLanded: number;
  /**
   * Hits core turned into no-ops because the target was already dead or gone (D4), e.g. a second
   * Burning tick after a lethal one. Nothing is dealt or emitted for them.
   */
  readonly refusedHits: number;
  readonly deaths: number;
}

export interface CombatSystemOptions {
  readonly tuning?: CombatTuning;
  readonly gibs?: GibTuning;
  readonly statuses?: Readonly<Record<StatusId, StatusDef>>;
}

/**
 * Auto-combat (GDD §3, §12): the wizard shots TargetingSystem decided, the goblin attacks their
 * brains released (melee hits, arrows), pooled projectiles, and every hit resolved
 * through core's `applyHit` on the one {@link CombatWorld}. Landed hits emit `unit:damaged`; a
 * non-lethal hit then applies its status (`status:applied` when new) and knockback.
 *
 * Deaths are queued during the frame and resolved once by {@link flushDeaths}, which StatusSystem
 * calls after its ticks: all of a frame's deaths in ascending EntityId order (GDD §0). Wizards go
 * through `SquadSystem.kill` (succession), enemies emit `unit:died` and are removed.
 */
export class CombatSystem implements System {
  private readonly projectiles: LiveProjectile[] = [];
  private readonly pool: ImagePool;
  private pendingDeaths: DeathRecord[] = [];
  private readonly tuning: CombatTuning;
  private readonly gibs: GibTuning;
  private readonly statuses: Readonly<Record<StatusId, StatusDef>>;
  private counters: CombatCounters = { shotsFired: 0, hitsLanded: 0, refusedHits: 0, deaths: 0 };

  constructor(
    scene: Phaser.Scene,
    private readonly world: CombatWorld,
    private readonly squad: SquadSystem,
    private readonly enemies: EnemyRoster,
    private readonly targeting: TargetingSystem,
    private readonly ids: IdAllocator,
    private readonly bus: EventBus,
    options: CombatSystemOptions = {},
  ) {
    this.tuning = options.tuning ?? COMBAT;
    this.gibs = options.gibs ?? GIBS;
    this.statuses = options.statuses ?? STATUSES;
    this.pool = new ImagePool(() =>
      scene.add.image(0, 0, PlaceholderTextures.Spark).setDepth(Depth.Projectiles),
    );
    for (const member of squad.state.members) {
      world.add({
        id: member.id,
        team: 'squad',
        maxHp: CLASSES[squad.classOf(member.id)].maxHp,
        bodyRadiusPx: MOVEMENT.wizardBodyRadiusPx,
      });
    }
  }

  get poolStats(): PoolStats {
    return this.pool.stats;
  }

  get stats(): CombatCounters {
    return this.counters;
  }

  /** Projectiles in flight, for the debug overlay. */
  get liveProjectiles(): readonly Projectile[] {
    return this.projectiles.map((live) => live.projectile);
  }

  update(dt: number): void {
    for (const shot of this.targeting.takeShots()) {
      const { attack } = CLASSES[this.squad.classOf(shot.wizard)];
      this.spawnProjectile(shot.wizard, 'squad', shot.from, shot.aimAt, attack);
    }
    for (const intent of this.enemies.takeIntents()) {
      if (intent.kind === 'melee') {
        const from = this.enemies.positionOf(intent.attacker);
        const to = this.squad.positionOf(intent.target);
        const direction = from && to ? sub(to, from) : { x: 0, y: 0 };
        this.resolveAttackHit(intent.target, intent.attack, intent.attacker, direction);
      } else {
        this.spawnProjectile(intent.attacker, 'enemy', intent.from, intent.aimAt, intent.attack);
      }
    }
    this.stepProjectiles(dt);
  }

  /**
   * One hit through core. Emits `unit:damaged` when it landed; a kill is queued for
   * {@link flushDeaths}. A dead or unknown target is a no-op (D4), counted in `refusedHits`.
   */
  applyHit(target: EntityId, hit: Hit): HitResult {
    const result = applyHit(this.world, target, hit, this.gibs);
    // A landed hit's unit is still in the world: only flushDeaths removes units.
    const unit = this.world.get(target);
    if (!result.landed || !unit) {
      this.counters = { ...this.counters, refusedHits: this.counters.refusedHits + 1 };
      return result;
    }
    this.counters = { ...this.counters, hitsLanded: this.counters.hitsLanded + 1 };
    if (result.dealt > 0) {
      this.bus.emit('unit:damaged', {
        id: target,
        team: unit.team,
        amount: result.dealt,
        source: hit.sourceId,
        element: hit.element,
      });
    }
    if (result.killed) this.pendingDeaths.push(result.death);
    return result;
  }

  /**
   * Applies a status through core (`applyStatus`): `status:applied` when it is new, a refresh
   * otherwise. No damage. No-op on a dead or unknown target (D4). Also the debug B key's path.
   */
  applyStatus(target: EntityId, status: StatusId, sourceId: EntityId | null): void {
    const applied = applyStatus(this.world, target, this.statuses[status], sourceId);
    if (applied === 'applied') this.bus.emit('status:applied', { id: target, status });
  }

  /**
   * Kills a living unit without a damage source (debug K/L now; Volunteer! and left-behind later)
   * through core `killUnit`: dead in the combat world at once (never hit, targeted or ticked
   * again), then resolved with the frame's other deaths in {@link flushDeaths} (`unit:died`,
   * succession). No-op for a dead or unknown id.
   */
  kill(id: EntityId, cause: DeathCause): void {
    const death = killUnit(this.world, id, cause);
    if (death) this.pendingDeaths.push(death);
  }

  /**
   * Resolves this frame's deaths once, in ascending id order: wizards through SquadSystem.kill
   * (it emits their `unit:died` and any succession), then enemies. Wizard ids are allocated before
   * any enemy's, so this keeps the order ascending across both teams.
   */
  flushDeaths(): void {
    if (this.pendingDeaths.length === 0) return;
    const deaths = resolveFrameDeaths(this.pendingDeaths);
    this.pendingDeaths = [];
    this.counters = { ...this.counters, deaths: this.counters.deaths + deaths.length };

    const wizards = deaths.filter((death) => death.team === 'squad');
    if (wizards.length > 0) this.squad.kill(wizards);
    for (const death of deaths) {
      if (death.team === 'squad') continue;
      const { id, team, cause, deathVariant, gibbed } = death;
      this.bus.emit('unit:died', { id, team, cause, deathVariant, gibbed });
      this.enemies.remove(id);
    }
    for (const death of deaths) this.world.remove(death.id);
  }

  destroy(): void {
    this.projectiles.length = 0;
    this.pendingDeaths = [];
    this.pool.destroy();
  }

  private spawnProjectile(
    ownerId: EntityId,
    team: Team,
    from: Vec2,
    aimAt: Vec2,
    attack: ProjectileAttackDef,
  ): void {
    const projectile = createProjectile({
      id: this.ids.next(),
      ownerId,
      team,
      from,
      aimAt,
      attack,
      rangeFactor: this.tuning.projectileRangeFactor,
    });
    const texture = projectileTexture(team, attack);
    const origin = PROJECTILE_ORIGINS[texture];
    const image = this.pool
      .acquire()
      .setTexture(texture)
      .setOrigin(origin.x, origin.y)
      .setRotation(Math.atan2(projectile.direction.y, projectile.direction.x))
      // Squad shots glow, enemy arrows are matte (readability.md §1.5).
      .setBlendMode(team === 'squad' ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    const live: LiveProjectile = { projectile, image };
    this.syncProjectile(live);
    this.projectiles.push(live);
    this.counters = { ...this.counters, shotsFired: this.counters.shotsFired + 1 };
  }

  /**
   * In spawn order. A projectile from a dead shooter still flies and hits (GDD §3). Aliveness is
   * re-read for every projectile, so a unit killed by an earlier projectile this frame never
   * absorbs a later one (D4).
   */
  private stepProjectiles(dt: number): void {
    const bodies = this.bodies();
    const kept: LiveProjectile[] = [];
    for (const live of this.projectiles) {
      const living = bodies.map((body) => ({ ...body, alive: this.world.isAlive(body.id) }));
      const step = stepProjectile(live.projectile, dt, living);
      live.projectile = step.projectile;
      if (step.hit !== null) {
        const { source, ownerId, direction } = step.projectile;
        this.resolveAttackHit(step.hit, source, ownerId, direction);
      }
      if (step.hit !== null || step.expired) {
        this.pool.release(live.image);
        continue;
      }
      this.syncProjectile(live);
      kept.push(live);
    }
    this.projectiles.length = 0;
    this.projectiles.push(...kept);
  }

  /** Damage, then on a non-lethal landed hit the status and knockback (core damage.ts order). */
  private resolveAttackHit(
    target: EntityId,
    source: DamageSourceDef,
    ownerId: EntityId,
    direction: Vec2,
  ): void {
    const result = this.applyHit(target, { ...source, sourceId: ownerId });
    if (!result.landed || result.killed) return;
    if (source.applies !== undefined) this.applyStatus(target, source.applies, ownerId);
    // Only enemies take knockback in M4: no goblin attack has any (GDD §12, M4 Q2).
    if (source.knockbackPx > 0 && this.world.get(target)?.team === 'enemy') {
      this.enemies.knockBack(target, normalizeOrZero(direction), source.knockbackPx);
    }
  }

  /** Every unit alive at the start of the projectile step, as a hit circle at its feet. */
  private bodies(): ProjectileBody[] {
    const list: ProjectileBody[] = [];
    for (const unit of this.world.units()) {
      if (!unit.alive) continue;
      const position =
        unit.team === 'squad' ? this.squad.positionOf(unit.id) : this.enemies.positionOf(unit.id);
      if (!position) continue;
      list.push({
        id: unit.id,
        team: unit.team,
        position,
        bodyRadiusPx: unit.bodyRadiusPx,
        alive: true,
      });
    }
    return list;
  }

  private syncProjectile({ projectile, image }: LiveProjectile): void {
    const { x, y } = projectile.position;
    image.setPosition(x, y - PROJECTILE_DRAW_LIFT_PX);
  }
}

function projectileTexture(team: Team, attack: ProjectileAttackDef): ProjectileTexture {
  if (team !== 'squad') return PlaceholderTextures.Arrow;
  return attack.element === 'fire' ? PlaceholderTextures.FireBolt : PlaceholderTextures.Spark;
}

function normalizeOrZero(v: Vec2): Vec2 {
  return v.x === 0 && v.y === 0 ? v : normalize(v);
}
