import Phaser from 'phaser';
import type { EntityId, Vec2, VolunteerTuning } from '@core/types';
import { VOLUNTEER } from '@data/volunteer';
import type { EventBus, GameEventListener } from '../bus/EventBus';
import { Depth } from '../depths';
import { ARCANE_BURST, burstCoreRadiusPx, drawBurst } from '../fx/bursts';
import type { FlashBudget } from '../fx/FlashBudget';
import { GraphicsPool, ImagePool, ObjectPool, type PoolStats } from '../fx/ImagePool';
import type { ScreenShake } from '../fx/ScreenShake';
import { cssColor, Palette } from '../palette';
import {
  CHARACTER_EXTENT_ABOVE_FEET_PX,
  HatTextures,
  PLACEHOLDER_WIZARD_SCALE,
} from '../placeholders';
import type { SquadSystem } from '../systems/SquadSystem';
import type { System } from '../systems/System';
import type { VolunteerRunnerView } from '../systems/VolunteerSystem';

/**
 * Volunteer! FX, readability.md §5c "Volunteer! (in world)" and "Bark bubble" (M6 T2). Presentation,
 * not tuning (CD 2026-10-16: constants stay in src/game citing §5c); the blast radius and the fuse
 * come from VOLUNTEER.
 */
const VOLUNTEER_FX = {
  /** White/`arcane-light`, each colour held 150 ms (§2), as a 1-texel tinted outline. */
  outline: { holdMs: 150, colors: [Palette.cream, Palette.arcaneLight] as const, offsetPx: 2 },
  /** Around the feet, 14 → 4 px over the fuse: 1 px `arcane-light`, `ink` outside. */
  fuseRing: { startRadiusPx: 14, endRadiusPx: 4, linePx: 1 },
  /** Dashed 1 px `arcane` ring at the blast radius, following the runner, 50%, `ink` outside. */
  blastRing: { dashPx: 6, gapPx: 4, linePx: 1, alpha: 0.5 },
  /** 9×9 `arcane` X with an `ink` outline at the clamped aim. */
  marker: { halfPx: 4, linePx: 1, outlinePx: 1 },
  bark: {
    /** Tail tip this far above the top of the 48 px frame. */
    gapAboveFramePx: 4,
    padXPx: 4,
    padYPx: 3,
    borderPx: 1,
    tailPx: 3,
    plateAlpha: 0.85,
    maxWidthPx: 150,
    viewMarginPx: 4,
    /** Below the feet when flipped (no room above). */
    gapBelowFeetPx: 4,
    font: { fontFamily: 'monospace', fontSize: '8px' },
    popMs: 100,
    popPx: 1,
    holdMs: 600,
    fadeMs: 200,
  },
  /** Like Kaboom's timing (§5c): expand 16 → 64 in 60, hold 40, fade 200. */
  blast: { startPx: 16, expandMs: 60, holdMs: 40, fadeMs: 200 },
  /** The class hat arcs up and falls back in 600 ms, then lies as the dropped hat (about 5 s). */
  hat: { risePx: 28, driftPx: 10, flightMs: 600, restMs: 5000, fadeMs: 500, spinTurns: 1 },
  shake: { px: 2, durationMs: 120 },
} as const;

/**
 * Depth step that puts the outline just behind its sprite: far below unitDepth's 1 px step
 * (about 1e-5), so no other unit sorts between them.
 */
const OUTLINE_BEHIND_DEPTH = 1e-7;

const OUTLINE_OFFSETS: readonly Vec2[] = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
];

interface RunnerFx {
  readonly outlines: readonly Phaser.GameObjects.Image[];
  readonly fuseRing: Phaser.GameObjects.Graphics;
  readonly blastRing: Phaser.GameObjects.Graphics;
  readonly marker: Phaser.GameObjects.Graphics;
  ageMs: number;
}

interface Bubble {
  readonly id: EntityId;
  readonly plate: Phaser.GameObjects.Graphics;
  readonly text: Phaser.GameObjects.Text;
  readonly widthPx: number;
  readonly heightPx: number;
  ageMs: number;
  /** ms since the bang; null while the volunteer still runs. */
  heldMs: number | null;
}

interface Blast {
  readonly g: Phaser.GameObjects.Graphics;
  ageMs: number;
}

interface Hat {
  readonly image: Phaser.GameObjects.Image;
  readonly from: Vec2;
  readonly drift: number;
  ageMs: number;
}

/**
 * Pooled Volunteer! visuals: per sprinting volunteer a blinking outline (four fill-tinted copies of
 * its sprite behind it, so the hit flash on the sprite itself stays free), the fuse ring shrinking
 * over the fuse, the dashed blast ring that goes where they go, and the target marker at the
 * clamped aim; the bark bubble over the runner (held 600 ms after the bang, then fading); on
 * `volunteer:detonated` the violet Arcane Detonation at the blast radius, the hat flying up and
 * landing, and the shake through {@link ScreenShake}. Reads VolunteerSystem's runners every frame;
 * never changes game state.
 */
export class VolunteerFxView implements System {
  private readonly outlinePool: ImagePool;
  private readonly fuseRingPool: GraphicsPool;
  private readonly blastRingPool: GraphicsPool;
  private readonly markerPool: GraphicsPool;
  private readonly platePool: GraphicsPool;
  private readonly textPool: ObjectPool<Phaser.GameObjects.Text>;
  private readonly blastPool: GraphicsPool;
  private readonly hatPool: ImagePool;
  private readonly live = new Map<EntityId, RunnerFx>();
  private readonly bubbles: Bubble[] = [];
  private readonly blasts: Blast[] = [];
  private readonly hats: Hat[] = [];
  private shakes = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly camera: Phaser.Cameras.Scene2D.Camera,
    private readonly screenShake: ScreenShake,
    private readonly source: { readonly runners: readonly VolunteerRunnerView[] },
    private readonly squad: SquadSystem,
    private readonly bus: EventBus,
    private readonly flashBudget: FlashBudget,
    private readonly tuning: VolunteerTuning = VOLUNTEER,
  ) {
    this.outlinePool = new ImagePool(() =>
      scene.add.image(0, 0, HatTextures.pyromancer).setTintMode(Phaser.TintModes.FILL),
    );
    const graphics = (depth: number) => () => scene.add.graphics().setDepth(depth);
    this.fuseRingPool = new GraphicsPool(graphics(Depth.GroundFx));
    this.blastRingPool = new GraphicsPool(graphics(Depth.GroundFx));
    this.markerPool = new GraphicsPool(graphics(Depth.GroundFx));
    this.platePool = new GraphicsPool(graphics(Depth.SpeechPlate));
    this.textPool = new ObjectPool(() =>
      scene.add
        .text(0, 0, '', {
          ...VOLUNTEER_FX.bark.font,
          color: cssColor(Palette.cream),
          wordWrap: {
            width: VOLUNTEER_FX.bark.maxWidthPx - VOLUNTEER_FX.bark.padXPx * 2,
            useAdvancedWrap: true,
          },
          maxLines: 2,
        })
        .setOrigin(0.5, 0)
        .setDepth(Depth.SpeechText),
    );
    this.blastPool = new GraphicsPool(graphics(Depth.Fx));
    this.hatPool = new ImagePool(() =>
      scene.add
        .image(0, 0, HatTextures.pyromancer)
        .setScale(PLACEHOLDER_WIZARD_SCALE)
        .setDepth(Depth.Fx),
    );
    bus.on('volunteer:started', this.handleStarted);
    bus.on('volunteer:detonated', this.handleDetonated);
  }

  get poolStats(): Readonly<Record<string, PoolStats>> {
    return {
      volunteerOutlines: this.outlinePool.stats,
      volunteerFuseRings: this.fuseRingPool.stats,
      volunteerBlastRings: this.blastRingPool.stats,
      volunteerMarkers: this.markerPool.stats,
      barkPlates: this.platePool.stats,
      barkTexts: this.textPool.stats,
      detonations: this.blastPool.stats,
      hats: this.hatPool.stats,
    };
  }

  /** Bark bubbles on screen now (debug). */
  get barksShown(): number {
    return this.bubbles.length;
  }

  get shakeCount(): number {
    return this.shakes;
  }

  update(dt: number): void {
    this.syncRunners(dt);
    this.stepBubbles(dt);
    this.stepBlasts(dt);
    this.stepHats(dt);
  }

  destroy(): void {
    this.bus.off('volunteer:started', this.handleStarted);
    this.bus.off('volunteer:detonated', this.handleDetonated);
    this.live.clear();
    this.bubbles.length = 0;
    this.blasts.length = 0;
    this.hats.length = 0;
    this.outlinePool.destroy();
    this.fuseRingPool.destroy();
    this.blastRingPool.destroy();
    this.markerPool.destroy();
    this.platePool.destroy();
    this.textPool.destroy();
    this.blastPool.destroy();
    this.hatPool.destroy();
  }

  // --- Runners -----------------------------------------------------------------------------

  /** FX made on a runner's first frame, mirrored every frame, released when it is gone. */
  private syncRunners(dt: number): void {
    const seen = new Set<EntityId>();
    for (const runner of this.source.runners) {
      seen.add(runner.id);
      let fx = this.live.get(runner.id);
      if (!fx) {
        fx = this.acquireRunner(runner);
        this.live.set(runner.id, fx);
      } else {
        fx.ageMs += dt;
      }
      this.drawRunner(runner, fx);
    }
    for (const [id, fx] of this.live) {
      if (seen.has(id)) continue;
      for (const image of fx.outlines) this.outlinePool.release(image);
      this.fuseRingPool.release(fx.fuseRing);
      this.blastRingPool.release(fx.blastRing);
      this.markerPool.release(fx.marker);
      this.live.delete(id);
    }
  }

  private acquireRunner(runner: VolunteerRunnerView): RunnerFx {
    const outlines = OUTLINE_OFFSETS.map(() => this.outlinePool.acquire());
    const fuseRing = this.fuseRingPool.acquire().clear().setAlpha(1);
    const blastRing = this.blastRingPool.acquire().clear().setAlpha(VOLUNTEER_FX.blastRing.alpha);
    this.drawBlastRing(blastRing);
    const marker = this.markerPool
      .acquire()
      .clear()
      .setPosition(runner.target.x, runner.target.y)
      .setAlpha(1);
    const { halfPx, linePx, outlinePx } = VOLUNTEER_FX.marker;
    for (const [width, color] of [
      [linePx + outlinePx * 2, Palette.ink],
      [linePx, Palette.arcane],
    ] as const) {
      marker
        .lineStyle(width, color)
        .lineBetween(-halfPx, -halfPx, halfPx, halfPx)
        .lineBetween(-halfPx, halfPx, halfPx, -halfPx);
    }
    return { outlines, fuseRing, blastRing, marker, ageMs: 0 };
  }

  /** Dashes at the blast radius, `ink` just outside each one. */
  private drawBlastRing(g: Phaser.GameObjects.Graphics): void {
    const { dashPx, gapPx, linePx } = VOLUNTEER_FX.blastRing;
    const r = this.tuning.blast.radiusPx;
    const count = Math.max(1, Math.round((2 * Math.PI * r) / (dashPx + gapPx)));
    const step = (2 * Math.PI) / count;
    const span = step * (dashPx / (dashPx + gapPx));
    for (const [radius, color] of [
      [r + linePx, Palette.ink],
      [r, Palette.arcane],
    ] as const) {
      for (let i = 0; i < count; i++) {
        g.lineStyle(linePx, color)
          .beginPath()
          .arc(0, 0, radius, i * step, i * step + span, false)
          .strokePath();
      }
    }
  }

  private drawRunner(runner: VolunteerRunnerView, fx: RunnerFx): void {
    const { x, y } = runner.position;
    const sprite = this.squad.spriteOf(runner.id);
    const { holdMs, colors, offsetPx } = VOLUNTEER_FX.outline;
    const tint = colors[Math.floor(fx.ageMs / holdMs) % colors.length] ?? colors[0];
    fx.outlines.forEach((image, i) => {
      const offset = OUTLINE_OFFSETS[i] ?? { x: 0, y: 0 };
      image.setVisible(sprite !== undefined);
      if (!sprite) return;
      image
        .setTexture(sprite.texture.key)
        .setOrigin(sprite.originX, sprite.originY)
        .setScale(sprite.scaleX, sprite.scaleY)
        .setFlipX(sprite.flipX)
        .setPosition(sprite.x + offset.x * offsetPx, sprite.y + offset.y * offsetPx)
        .setDepth(sprite.depth - OUTLINE_BEHIND_DEPTH)
        .setTint(tint)
        .setTintMode(Phaser.TintModes.FILL);
    });

    const ring = VOLUNTEER_FX.fuseRing;
    const t = Math.min(1, runner.elapsedMs / this.tuning.fuseMs);
    const radius = ring.startRadiusPx + (ring.endRadiusPx - ring.startRadiusPx) * t;
    fx.fuseRing
      .clear()
      .setPosition(x, y)
      .lineStyle(ring.linePx, Palette.ink)
      .strokeCircle(0, 0, radius + ring.linePx)
      .lineStyle(ring.linePx, Palette.arcaneLight)
      .strokeCircle(0, 0, radius);
    fx.blastRing.setPosition(x, y);
  }

  // --- Bark bubble -------------------------------------------------------------------------

  private readonly handleStarted: GameEventListener<'volunteer:started'> = ({ id, bark }) => {
    const { padXPx, padYPx, borderPx, tailPx, plateAlpha } = VOLUNTEER_FX.bark;
    const text = this.textPool.acquire().setText(bark).setAlpha(1);
    const w = Math.ceil(text.width) + padXPx * 2;
    const h = Math.ceil(text.height) + padYPx * 2;
    // Local origin: the tail tip. The plate sits above it.
    const plate = this.platePool
      .acquire()
      .clear()
      .setAlpha(1)
      .setScale(1)
      .fillStyle(Palette.cream)
      .fillRect(-w / 2 - borderPx, -tailPx - h - borderPx, w + borderPx * 2, h + borderPx * 2)
      .fillStyle(Palette.ink, plateAlpha)
      .fillRect(-w / 2, -tailPx - h, w, h)
      .fillStyle(Palette.cream)
      .fillTriangle(-tailPx, -tailPx, tailPx, -tailPx, 0, 0);
    this.bubbles.push({ id, plate, text, widthPx: w, heightPx: h, ageMs: 0, heldMs: null });
  };

  /** Follows the runner at whole pixels, kept in the view; frozen once the runner went off. */
  private stepBubbles(dt: number): void {
    const b = VOLUNTEER_FX.bark;
    const view = this.camera.worldView;
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const bubble = this.bubbles[i];
      if (!bubble) continue;
      bubble.ageMs += dt;
      if (bubble.heldMs !== null) {
        bubble.heldMs += dt;
        const fade = bubble.heldMs - b.holdMs;
        if (fade >= b.fadeMs) {
          this.platePool.release(bubble.plate);
          this.textPool.release(bubble.text);
          this.bubbles.splice(i, 1);
          continue;
        }
        const alpha = fade <= 0 ? 1 : 1 - fade / b.fadeMs;
        bubble.plate.setAlpha(alpha);
        bubble.text.setAlpha(alpha);
        continue;
      }
      const feet = this.squad.positionOf(bubble.id);
      if (!feet) continue;
      const pop = bubble.ageMs < b.popMs ? b.popPx : 0;
      const half = bubble.widthPx / 2 + b.borderPx;
      const left = view.x + b.viewMarginPx + half;
      const right = view.right - b.viewMarginPx - half;
      const x = Math.round(Phaser.Math.Clamp(feet.x, left, Math.max(left, right)));
      let tip = feet.y - CHARACTER_EXTENT_ABOVE_FEET_PX - b.gapAboveFramePx - pop;
      const top = tip - b.tailPx - bubble.heightPx - b.borderPx;
      // No room above: flip below the feet (tail up).
      const flipped = top < view.y + b.viewMarginPx;
      if (flipped) tip = feet.y + b.gapBelowFeetPx;
      tip = Math.round(tip);
      bubble.plate.setPosition(x, tip).setScale(1, flipped ? -1 : 1);
      const textTop = flipped
        ? tip + b.tailPx + b.padYPx
        : tip - b.tailPx - bubble.heightPx + b.padYPx;
      bubble.text.setPosition(x, Math.round(textTop));
    }
  }

  // --- Detonation --------------------------------------------------------------------------

  private readonly handleDetonated: GameEventListener<'volunteer:detonated'> = ({ id, at }) => {
    for (const bubble of this.bubbles) {
      if (bubble.id === id && bubble.heldMs === null) bubble.heldMs = 0;
    }

    const radiusPx = this.tuning.blast.radiusPx;
    // The cream core (about 26 px) is past §1.9's 16 px: it asks the budget like Kaboom's.
    const core = this.flashBudget.tryFlash(burstCoreRadiusPx(radiusPx));
    const g = this.blastPool
      .acquire()
      .setPosition(at.x, at.y)
      .setScale(VOLUNTEER_FX.blast.startPx / radiusPx)
      .setAlpha(1);
    drawBurst(g, radiusPx, ARCANE_BURST, core);
    this.blasts.push({ g, ageMs: 0 });

    const image = this.hatPool
      .acquire()
      .setTexture(HatTextures[this.squad.classOf(id)])
      .setOrigin(0.5, 1)
      .setPosition(at.x, at.y)
      .setRotation(0)
      .setAlpha(1);
    const drift = (id % 2 === 0 ? 1 : -1) * VOLUNTEER_FX.hat.driftPx;
    this.hats.push({ image, from: { ...at }, drift, ageMs: 0 });

    if (this.screenShake.shake(VOLUNTEER_FX.shake)) this.shakes++;
  };

  private stepBlasts(dt: number): void {
    const { startPx, expandMs, holdMs, fadeMs } = VOLUNTEER_FX.blast;
    const start = startPx / this.tuning.blast.radiusPx;
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const blast = this.blasts[i];
      if (!blast) continue;
      blast.ageMs += dt;
      const age = blast.ageMs;
      if (age >= expandMs + holdMs + fadeMs) {
        this.blastPool.release(blast.g);
        this.blasts.splice(i, 1);
        continue;
      }
      const grow = Phaser.Math.Easing.Quadratic.Out(Math.min(1, age / expandMs));
      blast.g.setScale(start + (1 - start) * grow);
      const fading = age - expandMs - holdMs;
      blast.g.setAlpha(fading <= 0 ? 1 : 1 - fading / fadeMs);
    }
  }

  /** Up and back down onto the ground (a sine arc), one turn in the air, then lies and fades. */
  private stepHats(dt: number): void {
    const { risePx, flightMs, restMs, fadeMs, spinTurns } = VOLUNTEER_FX.hat;
    for (let i = this.hats.length - 1; i >= 0; i--) {
      const hat = this.hats[i];
      if (!hat) continue;
      hat.ageMs += dt;
      const life = flightMs + restMs;
      if (hat.ageMs >= life) {
        this.hatPool.release(hat.image);
        this.hats.splice(i, 1);
        continue;
      }
      const t = Math.min(1, hat.ageMs / flightMs);
      hat.image
        .setPosition(
          Math.round(hat.from.x + hat.drift * t),
          Math.round(hat.from.y - Math.sin(t * Math.PI) * risePx),
        )
        .setRotation(t < 1 ? t * spinTurns * Math.PI * 2 * Math.sign(hat.drift) : 0)
        .setAlpha(Math.min(1, (life - hat.ageMs) / fadeMs));
    }
  }
}
