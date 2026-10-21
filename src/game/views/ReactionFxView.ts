import Phaser from 'phaser';
import type { CombustDef, EntityId, KaboomDef, Vec2 } from '@core/types';
import { REACTIONS } from '@data/reactions';
import type { EventBus, GameEventListener } from '../bus/EventBus';
import { Depth } from '../depths';
import { burstCoreRadiusPx, drawBurst, FIRE_BURST } from '../fx/bursts';
import type { FlashBudget } from '../fx/FlashBudget';
import type { ScreenShake } from '../fx/ScreenShake';
import { GraphicsPool, ImagePool, type PoolStats } from '../fx/ImagePool';
import { arcPoint, Movers } from '../fx/Movers';
import type { UnitLookup } from '../entities/Positioned';
import { Palette } from '../palette';
import { PlaceholderTextures } from '../placeholders';
import type { System } from '../systems/System';

/**
 * Reaction FX, readability.md §5 "Reaction FX numbers (M5 placeholder spec)". Radii come from
 * REACTIONS, never from here. Presentation, not tuning (CD 2026-10-16: constants stay in src/game).
 */
const REACTION_FX = {
  /** Expands from 8 px to the blast radius in 80 ms, fades 100 ms. No smoke, shake or flash. */
  combust: { startPx: 8, expandMs: 80, holdMs: 0, fadeMs: 100 },
  /** One per `spreadTo` unit: origin → unit in 200 ms, arc peaking 10 px, 2-frame trail. */
  embers: { lifeMs: 200, arcPx: 10, liftPx: 12, trailFrames: 2, trailAlpha: 0.5 },
  /** Expands from 16 px to 72 in 60 ms, holds 40 ms, fades 200 ms. */
  kaboom: { startPx: 16, expandMs: 60, holdMs: 40, fadeMs: 200 },
  /** 3 ash puffs rising 24–32 px over 600 ms, gone by 900 ms. */
  smoke: {
    rises: [24, 28, 32],
    riseMs: 600,
    lifeMs: 900,
    swayPx: 4,
    startScale: 2,
    endScale: 4,
    startAlpha: 0.85,
  },
  /** 4–6 bark/slate specks with an ink outline, landing within 48 px in ≤ 400 ms. */
  debris: { chips: 6, lifeMs: 380, distancesPx: [30, 44, 36, 48, 26, 40], hopPx: 16, scale: 1 },
  /** 2 px for 120 ms; a chain restarts the shake, never stacks it. */
  shake: { px: 2, durationMs: 120 },
} as const;

interface BurstTiming {
  readonly startPx: number;
  readonly expandMs: number;
  readonly holdMs: number;
  readonly fadeMs: number;
}

interface Burst {
  readonly g: Phaser.GameObjects.Graphics;
  readonly radiusPx: number;
  readonly timing: BurstTiming;
  ageMs: number;
}

interface Ember {
  readonly head: Phaser.GameObjects.Image;
  readonly trail: Phaser.GameObjects.Image;
  readonly from: Vec2;
  readonly target: EntityId;
  /** Last known target point (lifted); kept if the target dies mid-arc. */
  to: Vec2;
  /** Positions of the last frames, newest last, for the trail. */
  readonly history: Vec2[];
  ageMs: number;
}

/**
 * Combust pop and ember arcs, Kaboom blast, smoke column, debris and shake; pooled, driven by
 * `reaction:triggered` and the scene's dt (Phaser clock). Ember arcs are decorative: the Burning
 * overlay starts on `status:applied` at Combust time, so they land on a target already burning.
 */
export class ReactionFxView implements System {
  private readonly burstPool: GraphicsPool;
  private readonly emberPool: ImagePool;
  private readonly smokePool: ImagePool;
  private readonly debrisPool: ImagePool;
  private readonly bursts: Burst[] = [];
  private readonly embers: Ember[] = [];
  private readonly movers: Movers;
  private shakes = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly screenShake: ScreenShake,
    private readonly units: UnitLookup,
    private readonly bus: EventBus,
    private readonly flashBudget: FlashBudget,
    private readonly combust: CombustDef = REACTIONS.combust,
    private readonly kaboom: KaboomDef = REACTIONS.kaboom,
  ) {
    this.burstPool = new GraphicsPool(() => scene.add.graphics().setDepth(Depth.Fx));
    this.emberPool = new ImagePool(() =>
      scene.add
        .image(0, 0, PlaceholderTextures.Ember)
        .setDepth(Depth.Fx)
        .setBlendMode(Phaser.BlendModes.ADD),
    );
    this.smokePool = new ImagePool(() =>
      scene.add.image(0, 0, PlaceholderTextures.Puff).setDepth(Depth.Fx).setTint(Palette.ash),
    );
    this.debrisPool = new ImagePool(() =>
      scene.add
        .image(0, 0, PlaceholderTextures.Debris)
        .setDepth(Depth.Fx)
        .setScale(REACTION_FX.debris.scale),
    );
    this.movers = new Movers(this.smokePool, this.debrisPool);
    bus.on('reaction:triggered', this.handleReaction);
  }

  get poolStats(): Readonly<Record<string, PoolStats>> {
    return {
      blasts: this.burstPool.stats,
      embers: this.emberPool.stats,
      smoke: this.smokePool.stats,
      debris: this.debrisPool.stats,
    };
  }

  /** Kaboom screen shakes started this run (debug). */
  get shakeCount(): number {
    return this.shakes;
  }

  update(dt: number): void {
    this.stepBursts(dt);
    this.stepEmbers(dt);
    this.movers.update(dt);
  }

  destroy(): void {
    this.bus.off('reaction:triggered', this.handleReaction);
    this.bursts.length = 0;
    this.embers.length = 0;
    this.movers.clear();
    this.burstPool.destroy();
    this.emberPool.destroy();
    this.smokePool.destroy();
    this.debrisPool.destroy();
  }

  private readonly handleReaction: GameEventListener<'reaction:triggered'> = ({
    reaction,
    at,
    spreadTo,
  }) => {
    if (reaction === 'combust') {
      this.playBurst(at, this.combust.blast.radiusPx, REACTION_FX.combust);
      for (const id of spreadTo) this.playEmber(at, id);
      return;
    }
    this.playBurst(at, this.kaboom.blast.radiusPx, REACTION_FX.kaboom);
    this.movers.playSmoke(at, REACTION_FX.smoke);
    this.movers.playDebris(at, REACTION_FX.debris);
    // A chain restarts the shake instead of stacking; a smaller running shake gives way (§5c).
    if (this.screenShake.shake(REACTION_FX.shake)) this.shakes++;
  };

  /**
   * The flash budget is asked with the burst's near-white core radius (§1.9): the Kaboom core
   * (about 29 px) counts, the Combust pop core (about 13 px, under 16) always plays uncounted. A
   * skipped core still leaves the flame/ember burst at full radius.
   */
  private playBurst(at: Vec2, radiusPx: number, timing: BurstTiming): void {
    const core = this.flashBudget.tryFlash(burstCoreRadiusPx(radiusPx));
    const g = this.burstPool
      .acquire()
      .setPosition(at.x, at.y)
      .setScale(timing.startPx / radiusPx)
      .setAlpha(1);
    drawBurst(g, radiusPx, FIRE_BURST, core);
    this.bursts.push({ g, radiusPx, timing, ageMs: 0 });
  }

  private stepBursts(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i];
      if (!burst) continue;
      burst.ageMs += dt;
      const { startPx, expandMs, holdMs, fadeMs } = burst.timing;
      const age = burst.ageMs;
      if (age >= expandMs + holdMs + fadeMs) {
        this.burstPool.release(burst.g);
        this.bursts.splice(i, 1);
        continue;
      }
      const grow = Phaser.Math.Easing.Quadratic.Out(Math.min(1, age / expandMs));
      const start = startPx / burst.radiusPx;
      burst.g.setScale(start + (1 - start) * grow);
      const fading = age - expandMs - holdMs;
      burst.g.setAlpha(fading <= 0 ? 1 : 1 - fading / fadeMs);
    }
  }

  private playEmber(origin: Vec2, target: EntityId): void {
    const feet = this.units.positionOf(target);
    if (!feet) return;
    const { liftPx, trailAlpha } = REACTION_FX.embers;
    const from = { x: origin.x, y: origin.y - liftPx };
    const head = this.emberPool.acquire().setPosition(from.x, from.y).setAlpha(1);
    const trail = this.emberPool.acquire().setPosition(from.x, from.y).setAlpha(trailAlpha);
    this.embers.push({
      head,
      trail,
      from,
      target,
      to: { x: feet.x, y: feet.y - liftPx },
      history: [from],
      ageMs: 0,
    });
  }

  private stepEmbers(dt: number): void {
    const { lifeMs, arcPx, liftPx, trailFrames } = REACTION_FX.embers;
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const ember = this.embers[i];
      if (!ember) continue;
      ember.ageMs += dt;
      const t = ember.ageMs / lifeMs;
      if (t >= 1) {
        this.emberPool.release(ember.head);
        this.emberPool.release(ember.trail);
        this.embers.splice(i, 1);
        continue;
      }
      // Homes on the unit while it lives; a target that died keeps its last point (§5).
      const feet = this.units.positionOf(ember.target);
      if (feet) ember.to = { x: feet.x, y: feet.y - liftPx };
      const p = arcPoint(ember.from, ember.to, t, arcPx);
      ember.head.setPosition(p.x, p.y);
      ember.history.push(p);
      if (ember.history.length > trailFrames + 1) ember.history.shift();
      const tail = ember.history[0] ?? p;
      ember.trail.setPosition(tail.x, tail.y);
    }
  }
}
