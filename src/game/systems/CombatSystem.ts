import Phaser from 'phaser';
import type {
  CombatTuning,
  CombustDef,
  DamageElement,
  DamageSourceDef,
  DeathCause,
  EntityId,
  GibTuning,
  KaboomDef,
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
import {
  applyAreaStatus,
  type AreaBody,
  type AreaEvent,
  type AreaEventResult,
  type AreaStatusEvent,
  type UnitPosition,
} from '@core/combat/area';
import {
  resolveAreaWithReactions,
  resolveKaboom,
  resolveUnitHit,
  type ReactionContext,
  type ReactionResults,
} from '@core/combat/reactions';
import { applyStatus } from '@core/combat/status';
import type { CombatWorld } from '@core/combat/world';
import { CLASSES } from '@data/classes';
import { COMBAT, GIBS } from '@data/combat';
import { MOVEMENT } from '@data/movement';
import { REACTIONS } from '@data/reactions';
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
  readonly combusts: number;
  readonly kabooms: number;
  readonly kegsTriggered: number;
}

/** The kegs as CombatSystem sees them (KegSystem implements it). Kegs are not in the CombatWorld. */
export interface KegLink {
  /** Every keg as an area body; only idle ones are `alive` (keg.ts `kegBodies`). */
  readonly areaBodies: readonly AreaBody[];
  /** Lights these kegs (no-op for fusing or spent ones); emits `keg:fuse-started`. */
  trigger(ids: readonly EntityId[]): void;
}

export interface CombatSystemOptions {
  readonly tuning?: CombatTuning;
  readonly gibs?: GibTuning;
  readonly statuses?: Readonly<Record<StatusId, StatusDef>>;
  readonly combust?: CombustDef;
  readonly kaboom?: KaboomDef;
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
  private readonly combust: CombustDef;
  private readonly kaboom: KaboomDef;
  private counters: CombatCounters = {
    shotsFired: 0,
    hitsLanded: 0,
    refusedHits: 0,
    deaths: 0,
    combusts: 0,
    kabooms: 0,
    kegsTriggered: 0,
  };

  constructor(
    scene: Phaser.Scene,
    private readonly world: CombatWorld,
    private readonly squad: SquadSystem,
    private readonly enemies: EnemyRoster,
    private readonly targeting: TargetingSystem,
    private readonly ids: IdAllocator,
    private readonly bus: EventBus,
    private readonly kegs: KegLink,
    options: CombatSystemOptions = {},
  ) {
    this.tuning = options.tuning ?? COMBAT;
    this.gibs = options.gibs ?? GIBS;
    this.statuses = options.statuses ?? STATUSES;
    this.combust = options.combust ?? REACTIONS.combust;
    this.kaboom = options.kaboom ?? REACTIONS.kaboom;
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

  /** Alive in the combat world (false for dead or unknown ids). */
  isAlive(id: EntityId): boolean {
    return this.world.isAlive(id);
  }

  /** Status on a living unit right now (views read state; a Combust consumes with no event). */
  hasStatus(id: EntityId, status: StatusId): boolean {
    return this.world.get(id)?.statuses.has(status) === true;
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
   * One hit through core with no reaction (status ticks: Burning is fire, it never Combusts). Emits
   * `unit:damaged` when it landed; a kill is queued for {@link flushDeaths}. A dead or unknown target
   * is a no-op (D4), counted in `refusedHits`.
   */
  applyHit(target: EntityId, hit: Hit): HitResult {
    const result = applyHit(this.world, target, hit, this.gibs);
    this.recordHit(result, hit.sourceId, hit.element);
    if (result.killed) this.pendingDeaths.push(result.death);
    return result;
  }

  /**
   * One area blast (Fireball, Lightning, Convergence strikes and burning ground, Arcane Detonation)
   * through core `resolveAreaWithReactions`, the only way an area effect damages units (M5
   * architecture): its hits, statuses and knockback, then every Combust it set off, then the kegs
   * its ring lit (handed to KegSystem). The Combusts are credited to `event.reactionSourceId` when
   * set (core's `ReactionOutcome.sourceId`; M6 Q3: the Convergence's reactions charge the meter,
   * its strikes don't). All kills are
   * queued for {@link flushDeaths} with the frame's other deaths.
   */
  resolveArea(event: AreaEvent): AreaEventResult {
    const result = resolveAreaWithReactions(event, this.reactionContext());
    this.applyArea(result.area, event.sourceId, event.blast.element);
    this.applyReactions(result);
    return result.area;
  }

  /**
   * A status on every living unit of `event.teams` the ring touches, no damage, through core
   * `applyAreaStatus` (Meteor's burning ground, M6): `status:applied` for each new one. Not a hit:
   * no `unit:damaged`, reactions, kegs or knockback.
   */
  applyAreaStatus(event: AreaStatusEvent): void {
    const results = applyAreaStatus(event, this.unitPositions(), {
      world: this.world,
      statuses: this.statuses,
      gibs: this.gibs,
    });
    for (const { target, status, result } of results) {
      if (result === 'applied') this.bus.emit('status:applied', { id: target, status });
    }
  }

  /**
   * A keg whose fuse ended (KegSystem): the Kaboom blast on wizards and enemies alike through core
   * `resolveKaboom`, credited to the keg (squad-side, GDD §0), then the kegs it lights (cascade).
   */
  resolveKaboom(keg: { readonly id: EntityId; readonly position: Vec2 }): void {
    this.applyReactions(resolveKaboom(keg, this.reactionContext()));
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
   * How this living unit's death is recorded from now on, whatever kills it (core
   * `setDeathCause`): Volunteer! marks its runner `volunteer` at activation (GDD §11, §14).
   */
  setDeathCause(id: EntityId, cause: DeathCause): void {
    this.world.setDeathCause(id, cause);
  }

  /** The cause a living unit's death would be recorded with (debug kills honour it). */
  deathCauseOf(id: EntityId): DeathCause {
    return this.world.get(id)?.deathCause ?? 'combat';
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
    const hit: Hit = { ...source, sourceId: ownerId };
    const outcome = resolveUnitHit(target, hit, this.reactionContext());
    const result = outcome.hit;
    this.recordHit(result, ownerId, source.element);
    this.applyReactions(outcome);
    if (!result.landed || result.killed) return;
    if (source.applies !== undefined) this.applyStatus(target, source.applies, ownerId);
    // Only enemies take knockback in M4: no goblin attack has any (GDD §12, M4 Q2).
    if (source.knockbackPx > 0 && this.world.get(target)?.team === 'enemy') {
      this.enemies.knockBack(target, normalizeOrZero(direction), source.knockbackPx);
    }
  }

  /** `unit:damaged` for a landed hit and the hit counters (D4: a refused hit emits nothing). */
  private recordHit(result: HitResult, source: EntityId | null, element: DamageElement): void {
    const unit = this.world.get(result.target);
    if (!result.landed || !unit) {
      this.counters = { ...this.counters, refusedHits: this.counters.refusedHits + 1 };
      return;
    }
    this.counters = { ...this.counters, hitsLanded: this.counters.hitsLanded + 1 };
    if (result.dealt > 0) {
      this.bus.emit('unit:damaged', {
        id: result.target,
        team: unit.team,
        amount: result.dealt,
        source,
        element,
      });
    }
  }

  /** One blast's hits (ascending id), new statuses and knockback (enemies and wizards). */
  private applyArea(area: AreaEventResult, source: EntityId | null, element: DamageElement): void {
    for (const hit of area.hits) this.recordHit(hit, source, element);
    for (const { target, status, result } of area.statuses) {
      if (result === 'applied') this.bus.emit('status:applied', { id: target, status });
    }
    for (const { target, direction, distancePx } of area.knockbacks) {
      const team = this.world.get(target)?.team;
      if (team === 'enemy') this.enemies.knockBack(target, direction, distancePx);
      else if (team === 'squad') this.squad.knockBack(target, direction, distancePx);
    }
  }

  /**
   * What core resolved after a hit or blast: `reaction:triggered` then that reaction's blast, per
   * reaction in order, credited to core's `outcome.sourceId` (Combust: the hit's source or the
   * event's reaction id; Kaboom: the keg, GDD §0); every kill of the call queued once; the kegs it
   * lit handed to KegSystem.
   */
  private applyReactions(results: ReactionResults): void {
    for (const outcome of results.reactions) {
      const { reaction, at, origin, spreadTo } = outcome;
      this.bus.emit('reaction:triggered', { reaction, at, origin, spreadTo });
      const blast = reaction === 'combust' ? this.combust.blast : this.kaboom.blast;
      this.applyArea(outcome.area, outcome.sourceId, blast.element);
      this.counters = {
        ...this.counters,
        combusts: this.counters.combusts + (reaction === 'combust' ? 1 : 0),
        kabooms: this.counters.kabooms + (reaction === 'kaboom' ? 1 : 0),
      };
    }
    this.pendingDeaths.push(...results.deaths);
    if (results.kegs.length > 0) {
      this.counters = {
        ...this.counters,
        kegsTriggered: this.counters.kegsTriggered + results.kegs.length,
      };
      this.kegs.trigger(results.kegs);
    }
  }

  private reactionContext(): ReactionContext {
    return {
      world: this.world,
      statuses: this.statuses,
      gibs: this.gibs,
      combust: this.combust,
      kaboom: this.kaboom,
      units: this.unitPositions(),
      kegs: this.kegs.areaBodies,
    };
  }

  /** Every living unit's feet, for area events. */
  private unitPositions(): UnitPosition[] {
    return this.bodies().map(({ id, position }) => ({ id, position }));
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
