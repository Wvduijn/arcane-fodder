import type Phaser from 'phaser';
import type { EnemyId, MageClassId } from '@core/types';

/** Procedural stand-in textures used until tech-artist publishes atlases. */
export const PlaceholderTextures = {
  Ground: 'placeholder-ground',
  GroundBorder: 'placeholder-ground-border',
  FireBolt: 'placeholder-fire-bolt',
  Spark: 'placeholder-spark',
  Arrow: 'placeholder-arrow',
  /** White disc, tinted per death variant. */
  Puff: 'placeholder-puff',
  /** Two flicker frames of the Burning overlay. */
  BurningA: 'placeholder-burning-a',
  BurningB: 'placeholder-burning-b',
  /** Powder keg, 32×32 frame with the danger mark (readability.md §4). */
  Keg: 'placeholder-keg',
  /** Fireball in flight: a 15 px glowing orb (readability.md §5). */
  FireballOrb: 'placeholder-fireball-orb',
  /** Small hot speck: Fireball trail, Combust ember arcs, keg fuse sparks. */
  Ember: 'placeholder-ember',
  /** Lightning ground flash: white core, cyan edge, 10 px radius (the reticle's size). */
  StormFlash: 'placeholder-storm-flash',
  /** Kaboom debris speck: white body (tinted bark or slate), ink outline, matte. */
  Debris: 'placeholder-debris',
  /** HUD slot icons, 12×12, drawn at 2× as the 24×24 icon (readability.md §5b). */
  IconFireball: 'placeholder-icon-fireball',
  IconLightning: 'placeholder-icon-lightning',
  /** Greyscale twins for a lost slot (readability.md §5b: `ash`/`slate`). */
  IconFireballLost: 'placeholder-icon-fireball-lost',
  IconLightningLost: 'placeholder-icon-lightning-lost',
} as const;

/** One wizard texture per class: hat, robe and staff tip differ (readability.md §2). */
export const WizardTextures = {
  pyromancer: 'placeholder-wizard-pyromancer',
  stormcaller: 'placeholder-wizard-stormcaller',
} as const satisfies Record<MageClassId, string>;

/** Grunt wide with a raised weapon, archer narrow and hooded with a bow (readability.md §3). */
export const EnemyTextures = {
  'goblin-grunt': 'placeholder-goblin-grunt',
  'goblin-archer': 'placeholder-goblin-archer',
} as const satisfies Record<EnemyId, string>;

/** Integer scale that brings the 16 px placeholder characters (wizards, goblins) to the 48 px frame. */
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

/**
 * Projectile textures point along +x (rotate them to the velocity) and are drawn at 1× world px.
 * The origin is the hit circle's centre: the orb of the fire bolt, the tip of the arrow.
 */
export const PROJECTILE_ORIGINS = {
  [PlaceholderTextures.FireBolt]: { x: 5.5 / 9, y: 0.5 },
  [PlaceholderTextures.Spark]: { x: 0.5, y: 0.5 },
  [PlaceholderTextures.Arrow]: { x: 10 / 12, y: 0.5 },
} as const;

/**
 * Keg anchor as origin fractions: the footprint centre (where the body circle sits), 7.5 px above
 * the barrel's bottom edge in the 32×32 frame.
 */
export const KEG_ANCHOR = { x: 0.5, y: 22 / 32 } as const;

/** Radius of the StormFlash texture, in texture px. */
export const STORM_FLASH_RADIUS_PX = 10;

/** Its near-white centre (the inner half of the disc), for the §1.9 flash budget. */
export const STORM_FLASH_CORE_RADIUS_PX = STORM_FLASH_RADIUS_PX * 0.5;

/** Map tile size (tiled-conventions.md). Placeholder rendering only; M7 reads tilewidth from the map. */
export const TILE_SIZE_PX = 16;

const GROUND_COLORS = { fill: '#3f6b3a', grid: '#355c31' } as const;
const GROUND_BORDER_COLORS = { fill: '#6b4a2f', grid: '#4f3622' } as const;

type PixelRows = readonly string[];
type Palette = Readonly<Record<string, string>>;

/**
 * 16×16 wizard face and body below the hat (rows 6–15), after the staff-tip row (row 9). Each
 * character is one pixel; '.' is transparent.
 */
const wizardBodyRows = (staffTipRow: string): PixelRows => [
  '.....SSSSSS.....',
  '.....SESSES.....',
  '.....SSSSSS.....',
  staffTipRow,
  '....RRWWWWRR.X..',
  '...RRRRRRRRRRS..',
  '...SRRRRRRRR.T..',
  '....RRRRRRRR.T..',
  '....YYYYYYYY.T..',
  '....FF....FF.T..',
];

/** Pyromancer: short pointy hat with a floppy tip, flame staff tip (X), red robe. */
const PYROMANCER_PIXELS = [
  '................',
  '................',
  '........HH......',
  '......HHH.......',
  '.....HHHHHH.....',
  '...BBBBBBBBBB...',
  ...wizardBodyRows('.....WWWWWW..X..'),
];

/** Stormcaller: taller kinked hat (6 px above the Pyromancer's), forked staff tip (X), blue robe. */
const STORMCALLER_PIXELS = [
  '......H.........',
  '.......H........',
  '......HHH.......',
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '...BBBBBBBBBB...',
  ...wizardBodyRows('.....WWWWWWX.X..'),
];

const WIZARD_SHARED_PALETTE: Palette = {
  B: '#e3b341', // hat band
  S: '#f2c9a0', // skin
  E: '#2b1d3d', // eyes
  W: '#e8e8e8', // beard
  F: '#4a2f1d', // feet
  T: '#8a5a2b', // staff
};

const PYROMANCER_PALETTE: Palette = {
  ...WIZARD_SHARED_PALETTE,
  H: '#8c2a1f', // hat
  R: '#c8402e', // robe
  Y: '#c8402e', // hem, same as the robe
  X: '#ff8a1f', // flame tip
};

const STORMCALLER_PALETTE: Palette = {
  ...WIZARD_SHARED_PALETTE,
  H: '#2f3f9e', // hat
  R: '#3d55c8', // robe
  Y: '#f2d64a', // yellow trim
  X: '#7ff6ff', // forked tip
};

/** Grunt: hunched, wide, big ears, cleaver raised above the head. Body about 30×30 at 3×. */
const GRUNT_PIXELS = [
  '................',
  '................',
  '................',
  '...........KKK..',
  '...........KKKK.',
  '............N...',
  '...LGGGGGGL.N...',
  '..LLGOGGOGLLG...',
  '....GTGGTG..G...',
  '...AAAAAAAAG....',
  '..GAAAAAAAA.....',
  '..GAAAAAAAA.....',
  '...AAAAAAAA.....',
  '....GG..GG......',
  '....GG..GG......',
  '...FFF..FFF.....',
] as const;

/** Archer: narrow, hooded (no ear outline), bow arc vertical along the right side. */
const ARCHER_PIXELS = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '............W...',
  '......HHH....W..',
  '.....HOGOH...W..',
  '.....HGGGH...W..',
  '....HHHHHHH..W..',
  '....GHHHHHGGGW..',
  '.....AAAAA...W..',
  '.....AAAAA...W..',
  '.....GG.GG..W...',
  '.....GG.GG.W....',
  '....FFF.FFF.....',
] as const;

const GOBLIN_PALETTE: Palette = {
  G: '#9be04a', // lime skin
  L: '#7cc23a', // ears
  O: '#e8661a', // eyes (R7: static flame-orange, dimmer than Burning)
  T: '#f0ead6', // teeth
  A: '#8a4b2a', // rust scrap armour
  F: '#3b2a1a', // feet
  K: '#c9ced6', // cleaver steel
  N: '#6b4a2f', // cleaver handle
  H: '#c8963e', // archer hood
  W: '#7a4a22', // bow
};

/** Fire bolt: glowing orb (near-white core, orange edge) with a short trail to the left. */
const FIRE_BOLT_PIXELS = [
  '.....OO..',
  '....OYYO.',
  'rr.OYWWYO',
  '.rrOYWWYO',
  '....OYYO.',
  '.....OO..',
] as const;

/** Spark: small cyan-white zig-zag dash (≤ 9×4). */
const SPARK_PIXELS = ['C...CC..', 'WC.CWWC.', '.CWC..CW', '..C....C'] as const;

/** Arrow: matte pale shaft, steel head, dark outline (12×3). Nothing glows. */
const ARROW_PIXELS = ['IIIIIIIIIII.', 'FPPPPPPPPMMI', 'IIIIIIIIIII.'] as const;

const FX_PALETTE: Palette = {
  W: '#ffffff',
  Y: '#ffe14d',
  O: '#ff8a1f',
  r: '#b8501a',
  R: '#d8361f',
  C: '#40e0ff',
  I: '#1a1020', // ink outline
  P: '#e0d2a8', // shaft
  M: '#c9ced6', // steel head
  F: '#a89870', // fletching
};

const PUFF_PIXELS = [
  '..WWWW..',
  '.WWWWWW.',
  'WWWWWWWW',
  'WWWWWWWW',
  'WWWWWWWW',
  'WWWWWWWW',
  '.WWWWWW.',
  '..WWWW..',
] as const;

/** Burning overlay frame: flame with a near-white core and an orange edge (readability.md §5). */
const BURNING_PIXELS = [
  '...R....',
  '..RO..R.',
  '..OO.RO.',
  '.OYO.OO.',
  '.OYYOYO.',
  'OYWYYYOO',
  'OYWWWYYO',
  'OYWWWWYO',
  '.OYWWYO.',
  '..OOOO..',
] as const;

/**
 * Powder keg (readability.md §4, style guide §keg): a 20×24 barrel in a 32×32 frame, ink outline,
 * leather/bark staves, slate hoops, a thick ink powder band with a cream bomb stencil (its fuse
 * and spark top right), and a fuse stub on the lid. No skull, and no other prop uses this mark.
 */
const KEG_PIXELS = [
  '.................I..............',
  '...............I.cI.............',
  '...............IcI..............',
  '...............Ic...............',
  '...............Ic...............',
  '...............Ic...............',
  '.........IIIIIIIIIIIIII.........',
  '........IddddddddddddddI........',
  '.......IddddddddddddddddI.......',
  '......IwwwwwwwwwwwwwwwwwwI......',
  '......IhhhhhhhhhhhhhhhhhhI......',
  '......IwwwdwwwwwwwwwwdwwwI......',
  '......IwwwdwwwwwwwwwwdwwwI......',
  '......IppppppppppppspppppI......',
  '......IppppppppppppbpppppI......',
  '......IpppppppppppbppppppI......',
  '......IpppppppbbbbpppppppI......',
  '......IppppppbpbbbbppppppI......',
  '......IppppppbbbbbbppppppI......',
  '......IppppppbbbbbbppppppI......',
  '......IppppppbbbbbbppppppI......',
  '......IpppppppbbbbpppppppI......',
  '......IppppppppppppppppppI......',
  '......IwwwdwwwwwwwwwwdwwwI......',
  '......IwwwdwwwwwwwwwwdwwwI......',
  '......IhhhhhhhhhhhhhhhhhhI......',
  '......IwwwwwwwwwwwwwwwwwwI......',
  '.......IwwwwwwwwwwwwwwwwI.......',
  '........IwwwwwwwwwwwwwwI........',
  '.........IIIIIIIIIIIIII.........',
  '................................',
  '................................',
] as const;

/** Props sit a clear saturation step below units and FX (readability.md §1.2). */
const KEG_PALETTE: Palette = {
  I: '#1a1020', // ink outline
  w: '#8f5a34', // leather staves
  d: '#5c3a24', // bark lid, stave seams
  h: '#4f4a5e', // slate hoops
  p: '#1a1020', // ink powder band
  b: '#f4ecdc', // cream bomb stencil
  s: '#fff4c2', // flame-white stencil spark
  c: '#807a8c', // ash fuse cord
};

/** Ember: 3 px `ember` dot with a `flame-white` centre (readability.md §5). */
const EMBER_PIXELS = ['.E.', 'EWE', '.E.'] as const;

const EMBER_PALETTE: Palette = { E: '#f2581f', W: '#fff4c2' };

/** Debris speck: 3×3, white body to tint bark or slate, ink outline, matte (readability.md §5). */
const DEBRIS_PIXELS = ['II.', 'IwI', '.II'] as const;

const DEBRIS_PALETTE: Palette = { I: '#1a1020', w: '#ffffff' };

/** HUD Fireball icon (readability.md §5b): teardrop flame point up, flame-white core, ember lower edge. */
const ICON_FIREBALL_PIXELS = [
  '.....II.....',
  '....IOOI....',
  '....IOOI....',
  '...IOOOOI...',
  '...IOWWOI...',
  '..IOOWWOOI..',
  '..IOWWWWOI..',
  '.IOOWWWWOOI.',
  '.IOWWWWWWOI.',
  '.IEOWWWWOEI.',
  '..IEEOOEEI..',
  '...IIIIII...',
] as const;

/** HUD Lightning icon (readability.md §5b): 3-segment zigzag, top right to bottom left, bolt core. */
const ICON_LIGHTNING_PIXELS = [
  '.......III..',
  '......ICBI..',
  '.....ICBI...',
  '....ICBI....',
  '...ICBBIII..',
  '..ICBBBBBI..',
  '..IIIBBCI...',
  '....IBCI....',
  '...IBCI.....',
  '...ICI......',
  '..ICI.......',
  '..II........',
] as const;

/** Style-guide colours (§4): ink, flame, flame-white, ember, cyan, bolt. */
const ICON_PALETTE: Palette = {
  I: '#1a1020',
  O: '#ffab2e',
  W: '#fff4c2',
  E: '#f2581f',
  C: '#6fe7ff',
  B: '#fff36b',
};

/** Lost-icon greys (style guide §4) and the luma split between them; ink outlines stay ink. */
const LOST_ICON = { light: '#807a8c', dark: '#4f4a5e', ink: '#1a1020', lumaSplit: 150 } as const;

/** The same icon in `ash` (light colours) and `slate` (dark ones), outline kept (readability §5b). */
function greyscalePalette(palette: Palette): Palette {
  const grey: Record<string, string> = {};
  for (const [key, color] of Object.entries(palette)) {
    if (color === LOST_ICON.ink) {
      grey[key] = color;
      continue;
    }
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    grey[key] = luma >= LOST_ICON.lumaSplit ? LOST_ICON.light : LOST_ICON.dark;
  }
  return grey;
}

export function createPlaceholderTextures(textures: Phaser.Textures.TextureManager): void {
  drawPixelArt(textures, WizardTextures.pyromancer, PYROMANCER_PIXELS, PYROMANCER_PALETTE);
  drawPixelArt(textures, WizardTextures.stormcaller, STORMCALLER_PIXELS, STORMCALLER_PALETTE);
  drawPixelArt(textures, EnemyTextures['goblin-grunt'], GRUNT_PIXELS, GOBLIN_PALETTE);
  drawPixelArt(textures, EnemyTextures['goblin-archer'], ARCHER_PIXELS, GOBLIN_PALETTE);
  drawPixelArt(textures, PlaceholderTextures.FireBolt, FIRE_BOLT_PIXELS, FX_PALETTE);
  drawPixelArt(textures, PlaceholderTextures.Spark, SPARK_PIXELS, FX_PALETTE);
  drawPixelArt(textures, PlaceholderTextures.Arrow, ARROW_PIXELS, FX_PALETTE);
  drawPixelArt(textures, PlaceholderTextures.Puff, PUFF_PIXELS, FX_PALETTE);
  drawPixelArt(textures, PlaceholderTextures.BurningA, BURNING_PIXELS, FX_PALETTE);
  drawPixelArt(textures, PlaceholderTextures.BurningB, mirror(BURNING_PIXELS), FX_PALETTE);
  drawPixelArt(textures, PlaceholderTextures.Keg, KEG_PIXELS, KEG_PALETTE);
  drawPixelArt(textures, PlaceholderTextures.Ember, EMBER_PIXELS, EMBER_PALETTE);
  drawPixelArt(textures, PlaceholderTextures.Debris, DEBRIS_PIXELS, DEBRIS_PALETTE);
  drawPixelArt(textures, PlaceholderTextures.IconFireball, ICON_FIREBALL_PIXELS, ICON_PALETTE);
  drawPixelArt(textures, PlaceholderTextures.IconLightning, ICON_LIGHTNING_PIXELS, ICON_PALETTE);
  const lostPalette = greyscalePalette(ICON_PALETTE);
  drawPixelArt(textures, PlaceholderTextures.IconFireballLost, ICON_FIREBALL_PIXELS, lostPalette);
  drawPixelArt(textures, PlaceholderTextures.IconLightningLost, ICON_LIGHTNING_PIXELS, lostPalette);
  // Fireball orb: 15 px across, stepped white → yellow → orange → red edge (hard steps, no soft pixels).
  drawDisc(textures, PlaceholderTextures.FireballOrb, 7.5, [
    { upTo: 0.35, color: '#ffffff' },
    { upTo: 0.6, color: '#ffe14d' },
    { upTo: 0.85, color: '#ff8a1f' },
    { upTo: 1, color: '#d8361f' },
  ]);
  drawDisc(textures, PlaceholderTextures.StormFlash, STORM_FLASH_RADIUS_PX, [
    { upTo: STORM_FLASH_CORE_RADIUS_PX / STORM_FLASH_RADIUS_PX, color: '#fff36b' },
    { upTo: 0.8, color: '#6fe7ff' },
    { upTo: 1, color: '#1a6a8a' },
  ]);
  drawGridTile(textures, PlaceholderTextures.Ground, GROUND_COLORS);
  drawGridTile(textures, PlaceholderTextures.GroundBorder, GROUND_BORDER_COLORS);
}

/** One colour band of a disc: pixels whose centre is within `upTo` × radius of the middle. */
interface DiscBand {
  readonly upTo: number;
  readonly color: string;
}

/** A pixel-exact disc of `radius` (texture ⌈2r⌉ square) with hard concentric colour bands, inner first. */
function drawDisc(
  textures: Phaser.Textures.TextureManager,
  key: string,
  radius: number,
  bands: readonly DiscBand[],
): void {
  if (textures.exists(key)) return;

  const size = Math.ceil(radius * 2);
  const texture = textures.createCanvas(key, size, size);
  if (!texture) throw new Error(`Could not create placeholder texture "${key}"`);

  const { context } = texture;
  const centre = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - centre, y + 0.5 - centre) / radius;
      const color = bands.find((band) => d <= band.upTo)?.color;
      if (color === undefined) continue;
      context.fillStyle = color;
      context.fillRect(x, y, 1, 1);
    }
  }
  texture.refresh();
}

function mirror(rows: PixelRows): PixelRows {
  return rows.map((row) => Array.from(row).reverse().join(''));
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
  rows: PixelRows,
  palette: Palette,
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
