import type Phaser from 'phaser';
import type { EntityId, Vec2 } from '@core/types';
import type { RuneSlotObject } from '@core/mission/mapData';
import type { PortalPhase } from '@core/mission/portal';
import type { EventBus, GameEventListener } from '../bus/EventBus';
import { Depth, unitDepth } from '../depths';
import type { UnitLookup } from '../entities/Positioned';
import type { FlashBudget } from '../fx/FlashBudget';
import { Palette } from '../palette';
import type { System } from '../systems/System';
import {
  PORTAL_TEXTURE_PX,
  RUNE_TEXTURE_PX,
  StructureTextures,
} from '../world/structurePlaceholders';

/** What the view reads from PortalSystem. */
export interface PortalViewSource {
  readonly position: Vec2;
  readonly phase: PortalPhase;
  readonly runesLit: number;
  readonly runeCount: number;
  readonly runeFlareCount: number;
  readonly openingProgress: number;
  readonly extractionRadiusPx: number;
}

/**
 * readability.md "Portal" in world px. Presentation, not tuning. The placeholder texture is 128 px
 * with the pad centre (the portal's point) at (64, 88) and the arch opening around (64, 55).
 */
const LOOK = {
  padCentre: { x: 64, y: 88 },
  opening: { x: 64, y: 55, rx: 24, ry: 30 },
  /** Runes across the lintel when the map has no rune-slot objects. */
  runeRow: { y: 16, gapPx: 18 },
  /** Rune lit: a 300 ms flare, popping from 1.8× back to 1×. */
  runeFlare: { ms: 300, scale: 1.8 },
  swirl: { arms: 6, periodMs: 1400, dotPx: 3 },
  burst: { ms: 400, fromPx: 16, toPx: 96, linePx: 3 },
  /** §1.9: screen flash ≤ 100 ms at ≤ 50% opacity, through the flash budget. */
  screenFlash: { ms: 100, alpha: 0.5 },
  ring: { linePx: 2, outlinePx: 1, dashes: 36, dashFill: 0.6 },
  /** Saved wizards: a 300 ms stretch upward and fade. */
  warp: { ms: 300, stretch: 2.5 },
} as const;

/** The swirl and ring sit just above the ground decals, below units. */
const RING_DEPTH = Depth.GroundFx;

interface RuneView {
  readonly image: Phaser.GameObjects.Image;
  flareMs: number;
}

interface Warp {
  readonly sprite: Phaser.GameObjects.Image;
  readonly baseScaleY: number;
  elapsedMs: number;
}

/**
 * Draws the portal (readability.md "Portal"): the grey arch (placeholder), one dark rune socket per
 * target that turns gold with a flare, the violet swirl forming during the opening and looping once
 * open, the opening burst and one screen flash (budgeted), the dashed gold extraction ring from the
 * opening on, and a warp-out for each saved wizard. Owns a fixed set of objects (no per-frame
 * allocation); everything goes with destroy().
 */
export class PortalView implements System {
  private readonly arch: Phaser.GameObjects.Image;
  private readonly runes: RuneView[];
  private readonly swirl: Phaser.GameObjects.Graphics;
  private readonly burst: Phaser.GameObjects.Graphics;
  private readonly ring: Phaser.GameObjects.Graphics;
  private readonly flash: Phaser.GameObjects.Rectangle;
  private readonly warps: Warp[] = [];
  private seenFlares = 0;
  private ringDrawn = false;
  private burstMs: number = LOOK.burst.ms;
  private flashMs: number = LOOK.screenFlash.ms;
  private swirlMs = 0;
  private flashes = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly source: PortalViewSource,
    runeSlots: readonly RuneSlotObject[],
    private readonly units: UnitLookup,
    private readonly flashBudget: FlashBudget,
    private readonly bus: EventBus,
  ) {
    const { position } = source;
    const origin = {
      x: LOOK.padCentre.x / PORTAL_TEXTURE_PX,
      y: LOOK.padCentre.y / PORTAL_TEXTURE_PX,
    };
    this.arch = scene.add
      .image(position.x, position.y, StructureTextures.Portal)
      .setOrigin(origin.x, origin.y)
      // A wizard on the pad draws in front of the arch.
      .setDepth(unitDepth(position.y - LOOK.padCentre.y / 4));
    this.ring = scene.add.graphics().setDepth(RING_DEPTH).setVisible(false);
    this.swirl = scene.add.graphics().setDepth(this.arch.depth);
    this.burst = scene.add.graphics().setDepth(Depth.Fx).setVisible(false);
    const runeDepth = this.arch.depth;
    this.runes = Array.from({ length: source.runeCount }, (_, index) => {
      const at = runePosition(position, index, source.runeCount, runeSlots);
      const image = scene.add
        .image(at.x, at.y, StructureTextures.RuneDark)
        .setDisplaySize(RUNE_TEXTURE_PX, RUNE_TEXTURE_PX)
        .setDepth(runeDepth);
      return { image, flareMs: 0 };
    });
    const { width, height } = scene.scale.gameSize;
    this.flash = scene.add
      .rectangle(0, 0, width, height, Palette.cream, LOOK.screenFlash.alpha)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(Depth.Fx)
      .setVisible(false);
    bus.on('portal:opened', this.handleOpened);
    bus.on('portal:extracted', this.handleExtracted);
  }

  /** Screen flashes shown this run (debug). */
  get flashCount(): number {
    return this.flashes;
  }

  update(dt: number): void {
    const { source } = this;
    if (source.runeFlareCount !== this.seenFlares) {
      this.seenFlares = source.runeFlareCount;
      const rune = this.runes[source.runesLit - 1];
      if (rune) rune.flareMs = LOOK.runeFlare.ms;
    }
    this.runes.forEach((rune, index) => {
      const lit = index < source.runesLit;
      rune.image.setTexture(lit ? StructureTextures.RuneLit : StructureTextures.RuneDark);
      rune.flareMs = Math.max(0, rune.flareMs - dt);
      const pop = 1 + (LOOK.runeFlare.scale - 1) * (rune.flareMs / LOOK.runeFlare.ms);
      rune.image.setDisplaySize(RUNE_TEXTURE_PX * pop, RUNE_TEXTURE_PX * pop);
    });
    this.drawSwirl(dt);
    this.drawBurst(dt);
    this.stepFlash(dt);
    this.stepWarps(dt);
    if (!this.ringDrawn && source.phase !== 'sealed') this.drawRing();
  }

  destroy(): void {
    this.bus.off('portal:opened', this.handleOpened);
    this.bus.off('portal:extracted', this.handleExtracted);
    this.warps.length = 0;
    this.arch.destroy();
    for (const rune of this.runes) rune.image.destroy();
    this.runes.length = 0;
    this.swirl.destroy();
    this.burst.destroy();
    this.ring.destroy();
    this.flash.destroy();
  }

  private drawSwirl(dt: number): void {
    const g = this.swirl;
    g.clear();
    const growth = this.source.openingProgress;
    if (growth <= 0) return;
    this.swirlMs = (this.swirlMs + dt) % LOOK.swirl.periodMs;
    const { opening, swirl } = LOOK;
    const cx = this.source.position.x + opening.x - LOOK.padCentre.x;
    const cy = this.source.position.y + opening.y - LOOK.padCentre.y;
    g.fillStyle(Palette.arcane, 0.85).fillEllipse(
      cx,
      cy,
      opening.rx * 2 * growth,
      opening.ry * 2 * growth,
    );
    const spin = (this.swirlMs / swirl.periodMs) * Math.PI * 2;
    g.fillStyle(Palette.arcaneLight, 1);
    for (let arm = 0; arm < swirl.arms; arm++) {
      const angle = spin + (arm / swirl.arms) * Math.PI * 2;
      for (let step = 1; step <= 3; step++) {
        const r = (step / 3) * growth;
        g.fillRect(
          Math.round(cx + Math.cos(angle + step * 0.6) * opening.rx * r) - 1,
          Math.round(cy + Math.sin(angle + step * 0.6) * opening.ry * r) - 1,
          swirl.dotPx,
          swirl.dotPx,
        );
      }
    }
    // Open: the white core (readability "Open (loop)").
    if (this.source.phase === 'open' || this.source.phase === 'extracted') {
      g.fillStyle(Palette.cream, 1).fillEllipse(cx, cy, opening.rx * 0.5, opening.ry * 0.5);
    }
  }

  private drawBurst(dt: number): void {
    if (this.burstMs >= LOOK.burst.ms) return;
    this.burstMs += dt;
    const t = Math.min(1, this.burstMs / LOOK.burst.ms);
    const { burst } = LOOK;
    const radius = burst.fromPx + (burst.toPx - burst.fromPx) * t;
    this.burst
      .clear()
      .setVisible(t < 1)
      .lineStyle(burst.linePx, Palette.arcaneLight, 1 - t)
      .strokeCircle(this.source.position.x, this.source.position.y - LOOK.padCentre.y / 3, radius);
  }

  private stepFlash(dt: number): void {
    if (this.flashMs >= LOOK.screenFlash.ms) return;
    this.flashMs += dt;
    const left = 1 - Math.min(1, this.flashMs / LOOK.screenFlash.ms);
    this.flash.setVisible(left > 0).setAlpha(LOOK.screenFlash.alpha * left);
  }

  private stepWarps(dt: number): void {
    for (const warp of this.warps) {
      warp.elapsedMs = Math.min(LOOK.warp.ms, warp.elapsedMs + dt);
      const t = warp.elapsedMs / LOOK.warp.ms;
      warp.sprite.setScale(warp.sprite.scaleX, warp.baseScaleY * (1 + (LOOK.warp.stretch - 1) * t));
      warp.sprite.setAlpha(1 - t);
    }
  }

  /** Dashed gold circle with an ink outline (readability "Open (loop)"). Drawn once. */
  private drawRing(): void {
    const { x, y } = this.source.position;
    const r = this.source.extractionRadiusPx;
    const { ring } = LOOK;
    const g = this.ring.setVisible(true);
    const step = (Math.PI * 2) / ring.dashes;
    for (const [width, color] of [
      [ring.linePx + ring.outlinePx * 2, Palette.ink],
      [ring.linePx, Palette.gold],
    ] as const) {
      g.lineStyle(width, color, 1);
      for (let i = 0; i < ring.dashes; i++) {
        g.beginPath();
        g.arc(x, y, r, i * step, i * step + step * ring.dashFill);
        g.strokePath();
      }
    }
    this.ringDrawn = true;
  }

  private readonly handleOpened = (): void => {
    this.burstMs = 0;
    // The screen flash counts toward the §1.9 budget like any flash; refused, the burst still plays.
    if (this.flashBudget.tryFlash(Number.POSITIVE_INFINITY)) {
      this.flashMs = 0;
      this.flashes++;
    }
  };

  private readonly handleExtracted: GameEventListener<'portal:extracted'> = ({ saved }) => {
    for (const id of saved) this.warpOut(id);
  };

  private warpOut(id: EntityId): void {
    const sprite = this.units.spriteOf(id);
    if (sprite) this.warps.push({ sprite, baseScaleY: sprite.scaleY, elapsedMs: 0 });
  }
}

/** A rune's world position: its rune-slot object, else spread across the arch's lintel. */
function runePosition(
  portal: Vec2,
  index: number,
  count: number,
  slots: readonly RuneSlotObject[],
): Vec2 {
  const slot = slots.find((s) => s.index === index);
  if (slot) return slot.position;
  const { runeRow, padCentre } = LOOK;
  return {
    x: portal.x + (index - (count - 1) / 2) * runeRow.gapPx,
    y: portal.y + runeRow.y - padCentre.y,
  };
}
