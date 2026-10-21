import Phaser from 'phaser';
import type { EntityId, SpellDef, SpellId, Vec2 } from '@core/types';
import { SPELLS } from '@data/spells';
import type { EventBus, GameEventListener } from '../bus/EventBus';
import { Depth } from '../depths';
import { drawBolt, STORM_BOLT } from '../fx/bolts';
import { burstCoreRadiusPx, drawBurst, drawOutlinedRing, FIRE_BURST } from '../fx/bursts';
import type { FlashBudget } from '../fx/FlashBudget';
import { GraphicsPool, ImagePool, type PoolStats } from '../fx/ImagePool';
import { Palette } from '../palette';
import { PlaceholderTextures, STORM_FLASH_RADIUS_PX } from '../placeholders';
import type { System } from '../systems/System';

/** A Fireball in flight, as the caster holds it (SpellSystem implements the source). */
export interface FireballFlight {
  readonly id: EntityId;
  /** Hit point at feet level, like every projectile (GDD §0). */
  readonly position: Vec2;
}

export interface SpellFlightSource {
  readonly fireballs: readonly FireballFlight[];
}

/**
 * Placeholder spell FX (readability.md §5). Presentation, not tuning (CD 2026-10-16: constants stay
 * in src/game): sizes that matter for gameplay (burst radius, telegraph time) come from SPELLS.
 */
const SPELL_FX = {
  /** Same lift as auto projectiles (CombatSystem): chest height over the feet-level hit point. */
  orbLiftPx: 14,
  trail: { everyMs: 30, lifeMs: 220, startScale: 1.5, endScale: 0.5 },
  burst: { lifeMs: 260, growMs: 60, startScale: 0.8 },
  reticle: {
    /** About 20 px across (readability §5): bigger than the 8 px hit radius on purpose. */
    radiusPx: 10,
    endScale: 0.45,
    linePx: 2,
    outlinePx: 1,
    color: Palette.cyan,
    outline: Palette.ink,
    tickPx: 4,
  },
  /** Drawn with fx/bolts STORM_BOLT. */
  bolt: { lifeMs: 140 },
  flash: { lifeMs: 160 },
} as const;

interface TimedFx<T> {
  readonly item: T;
  ageMs: number;
}

interface Reticle extends TimedFx<Phaser.GameObjects.Graphics> {
  readonly lifeMs: number;
}

interface Burst extends TimedFx<Phaser.GameObjects.Graphics> {
  readonly flash: boolean;
}

/**
 * Spell visuals, pooled: the Fireball orb (15 px, mirrors the caster's flights every frame) and its
 * ember trail, the Fireball burst filling the 44 px radius, the Lightning reticle shrinking over
 * the telegraph, the bolt from the top of the screen and the ground flash. Driven by `spell:cast`
 * and `spell:impact` and the scene's dt (Phaser clock). Reads; never changes game state.
 */
export class SpellFxView implements System {
  private readonly orbPool: ImagePool;
  private readonly trailPool: ImagePool;
  private readonly flashPool: ImagePool;
  private readonly burstPool: GraphicsPool;
  private readonly reticlePool: GraphicsPool;
  private readonly boltPool: GraphicsPool;
  private readonly orbs = new Map<EntityId, Phaser.GameObjects.Image>();
  private readonly trail: TimedFx<Phaser.GameObjects.Image>[] = [];
  private readonly flashes: TimedFx<Phaser.GameObjects.Image>[] = [];
  private readonly bursts: Burst[] = [];
  private readonly reticles: Reticle[] = [];
  private readonly bolts: TimedFx<Phaser.GameObjects.Graphics>[] = [];
  private sinceTrailMs = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly camera: Phaser.Cameras.Scene2D.Camera,
    private readonly flights: SpellFlightSource,
    private readonly bus: EventBus,
    private readonly flashBudget: FlashBudget,
    private readonly spells: Readonly<Record<SpellId, SpellDef>> = SPELLS,
  ) {
    this.orbPool = new ImagePool(() =>
      scene.add
        .image(0, 0, PlaceholderTextures.FireballOrb)
        .setDepth(Depth.Projectiles)
        .setBlendMode(Phaser.BlendModes.ADD),
    );
    this.trailPool = new ImagePool(() =>
      scene.add
        .image(0, 0, PlaceholderTextures.Ember)
        .setDepth(Depth.Projectiles)
        .setBlendMode(Phaser.BlendModes.ADD),
    );
    this.flashPool = new ImagePool(() =>
      scene.add.image(0, 0, PlaceholderTextures.StormFlash).setDepth(Depth.GroundFx),
    );
    this.burstPool = new GraphicsPool(() => scene.add.graphics().setDepth(Depth.Fx));
    this.reticlePool = new GraphicsPool(() => scene.add.graphics().setDepth(Depth.GroundFx));
    this.boltPool = new GraphicsPool(() => scene.add.graphics().setDepth(Depth.Fx));
    bus.on('spell:cast', this.handleCast);
    bus.on('spell:impact', this.handleImpact);
  }

  /** Pool counts for the debug overlay and the D6 leak check. */
  get poolStats(): Readonly<Record<string, PoolStats>> {
    return {
      orbs: this.orbPool.stats,
      trail: this.trailPool.stats,
      bursts: this.burstPool.stats,
      reticles: this.reticlePool.stats,
      bolts: this.boltPool.stats,
      flashes: this.flashPool.stats,
    };
  }

  update(dt: number): void {
    this.syncOrbs(dt);
    this.age(this.trail, dt, SPELL_FX.trail.lifeMs, this.trailPool, (image, t) => {
      const { startScale, endScale } = SPELL_FX.trail;
      image.setScale(startScale + (endScale - startScale) * t).setAlpha(1 - t);
    });
    this.age(this.flashes, dt, SPELL_FX.flash.lifeMs, this.flashPool, (image, t) => {
      image.setAlpha(1 - t);
    });
    this.age(this.bolts, dt, SPELL_FX.bolt.lifeMs, this.boltPool, (g, t) => {
      g.setAlpha(1 - t * t);
    });
    this.age(this.bursts, dt, SPELL_FX.burst.lifeMs, this.burstPool, (g, t, fx) => {
      const { lifeMs, growMs, startScale } = SPELL_FX.burst;
      const grow = Math.min(1, (fx.ageMs / growMs) * 1);
      g.setScale(startScale + (1 - startScale) * Phaser.Math.Easing.Quadratic.Out(grow));
      const fadeFrom = growMs / lifeMs;
      g.setAlpha(t <= fadeFrom ? 1 : 1 - (t - fadeFrom) / (1 - fadeFrom));
    });
    for (let i = this.reticles.length - 1; i >= 0; i--) {
      const reticle = this.reticles[i];
      if (!reticle) continue;
      reticle.ageMs += dt;
      const t = Math.min(1, reticle.ageMs / reticle.lifeMs);
      reticle.item.setScale(1 + (SPELL_FX.reticle.endScale - 1) * t);
      // Held at its end size until the strike removes it (so it never vanishes before impact).
    }
  }

  destroy(): void {
    this.bus.off('spell:cast', this.handleCast);
    this.bus.off('spell:impact', this.handleImpact);
    this.orbs.clear();
    this.trail.length = 0;
    this.flashes.length = 0;
    this.bursts.length = 0;
    this.reticles.length = 0;
    this.bolts.length = 0;
    this.orbPool.destroy();
    this.trailPool.destroy();
    this.flashPool.destroy();
    this.burstPool.destroy();
    this.reticlePool.destroy();
    this.boltPool.destroy();
  }

  /** One orb per flight, made on first sight and released when the flight is gone. */
  private syncOrbs(dt: number): void {
    const seen = new Set<EntityId>();
    this.sinceTrailMs += dt;
    const emitTrail = this.sinceTrailMs >= SPELL_FX.trail.everyMs;
    if (emitTrail) this.sinceTrailMs = 0;
    for (const { id, position } of this.flights.fireballs) {
      seen.add(id);
      let orb = this.orbs.get(id);
      if (!orb) {
        orb = this.orbPool.acquire();
        this.orbs.set(id, orb);
      }
      const y = position.y - SPELL_FX.orbLiftPx;
      orb.setPosition(position.x, y);
      if (emitTrail) {
        const ember = this.trailPool
          .acquire()
          .setPosition(position.x, y)
          .setScale(SPELL_FX.trail.startScale)
          .setAlpha(1);
        this.trail.push({ item: ember, ageMs: 0 });
      }
    }
    for (const [id, orb] of this.orbs) {
      if (seen.has(id)) continue;
      this.orbPool.release(orb);
      this.orbs.delete(id);
    }
  }

  /** Ages each FX, calls `apply` with progress 0..1, releases it at the end of its life. */
  private age<
    T extends Phaser.GameObjects.Image | Phaser.GameObjects.Graphics,
    F extends TimedFx<T>,
  >(
    list: F[],
    dt: number,
    lifeMs: number,
    pool: { release(item: T): void },
    apply: (item: T, t: number, fx: F) => void,
  ): void {
    for (let i = list.length - 1; i >= 0; i--) {
      const fx = list[i];
      if (!fx) continue;
      fx.ageMs += dt;
      const t = fx.ageMs / lifeMs;
      if (t >= 1) {
        pool.release(fx.item);
        list.splice(i, 1);
        continue;
      }
      apply(fx.item, t, fx);
    }
  }

  private readonly handleCast: GameEventListener<'spell:cast'> = ({ spell, at }) => {
    const { delivery } = this.spells[spell];
    if (delivery.kind !== 'strike') return;
    const { radiusPx, linePx, outlinePx, color, outline, tickPx } = SPELL_FX.reticle;
    const g = this.reticlePool.acquire().clear().setPosition(at.x, at.y).setScale(1).setAlpha(1);
    drawOutlinedRing(g, radiusPx, color, linePx, outline, outlinePx);
    // Four inward ticks: the centre is the hit point.
    g.lineStyle(linePx, color)
      .lineBetween(0, -radiusPx, 0, -radiusPx + tickPx)
      .lineBetween(0, radiusPx, 0, radiusPx - tickPx)
      .lineBetween(-radiusPx, 0, -radiusPx + tickPx, 0)
      .lineBetween(radiusPx, 0, radiusPx - tickPx, 0);
    this.reticles.push({ item: g, ageMs: 0, lifeMs: delivery.telegraphMs });
  };

  private readonly handleImpact: GameEventListener<'spell:impact'> = ({ spell, at }) => {
    const def = this.spells[spell];
    if (def.delivery.kind === 'strike') {
      // Strikes resolve in cast order, so the oldest reticle is this strike's.
      const reticle = this.reticles.shift();
      if (reticle) this.reticlePool.release(reticle.item);
      this.playBolt(at);
      return;
    }
    // Fireball's core (about 18 px) is past §1.9's 16 px, so it counts against the budget.
    const flash = this.flashBudget.tryFlash(burstCoreRadiusPx(def.radiusPx));
    const g = this.burstPool
      .acquire()
      .setPosition(at.x, at.y)
      .setScale(SPELL_FX.burst.startScale)
      .setAlpha(1);
    drawBurst(g, def.radiusPx, FIRE_BURST, flash);
    this.bursts.push({ item: g, ageMs: 0, flash });
  };

  /**
   * Jagged bolt from the top of the visible world down to the impact, plus the ground flash. The
   * jitter is a hash of the impact point, so a replay draws the same bolt.
   */
  private playBolt(at: Vec2): void {
    const g = this.boltPool.acquire().setPosition(0, 0).setAlpha(1);
    drawBolt(g, at, this.camera.worldView.y, STORM_BOLT);
    this.bolts.push({ item: g, ageMs: 0 });

    // Not an impact flash (§1.9 names it: near-white area about 5 px, under 16): always plays,
    // never asks the budget.
    const flash = this.flashPool
      .acquire()
      .setPosition(at.x, at.y)
      .setScale(SPELL_FX.reticle.radiusPx / STORM_FLASH_RADIUS_PX)
      .setAlpha(1);
    this.flashes.push({ item: flash, ageMs: 0 });
  }
}
