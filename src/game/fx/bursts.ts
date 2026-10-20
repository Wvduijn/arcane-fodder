import type Phaser from 'phaser';
import { Palette } from '../palette';

/** Colour steps of an area burst, outside in (readability.md §1.6: near-white core, edge step). */
export interface BurstPalette {
  /** Rim at the full radius, so the edge reads on grass and dirt alike. */
  readonly rim: number;
  readonly outer: number;
  readonly inner: number;
  /** The flash core; skipped when the flash budget is spent (§1.9). */
  readonly core: number;
}

/**
 * Band radii as fractions of the burst radius, and the rim width (readability.md §5: core about
 * 40% of the radius, 1 px ink rim). Presentation.
 */
const BANDS = { inner: 0.7, core: 0.4, rimPx: 1 } as const;

/** Fireball, Combust and Kaboom (readability.md §5): flame-white core, flame/ember body, ink rim. */
export const FIRE_BURST: BurstPalette = {
  rim: Palette.ink,
  outer: Palette.ember,
  inner: Palette.flame,
  core: Palette.flameWhite,
} as const;

/** Radius of a burst's near-white core: what the §1.9 flash budget is asked about. */
export function burstCoreRadiusPx(radiusPx: number): number {
  return radiusPx * BANDS.core;
}

/**
 * Draws a burst centred on the Graphics' local origin, reaching exactly `radiusPx` (readability §5:
 * the edge reaches the ring the hit rule uses). Clears first; position, scale and alpha are the
 * caller's.
 */
export function drawBurst(
  g: Phaser.GameObjects.Graphics,
  radiusPx: number,
  palette: BurstPalette,
  core: boolean,
): void {
  g.clear()
    .fillStyle(palette.outer)
    .fillCircle(0, 0, radiusPx)
    .fillStyle(palette.inner)
    .fillCircle(0, 0, radiusPx * BANDS.inner);
  if (core) g.fillStyle(palette.core).fillCircle(0, 0, radiusPx * BANDS.core);
  g.lineStyle(BANDS.rimPx, palette.rim).strokeCircle(0, 0, radiusPx - BANDS.rimPx / 2);
}

/** A ring with a dark line on both sides, so it reads on any ground (keg fuse, reticle). */
export function drawOutlinedRing(
  g: Phaser.GameObjects.Graphics,
  radiusPx: number,
  color: number,
  linePx: number,
  outline: number,
  outlinePx: number,
): void {
  g.lineStyle(linePx + outlinePx * 2, outline)
    .strokeCircle(0, 0, radiusPx)
    .lineStyle(linePx, color)
    .strokeCircle(0, 0, radiusPx);
}
