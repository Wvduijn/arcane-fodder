import type Phaser from 'phaser';
import type { Vec2 } from '@core/types';
import { Palette } from '../palette';

/** Jagged bolt look (readability.md §5 Lightning strike). Presentation. */
export interface BoltStyle {
  readonly segmentPx: number;
  readonly jitterPx: number;
  readonly glowLinePx: number;
  readonly coreLinePx: number;
  readonly glow: number;
  readonly core: number;
}

/** The M5 Lightning bolt; Thunderstorm and Firestorm bolts reuse it (M6 T11). */
export const STORM_BOLT: BoltStyle = {
  segmentPx: 24,
  jitterPx: 5,
  glowLinePx: 6,
  coreLinePx: 2,
  glow: Palette.cyan,
  core: Palette.bolt,
} as const;

/**
 * Draws a jagged bolt from `topY` straight down to `at`, in world coordinates (the Graphics sits at
 * 0, 0). Clears first. The jitter is a hash of the impact point, so a replay draws the same bolt.
 */
export function drawBolt(
  g: Phaser.GameObjects.Graphics,
  at: Vec2,
  topY: number,
  style: BoltStyle,
): void {
  const { segmentPx, jitterPx, glowLinePx, coreLinePx, glow, core } = style;
  const points: Vec2[] = [];
  const length = Math.max(segmentPx, at.y - topY);
  const count = Math.ceil(length / segmentPx);
  for (let i = 0; i <= count; i++) {
    const y = at.y - (length * i) / count;
    const x = i === 0 ? at.x : at.x + jitter(at, i) * jitterPx;
    points.push({ x, y });
  }
  g.clear();
  const stroke = (width: number, color: number): void => {
    g.lineStyle(width, color).beginPath();
    points.forEach((p, i) => {
      if (i === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    });
    g.strokePath();
  };
  stroke(glowLinePx, glow);
  stroke(coreLinePx, core);
}

/** Deterministic −1..1 from a point and an index (presentation only). */
export function jitter(at: Vec2, i: number): number {
  const n = Math.sin(at.x * 12.9898 + at.y * 78.233 + i * 37.719) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1;
}
