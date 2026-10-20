/**
 * Style-guide colours (assets-src/style-guide.md §4) that engine-drawn FX and the HUD use, as
 * Phaser colour numbers. The style guide is authoritative; this mirrors the entries code needs.
 */
export const Palette = {
  ink: 0x1a1020,
  slate: 0x4f4a5e,
  ash: 0x807a8c,
  cream: 0xf4ecdc,
  flameWhite: 0xfff4c2,
  flame: 0xffab2e,
  ember: 0xf2581f,
  crimson: 0xc42a2a,
  bolt: 0xfff36b,
  cyan: 0x6fe7ff,
  bark: 0x5c3a24,
  leather: 0x8f5a34,
} as const;

/** CSS form of a palette colour, for Text styles. */
export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
