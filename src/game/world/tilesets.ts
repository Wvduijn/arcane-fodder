import type Phaser from 'phaser';

/** Tiled tileset name → Phaser texture key (tiled-conventions.md §7). */
export const TilesetTextures = {
  'forest-ground': 'tiles-forest-ground',
  'forest-blockers': 'tiles-forest-blockers',
  'forest-canopy': 'tiles-forest-canopy',
} as const;

export type TilesetName = keyof typeof TilesetTextures;

export function isTilesetName(name: string): name is TilesetName {
  return Object.hasOwn(TilesetTextures, name);
}

/** Columns of a generated placeholder tileset; Phaser derives tile ids from the texture width. */
const PLACEHOLDER_COLUMNS = 8;

/**
 * How one placeholder tile is painted: a fill plus an accent in a simple pattern, so terrain kinds
 * read apart at a glance. `null` fill leaves the tile transparent (detail and canopy edges).
 */
interface TileLook {
  readonly fill: string | null;
  readonly accent: string;
  readonly pattern: 'flat' | 'grid' | 'speckle' | 'dither' | 'waves' | 'planks' | 'trunk' | 'edge';
}

/**
 * Placeholder look per tile `name` (scripts/levels/README.md tile catalogue). Presentation only;
 * replaced by tech-artist's tilesets in M8. Canopy is a half-transparent dither so units under it
 * stay readable.
 */
const TILE_LOOKS: Readonly<Record<string, TileLook>> = {
  grass: { fill: '#3f6b3a', accent: '#355c31', pattern: 'grid' },
  'grass-dark': { fill: '#355c31', accent: '#2c4f29', pattern: 'grid' },
  dirt: { fill: '#6b5236', accent: '#5a442c', pattern: 'speckle' },
  road: { fill: '#8a6e48', accent: '#76603e', pattern: 'speckle' },
  mud: { fill: '#4a3a2a', accent: '#3a2418', pattern: 'speckle' },
  water: { fill: '#2d5f8a', accent: '#6fa8d0', pattern: 'waves' },
  bridge: { fill: '#8f5a34', accent: '#5c3a24', pattern: 'planks' },
  'portal-pad': { fill: '#4f4a5e', accent: '#33263f', pattern: 'grid' },
  flowers: { fill: null, accent: '#f4ecdc', pattern: 'speckle' },
  puddle: { fill: null, accent: '#4f7fa0', pattern: 'speckle' },
  shadow: { fill: null, accent: '#1a1020', pattern: 'dither' },
  'path-edge': { fill: null, accent: '#5a442c', pattern: 'edge' },
  scorch: { fill: null, accent: '#1a1020', pattern: 'speckle' },
  trunk: { fill: '#2c4f29', accent: '#5c3a24', pattern: 'trunk' },
  rock: { fill: '#807a8c', accent: '#4f4a5e', pattern: 'speckle' },
  cliff: { fill: '#4f4a5e', accent: '#33263f', pattern: 'planks' },
  'hut-footprint': { fill: '#3a2418', accent: '#1a1020', pattern: 'grid' },
  'bridge-rail': { fill: '#5c3a24', accent: '#1a1020', pattern: 'planks' },
  canopy: { fill: null, accent: '#1f3d1c', pattern: 'dither' },
  'canopy-edge': { fill: null, accent: '#1f3d1c', pattern: 'edge' },
};

/** Unknown tile names paint loudly, so a missing look shows up in a playtest. */
const MISSING_LOOK: TileLook = { fill: '#ff00ff', accent: '#000000', pattern: 'grid' };

/**
 * Paints the placeholder texture for every tileset of `map` that has no texture yet. Tile ids map
 * to looks through each tile's `name` property (written by scripts/levels/build-tilemap.js).
 * Textures outlive the scene, so restarts reuse them.
 */
export function createPlaceholderTilesets(
  textures: Phaser.Textures.TextureManager,
  map: Phaser.Tilemaps.Tilemap,
): void {
  for (const tileset of map.tilesets) {
    if (!isTilesetName(tileset.name)) {
      throw new Error(`Map tileset "${tileset.name}" has no texture key (tiled-conventions §7)`);
    }
    const key = TilesetTextures[tileset.name];
    if (textures.exists(key)) continue;

    const names = tileNames(tileset);
    const size = map.tileWidth;
    const rows = Math.max(1, Math.ceil(names.length / PLACEHOLDER_COLUMNS));
    const texture = textures.createCanvas(key, PLACEHOLDER_COLUMNS * size, rows * size);
    if (!texture) throw new Error(`Could not create placeholder tileset "${key}"`);
    names.forEach((name, id) => {
      const x = (id % PLACEHOLDER_COLUMNS) * size;
      const y = Math.floor(id / PLACEHOLDER_COLUMNS) * size;
      paintTile(texture.context, x, y, size, TILE_LOOKS[name] ?? MISSING_LOOK);
    });
    texture.refresh();
  }
}

/** Tile names by local id; ids without a name get an empty slot. */
function tileNames(tileset: Phaser.Tilemaps.Tileset): string[] {
  const properties = tileset.tileProperties as Readonly<Record<string, unknown>>;
  const names: (string | undefined)[] = [];
  for (const [id, value] of Object.entries(properties)) {
    const name = (value as { readonly name?: unknown } | null)?.name;
    if (typeof name === 'string') names[Number(id)] = name;
  }
  return Array.from(names, (name) => name ?? '');
}

function paintTile(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  look: TileLook,
): void {
  if (look.fill !== null) {
    context.fillStyle = look.fill;
    context.fillRect(left, top, size, size);
  }
  context.fillStyle = look.accent;
  const dot = (x: number, y: number, w = 1, h = 1): void => {
    context.fillRect(left + x, top + y, w, h);
  };
  switch (look.pattern) {
    case 'flat':
      break;
    case 'grid':
      dot(0, 0, size, 1);
      dot(0, 0, 1, size);
      break;
    case 'speckle':
      for (let i = 0; i < 6; i++) dot((i * 7 + 3) % size, (i * 5 + 2) % size, 2, 1);
      break;
    case 'dither':
      for (let y = 0; y < size; y++) for (let x = y % 2; x < size; x += 2) dot(x, y);
      break;
    case 'waves':
      for (let y = 3; y < size; y += 6) dot(2 + (y % 4), y, size / 2, 1);
      break;
    case 'planks':
      for (let y = 0; y < size; y += 4) dot(0, y, size, 1);
      break;
    case 'trunk':
      dot(size / 4, 0, size / 2, size);
      context.fillStyle = '#1a1020';
      dot(size / 4, 0, 1, size);
      dot((size * 3) / 4 - 1, 0, 1, size);
      break;
    case 'edge':
      for (let x = 0; x < size; x += 2) dot(x, 0, 1, 2);
      break;
  }
}
