import Phaser from 'phaser';
import type { SpellId } from '@core/types';
import type { HudSlotView, HudView } from '../hud/HudModel';
import { CHANNEL_DIM_ALPHA, DENIED_SHAKE, shakeOffsetPx, squareSweep } from '../hud/hudShapes';
import { MeterWidget } from '../hud/MeterWidget';
import { VolunteerWidget } from '../hud/VolunteerWidget';
import { cssColor, Palette } from '../palette';
import { PlaceholderTextures } from '../placeholders';
import { SceneKeys } from './keys';

/** Passed through `scene.launch(SceneKeys.Hud, data)` by MissionScene. */
export interface HudSceneData {
  readonly view: HudView;
}

/**
 * Spell slots, readability.md §5b, in HUD px at 640×360. Presentation, not tuning (CD 2026-10-16:
 * HUD constants stay in src/game citing §5b).
 */
const SLOTS = {
  /** Slot 1 top-left (8, 320); slot 2 4 px after it, at (44, 320). */
  leftPx: 8,
  bottomPx: 8,
  framePx: 32,
  gapPx: 4,
  borderPx: 1,
  plateAlpha: 0.75,
  /** 12 px placeholder icons drawn at 2×: 24×24, 4 px inset. */
  iconScale: 2,
  sweepAlpha: 0.65,
  badge: { px: 10, offsetPx: 24, borderPx: 1, lostAlpha: 0.5 },
  lost: { iconAlpha: 0.5, fadeMs: 250, slashInsetPx: 6, slashPx: 2, slashOutlinePx: 1 },
  readyFlashMs: 150,
  /** Slot-only shake: 3 px, 200 ms, 2 full cycles, amplitude easing out linearly, whole px. */
  shake: DENIED_SHAKE,
} as const;

const KEY_LABELS = { 1: 'Q', 2: 'E' } as const satisfies Record<1 | 2, string>;

const ICONS = {
  fireball: PlaceholderTextures.IconFireball,
  lightning: PlaceholderTextures.IconLightning,
} as const satisfies Record<SpellId, string>;

/** Greyscale twins (`ash`/`slate`) for the lost look (§5b). */
const LOST_ICONS = {
  fireball: PlaceholderTextures.IconFireballLost,
  lightning: PlaceholderTextures.IconLightningLost,
} as const satisfies Record<SpellId, string>;

/** The border flashes the element core colour for 150 ms when the cooldown ends (§5b). */
const READY_FLASH = {
  fireball: Palette.flameWhite,
  lightning: Palette.bolt,
} as const satisfies Record<SpellId, number>;

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

type Look = 'ready' | 'cooldown' | 'lost';

interface SlotWidget {
  readonly slot: 1 | 2;
  readonly container: Phaser.GameObjects.Container;
  readonly frame: Phaser.GameObjects.Graphics;
  readonly icon: Phaser.GameObjects.Image;
  /** The greyscale icon, on top of the colour one; faded in when the slot is lost. */
  readonly lostIcon: Phaser.GameObjects.Image;
  /** Cooldown sweep or lost slash, above the icon. */
  readonly overlay: Phaser.GameObjects.Graphics;
  readonly seconds: Phaser.GameObjects.Text;
  readonly badge: Phaser.GameObjects.Graphics;
  readonly key: Phaser.GameObjects.Text;
  /** The channel dim (§5c), above everything in the slot. */
  readonly dim: Phaser.GameObjects.Graphics;
  readonly baseX: number;
  /** Null until the first render. */
  look: Look | null;
  spell: SpellId | null;
  deniedSeen: number;
  lostSeen: number;
  shakeMs: number;
  readyFlashMs: number;
  /** ms into the lost fade; null when not fading. */
  lostFadeMs: number | null;
  /** Last drawn frame and overlay, so they are redrawn only when they change. */
  frameDrawn: string;
  overlayDrawn: string;
}

/**
 * Screen-fixed HUD (M5 Q3), its own scene above MissionScene: its own camera, never scrolled or
 * zoomed: the spell slots bottom-left, the Volunteer! icon right of them and the Convergence meter
 * bottom-centre (M6 Q4, {@link VolunteerWidget}, {@link MeterWidget}); M8's touch buttons later.
 * It reads only the {@link HudView} passed at launch; MissionScene stops it on its own SHUTDOWN and
 * launches a fresh one every run, so nothing outlives a restart (Phaser clears the display list).
 *
 * Each slot per readability.md §5b: ready (cream border), cooldown (ash border, ink sweep over the
 * remaining fraction from 12 o'clock, whole seconds left rounded up, a 150 ms element-colour border
 * flash when it ends), lost (slate border, greyed icon at 50%, diagonal slash, dimmed badge; after
 * `spell:lost` the slot shakes once and fades over 250 ms; a never-granted slot starts lost). A
 * `spell:denied` press shakes the slot (restarts, never stacks). Timers run on the HUD scene's
 * delta (Phaser clock).
 */
export class HudScene extends Phaser.Scene {
  private view: HudView | null = null;
  private widgets: SlotWidget[] = [];
  private meter: MeterWidget | null = null;
  private volunteer: VolunteerWidget | null = null;

  constructor() {
    super(SceneKeys.Hud);
  }

  init(data: HudSceneData): void {
    this.view = data.view;
    this.widgets = [];
    this.meter = null;
    this.volunteer = null;
  }

  create(): void {
    this.cameras.main.setRoundPixels(true);
    const { height } = this.scale.gameSize;
    const y = height - SLOTS.bottomPx - SLOTS.framePx;
    this.widgets = ([1, 2] as const).map((slot, i) =>
      this.createSlot(slot, SLOTS.leftPx + i * (SLOTS.framePx + SLOTS.gapPx), y),
    );
    this.meter = new MeterWidget(this);
    this.volunteer = new VolunteerWidget(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown);
  }

  override update(_time: number, delta: number): void {
    const view = this.view;
    if (!view?.alive) return;
    for (const widget of this.widgets) {
      const slot = view.slots.find((s) => s.slot === widget.slot);
      widget.container.setVisible(slot !== undefined);
      if (slot) this.renderSlot(widget, slot, delta);
      widget.dim.setVisible(view.meter.channelling);
    }
    this.meter?.render(view.meter, delta);
    this.volunteer?.render(view.volunteer, view.meter.channelling, delta);
  }

  private createSlot(slot: 1 | 2, x: number, y: number): SlotWidget {
    const half = SLOTS.framePx / 2;
    const frame = this.add.graphics();
    const icon = this.add.image(half, half, ICONS.fireball).setScale(SLOTS.iconScale);
    const lostIcon = this.add
      .image(half, half, LOST_ICONS.fireball)
      .setScale(SLOTS.iconScale)
      .setAlpha(0);
    const overlay = this.add.graphics();
    const seconds = this.add.text(half, half, '', SECONDS_STYLE).setOrigin(0.5, 0.5);
    const { px, offsetPx, borderPx } = SLOTS.badge;
    const badge = this.add
      .graphics()
      .fillStyle(Palette.ink)
      .fillRect(offsetPx, offsetPx, px, px)
      .lineStyle(borderPx, Palette.cream)
      .strokeRect(offsetPx + borderPx / 2, offsetPx + borderPx / 2, px - borderPx, px - borderPx);
    const key = this.add
      .text(offsetPx + px / 2, offsetPx + px / 2, KEY_LABELS[slot], KEY_STYLE)
      .setOrigin(0.5, 0.5);
    const dim = this.add
      .graphics()
      .fillStyle(Palette.ink, CHANNEL_DIM_ALPHA)
      .fillRect(0, 0, SLOTS.framePx, SLOTS.framePx)
      .setVisible(false);
    const container = this.add.container(x, y, [
      frame,
      icon,
      lostIcon,
      overlay,
      seconds,
      badge,
      key,
      dim,
    ]);
    return {
      slot,
      container,
      frame,
      icon,
      lostIcon,
      overlay,
      seconds,
      badge,
      key,
      dim,
      baseX: x,
      look: null,
      spell: null,
      deniedSeen: 0,
      lostSeen: 0,
      shakeMs: 0,
      readyFlashMs: 0,
      lostFadeMs: null,
      frameDrawn: '',
      overlayDrawn: '',
    };
  }

  private renderSlot(widget: SlotWidget, slot: HudSlotView, delta: number): void {
    if (widget.spell !== slot.spell) {
      widget.spell = slot.spell;
      widget.icon.setTexture(ICONS[slot.spell]);
      widget.lostIcon.setTexture(LOST_ICONS[slot.spell]);
    }
    const first = widget.look === null;
    const look: Look = slot.state;
    if (first) {
      // Never granted (or already lost): the lost look at once, no shake or fade.
      widget.deniedSeen = slot.deniedCount;
      widget.lostSeen = slot.lostCount;
    } else {
      if (widget.look === 'cooldown' && look === 'ready') widget.readyFlashMs = SLOTS.readyFlashMs;
      if (slot.lostCount > widget.lostSeen) {
        widget.lostSeen = slot.lostCount;
        widget.lostFadeMs = 0;
        widget.shakeMs = SLOTS.shake.durationMs;
      }
      if (slot.deniedCount > widget.deniedSeen) {
        widget.deniedSeen = slot.deniedCount;
        widget.shakeMs = SLOTS.shake.durationMs;
      }
    }
    widget.look = look;

    widget.readyFlashMs = Math.max(0, widget.readyFlashMs - delta);
    if (widget.lostFadeMs !== null) {
      widget.lostFadeMs += delta;
      if (widget.lostFadeMs >= SLOTS.lost.fadeMs) widget.lostFadeMs = null;
    }
    const fading = widget.lostFadeMs !== null;
    const fade = fading ? (widget.lostFadeMs ?? 0) / SLOTS.lost.fadeMs : 1;

    this.drawFrameFor(widget, slot, look);
    this.drawIcon(widget, look, fade);
    this.drawOverlayFor(widget, slot, look, fading);

    const label = look === 'cooldown' ? String(Math.ceil(slot.cooldownRemainingMs / 1000)) : '';
    if (widget.seconds.text !== label) widget.seconds.setText(label);

    widget.shakeMs = Math.max(0, widget.shakeMs - delta);
    widget.container.setX(widget.baseX + shakeOffsetPx(widget.shakeMs, SLOTS.shake));
  }

  private drawFrameFor(widget: SlotWidget, slot: HudSlotView, look: Look): void {
    let border: number =
      look === 'lost' ? Palette.slate : look === 'cooldown' ? Palette.ash : Palette.cream;
    if (widget.readyFlashMs > 0 && look === 'ready') border = READY_FLASH[slot.spell];
    const key = String(border);
    if (widget.frameDrawn === key) return;
    widget.frameDrawn = key;
    const size = SLOTS.framePx;
    const b = SLOTS.borderPx;
    widget.frame
      .clear()
      .fillStyle(Palette.ink, SLOTS.plateAlpha)
      .fillRect(0, 0, size, size)
      .lineStyle(b, border)
      .strokeRect(b / 2, b / 2, size - b, size - b);
    const lost = look === 'lost';
    widget.badge.setAlpha(lost ? SLOTS.badge.lostAlpha : 1);
    widget.key.setColor(cssColor(lost ? Palette.slate : Palette.cream));
  }

  /**
   * Full colour, or the greyscale icon at 50% alpha when lost (§5b). `fade` 0..1 runs the 250 ms
   * crossfade from colour to grey.
   */
  private drawIcon(widget: SlotWidget, look: Look, fade: number): void {
    const t = look === 'lost' ? fade : 0;
    widget.icon.setAlpha(1 - t);
    widget.lostIcon.setAlpha(SLOTS.lost.iconAlpha * t);
  }

  /** Cooldown sweep, or the lost slash once the fade is over. */
  private drawOverlayFor(widget: SlotWidget, slot: HudSlotView, look: Look, fading: boolean): void {
    const size = SLOTS.framePx;
    let key = '';
    let fraction = 0;
    if (look === 'lost') key = fading ? '' : 'slash';
    else if (look === 'cooldown' && slot.cooldownMs > 0) {
      fraction = Math.min(1, slot.cooldownRemainingMs / slot.cooldownMs);
      // A quarter-pixel of sweep at the frame edge is enough; the number carries the time.
      key = `sweep${String(Math.round(fraction * size * 4))}`;
    }
    if (widget.overlayDrawn === key) return;
    widget.overlayDrawn = key;
    const g = widget.overlay.clear();
    if (key === 'slash') {
      const { slashInsetPx, slashPx, slashOutlinePx } = SLOTS.lost;
      const a = slashInsetPx;
      const b = size - slashInsetPx;
      g.lineStyle(slashPx + slashOutlinePx * 2, Palette.ink)
        .lineBetween(b, a, a, b)
        .lineStyle(slashPx, Palette.ash)
        .lineBetween(b, a, a, b);
    } else if (fraction > 0) {
      g.fillStyle(Palette.ink, SLOTS.sweepAlpha).fillPoints(squareSweep(size / 2, fraction), true);
    }
  }

  private readonly handleShutdown = (): void => {
    // Phaser destroys the display list on stop; only references are dropped here.
    this.widgets = [];
    this.meter = null;
    this.volunteer = null;
    this.view = null;
  };
}
