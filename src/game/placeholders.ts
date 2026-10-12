import type Phaser from 'phaser';

/** Procedural stand-in textures used until tech-artist publishes atlases. */
export const PlaceholderTextures = {
  Wizard: 'placeholder-wizard',
} as const;

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
