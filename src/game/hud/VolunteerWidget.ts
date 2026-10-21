import type Phaser from 'phaser';
import type { HudVolunteerState, HudVolunteerView } from './HudModel';
import { CHANNEL_DIM_ALPHA, DENIED_SHAKE, shakeOffsetPx, squareSweep } from './hudShapes';
import { cssColor, Palette } from '../palette';
import { PlaceholderTextures } from '../placeholders';

/**
 * Volunteer! slot, readability.md §5c "HUD" and "Volunteer slot states" (CD Q4), in HUD px at
 * 640×360: a 32×32 frame at (80, 320), 4 px after slot 2, styled like a §5b slot. Ready (cream
 * border), cooldown (ash border, ink sweep and whole seconds, a 150 ms `arcane-light` flash when it
 * ends), unavailable (only the leader left: slate border, greyscale icon at 50%, no slash, badge
 * slate at 50%; wins over cooldown). `volunteer:denied` shakes it; a channel dims it. Presentation.
 */
const ICON = {
  leftPx: 80,
  bottomPx: 8,
  framePx: 32,
  borderPx: 1,
  plateAlpha: 0.75,
  iconScale: 2,
  sweepAlpha: 0.65,
  badge: { px: 10, offsetPx: 24, borderPx: 1, unavailableAlpha: 0.5 },
  unavailableIconAlpha: 0.5,
  readyFlashMs: 150,
  readyFlash: Palette.arcaneLight,
  shake: DENIED_SHAKE,
} as const;

const KEY_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '8px',
  color: cssColor(Palette.cream),
};

const SECONDS_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '10px',
  color: cssColor(Palette.cream),
  stroke: cssColor(Palette.ink),
  strokeThickness: 2,
};

export class VolunteerWidget {
  private readonly container: Phaser.GameObjects.Container;
  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly icon: Phaser.GameObjects.Image;
  private readonly greyIcon: Phaser.GameObjects.Image;
  private readonly overlay: Phaser.GameObjects.Graphics;
  private readonly seconds: Phaser.GameObjects.Text;
  private readonly badge: Phaser.GameObjects.Graphics;
  private readonly key: Phaser.GameObjects.Text;
  private readonly dim: Phaser.GameObjects.Graphics;
  private readonly baseX: number;
  private state: HudVolunteerState | null = null;
  private deniedSeen = 0;
  private shakeMs = 0;
  private readyFlashMs = 0;
  private frameDrawn = '';
  private overlayDrawn = '';

  constructor(scene: Phaser.Scene) {
    const { height } = scene.scale.gameSize;
    const half = ICON.framePx / 2;
    this.baseX = ICON.leftPx;
    this.frame = scene.add.graphics();
    this.icon = scene.add
      .image(half, half, PlaceholderTextures.IconVolunteer)
      .setScale(ICON.iconScale);
    this.greyIcon = scene.add
      .image(half, half, PlaceholderTextures.IconVolunteerLost)
      .setScale(ICON.iconScale)
      .setAlpha(0);
    this.overlay = scene.add.graphics();
    this.seconds = scene.add.text(half, half, '', SECONDS_STYLE).setOrigin(0.5, 0.5);
    const { px, offsetPx, borderPx } = ICON.badge;
    this.badge = scene.add
      .graphics()
      .fillStyle(Palette.ink)
      .fillRect(offsetPx, offsetPx, px, px)
      .lineStyle(borderPx, Palette.cream)
      .strokeRect(offsetPx + borderPx / 2, offsetPx + borderPx / 2, px - borderPx, px - borderPx);
    this.key = scene.add
      .text(offsetPx + px / 2, offsetPx + px / 2, 'F', KEY_STYLE)
      .setOrigin(0.5, 0.5);
    this.dim = scene.add
      .graphics()
      .fillStyle(Palette.ink, CHANNEL_DIM_ALPHA)
      .fillRect(0, 0, ICON.framePx, ICON.framePx)
      .setVisible(false);
    this.container = scene.add.container(this.baseX, height - ICON.bottomPx - ICON.framePx, [
      this.frame,
      this.icon,
      this.greyIcon,
      this.overlay,
      this.seconds,
      this.badge,
      this.key,
      this.dim,
    ]);
  }

  render(view: HudVolunteerView, channelling: boolean, delta: number): void {
    this.dim.setVisible(channelling);
    if (this.state === null) this.deniedSeen = view.deniedCount;
    else if (this.state === 'cooldown' && view.state === 'ready') {
      this.readyFlashMs = ICON.readyFlashMs;
    }
    if (view.deniedCount > this.deniedSeen) {
      this.deniedSeen = view.deniedCount;
      this.shakeMs = ICON.shake.durationMs;
    }
    this.state = view.state;
    this.readyFlashMs = Math.max(0, this.readyFlashMs - delta);

    this.drawFrame(view.state);
    const unavailable = view.state === 'unavailable';
    this.icon.setAlpha(unavailable ? 0 : 1);
    this.greyIcon.setAlpha(unavailable ? ICON.unavailableIconAlpha : 0);
    this.drawSweep(view);
    const label =
      view.state === 'cooldown' ? String(Math.ceil(view.cooldownRemainingMs / 1000)) : '';
    if (this.seconds.text !== label) this.seconds.setText(label);

    this.shakeMs = Math.max(0, this.shakeMs - delta);
    this.container.setX(this.baseX + shakeOffsetPx(this.shakeMs, ICON.shake));
  }

  private drawFrame(state: HudVolunteerState): void {
    let border: number =
      state === 'unavailable' ? Palette.slate : state === 'cooldown' ? Palette.ash : Palette.cream;
    if (this.readyFlashMs > 0 && state === 'ready') border = ICON.readyFlash;
    const key = String(border);
    if (this.frameDrawn === key) return;
    this.frameDrawn = key;
    const size = ICON.framePx;
    const b = ICON.borderPx;
    this.frame
      .clear()
      .fillStyle(Palette.ink, ICON.plateAlpha)
      .fillRect(0, 0, size, size)
      .lineStyle(b, border)
      .strokeRect(b / 2, b / 2, size - b, size - b);
    const unavailable = state === 'unavailable';
    this.badge.setAlpha(unavailable ? ICON.badge.unavailableAlpha : 1);
    this.key.setColor(cssColor(unavailable ? Palette.slate : Palette.cream));
  }

  /** Cooldown sweep over the remaining fraction from 12 o'clock (§5b). */
  private drawSweep(view: HudVolunteerView): void {
    const size = ICON.framePx;
    const fraction =
      view.state === 'cooldown' && view.cooldownMs > 0
        ? Math.min(1, view.cooldownRemainingMs / view.cooldownMs)
        : 0;
    const key = String(Math.round(fraction * size * 4));
    if (this.overlayDrawn === key) return;
    this.overlayDrawn = key;
    const g = this.overlay.clear();
    if (fraction > 0) {
      g.fillStyle(Palette.ink, ICON.sweepAlpha).fillPoints(squareSweep(size / 2, fraction), true);
    }
  }
}
