import Phaser from 'phaser';
import type { EntityId, KaboomDef, KegDef, Rect, Vec2 } from '@core/types';
import type { AreaBody } from '@core/combat/area';
import type { IdAllocator } from '@core/ids';
import { createKeg, kegBodies, stepKegs, triggerKeg, type KegState } from '@core/structures/keg';
import { REACTIONS } from '@data/reactions';
import { KEG } from '@data/structures';
import type { EventBus } from '../bus/EventBus';
import { Depth, unitDepth } from '../depths';
import { drawOutlinedRing } from '../fx/bursts';
import { GraphicsPool, ImagePool, type PoolStats } from '../fx/ImagePool';
import { Palette } from '../palette';
import { KEG_ANCHOR, PlaceholderTextures } from '../placeholders';
import type { KegLink } from './CombatSystem';
import type { SpellHitBodies } from './SpellSystem';
import type { System } from './System';

/**
 * Fuse tell, readability.md §4 and §5 "Kaboom fuse": the keg blinks white/crimson at a 100 ms
 * period (sprite-only and local, exempt from the §1.9 flash cap, CD 2026-10-16, so it never asks
 * the FlashBudget), 2–3 flame sparks per 100 ms from the fuse stub
 * (life ≤ 150 ms), and the blast radius as a static ground ring (2 px crimson, 1 px ink inside
 * and outside) for the whole fuse. Presentation, not tuning; the ring radius is the data blast
 * radius (CD 2026-10-16: constants stay in src/game).
 */
const FUSE_FX = {
  /** Each colour holds half the 100 ms period. */
  blinkMs: 50,
  /** Pure white is not a style-guide colour; the CD approved a white fill for this blink. */
  blink: [0xffffff, Palette.crimson] as const,
  ring: { color: Palette.crimson, linePx: 2, outline: Palette.ink, outlinePx: 1 },
  sparks: { everyMs: 40, lifeMs: 150, risePx: 8, spreadPx: 4 },
  /** The fuse stub's tip above the keg's footprint centre (KEG_PIXELS row 1 vs anchor row 22). */
  fuseTipAboveAnchorPx: 21,
  fuseTipRightPx: 1,
} as const;

/** Called when a fuse ends: CombatSystem resolves the Kaboom (and lights the cascade). */
export type KaboomHandler = (keg: { readonly id: EntityId; readonly position: Vec2 }) => void;

export interface KegSystemOptions {
  readonly ids: IdAllocator;
  /** World positions, one keg each: the map's `powder-keg` objects (M7). */
  readonly positions: readonly Vec2[];
  /** Kegs are solid until their Kaboom (M7, GDD §8); shots pass them. Not solid when omitted. */
  readonly solids?: SolidRegistry;
  readonly def?: KegDef;
  readonly kaboom?: KaboomDef;
}

/** Where structures register their footprints (CollisionSystem). */
export interface SolidRegistry {
  addSolid(id: EntityId, rect: Rect, blocksShots: boolean): void;
  removeSolid(id: EntityId): void;
}

interface KegView {
  readonly sprite: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Graphics | null;
}

interface Spark {
  readonly image: Phaser.GameObjects.Image;
  readonly from: Vec2;
  readonly drift: number;
  ageMs: number;
}

/** Keg debug readout. */
export interface KegDebug {
  readonly id: EntityId;
  readonly position: Vec2;
  readonly phase: KegState['phase'];
  readonly fuseRemainingMs: number;
  /** True while the 72 px ring is drawn (D5: the whole fuse). */
  readonly ringShown: boolean;
}

/**
 * Powder kegs (GDD §8). Core's {@link KegState} list is the one authoritative state (idle → fuse →
 * spent); sprites, the fuse ring and the sparks only mirror it. Frame order: after spells, before
 * combat (M5.md): fuses count down here and each one that ends is handed to CombatSystem for the
 * Kaboom. Kegs light through {@link trigger} (CombatSystem, for spells, Combusts and Kaboom
 * cascades). A keg lit before this frame's step (a Spell-phase impact) is lit `beforeStep` (core
 * keg.ts), so it skips this frame's step; one lit after it (Combat phase, the cascade) starts
 * counting next frame. Either way its fuse lasts the full fuseMs and its ring is drawn from the
 * frame it was lit until the frame it blows (D5).
 *
 * Solid through `options.solids` until the Kaboom (M7). Spawns the map's kegs at scene start; {@link respawn}
 * (debug G) replaces them with fresh idle kegs and fresh ids.
 */
export class KegSystem implements System, KegLink, SpellHitBodies {
  private kegs: KegState[] = [];
  private readonly views = new Map<EntityId, KegView>();
  private readonly sparks: Spark[] = [];
  private readonly kegPool: ImagePool;
  private readonly ringPool: GraphicsPool;
  private readonly sparkPool: ImagePool;
  private readonly def: KegDef;
  private readonly kaboom: KaboomDef;
  private sinceSparkMs = 0;

  /** Game-loop frame of the last fuse step: a trigger in a later frame came before its step. */
  private steppedFrame = -1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly bus: EventBus,
    private readonly onKaboom: KaboomHandler,
    private readonly options: KegSystemOptions,
  ) {
    this.def = options.def ?? KEG;
    this.kaboom = options.kaboom ?? REACTIONS.kaboom;
    this.kegPool = new ImagePool(() =>
      scene.add.image(0, 0, PlaceholderTextures.Keg).setOrigin(KEG_ANCHOR.x, KEG_ANCHOR.y),
    );
    this.ringPool = new GraphicsPool(() => scene.add.graphics().setDepth(Depth.GroundFx));
    this.sparkPool = new ImagePool(() =>
      scene.add
        .image(0, 0, PlaceholderTextures.Ember)
        .setDepth(Depth.Fx)
        .setBlendMode(Phaser.BlendModes.ADD),
    );
    this.spawn();
  }

  /** Idle kegs count as `alive`: what area rings can light. */
  get areaBodies(): readonly AreaBody[] {
    return kegBodies(this.kegs, this.def);
  }

  /** A fusing keg still stops a Fireball (keg.ts `solidOnly`). */
  get spellHitBodies(): readonly AreaBody[] {
    return kegBodies(this.kegs, this.def, { solidOnly: true });
  }

  get debugKegs(): readonly KegDebug[] {
    return this.kegs.map((keg) => ({
      id: keg.id,
      position: { ...keg.position },
      phase: keg.phase,
      fuseRemainingMs: keg.fuseRemainingMs,
      ringShown: this.views.get(keg.id)?.ring?.visible === true,
    }));
  }

  get poolStats(): Readonly<Record<string, PoolStats>> {
    return {
      kegs: this.kegPool.stats,
      rings: this.ringPool.stats,
      sparks: this.sparkPool.stats,
    };
  }

  trigger(ids: readonly EntityId[]): void {
    const wanted = new Set(ids);
    const beforeStep = this.scene.game.loop.frame !== this.steppedFrame;
    this.kegs = this.kegs.map((keg) => {
      if (!wanted.has(keg.id)) return keg;
      const { keg: next, started } = triggerKeg(keg, this.kaboom, { beforeStep });
      if (started) {
        this.showRing(next);
        this.bus.emit('keg:fuse-started', { id: next.id, at: next.position });
      }
      return next;
    });
  }

  update(dt: number): void {
    this.steppedFrame = this.scene.game.loop.frame;
    const step = stepKegs(this.kegs, dt);
    this.kegs = [...step.kegs];
    for (const keg of step.exploded) {
      this.removeView(keg.id);
      this.options.solids?.removeSolid(keg.id);
      // May light more kegs through trigger(); they start counting next frame.
      this.onKaboom({ id: keg.id, position: keg.position });
    }
    this.syncFuses(dt);
  }

  /** Debug G: every keg replaced by a fresh idle one at its spawn. */
  respawn(): void {
    for (const id of [...this.views.keys()]) this.removeView(id);
    for (const keg of this.kegs) this.options.solids?.removeSolid(keg.id);
    for (const spark of this.sparks) this.sparkPool.release(spark.image);
    this.sparks.length = 0;
    this.spawn();
  }

  destroy(): void {
    this.views.clear();
    this.sparks.length = 0;
    this.kegs = [];
    this.kegPool.destroy();
    this.ringPool.destroy();
    this.sparkPool.destroy();
  }

  private spawn(): void {
    this.kegs = this.options.positions.map((position) =>
      createKeg(this.options.ids.next(), position),
    );
    const half = this.def.footprintPx / 2;
    for (const keg of this.kegs) {
      this.options.solids?.addSolid(
        keg.id,
        { x: keg.position.x - half, y: keg.position.y - half, width: half * 2, height: half * 2 },
        false,
      );
      const sprite = this.kegPool
        .acquire()
        .setPosition(keg.position.x, keg.position.y)
        .setDepth(unitDepth(keg.position.y))
        .clearTint();
      this.views.set(keg.id, { sprite, ring: null });
    }
  }

  private showRing(keg: KegState): void {
    const view = this.views.get(keg.id);
    if (!view || view.ring) return;
    // Static: it is the true danger area, so it never pulses or shrinks (§5).
    const { color, linePx, outline, outlinePx } = FUSE_FX.ring;
    view.ring = this.ringPool.acquire().clear().setPosition(keg.position.x, keg.position.y);
    drawOutlinedRing(view.ring, this.kaboom.blast.radiusPx, color, linePx, outline, outlinePx);
    // First blink colour at once, so the keg reads lit on the same frame as its ring.
    view.sprite.setTint(FUSE_FX.blink[0]).setTintMode(Phaser.TintModes.FILL);
  }

  /** Blink and sparks on every fusing keg (the ring is static); sparks age out. */
  private syncFuses(dt: number): void {
    this.sinceSparkMs += dt;
    const emit = this.sinceSparkMs >= FUSE_FX.sparks.everyMs;
    if (emit) this.sinceSparkMs = 0;
    for (const keg of this.kegs) {
      if (keg.phase !== 'fuse') continue;
      const view = this.views.get(keg.id);
      if (!view) continue;
      // Phase from the keg's own fuse, so every keg starts its blink on white.
      const litMs = this.kaboom.fuseMs - keg.fuseRemainingMs;
      const phase = Math.floor(litMs / FUSE_FX.blinkMs) % FUSE_FX.blink.length;
      view.sprite
        .setTint(FUSE_FX.blink[phase] ?? FUSE_FX.blink[0])
        .setTintMode(Phaser.TintModes.FILL);
      if (emit) {
        const from = {
          x: keg.position.x + FUSE_FX.fuseTipRightPx,
          y: keg.position.y - FUSE_FX.fuseTipAboveAnchorPx,
        };
        const drift = ((this.sparks.length % 3) - 1) * FUSE_FX.sparks.spreadPx;
        const image = this.sparkPool.acquire().setPosition(from.x, from.y).setAlpha(1);
        this.sparks.push({ image, from, drift, ageMs: 0 });
      }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const spark = this.sparks[i];
      if (!spark) continue;
      spark.ageMs += dt;
      const t = spark.ageMs / FUSE_FX.sparks.lifeMs;
      if (t >= 1) {
        this.sparkPool.release(spark.image);
        this.sparks.splice(i, 1);
        continue;
      }
      spark.image
        .setPosition(spark.from.x + spark.drift * t, spark.from.y - FUSE_FX.sparks.risePx * t)
        .setAlpha(1 - t);
    }
  }

  private removeView(id: EntityId): void {
    const view = this.views.get(id);
    if (!view) return;
    view.sprite.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
    this.kegPool.release(view.sprite);
    if (view.ring) this.ringPool.release(view.ring);
    this.views.delete(id);
  }
}
