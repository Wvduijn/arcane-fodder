import Phaser from 'phaser';
import type { EventBus } from '../bus/EventBus';
import { Depth } from '../depths';
import type { System } from '../systems/System';
import type { LeaderSource } from './Positioned';

/** Placeholder marker look. Presentation, not tuning; M8 art replaces it. */
const MARKER = {
  widthPx: 27,
  heightPx: 12,
  outlinePx: 2,
  /** style-guide.md palette: gold is reserved for the leader marker (and runes, HUD count). */
  fill: 0xf2b42a,
  /** style-guide.md ink: outlines are never pure black. */
  outline: 0x1a1020,
  /** readability.md: ≥ 800 ms. */
  pulsePeriodMs: 1000,
  pulseScale: 0.12,
  pulseMinAlpha: 0.7,
  /** readability.md: ≤ 200 ms. */
  popMs: 180,
  popScale: 0.6,
} as const;

/**
 * Placeholder leader marker (readability.md "Leader vs followers"): a gold ground ellipse with a
 * dark outline under the leader's feet. A slow scale-and-alpha pulse makes it read by motion, not
 * hue alone. On `squad:leader-changed` it moves to the new leader with a short pop. Hidden when the
 * squad is wiped. Presentation only: it reads the leader's position every frame and owns no state
 * beyond its animation clocks (driven by the scene's dt).
 */
export class LeaderMarker implements System {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private pulseMs = 0;
  /** Time since the last pop started; ≥ popMs when no pop is running. */
  private popElapsedMs: number = MARKER.popMs;

  constructor(
    scene: Phaser.Scene,
    private readonly source: LeaderSource,
    private readonly bus: EventBus,
  ) {
    const { widthPx, heightPx, outlinePx } = MARKER;
    this.graphics = scene.add
      .graphics()
      .fillStyle(MARKER.outline)
      .fillEllipse(0, 0, widthPx + outlinePx * 2, heightPx + outlinePx * 2)
      .fillStyle(MARKER.fill)
      .fillEllipse(0, 0, widthPx, heightPx)
      .setDepth(Depth.GroundMarker);
    bus.on('squad:leader-changed', this.handleLeaderChanged);
    this.update(0);
  }

  /** Debug readout: whether it is drawn, where, and the pop progress (null when no pop runs). */
  get debugState(): {
    readonly visible: boolean;
    readonly x: number;
    readonly y: number;
    readonly scale: number;
    readonly popProgress: number | null;
  } {
    const { visible, x, y, scaleX } = this.graphics;
    return { visible, x, y, scale: scaleX, popProgress: this.popProgress };
  }

  /** Current pop progress 0..1, or null when no pop is running. */
  get popProgress(): number | null {
    return this.popElapsedMs < MARKER.popMs ? this.popElapsedMs / MARKER.popMs : null;
  }

  update(dt: number): void {
    const { leader } = this.source;
    this.graphics.setVisible(leader !== null);
    if (!leader) return;

    this.pulseMs = (this.pulseMs + dt) % MARKER.pulsePeriodMs;
    this.popElapsedMs = Math.min(this.popElapsedMs + dt, MARKER.popMs);
    // 0 → 1 → 0 over one period.
    const wave = (1 - Math.cos((this.pulseMs / MARKER.pulsePeriodMs) * Math.PI * 2)) / 2;
    const popT = this.popElapsedMs / MARKER.popMs;
    const pop = MARKER.popScale * (1 - Phaser.Math.Easing.Back.Out(popT));
    const scale = 1 + MARKER.pulseScale * wave + pop;

    this.graphics
      .setPosition(leader.position.x, leader.position.y)
      .setScale(scale)
      .setAlpha(1 - (1 - MARKER.pulseMinAlpha) * wave);
  }

  destroy(): void {
    this.bus.off('squad:leader-changed', this.handleLeaderChanged);
    this.graphics.destroy();
  }

  private readonly handleLeaderChanged = (): void => {
    this.popElapsedMs = 0;
  };
}
