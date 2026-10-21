import type Phaser from 'phaser';
import type { HudMeterView } from './HudModel';
import { DENIED_SHAKE, shakeOffsetPx } from './hudShapes';
import { cssColor, Palette } from '../palette';

/**
 * Convergence meter, readability.md §5c "HUD" and "Meter states", in HUD px at 640×360. Presentation,
 * not tuning (CD 2026-10-16: HUD constants stay in src/game citing the readability section).
 */
const METER = {
  /** 160×12 at (240, 340): centred, bottom edge on the slots' 352 baseline. */
  widthPx: 160,
  heightPx: 12,
  bottomPx: 8,
  borderPx: 1,
  plateAlpha: 0.75,
  /** The fill is the inner area, 158×10 at (241, 341). */
  insetPx: 1,
  highlightPx: 1,
  /** R badge 10×10, 4 px right of the frame, vertically centred: (404, 341). */
  badge: { px: 10, gapPx: 4, borderPx: 1 },
  /** Pixels just gained stay `arcane-light` this long before settling to `arcane`. */
  gainedMs: 150,
  /** The border flashes `arcane-light` on `convergence:charged`, then turns cream. */
  chargedFlashMs: 150,
  /** Ready: a hard 2 px `arcane-light` halo, alpha 40% ↔ 100% over 800 ms. */
  glow: { px: 2, periodMs: 800, minAlpha: 0.4 },
  /** Ready: a 4 px `cream` column sweeps the fill in 300 ms, every 1200 ms (the grayscale cue). */
  glint: { widthPx: 4, sweepMs: 300, everyMs: 1200 },
  /** Spent: a ghost of the full fill fades 60% → 0 over 300 ms. */
  ghost: { startAlpha: 0.6, fadeMs: 300 },
  shake: DENIED_SHAKE,
} as const;

const KEY_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '8px',
  color: cssColor(Palette.cream),
};

type Look = 'charging' | 'ready' | 'spent';

/**
 * The meter: frame, fill (lit leading edge while charging), ready halo and glint, the spent ghost,
 * and the R badge; frame and badge shake together on a denied press. Pieces are redrawn only when
 * what they show changes. Timers run on the HUD scene's delta.
 */
export class MeterWidget {
  private readonly container: Phaser.GameObjects.Container;
  private readonly glow: Phaser.GameObjects.Graphics;
  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly fill: Phaser.GameObjects.Graphics;
  private readonly glint: Phaser.GameObjects.Graphics;
  private readonly ghost: Phaser.GameObjects.Graphics;
  private readonly key: Phaser.GameObjects.Text;
  private readonly baseX: number;
  private seen: { denied: number; charged: number; spent: number } | null = null;
  private shakeMs = 0;
  private chargedFlashMs = 0;
  private readyMs = 0;
  private ghostMs: number = METER.ghost.fadeMs;
  /** Fill pixels drawn `arcane`; the rest up to the current width is the lit leading edge. */
  private settledPx = 0;
  private fillPx = 0;
  private gainedMs = 0;
  private fillDrawn = '';
  private frameDrawn = '';

  constructor(scene: Phaser.Scene) {
    const { width, height } = scene.scale.gameSize;
    const { widthPx: w, heightPx: h, badge } = METER;
    this.baseX = Math.round((width - w) / 2);
    const y = height - METER.bottomPx - h;
    this.glow = scene.add.graphics().setVisible(false);
    this.frame = scene.add.graphics();
    this.fill = scene.add.graphics();
    this.ghost = scene.add.graphics().setVisible(false);
    this.glint = scene.add.graphics().setVisible(false);
    const badgeX = w + badge.gapPx;
    const badgeY = Math.round((h - badge.px) / 2);
    const plate = scene.add
      .graphics()
      .fillStyle(Palette.ink)
      .fillRect(badgeX, badgeY, badge.px, badge.px)
      .lineStyle(badge.borderPx, Palette.cream)
      .strokeRect(
        badgeX + badge.borderPx / 2,
        badgeY + badge.borderPx / 2,
        badge.px - badge.borderPx,
        badge.px - badge.borderPx,
      );
    this.key = scene.add
      .text(badgeX + badge.px / 2, badgeY + badge.px / 2, 'R', KEY_STYLE)
      .setOrigin(0.5, 0.5);
    const { insetPx } = METER;
    this.ghost
      .fillStyle(Palette.arcaneLight)
      .fillRect(insetPx, insetPx, w - insetPx * 2, h - insetPx * 2);
    this.glow
      .fillStyle(Palette.arcaneLight)
      .fillRect(-METER.glow.px, -METER.glow.px, w + METER.glow.px * 2, h + METER.glow.px * 2);
    this.container = scene.add.container(this.baseX, y, [
      this.glow,
      this.frame,
      this.fill,
      this.ghost,
      this.glint,
      plate,
      this.key,
    ]);
  }

  render(view: HudMeterView, delta: number): void {
    const seen = (this.seen ??= {
      denied: view.deniedCount,
      charged: view.chargedCount,
      spent: view.spentCount,
    });
    if (view.deniedCount > seen.denied) this.shakeMs = METER.shake.durationMs;
    if (view.chargedCount > seen.charged) this.chargedFlashMs = METER.chargedFlashMs;
    if (view.spentCount > seen.spent) {
      this.ghostMs = 0;
      this.settledPx = 0;
    }
    seen.denied = view.deniedCount;
    seen.charged = view.chargedCount;
    seen.spent = view.spentCount;

    const look: Look = view.full ? 'ready' : view.channelling ? 'spent' : 'charging';
    this.chargedFlashMs = Math.max(0, this.chargedFlashMs - delta);
    this.drawFrame(look);
    this.drawFill(view, delta);
    this.drawReady(look, delta);
    this.drawGhost(delta);

    this.shakeMs = Math.max(0, this.shakeMs - delta);
    this.container.setX(this.baseX + shakeOffsetPx(this.shakeMs, METER.shake));
  }

  private drawFrame(look: Look): void {
    let border: number = look === 'ready' ? Palette.cream : Palette.ash;
    if (this.chargedFlashMs > 0) border = Palette.arcaneLight;
    const key = String(border);
    if (this.frameDrawn === key) return;
    this.frameDrawn = key;
    const { widthPx: w, heightPx: h, borderPx: b } = METER;
    this.frame
      .clear()
      .fillStyle(Palette.ink, METER.plateAlpha)
      .fillRect(0, 0, w, h)
      .lineStyle(b, border)
      .strokeRect(b / 2, b / 2, w - b, h - b);
    this.key.setColor(cssColor(look === 'ready' ? Palette.cream : Palette.slate));
  }

  /** floor(inner width × fraction) px; gained pixels lit for 150 ms, then settled. */
  private drawFill(view: HudMeterView, delta: number): void {
    const { widthPx, heightPx, insetPx, highlightPx } = METER;
    const inner = widthPx - insetPx * 2;
    const px = Math.floor(inner * Math.min(1, Math.max(0, view.fraction)));
    if (px > this.fillPx) {
      // A new gain while one is still lit keeps the older settle point.
      if (this.gainedMs <= 0) this.settledPx = this.fillPx;
      this.gainedMs = METER.gainedMs;
    }
    this.fillPx = px;
    this.gainedMs = Math.max(0, this.gainedMs - delta);
    if (this.gainedMs <= 0 || this.settledPx > px) this.settledPx = px;
    const key = `${String(px)}:${String(this.settledPx)}`;
    if (this.fillDrawn === key) return;
    this.fillDrawn = key;
    const g = this.fill.clear();
    if (px <= 0) return;
    const h = heightPx - insetPx * 2;
    g.fillStyle(Palette.arcane).fillRect(insetPx, insetPx, this.settledPx, h);
    g.fillStyle(Palette.arcaneLight)
      .fillRect(insetPx + this.settledPx, insetPx, px - this.settledPx, h)
      .fillRect(insetPx, insetPx, px, highlightPx);
  }

  /** Halo pulse and the glint sweep while full; both off otherwise. */
  private drawReady(look: Look, delta: number): void {
    const ready = look === 'ready';
    this.glow.setVisible(ready);
    this.glint.setVisible(false);
    if (!ready) {
      this.readyMs = 0;
      return;
    }
    this.readyMs += delta;
    const { periodMs, minAlpha } = METER.glow;
    // 100% → 40% → 100% over one period.
    const wave = (1 + Math.cos((this.readyMs / periodMs) * Math.PI * 2)) / 2;
    this.glow.setAlpha(minAlpha + (1 - minAlpha) * wave);
    const { widthPx: glintW, sweepMs, everyMs } = METER.glint;
    const into = this.readyMs % everyMs;
    if (into >= sweepMs) return;
    const { widthPx, heightPx, insetPx } = METER;
    const inner = widthPx - insetPx * 2;
    const x = insetPx + Math.round(((inner - glintW) * into) / sweepMs);
    this.glint
      .clear()
      .fillStyle(Palette.cream)
      .fillRect(x, insetPx, glintW, heightPx - insetPx * 2)
      .setVisible(true);
  }

  private drawGhost(delta: number): void {
    const { startAlpha, fadeMs } = METER.ghost;
    this.ghostMs = Math.min(fadeMs, this.ghostMs + delta);
    const t = this.ghostMs / fadeMs;
    this.ghost.setVisible(t < 1).setAlpha(startAlpha * (1 - t));
  }
}
