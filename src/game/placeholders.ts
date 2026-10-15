import type Phaser from 'phaser';

/** Procedural stand-in textures used until tech-artist publishes atlases. */
export const PlaceholderTextures = {
  Wizard: 'placeholder-wizard',
  Ground: 'placeholder-ground',
  GroundBorder: 'placeholder-ground-border',
} as const;

/** Integer scale that brings the 16 px placeholder wizard to the 48 px character frame. */
export const PLACEHOLDER_WIZARD_SCALE = 3;

/** Character frame size in world px (style-guide.md §6: 48 × 48). */
export const CHARACTER_FRAME_PX = 48;

/**
 * Character anchor in the frame, as origin fractions: the feet, where the body circle sits
 * (style-guide.md §6: anchor (24, 46); GDD §0). Real atlases bring their own anchor (M8).
 */
export const CHARACTER_ANCHOR = {
  x: 24 / CHARACTER_FRAME_PX,
  y: 46 / CHARACTER_FRAME_PX,
} as const;

/** How far the character art reaches above the feet (46 px). Presentation, not tuning. */
export const CHARACTER_EXTENT_ABOVE_FEET_PX = CHARACTER_ANCHOR.y * CHARACTER_FRAME_PX;

/** Map tile size (tiled-conventions.md). Placeholder rendering only; M7 reads tilewidth from the map. */
export const TILE_SIZE_PX = 16;

const GROUND_COLORS = { fill: '#3f6b3a', grid: '#355c31' } as const;
const GROUND_BORDER_COLORS = { fill: '#6b4a2f', grid: '#4f3622' } as const;

/** 16×16 wizard. Each character is one pixel; '.' is transparent. */
const WIZARD_PIXELS = [
  '.......HH.......',
  '......HHHH......',
  '.....HHHHH......',
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '...BBBBBBBBBB...',
  '.....SSSSSS.....',
  '.....SESSES.....',
  '.....SSSSSS.....',
  '.....WWWWWW.....',
  '....RRWWWWRR....',
  '...RRRRRRRRRRS..',
  '...SRRRRRRRR.T..',
  '....RRRRRRRR.T..',
  '....RRRRRRRR.T..',
  '....FF....FF.T..',
] as const;

const WIZARD_PALETTE: Readonly<Record<string, string>> = {
  H: '#3d4fb5', // hat
  B: '#e3b341', // hat band
  S: '#f2c9a0', // skin
  E: '#2b1d3d', // eyes
  W: '#e8e8e8', // beard
  R: '#5865d6', // robe
  F: '#4a2f1d', // feet
  T: '#8a5a2b', // staff
};

export function createPlaceholderTextures(textures: Phaser.Textures.TextureManager): void {
  drawPixelArt(textures, PlaceholderTextures.Wizard, WIZARD_PIXELS, WIZARD_PALETTE);
  drawGridTile(textures, PlaceholderTextures.Ground, GROUND_COLORS);
  drawGridTile(textures, PlaceholderTextures.GroundBorder, GROUND_BORDER_COLORS);
}

/** One tile with a 1 px line on its top and left edges, so a tiled area reads as a grid. */
function drawGridTile(
  textures: Phaser.Textures.TextureManager,
  key: string,
  colors: { readonly fill: string; readonly grid: string },
): void {
  if (textures.exists(key)) return;

  const texture = textures.createCanvas(key, TILE_SIZE_PX, TILE_SIZE_PX);
  if (!texture) throw new Error(`Could not create placeholder texture "${key}"`);

  const { context } = texture;
  context.fillStyle = colors.fill;
  context.fillRect(0, 0, TILE_SIZE_PX, TILE_SIZE_PX);
  context.fillStyle = colors.grid;
  context.fillRect(0, 0, TILE_SIZE_PX, 1);
  context.fillRect(0, 0, 1, TILE_SIZE_PX);
  texture.refresh();
}

function drawPixelArt(
  textures: Phaser.Textures.TextureManager,
  key: string,
  rows: readonly string[],
  palette: Readonly<Record<string, string>>,
): void {
  if (textures.exists(key)) return;

  const width = rows[0]?.length ?? 0;
  const texture = textures.createCanvas(key, width, rows.length);
  if (!texture) throw new Error(`Could not create placeholder texture "${key}"`);

  const { context } = texture;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = palette[row.charAt(x)];
      if (color === undefined) continue;
      context.fillStyle = color;
      context.fillRect(x, y, 1, 1);
    }
  });
  texture.refresh();
}
