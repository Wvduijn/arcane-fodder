#!/usr/bin/env node
// Level source (ASCII terrain + objects JSON) → Tiled JSON map. Format: scripts/levels/README.md.
// Map contract: docs/design/levels/tiled-conventions.md. Plain Node 22 ESM, no dependencies.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_ROOT = join(ROOT, 'assets-src/levels');
const OUT_ROOT = join(ROOT, 'public/assets/tilemaps');
const TILE_PX = 16;
const TILESET_COLUMNS = 8;

/** Conventions §7. Tile order is the tile id; append only, so built maps keep their ids. */
const TILESETS = [
  {
    name: 'forest-ground',
    key: 'tiles-forest-ground',
    tiles: [
      'grass',
      'grass-dark',
      'dirt',
      'road',
      'mud',
      'water',
      'bridge',
      'portal-pad',
      'flowers',
      'puddle',
      'shadow',
      'path-edge',
      'scorch',
    ],
  },
  {
    name: 'forest-blockers',
    key: 'tiles-forest-blockers',
    tiles: ['trunk', 'rock', 'cliff', 'water', 'hut-footprint', 'bridge-rail'],
  },
  { name: 'forest-canopy', key: 'tiles-forest-canopy', tiles: ['canopy', 'canopy-edge'] },
];

/** Conventions §3, bottom to top. */
const TILE_LAYERS = [
  { name: 'ground', tileset: 'forest-ground' },
  { name: 'ground-detail', tileset: 'forest-ground' },
  { name: 'blockers', tileset: 'forest-blockers' },
  { name: 'canopy', tileset: 'forest-canopy' },
];
const OBJECT_LAYERS = ['zones', 'spawns', 'structures', 'props'];

/** Conventions §4: object type → layer and geometry. */
const OBJECT_TYPES = {
  section: { layer: 'zones', rect: true },
  trigger: { layer: 'zones', rect: true },
  'safe-start': { layer: 'zones', rect: true },
  'bounds-hint': { layer: 'zones', rect: true },
  'squad-start': { layer: 'spawns', rect: false },
  'enemy-spawn': { layer: 'spawns', rect: false },
  'archer-post': { layer: 'spawns', rect: false },
  'surge-spawn': { layer: 'spawns', rect: false },
  'hut-spawn': { layer: 'spawns', rect: false },
  'goblin-hut': { layer: 'structures', rect: false },
  portal: { layer: 'structures', rect: false },
  'rune-slot': { layer: 'structures', rect: false },
  'powder-keg': { layer: 'structures', rect: false },
  prop: { layer: 'props', rect: false },
};

/** README "Default legend". */
const DEFAULT_LEGEND = {
  '.': { ground: 'grass' },
  ',': { ground: 'grass-dark' },
  ':': { ground: 'dirt' },
  '=': { ground: 'road' },
  m: { ground: 'mud' },
  '*': { ground: 'grass', 'ground-detail': 'flowers' },
  o: { ground: 'grass', 'ground-detail': 'puddle' },
  s: { ground: 'grass', 'ground-detail': 'shadow' },
  '-': { ground: 'road', 'ground-detail': 'path-edge' },
  B: { ground: 'bridge' },
  '|': { ground: 'bridge', blockers: 'bridge-rail' },
  W: { ground: 'water', blockers: 'water' },
  T: { ground: 'grass', blockers: 'trunk', canopy: 'canopy' },
  t: { ground: 'grass', blockers: 'trunk' },
  R: { ground: 'grass', blockers: 'rock' },
  C: { ground: 'dirt', blockers: 'cliff' },
  H: { ground: 'dirt', blockers: 'hut-footprint' },
  '^': { ground: 'grass', canopy: 'canopy' },
  v: { ground: 'road', canopy: 'canopy-edge' },
  P: { ground: 'portal-pad' },
};

class BuildError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(problems.join('\n'));
    this.problems = problems;
  }
}

/** @param {string} path */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new BuildError([`${path}: ${error instanceof Error ? error.message : String(error)}`]);
  }
}

/** firstgid per tileset and gid per "tileset/tile" name. */
function tilesetTable() {
  const gids = new Map();
  const firstGids = new Map();
  let next = 1;
  for (const set of TILESETS) {
    firstGids.set(set.name, next);
    set.tiles.forEach((tile, index) => gids.set(`${set.name}/${tile}`, next + index));
    next += set.tiles.length;
  }
  return { gids, firstGids };
}

/** @param {string} dir */
function loadLegend(dir) {
  const legend = { ...DEFAULT_LEGEND };
  const path = join(dir, 'legend.json');
  if (!existsSync(path)) return legend;
  const extra = readJson(path);
  if (typeof extra !== 'object' || extra === null || Array.isArray(extra)) {
    throw new BuildError([`${path}: expected an object of char → { layer: tile }`]);
  }
  return { ...legend, ...extra };
}

/**
 * @param {Record<string, Record<string, string>>} legend
 * @param {Map<string, number>} gids
 */
function checkLegend(legend, gids) {
  const problems = [];
  const layerNames = new Set(TILE_LAYERS.map((layer) => layer.name));
  for (const [char, entry] of Object.entries(legend)) {
    if ([...char].length !== 1 || /[#()0-9]/.test(char) || char.trim() === '') {
      problems.push(`legend: "${char}" must be one visible character other than # ( ) and digits`);
      continue;
    }
    if (typeof entry !== 'object' || entry === null) {
      problems.push(`legend "${char}": expected an object`);
      continue;
    }
    if (typeof entry.ground !== 'string') problems.push(`legend "${char}": ground is required`);
    for (const [layerName, tile] of Object.entries(entry)) {
      const layer = TILE_LAYERS.find((candidate) => candidate.name === layerName);
      if (!layer || !layerNames.has(layerName)) {
        problems.push(`legend "${char}": unknown layer "${layerName}"`);
      } else if (!gids.has(`${layer.tileset}/${String(tile)}`)) {
        problems.push(`legend "${char}": "${String(tile)}" is not a ${layer.tileset} tile`);
      }
    }
  }
  if (problems.length > 0) throw new BuildError(problems);
}

/**
 * One terrain line to its tile chars. `(cN)` is N copies of the legend char `c` (N ≥ 1), mixable
 * with literal chars: `(T8),,,mm(.5)`. Parentheses and digits are never tile chars.
 * @param {string} line
 */
function expandRuns(line) {
  const chars = [];
  let i = 0;
  while (i < line.length) {
    const char = line[i];
    if (char === '(') {
      const match = /^\(([^()0-9])(\d+)\)/u.exec(line.slice(i));
      if (!match || Number(match[2]) < 1) {
        throw new BuildError([`bad run at column ${String(i + 1)}: expected (cN) with N ≥ 1`]);
      }
      for (let n = 0; n < Number(match[2]); n++) chars.push(match[1]);
      i += match[0].length;
    } else if (char === ')' || /[0-9]/.test(char)) {
      throw new BuildError([`stray "${char}" at column ${String(i + 1)} (only inside (cN))`]);
    } else {
      chars.push(char);
      i++;
    }
  }
  return chars;
}

/** @param {string} path */
function readTerrain(path) {
  const rows = [];
  const lineNumbers = [];
  const problems = [];
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .forEach((raw, index) => {
      const line = raw.trimEnd();
      if (line === '' || line.startsWith('#')) return;
      try {
        rows.push(expandRuns(line));
      } catch (error) {
        if (!(error instanceof BuildError)) throw error;
        problems.push(`${path}:${String(index + 1)}: ${error.message}`);
        rows.push([]);
      }
      lineNumbers.push(index + 1);
    });
  if (problems.length > 0) throw new BuildError(problems);
  if (rows.length === 0) throw new BuildError([`${path}: no terrain rows`]);
  const width = rows[0].length;
  rows.forEach((row, index) => {
    if (row.length !== width) {
      problems.push(
        `${path}:${String(lineNumbers[index])}: ${String(row.length)} tiles after expanding runs, expected ${String(width)} (the first row)`,
      );
    }
  });
  if (problems.length > 0) throw new BuildError(problems);
  return { rows, lineNumbers, width, height: rows.length };
}

/**
 * @param {ReturnType<typeof readTerrain>} terrain
 * @param {Record<string, Record<string, string>>} legend
 * @param {Map<string, number>} gids
 * @param {string} path
 */
function buildTileLayers(terrain, legend, gids, path) {
  const data = TILE_LAYERS.map(() => new Array(terrain.width * terrain.height).fill(0));
  const unknown = new Map();
  terrain.rows.forEach((row, y) => {
    row.forEach((char, x) => {
      const entry = legend[char];
      if (!entry) {
        if (!unknown.has(char))
          unknown.set(char, `${path}:${String(terrain.lineNumbers[y])}:${String(x + 1)}`);
        return;
      }
      TILE_LAYERS.forEach((layer, layerIndex) => {
        const tile = entry[layer.name];
        if (tile !== undefined)
          data[layerIndex][y * terrain.width + x] = gids.get(`${layer.tileset}/${tile}`);
      });
    });
  });
  if (unknown.size > 0) {
    throw new BuildError([...unknown].map(([char, at]) => `${at}: unknown terrain char "${char}"`));
  }
  return data;
}

/** @param {string} owner @param {string} name @param {unknown} value */
function toProperty(owner, name, value) {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const typed = /** @type {{ type?: unknown, value?: unknown }} */ (value);
    const types = ['string', 'int', 'float', 'bool'];
    if (typeof typed.type !== 'string' || !types.includes(typed.type) || !('value' in typed)) {
      throw new BuildError([
        `${owner}.${name}: expected { "type": string|int|float|bool, "value" }`,
      ]);
    }
    const valid = {
      string: typeof typed.value === 'string',
      bool: typeof typed.value === 'boolean',
      int: Number.isInteger(typed.value),
      float: typeof typed.value === 'number' && Number.isFinite(typed.value),
    }[typed.type];
    if (!valid) {
      throw new BuildError([
        `${owner}.${name}: ${JSON.stringify(typed.value)} is not a ${typed.type}`,
      ]);
    }
    return { name, type: typed.type, value: typed.value };
  }
  if (typeof value === 'string') return { name, type: 'string', value };
  if (typeof value === 'boolean') return { name, type: 'bool', value };
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { name, type: Number.isInteger(value) ? 'int' : 'float', value };
  }
  throw new BuildError([`${owner}.${name}: unsupported value ${JSON.stringify(value)}`]);
}

/**
 * @param {string} path
 * @param {{ width: number, height: number }} size map size in pixels
 */
function buildObjectLayers(path, size) {
  const source = readJson(path);
  const list = source?.objects;
  if (!Array.isArray(list)) throw new BuildError([`${path}: expected { "objects": [...] }`]);
  const layers = new Map(OBJECT_LAYERS.map((name) => [name, []]));
  const names = new Set();
  const problems = [];
  let nextId = 1;
  list.forEach((raw, index) => {
    const label = typeof raw?.name === 'string' ? raw.name : `objects[${String(index)}]`;
    try {
      if (typeof raw !== 'object' || raw === null)
        throw new BuildError([`${label}: expected an object`]);
      const { name, type, x, y, w, h, properties } = raw;
      const issues = [];
      if (typeof name !== 'string' || name === '') issues.push(`${label}: name is required`);
      else if (names.has(name)) issues.push(`${label}: duplicate name`);
      // Recorded before any other check, so a later object with this name is reported even when
      // this one is broken.
      if (typeof name === 'string') names.add(name);
      const kind = typeof type === 'string' ? OBJECT_TYPES[type] : undefined;
      if (!kind) issues.push(`${label}: unknown type ${JSON.stringify(type)}`);
      if (typeof x !== 'number' || typeof y !== 'number')
        issues.push(`${label}: x and y must be numbers`);
      const isRect = w !== undefined || h !== undefined;
      if (isRect && !(typeof w === 'number' && w > 0 && typeof h === 'number' && h > 0)) {
        issues.push(`${label}: w and h must both be numbers > 0`);
      }
      if (kind && kind.rect !== isRect) {
        issues.push(
          `${label}: ${String(type)} must be a ${kind.rect ? 'rectangle (w, h)' : 'point (no w, h)'}`,
        );
      }
      if (typeof x === 'number' && typeof y === 'number') {
        const right = x + (typeof w === 'number' ? w : 0);
        const bottom = y + (typeof h === 'number' ? h : 0);
        // A rect may end on the map edge; a point must lie inside the last tile.
        const outside = isRect
          ? right > size.width || bottom > size.height
          : x >= size.width || y >= size.height;
        if (x < 0 || y < 0 || outside) {
          issues.push(`${label}: outside the ${String(size.width)}×${String(size.height)} px map`);
        }
      }
      if (
        properties !== undefined &&
        (typeof properties !== 'object' || properties === null || Array.isArray(properties))
      ) {
        issues.push(`${label}: properties must be an object`);
      }
      if (issues.length > 0) throw new BuildError(issues);
      const object = {
        id: nextId++,
        name,
        type,
        x,
        y,
        width: isRect ? w : 0,
        height: isRect ? h : 0,
        rotation: 0,
        visible: true,
      };
      if (!isRect) object.point = true;
      const props = Object.entries(properties ?? {}).map(([key, value]) =>
        toProperty(label, key, value),
      );
      if (props.length > 0) object.properties = props;
      layers.get(kind.layer).push(object);
    } catch (error) {
      if (error instanceof BuildError) problems.push(...error.problems);
      else throw error;
    }
  });
  if (problems.length > 0) throw new BuildError(problems.map((problem) => `${path}: ${problem}`));
  return { layers, nextObjectId: nextId };
}

function buildTilesets() {
  const { firstGids } = tilesetTable();
  return TILESETS.map((set) => {
    const rows = Math.ceil(set.tiles.length / TILESET_COLUMNS);
    return {
      firstgid: firstGids.get(set.name),
      name: set.name,
      image: `${set.key}.png`,
      imagewidth: TILESET_COLUMNS * TILE_PX,
      imageheight: rows * TILE_PX,
      tilewidth: TILE_PX,
      tileheight: TILE_PX,
      columns: TILESET_COLUMNS,
      tilecount: set.tiles.length,
      margin: 0,
      spacing: 0,
      tiles: set.tiles.map((tile, id) => ({
        id,
        properties: [{ name: 'name', type: 'string', value: tile }],
      })),
    };
  });
}

/** @param {string} srcDir @param {string} outFile */
export function buildMap(srcDir, outFile) {
  const { gids } = tilesetTable();
  const legend = loadLegend(srcDir);
  checkLegend(legend, gids);
  const terrainPath = join(srcDir, 'terrain.txt');
  const objectsPath = join(srcDir, 'objects.json');
  for (const path of [terrainPath, objectsPath]) {
    if (!existsSync(path)) throw new BuildError([`${path}: missing`]);
  }
  const terrain = readTerrain(terrainPath);
  const tileData = buildTileLayers(terrain, legend, gids, terrainPath);
  const objects = buildObjectLayers(objectsPath, {
    width: terrain.width * TILE_PX,
    height: terrain.height * TILE_PX,
  });

  let layerId = 1;
  const layers = [
    ...TILE_LAYERS.map((layer, index) => ({
      id: layerId++,
      name: layer.name,
      type: 'tilelayer',
      x: 0,
      y: 0,
      width: terrain.width,
      height: terrain.height,
      opacity: 1,
      visible: true,
      data: tileData[index],
    })),
    ...OBJECT_LAYERS.map((name) => ({
      id: layerId++,
      name,
      type: 'objectgroup',
      draworder: 'topdown',
      x: 0,
      y: 0,
      opacity: 1,
      visible: true,
      objects: objects.layers.get(name),
    })),
  ];
  const map = {
    type: 'map',
    version: '1.10',
    tiledversion: '1.11.0',
    orientation: 'orthogonal',
    renderorder: 'right-down',
    infinite: false,
    compressionlevel: -1,
    width: terrain.width,
    height: terrain.height,
    tilewidth: TILE_PX,
    tileheight: TILE_PX,
    nextlayerid: layerId,
    nextobjectid: objects.nextObjectId,
    layers,
    tilesets: buildTilesets(),
  };
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(map)}\n`);
  const objectCount = objects.nextObjectId - 1;
  return `${outFile}: ${String(terrain.width)}×${String(terrain.height)} tiles, ${String(objectCount)} objects`;
}

/** @param {string[]} argv */
function main(argv) {
  const jobs = [];
  const srcIndex = argv.indexOf('--src');
  if (srcIndex >= 0) {
    const src = argv[srcIndex + 1];
    const outIndex = argv.indexOf('--out');
    const out = outIndex >= 0 ? argv[outIndex + 1] : undefined;
    if (!src || !out)
      throw new BuildError(['usage: build-tilemap.js --src <dir> --out <file.json>']);
    jobs.push({ src: resolve(src), out: resolve(out) });
  } else {
    const ids =
      argv.length > 0
        ? argv
        : existsSync(SOURCE_ROOT)
          ? readdirSync(SOURCE_ROOT, { withFileTypes: true })
              .filter((entry) => entry.isDirectory())
              .map((entry) => entry.name)
          : [];
    if (ids.length === 0) throw new BuildError([`no level sources in ${SOURCE_ROOT}`]);
    for (const id of ids)
      jobs.push({ src: join(SOURCE_ROOT, id), out: join(OUT_ROOT, `${id}.json`) });
  }
  let failed = false;
  for (const job of jobs) {
    try {
      console.log(buildMap(job.src, job.out));
    } catch (error) {
      if (!(error instanceof BuildError)) throw error;
      failed = true;
      console.error(`maps:build failed for ${job.src}:\n  ${error.problems.join('\n  ')}`);
    }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof BuildError ? error.message : error);
    process.exitCode = 1;
  }
}
