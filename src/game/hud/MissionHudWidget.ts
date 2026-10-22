import type Phaser from 'phaser';
import type { MissionHudView } from './MissionHudModel';
import { cssColor, Palette } from '../palette';
import { StructureTextures } from '../world/structurePlaceholders';

/**
 * "Huts n/2" and the portal arrow, in HUD px at 640×360 (readability.md §1 gold = progress, Portal
 * "Off-screen"). Presentation, not tuning (CD 2026-10-16: HUD constants stay in src/game).
 */
const WIDGET = {
  /** Objective count top-left. */
  objective: { x: 8, y: 8, px: 12, label: 'Huts' },
  /** On progress the count pops to 1.25× and settles over 250 ms. */
  pulse: { scale: 1.25, ms: 250 },
  arrow: {
    /** Sealed: dim grey-gold. Open: bright gold, breathing 70–100% over 900 ms. */
    sealedTint: 0x9a8a5a,
    sealedAlpha: 0.55,
    openTint: Palette.gold,
    breathe: { periodMs: 900, minAlpha: 0.7 },
    scale: 1.5,
  },
} as const;

/** Renders a {@link MissionHudView}; timers run on the HUD scene's delta. */
export class MissionHudWidget {
  private readonly count: Phaser.GameObjects.Text;
  private readonly arrow: Phaser.GameObjects.Image;
  private seenChanges = 0;
  private pulseMs = 0;
  private breatheMs = 0;
  private drawnText = '';

  constructor(scene: Phaser.Scene) {
    const { objective } = WIDGET;
    this.count = scene.add
      .text(objective.x, objective.y, '', {
        fontFamily: 'monospace',
        fontSize: `${String(objective.px)}px`,
        color: cssColor(Palette.gold),
        stroke: cssColor(Palette.ink),
        strokeThickness: 2,
      })
      .setOrigin(0, 0);
    this.arrow = scene.add
      .image(0, 0, StructureTextures.PortalArrow)
      .setScale(WIDGET.arrow.scale)
      .setVisible(false);
  }

  render(view: MissionHudView, delta: number): void {
    const { objective, arrow } = view;
    const text = `${WIDGET.objective.label} ${String(objective.progress)}/${String(objective.required)}`;
    if (text !== this.drawnText) {
      this.count.setText(text);
      this.drawnText = text;
    }
    if (objective.changedCount !== this.seenChanges) {
      this.seenChanges = objective.changedCount;
      this.pulseMs = WIDGET.pulse.ms;
    }
    this.pulseMs = Math.max(0, this.pulseMs - delta);
    this.count.setScale(1 + (WIDGET.pulse.scale - 1) * (this.pulseMs / WIDGET.pulse.ms));

    const { placement } = arrow;
    this.arrow.setVisible(placement !== null);
    if (!placement) return;
    this.arrow.setPosition(Math.round(placement.x), Math.round(placement.y));
    this.arrow.setRotation(placement.angle);
    if (arrow.open) {
      const { periodMs, minAlpha } = WIDGET.arrow.breathe;
      this.breatheMs = (this.breatheMs + delta) % periodMs;
      const wave = (1 - Math.cos((this.breatheMs / periodMs) * Math.PI * 2)) / 2;
      this.arrow.setTint(WIDGET.arrow.openTint).setAlpha(minAlpha + (1 - minAlpha) * wave);
    } else {
      this.arrow.setTint(WIDGET.arrow.sealedTint).setAlpha(WIDGET.arrow.sealedAlpha);
    }
  }
}
