import Phaser from 'phaser';
import type {
  ConvergenceDef,
  ConvergenceId,
  Element,
  EntityId,
  MageClassId,
  Vec2,
} from '@core/types';
import { CLASSES } from '@data/classes';
import { CONVERGENCES } from '@data/convergences';
import type { EventBus, GameEventListener } from '../bus/EventBus';
import { Depth } from '../depths';
import { drawBolt, jitter, STORM_BOLT } from '../fx/bolts';
import { burstCoreRadiusPx, drawBurst, drawOutlinedRing, FIRE_BURST } from '../fx/bursts';
import type { FlashBudget } from '../fx/FlashBudget';
import { GraphicsPool, ImagePool, type PoolStats } from '../fx/ImagePool';
import { Movers } from '../fx/Movers';
import type { ScreenShake } from '../fx/ScreenShake';
import { Palette } from '../palette';
import { PlaceholderTextures, STRIKE_FLASH_RADIUS_PX } from '../placeholders';
import type { System } from '../systems/System';

/**
 * Convergence FX, readability.md §5c "Channel", "Preview ring" and "Strikes" (M6 T2). Presentation,
 * not tuning (CD 2026-10-16: constants stay in src/game citing §5c); combo radii, fall time,
 * barrage length and burn time are read from CONVERGENCES, the channel length from the source.
 */
const CONVERGENCE_FX = {
  /** Staff tip relative to the feet (placeholder wizard: tip texel (13, 9), anchor (8, 15.3), ×3). */
  staffTip: { x: 15, y: -19 },
  /** Above the leader's staff tip; diameter 4 → 12 px over the channel (its progress bar). */
  orb: {
    startDiameterPx: 4,
    endDiameterPx: 12,
    gapAboveTipPx: 1,
    rimPx: 1,
    /** Moves to a new leader with the leader marker's pop (§2: ≤ 200 ms). */
    popMs: 180,
    popScale: 0.6,
    /** At release: a 2-frame upward streak, then gone. */
    streak: { frames: 2, lengthPx: 18, linePx: 2 },
  },
  /** 5 px: 1 px core, 1 px element edge each side, 1 px ink at 60% outside. */
  beam: {
    inkPx: 5,
    inkAlpha: 0.6,
    edgePx: 3,
    corePx: 1,
    /** The last px before the orb turn arcane (the violet meeting point, §2). */
    meetPx: 12,
    growMs: 100,
    fadeMs: 100,
    /** Cream dashes toward the leader: direction cue that reads in grayscale. */
    dash: { px: 4, spacingPx: 16, speedPxPerS: 240 },
  },
  beamColors: {
    fire: { edge: Palette.flame, core: Palette.flameWhite },
    storm: { edge: Palette.cyan, core: Palette.bolt },
  } satisfies Record<Element, { readonly edge: number; readonly core: number }>,
  /** Dashed 8 on / 4 off, rotating clockwise; solid at lock (§5c "Preview ring"). */
  ring: {
    dashPx: 8,
    gapPx: 4,
    linePx: 2,
    outlinePx: 1,
    outline: Palette.ink,
    spinRadPerS: Math.PI / 4,
    /** 5×5 `+` at the aim. */
    markHalfPx: 2,
    fadeInMs: 100,
    swapFadeMs: 150,
    lockSolidMs: 150,
    strikeAlpha: 0.5,
    strikeFadeMs: 200,
    cancelFadeMs: 200,
  },
  ringColors: {
    meteor: [Palette.flame],
    thunderstorm: [Palette.cyan],
    firestorm: [Palette.flame, Palette.cyan],
  } satisfies Record<ConvergenceId, readonly number[]>,
  /** `ink` disc 18 → radius (ease-in, a fall), alpha 25% → 50%, hard edge, 1 px darker rim. */
  shadow: { startRadiusPx: 18, startAlpha: 0.25, endAlpha: 0.5, rimPx: 1, rimExtraAlpha: 0.3 },
  meteor: {
    burst: { startPx: 24, expandMs: 80, holdMs: 60, fadeMs: 260 },
    smoke: {
      rises: [32, 35, 38, 40],
      riseMs: 700,
      lifeMs: 1000,
      swayPx: 6,
      startScale: 2,
      endScale: 4.5,
      startAlpha: 0.85,
    },
    debris: { chips: 8, lifeMs: 400, distancesPx: [40, 56, 48, 64, 44, 60, 52, 36], hopPx: 20 },
    shake: { px: 3, durationMs: 200 },
  },
  /** Firestorm meteorlets: core held to 12 px (under the 16 px flash size, never counted). */
  meteorlet: {
    burst: { startPx: 8, expandMs: 60, holdMs: 40, fadeMs: 160 },
    coreRadiusPx: 12,
    streak: { frames: 2, lengthPx: 48, linePx: 3 },
    shake: { px: 1, durationMs: 80 },
  },
  /** M5 bolt, 120 ms, and a ground flash at the blast radius (core ≤ 40%). No shake. */
  bolt: { lifeMs: 120, flashLifeMs: 160 },
  /** Calm rules (§5c): soil disc, stepped edge, ember rim, 8 small flickering licks. */
  groundBurn: {
    fill: Palette.soil,
    fillAlpha: 0.45,
    rim: Palette.ember,
    rimPx: 2,
    rimAlpha: 0.7,
    edgeSteps: 32,
    edgeJitter: 0.06,
    licks: 8,
    lickInsetPx: 8,
    lickFrameMs: 200,
    fadeMs: 500,
  },
  /** `slate` 25% disc, stepped edge, ground layer: the cloud's shadow. */
  cloud: {
    color: Palette.slate,
    alpha: 0.25,
    edgeSteps: 28,
    edgeJitter: 0.06,
    fadeInMs: 150,
    fadeOutMs: 200,
  },
} as const;

interface BurstTiming {
  readonly startPx: number;
  readonly expandMs: number;
  readonly holdMs: number;
  readonly fadeMs: number;
}

/** The channel as ConvergenceSystem holds it, for the beams, orb and preview ring. */
export interface ChannelView {
  /** Living wizards right now, leader first (beams retarget on succession, GDD Q4). */
  readonly wizards: readonly { readonly id: EntityId; readonly position: Vec2 }[];
  /** The aim, tracked and clamped; locks at strike. */
  readonly aim: Vec2;
  /** The combo the squad alive now would get (the ring radius), or null. */
  readonly previewCombo: ConvergenceId | null;
  readonly elapsedMs: number;
  readonly channelMs: number;
}

export interface ConvergenceFxSource {
  /** Null when no channel runs. */
  readonly channel: ChannelView | null;
  classOf(id: EntityId): MageClassId;
}

interface Beam {
  readonly g: Phaser.GameObjects.Graphics;
  readonly element: Element;
  ageMs: number;
  from: Vec2;
  to: Vec2;
}

type RingPhase = 'tracking' | 'locked' | 'fading';

interface Ring {
  readonly g: Phaser.GameObjects.Graphics;
  readonly mark: Phaser.GameObjects.Graphics;
  readonly combo: ConvergenceId;
  phase: RingPhase;
  ageMs: number;
  /** Alpha when a fade started, and its length. */
  fadeFrom: number;
  fadeMs: number;
  /** Barrage: ms the locked ring stays as the strike area. Null for Meteor (until impact). */
  strikeMs: number | null;
}

interface Timed {
  readonly g: Phaser.GameObjects.Graphics;
  readonly at: Vec2;
  readonly radiusPx: number;
  ageMs: number;
}

interface Burst extends Timed {
  readonly timing: BurstTiming;
}

interface Streak {
  readonly g: Phaser.GameObjects.Graphics;
  framesLeft: number;
}

interface Ground extends Timed {
  readonly lifeMs: number;
  readonly licks: readonly Phaser.GameObjects.Image[];
}

interface Cloud extends Timed {
  readonly holdMs: number;
}

interface TimedImage {
  readonly image: Phaser.GameObjects.Image;
  ageMs: number;
}

/**
 * Pooled Convergence visuals. While channelling: the leader orb (grows with the channel, pops to a
 * new leader), one beam per living non-leader wizard (element colours, violet meeting point, cream
 * dashes toward the leader; grow in, fade out on death, snap to a new leader), and the dashed,
 * rotating preview ring at the clamped aim, sized to the combo the living squad would get (a
 * downgrade swaps it). At release: the orb streaks off and the ring locks solid (Meteor: until the
 * impact; barrage: half alpha for the strike). Strikes: Meteor's falling shadow, impact, smoke,
 * debris and burning ground; the barrage cloud; meteorlets; M5 bolts. Shakes go through the shared
 * {@link ScreenShake} (§5c shake rule). Reads the channel view and the `convergence:*` events;
 * never changes game state.
 */
export class ConvergenceFxView implements System {
  private readonly beamPool: GraphicsPool;
  private readonly orbPool: GraphicsPool;
  private readonly ringPool: GraphicsPool;
  private readonly markPool: GraphicsPool;
  private readonly shadowPool: GraphicsPool;
  private readonly burstPool: GraphicsPool;
  private readonly streakPool: GraphicsPool;
  private readonly groundPool: GraphicsPool;
  private readonly lickPool: ImagePool;
  private readonly cloudPool: GraphicsPool;
  private readonly boltPool: GraphicsPool;
  private readonly flashPool: ImagePool;
  private readonly smokePool: ImagePool;
  private readonly debrisPool: ImagePool;
  private readonly movers: Movers;
  private readonly beams = new Map<EntityId, Beam>();
  private readonly fadingBeams: Beam[] = [];
  private orb: { readonly g: Phaser.GameObjects.Graphics; leader: EntityId; popMs: number } | null =
    null;
  private ring: Ring | null = null;
  private readonly oldRings: Ring[] = [];
  private readonly shadows: (Timed & { readonly fallMs: number })[] = [];
  private readonly bursts: Burst[] = [];
  private readonly streaks: Streak[] = [];
  private readonly grounds: Ground[] = [];
  private readonly clouds: Cloud[] = [];
  private readonly bolts: TimedImage[] = [];
  private readonly boltLines: (Timed & { readonly lifeMs: number })[] = [];
  private shakes = 0;
  private impacts = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly camera: Phaser.Cameras.Scene2D.Camera,
    private readonly screenShake: ScreenShake,
    private readonly source: ConvergenceFxSource,
    private readonly bus: EventBus,
    private readonly flashBudget: FlashBudget,
    private readonly convergences: Readonly<Record<ConvergenceId, ConvergenceDef>> = CONVERGENCES,
  ) {
    const graphics = (depth: number) => () => scene.add.graphics().setDepth(depth);
    this.beamPool = new GraphicsPool(graphics(Depth.Fx));
    this.orbPool = new GraphicsPool(graphics(Depth.Fx));
    this.ringPool = new GraphicsPool(graphics(Depth.GroundFx));
    this.markPool = new GraphicsPool(graphics(Depth.GroundFx));
    this.shadowPool = new GraphicsPool(graphics(Depth.GroundFx));
    this.burstPool = new GraphicsPool(graphics(Depth.Fx));
    this.streakPool = new GraphicsPool(graphics(Depth.Fx));
    this.groundPool = new GraphicsPool(graphics(Depth.GroundDecals));
    this.lickPool = new ImagePool(() =>
      scene.add
        .image(0, 0, PlaceholderTextures.GroundFlameA)
        .setOrigin(0.5, 1)
        .setDepth(Depth.GroundDecalDetails),
    );
    this.cloudPool = new GraphicsPool(graphics(Depth.GroundDecals));
    this.boltPool = new GraphicsPool(graphics(Depth.Fx));
    this.flashPool = new ImagePool(() =>
      scene.add.image(0, 0, PlaceholderTextures.StrikeFlash).setDepth(Depth.GroundFx),
    );
    this.smokePool = new ImagePool(() =>
      scene.add.image(0, 0, PlaceholderTextures.Puff).setDepth(Depth.Fx).setTint(Palette.ash),
    );
    this.debrisPool = new ImagePool(() =>
      scene.add.image(0, 0, PlaceholderTextures.Debris).setDepth(Depth.Fx),
    );
    this.movers = new Movers(this.smokePool, this.debrisPool);
    bus.on('convergence:released', this.handleReleased);
    bus.on('convergence:impact', this.handleImpact);
    bus.on('convergence:cancelled', this.handleCancelled);
  }

  get poolStats(): Readonly<Record<string, PoolStats>> {
    return {
      beams: this.beamPool.stats,
      channelOrb: this.orbPool.stats,
      previewRing: this.ringPool.stats,
      previewMark: this.markPool.stats,
      meteorShadows: this.shadowPool.stats,
      strikeBursts: this.burstPool.stats,
      strikeStreaks: this.streakPool.stats,
      burningGround: this.groundPool.stats,
      groundLicks: this.lickPool.stats,
      clouds: this.cloudPool.stats,
      strikeBolts: this.boltPool.stats,
      strikeFlashes: this.flashPool.stats,
      meteorSmoke: this.smokePool.stats,
      meteorDebris: this.debrisPool.stats,
    };
  }

  /** Beams and orb drawn now, the preview ring's combo and phase (debug, D2). */
  get debugState(): {
    readonly beams: number;
    readonly orbLeader: EntityId | null;
    readonly ringCombo: ConvergenceId | null;
    readonly ringPhase: RingPhase | null;
    readonly impactsDrawn: number;
    readonly shakes: number;
  } {
    return {
      beams: this.beams.size,
      orbLeader: this.orb?.leader ?? null,
      ringCombo: this.ring?.combo ?? null,
      ringPhase: this.ring?.phase ?? null,
      impactsDrawn: this.impacts,
      shakes: this.shakes,
    };
  }

  update(dt: number): void {
    this.syncChannel(dt);
    this.stepRings(dt);
    this.stepFadingBeams(dt);
    this.stepShadows(dt);
    this.stepBursts(dt);
    this.stepStreaks();
    this.stepGrounds(dt);
    this.stepClouds(dt);
    this.stepBolts(dt);
    this.movers.update(dt);
  }

  destroy(): void {
    this.bus.off('convergence:released', this.handleReleased);
    this.bus.off('convergence:impact', this.handleImpact);
    this.bus.off('convergence:cancelled', this.handleCancelled);
    this.beams.clear();
    this.fadingBeams.length = 0;
    this.orb = null;
    this.ring = null;
    this.oldRings.length = 0;
    this.shadows.length = 0;
    this.bursts.length = 0;
    this.streaks.length = 0;
    this.grounds.length = 0;
    this.clouds.length = 0;
    this.bolts.length = 0;
    this.boltLines.length = 0;
    this.movers.clear();
    for (const pool of [
      this.beamPool,
      this.orbPool,
      this.ringPool,
      this.markPool,
      this.shadowPool,
      this.burstPool,
      this.streakPool,
      this.groundPool,
      this.lickPool,
      this.cloudPool,
      this.boltPool,
      this.flashPool,
      this.smokePool,
      this.debrisPool,
    ]) {
      pool.destroy();
    }
  }

  // --- Channel -----------------------------------------------------------------------------

  /** Orb, beams and ring mirror the channel every frame. */
  private syncChannel(dt: number): void {
    const channel = this.source.channel;
    const leader = channel?.wizards[0];
    if (!channel || !leader) {
      this.endChannel(null);
      return;
    }
    const t = channel.channelMs > 0 ? Math.min(1, channel.elapsedMs / channel.channelMs) : 1;
    const orbAt = this.syncOrb(leader, t, dt);

    const seen = new Set<EntityId>();
    for (const wizard of channel.wizards.slice(1)) {
      seen.add(wizard.id);
      const from = staffTip(wizard.position);
      let beam = this.beams.get(wizard.id);
      if (!beam) {
        beam = {
          g: this.beamPool.acquire().setPosition(0, 0).setAlpha(1),
          element: CLASSES[this.source.classOf(wizard.id)].element,
          ageMs: 0,
          from,
          to: orbAt,
        };
        this.beams.set(wizard.id, beam);
      } else {
        beam.ageMs += dt;
      }
      beam.from = from;
      // Snaps to the orb (a new leader's) in one frame: `to` is re-read every frame.
      beam.to = orbAt;
      const grow = Math.min(1, beam.ageMs / CONVERGENCE_FX.beam.growMs);
      this.drawBeam(beam, grow, channel.elapsedMs);
    }
    for (const [id, beam] of this.beams) {
      if (seen.has(id)) continue;
      this.beams.delete(id);
      // The new leader's own beam goes at once (it is the target); a dead wizard's fades.
      if (id === leader.id) this.beamPool.release(beam.g);
      else this.fadingBeams.push({ ...beam, ageMs: 0 });
    }
    this.syncRing(channel, dt);
  }

  /** The orb above the leader's staff tip: its centre, which every beam ends on. */
  private syncOrb(
    leader: { readonly id: EntityId; readonly position: Vec2 },
    t: number,
    dt: number,
  ): Vec2 {
    const { startDiameterPx, endDiameterPx, gapAboveTipPx, rimPx, popMs, popScale } =
      CONVERGENCE_FX.orb;
    this.orb ??= { g: this.orbPool.acquire().setAlpha(1), leader: leader.id, popMs };
    const orb = this.orb;
    if (orb.leader !== leader.id) {
      orb.leader = leader.id;
      orb.popMs = 0;
    }
    orb.popMs = Math.min(popMs, orb.popMs + dt);
    const r = (startDiameterPx + (endDiameterPx - startDiameterPx) * t) / 2;
    const tip = staffTip(leader.position);
    const at = { x: tip.x, y: tip.y - gapAboveTipPx - r };
    const pop = popScale * (1 - Phaser.Math.Easing.Back.Out(orb.popMs / popMs));
    orb.g
      .clear()
      .setPosition(at.x, at.y)
      .setScale(1 + pop)
      .fillStyle(Palette.arcane)
      .fillCircle(0, 0, r)
      .fillStyle(Palette.arcaneLight)
      .fillCircle(0, 0, Math.max(0, r - rimPx))
      .fillStyle(Palette.cream)
      .fillCircle(0, 0, Math.max(0, r - rimPx) * 0.5);
    return at;
  }

  /**
   * Ink under all, element edge and core, the last `meetPx` in arcane, cream dashes moving toward
   * the orb. `grow` 0..1 is how far from the wizard it reaches yet.
   */
  private drawBeam(beam: Beam, grow: number, elapsedMs: number): void {
    const { inkPx, inkAlpha, edgePx, corePx, meetPx, dash } = CONVERGENCE_FX.beam;
    const { from, to, g } = beam;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const full = Math.hypot(dx, dy);
    g.clear();
    if (full <= 0 || grow <= 0) return;
    const ux = dx / full;
    const uy = dy / full;
    const length = full * grow;
    const at = (s: number): Vec2 => ({ x: from.x + ux * s, y: from.y + uy * s });
    const end = at(length);
    const meetFrom = at(Math.max(0, full - meetPx));
    const colors = CONVERGENCE_FX.beamColors[beam.element];
    g.lineStyle(inkPx, Palette.ink, inkAlpha).lineBetween(from.x, from.y, end.x, end.y);
    const elementEnd = length < full - meetPx ? end : meetFrom;
    g.lineStyle(edgePx, colors.edge).lineBetween(from.x, from.y, elementEnd.x, elementEnd.y);
    g.lineStyle(corePx, colors.core).lineBetween(from.x, from.y, elementEnd.x, elementEnd.y);
    if (length > full - meetPx) {
      g.lineStyle(edgePx, Palette.arcane).lineBetween(meetFrom.x, meetFrom.y, end.x, end.y);
      g.lineStyle(corePx, Palette.arcaneLight).lineBetween(meetFrom.x, meetFrom.y, end.x, end.y);
    }
    const offset = ((elapsedMs * dash.speedPxPerS) / 1000) % dash.spacingPx;
    g.lineStyle(corePx, Palette.cream);
    for (let s = offset; s + dash.px <= length; s += dash.spacingPx) {
      const a = at(s);
      const b = at(s + dash.px);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
  }

  private stepFadingBeams(dt: number): void {
    const { fadeMs } = CONVERGENCE_FX.beam;
    for (let i = this.fadingBeams.length - 1; i >= 0; i--) {
      const beam = this.fadingBeams[i];
      if (!beam) continue;
      beam.ageMs += dt;
      if (beam.ageMs >= fadeMs) {
        this.beamPool.release(beam.g);
        this.fadingBeams.splice(i, 1);
        continue;
      }
      beam.g.setAlpha(1 - beam.ageMs / fadeMs);
    }
  }

  /**
   * The channel is over (released, cancelled, or gone): beams fade, the orb goes, streaking up on
   * a release. A ring still tracking fades; a locked one was handed on by the release.
   */
  private endChannel(streakAt: Vec2 | null): void {
    for (const beam of this.beams.values()) this.fadingBeams.push({ ...beam, ageMs: 0 });
    this.beams.clear();
    if (this.orb) {
      if (streakAt) {
        const { frames, lengthPx, linePx } = CONVERGENCE_FX.orb.streak;
        const { x, y } = streakAt;
        const g = this.streakPool.acquire().clear().setPosition(0, 0).setAlpha(1);
        g.lineStyle(linePx, Palette.arcaneLight).lineBetween(x, y, x, y - lengthPx);
        this.streaks.push({ g, framesLeft: frames });
      }
      this.orbPool.release(this.orb.g);
      this.orb = null;
    }
    if (this.ring?.phase === 'tracking') this.fadeRing(this.ring, CONVERGENCE_FX.ring.cancelFadeMs);
  }

  // --- Preview ring ------------------------------------------------------------------------

  private syncRing(channel: ChannelView, dt: number): void {
    const combo = channel.previewCombo;
    if (this.ring && this.ring.combo !== combo) {
      // A class died out: the old ring fades while the new one appears at once.
      this.fadeRing(this.ring, CONVERGENCE_FX.ring.swapFadeMs);
      if (combo !== null) {
        this.ring = this.acquireRing(combo, 1);
        this.ring.ageMs = CONVERGENCE_FX.ring.fadeInMs;
      }
    }
    if (!this.ring && combo !== null) this.ring = this.acquireRing(combo, 0);
    const ring = this.ring;
    if (!ring) return;
    ring.ageMs += dt;
    const { fadeInMs, spinRadPerS } = CONVERGENCE_FX.ring;
    ring.g
      .setPosition(channel.aim.x, channel.aim.y)
      .setRotation(ring.g.rotation + (spinRadPerS * dt) / 1000)
      .setAlpha(Math.min(1, ring.ageMs / fadeInMs));
    ring.mark.setPosition(channel.aim.x, channel.aim.y).setAlpha(ring.g.alpha);
  }

  /** A dashed ring for `combo`, alternating its colours dash by dash, and the centre mark. */
  private acquireRing(combo: ConvergenceId, startAlpha: number): Ring {
    const { radiusPx } = this.convergences[combo];
    const { dashPx, gapPx, linePx, outlinePx, outline, markHalfPx } = CONVERGENCE_FX.ring;
    const colors = CONVERGENCE_FX.ringColors[combo];
    const g = this.ringPool.acquire().clear().setRotation(0).setAlpha(startAlpha);
    const count = Math.max(1, Math.round((2 * Math.PI * radiusPx) / (dashPx + gapPx)));
    const step = (2 * Math.PI) / count;
    const span = step * (dashPx / (dashPx + gapPx));
    const strokes: readonly (readonly [number, (i: number) => number])[] = [
      [linePx + outlinePx * 2, () => outline],
      [linePx, (i) => colors[i % colors.length] ?? Palette.flame],
    ];
    for (const [width, colorOf] of strokes) {
      for (let i = 0; i < count; i++) {
        g.lineStyle(width, colorOf(i))
          .beginPath()
          .arc(0, 0, radiusPx, i * step, i * step + span, false)
          .strokePath();
      }
    }
    const mark = this.markPool.acquire().clear().setRotation(0).setAlpha(startAlpha);
    const color = colors[0] ?? Palette.flame;
    for (const [width, c] of [
      [linePx + outlinePx * 2, outline],
      [1, color],
    ] as const) {
      mark
        .lineStyle(width, c)
        .lineBetween(-markHalfPx, 0, markHalfPx + 1, 0)
        .lineBetween(0, -markHalfPx, 0, markHalfPx + 1);
    }
    return {
      g,
      mark,
      combo,
      phase: 'tracking',
      ageMs: 0,
      fadeFrom: startAlpha,
      fadeMs: 0,
      strikeMs: null,
    };
  }

  private fadeRing(ring: Ring, fadeMs: number): void {
    ring.phase = 'fading';
    ring.ageMs = 0;
    ring.fadeFrom = ring.g.alpha;
    ring.fadeMs = fadeMs;
    this.oldRings.push(ring);
    if (this.ring === ring) this.ring = null;
  }

  private releaseRing(ring: Ring): void {
    this.ringPool.release(ring.g);
    this.markPool.release(ring.mark);
  }

  /** Locked: solid for lockSolidMs, then Meteor holds full until impact, a barrage halves. */
  private stepRings(dt: number): void {
    const { lockSolidMs, strikeAlpha, strikeFadeMs } = CONVERGENCE_FX.ring;
    for (let i = this.oldRings.length - 1; i >= 0; i--) {
      const ring = this.oldRings[i];
      if (!ring) continue;
      ring.ageMs += dt;
      if (ring.phase === 'fading') {
        const t = ring.fadeMs > 0 ? ring.ageMs / ring.fadeMs : 1;
        if (t >= 1) {
          this.releaseRing(ring);
          this.oldRings.splice(i, 1);
          continue;
        }
        ring.g.setAlpha(ring.fadeFrom * (1 - t));
        ring.mark.setAlpha(ring.g.alpha);
        continue;
      }
      if (ring.phase !== 'locked' || ring.ageMs < lockSolidMs || ring.strikeMs === null) continue;
      if (ring.ageMs >= ring.strikeMs) {
        ring.phase = 'fading';
        ring.fadeFrom = strikeAlpha;
        ring.fadeMs = strikeFadeMs;
        ring.ageMs = 0;
        continue;
      }
      ring.g.setAlpha(strikeAlpha);
      ring.mark.setAlpha(strikeAlpha);
    }
  }

  // --- Events ------------------------------------------------------------------------------

  private readonly handleCancelled: GameEventListener<'convergence:cancelled'> = () => {
    this.endChannel(null);
  };

  /** The orb streaks off, the ring locks; Meteor's shadow starts falling, a barrage's cloud. */
  private readonly handleReleased: GameEventListener<'convergence:released'> = ({ combo, at }) => {
    const orbAt = this.orb ? { x: this.orb.g.x, y: this.orb.g.y } : null;
    const ring = this.ring;
    this.ring = null;
    this.endChannel(orbAt);
    const def = this.convergences[combo];
    const { pattern } = def;
    if (ring) {
      // A death on the release frame can change the combo after the last preview.
      if (ring.combo === combo) {
        this.lockRing(ring, at, pattern.kind === 'barrage' ? pattern.durationMs : null);
      } else {
        this.fadeRing(ring, CONVERGENCE_FX.ring.swapFadeMs);
        this.lockRing(
          this.acquireRing(combo, 1),
          at,
          pattern.kind === 'barrage' ? pattern.durationMs : null,
        );
      }
    }
    if (pattern.kind === 'impact') {
      const g = this.shadowPool.acquire().clear().setPosition(at.x, at.y).setAlpha(1);
      this.shadows.push({
        g,
        at,
        radiusPx: pattern.blast.radiusPx,
        ageMs: 0,
        fallMs: pattern.fallMs,
      });
      this.stepShadows(0);
      return;
    }
    const g = this.cloudPool.acquire().clear().setPosition(at.x, at.y).setAlpha(0);
    const { color, edgeSteps, edgeJitter } = CONVERGENCE_FX.cloud;
    g.fillStyle(color).fillPoints(steppedEdge(at, def.radiusPx, edgeSteps, edgeJitter), true);
    this.clouds.push({ g, at, radiusPx: def.radiusPx, ageMs: 0, holdMs: pattern.durationMs });
  };

  /** Dashes close into a solid ring and rotation stops. */
  private lockRing(ring: Ring, at: Vec2, strikeMs: number | null): void {
    const { radiusPx } = this.convergences[ring.combo];
    const { linePx, outlinePx, outline } = CONVERGENCE_FX.ring;
    const color = CONVERGENCE_FX.ringColors[ring.combo][0] ?? Palette.flame;
    ring.g.clear().setRotation(0).setPosition(at.x, at.y).setAlpha(1);
    drawOutlinedRing(ring.g, radiusPx, color, linePx, outline, outlinePx);
    ring.mark.setPosition(at.x, at.y).setAlpha(1);
    ring.phase = 'locked';
    ring.ageMs = 0;
    ring.strikeMs = strikeMs;
    this.oldRings.push(ring);
  }

  private readonly handleImpact: GameEventListener<'convergence:impact'> = ({
    combo,
    element,
    at,
    radiusPx,
  }) => {
    this.impacts++;
    const { pattern } = this.convergences[combo];
    if (pattern.kind === 'impact') {
      this.playMeteor(at, radiusPx, pattern.groundBurn);
      return;
    }
    if (element === 'storm') this.playBolt(at, radiusPx);
    else this.playMeteorlet(at, radiusPx);
  };

  // --- Strikes -----------------------------------------------------------------------------

  private playMeteor(
    at: Vec2,
    radiusPx: number,
    groundBurn: { readonly radiusPx: number; readonly durationMs: number } | null,
  ): void {
    for (const shadow of this.shadows.splice(0)) this.shadowPool.release(shadow.g);
    // The locked Meteor ring held until now.
    for (let i = this.oldRings.length - 1; i >= 0; i--) {
      const ring = this.oldRings[i];
      if (ring?.phase === 'locked' && ring.strikeMs === null) {
        this.releaseRing(ring);
        this.oldRings.splice(i, 1);
      }
    }
    const { burst, smoke, debris, shake } = CONVERGENCE_FX.meteor;
    // Core about 36 px: counts as an impact flash (§1.9).
    const core = this.flashBudget.tryFlash(burstCoreRadiusPx(radiusPx));
    this.playBurst(at, radiusPx, burst, core);
    this.movers.playSmoke(at, smoke);
    this.movers.playDebris(at, debris);
    this.shake(shake);
    if (groundBurn) this.playGround(at, groundBurn.radiusPx, groundBurn.durationMs);
  }

  private playMeteorlet(at: Vec2, radiusPx: number): void {
    const { burst, coreRadiusPx, streak, shake } = CONVERGENCE_FX.meteorlet;
    // Held to 12 px, under §1.9's 16 px: the budget lets it through uncounted.
    const core = this.flashBudget.tryFlash(coreRadiusPx);
    this.playBurst(at, radiusPx, burst, core, coreRadiusPx);
    const g = this.streakPool.acquire().clear().setPosition(0, 0).setAlpha(1);
    const top = at.y - streak.lengthPx;
    g.lineStyle(streak.linePx, Palette.flame).lineBetween(at.x, top, at.x, at.y);
    g.lineStyle(1, Palette.flameWhite).lineBetween(at.x, top, at.x, at.y);
    this.streaks.push({ g, framesLeft: streak.frames });
    this.shake(shake);
  }

  private playBurst(
    at: Vec2,
    radiusPx: number,
    timing: BurstTiming,
    core: boolean,
    coreRadiusPx: number = burstCoreRadiusPx(radiusPx),
  ): void {
    const g = this.burstPool
      .acquire()
      .setPosition(at.x, at.y)
      .setScale(timing.startPx / radiusPx)
      .setAlpha(1);
    drawBurst(g, radiusPx, FIRE_BURST, core, coreRadiusPx);
    this.bursts.push({ g, at, radiusPx, timing, ageMs: 0 });
  }

  /** The M5 Lightning bolt and a ground flash at the blast radius (never an impact flash). */
  private playBolt(at: Vec2, radiusPx: number): void {
    const g = this.boltPool.acquire().setPosition(0, 0).setAlpha(1);
    drawBolt(g, at, this.camera.worldView.y, STORM_BOLT);
    this.boltLines.push({ g, at, radiusPx, ageMs: 0, lifeMs: CONVERGENCE_FX.bolt.lifeMs });
    const image = this.flashPool
      .acquire()
      .setPosition(at.x, at.y)
      .setScale(radiusPx / STRIKE_FLASH_RADIUS_PX)
      .setAlpha(1);
    this.bolts.push({ image, ageMs: 0 });
  }

  /** Soil disc with a stepped edge reaching the radius, ember rim, seeded flame licks. */
  private playGround(at: Vec2, radiusPx: number, lifeMs: number): void {
    const { fill, fillAlpha, rim, rimPx, rimAlpha, edgeSteps, edgeJitter, licks, lickInsetPx } =
      CONVERGENCE_FX.groundBurn;
    const edge = steppedEdge(at, radiusPx, edgeSteps, edgeJitter);
    const g = this.groundPool.acquire().clear().setPosition(at.x, at.y).setAlpha(1);
    g.fillStyle(fill, fillAlpha)
      .fillPoints(edge, true)
      .lineStyle(rimPx, rim, rimAlpha)
      .strokePoints(edge, true, true);
    const images: Phaser.GameObjects.Image[] = [];
    const inner = Math.max(0, radiusPx - lickInsetPx);
    for (let i = 0; i < licks; i++) {
      const angle = ((i + 0.5 + jitter(at, i) * 0.3) / licks) * Math.PI * 2;
      const d = inner * Math.sqrt((jitter(at, i + licks) + 1) / 2);
      const x = Math.round(at.x + Math.cos(angle) * d);
      const y = Math.round(at.y + Math.sin(angle) * d);
      images.push(this.lickPool.acquire().setPosition(x, y).setAlpha(1));
    }
    this.grounds.push({ g, at, radiusPx, ageMs: 0, lifeMs, licks: images });
  }

  private shake(spec: { readonly px: number; readonly durationMs: number }): void {
    if (this.screenShake.shake(spec)) this.shakes++;
  }

  private stepShadows(dt: number): void {
    const { startRadiusPx, startAlpha, endAlpha, rimPx, rimExtraAlpha } = CONVERGENCE_FX.shadow;
    for (const shadow of this.shadows) {
      shadow.ageMs += dt;
      const t = shadow.fallMs > 0 ? Math.min(1, shadow.ageMs / shadow.fallMs) : 1;
      // Ease-in: slow, then fast, like a fall. Held at full size until the impact removes it.
      const r = startRadiusPx + (shadow.radiusPx - startRadiusPx) * t * t;
      const a = startAlpha + (endAlpha - startAlpha) * t;
      shadow.g
        .clear()
        .fillStyle(Palette.ink, a)
        .fillCircle(0, 0, r)
        .lineStyle(rimPx, Palette.ink, Math.min(1, a + rimExtraAlpha))
        .strokeCircle(0, 0, r - rimPx / 2);
    }
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
      const start = startPx / burst.radiusPx;
      const grow = Phaser.Math.Easing.Quadratic.Out(Math.min(1, age / expandMs));
      burst.g.setScale(start + (1 - start) * grow);
      const fading = age - expandMs - holdMs;
      burst.g.setAlpha(fading <= 0 ? 1 : 1 - fading / fadeMs);
    }
  }

  /** Streaks last a fixed number of rendered frames. */
  private stepStreaks(): void {
    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const streak = this.streaks[i];
      if (!streak) continue;
      if (streak.framesLeft <= 0) {
        this.streakPool.release(streak.g);
        this.streaks.splice(i, 1);
        continue;
      }
      streak.framesLeft--;
    }
  }

  private stepGrounds(dt: number): void {
    const { lickFrameMs, fadeMs } = CONVERGENCE_FX.groundBurn;
    for (let i = this.grounds.length - 1; i >= 0; i--) {
      const ground = this.grounds[i];
      if (!ground) continue;
      ground.ageMs += dt;
      const left = ground.lifeMs - ground.ageMs;
      if (left <= 0) {
        this.groundPool.release(ground.g);
        for (const lick of ground.licks) this.lickPool.release(lick);
        this.grounds.splice(i, 1);
        continue;
      }
      const alpha = Math.min(1, left / fadeMs);
      ground.g.setAlpha(alpha);
      ground.licks.forEach((lick, k) => {
        // Seeded phase per lick, 2 frames at lickFrameMs each.
        const phase = Math.floor(ground.ageMs / lickFrameMs + (jitter(ground.at, k) + 1)) % 2;
        const texture =
          phase === 0 ? PlaceholderTextures.GroundFlameA : PlaceholderTextures.GroundFlameB;
        lick.setTexture(texture).setAlpha(alpha);
      });
    }
  }

  private stepClouds(dt: number): void {
    const { alpha, fadeInMs, fadeOutMs } = CONVERGENCE_FX.cloud;
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const cloud = this.clouds[i];
      if (!cloud) continue;
      cloud.ageMs += dt;
      const out = cloud.ageMs - cloud.holdMs;
      if (out >= fadeOutMs) {
        this.cloudPool.release(cloud.g);
        this.clouds.splice(i, 1);
        continue;
      }
      const k = out > 0 ? 1 - out / fadeOutMs : Math.min(1, cloud.ageMs / fadeInMs);
      cloud.g.setAlpha(alpha * k);
    }
  }

  private stepBolts(dt: number): void {
    for (let i = this.boltLines.length - 1; i >= 0; i--) {
      const bolt = this.boltLines[i];
      if (!bolt) continue;
      bolt.ageMs += dt;
      const t = bolt.ageMs / bolt.lifeMs;
      if (t >= 1) {
        this.boltPool.release(bolt.g);
        this.boltLines.splice(i, 1);
        continue;
      }
      bolt.g.setAlpha(1 - t * t);
    }
    const { flashLifeMs } = CONVERGENCE_FX.bolt;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const flash = this.bolts[i];
      if (!flash) continue;
      flash.ageMs += dt;
      const t = flash.ageMs / flashLifeMs;
      if (t >= 1) {
        this.flashPool.release(flash.image);
        this.bolts.splice(i, 1);
        continue;
      }
      flash.image.setAlpha(1 - t);
    }
  }
}

/** A wizard's staff tip from its feet. */
function staffTip(feet: Vec2): Vec2 {
  return { x: feet.x + CONVERGENCE_FX.staffTip.x, y: feet.y + CONVERGENCE_FX.staffTip.y };
}

/**
 * A stepped, irregular disc outline in local coordinates: `steps` whole-pixel vertices whose
 * radius dips by up to `jitterFraction`, never past `radiusPx` (the edge stays honest, §5c). The
 * dips are a hash of the centre, so a replay draws the same edge.
 */
function steppedEdge(
  centre: Vec2,
  radiusPx: number,
  steps: number,
  jitterFraction: number,
): Phaser.Math.Vector2[] {
  const points: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const r = radiusPx * (1 - jitterFraction * ((jitter(centre, i) + 1) / 2));
    points.push(
      new Phaser.Math.Vector2(Math.round(Math.cos(angle) * r), Math.round(Math.sin(angle) * r)),
    );
  }
  return points;
}
