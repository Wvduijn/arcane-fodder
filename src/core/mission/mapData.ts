/**
 * Mission maps (M7, plan §4.4, tiled-conventions.md): a Tiled JSON map, as `unknown`, to a typed
 * `MissionMap`, checked against the map contract and the mission that uses it. Game code only
 * fetches the JSON and calls `parseMissionMap`; everything a system needs (spawns, kegs, huts,
 * triggers, the portal, the blockers grid) comes from the result, never from the raw JSON.
 *
 * API:
 * - `parseMissionMap(json, mission)`: `{ map, errors, warnings }`. `map` is null when there is any
 *   error. Every problem is listed (not just the first), each with its rule and object name, so
 *   a broken map fails loudly in dev with the whole list.
 * - `collisionGridOf(map)`: the CollisionGrid from the `blockers` layer (no dynamic solids yet:
 *   the caller adds kegs and huts as it spawns them).
 * - `KEG_MIN_START_DISTANCE_PX`: conventions rule 7 (192 px; a contract constant, not tuning).
 *
 * Format (errors, `rule: 'format'`): an object at the top; orthogonal, not infinite, square
 * tiles; the required layers `ground`, `blockers` (tile) and `zones`, `spawns`, `structures`
 * (object) present with the right kind (optional: `ground-detail`, `canopy` tile, `props`
 * object); tile data as a plain array or uncompressed base64 of the map's size; every object a
 * known type on its own layer (conventions §4), with the geometry its type needs (point or
 * rectangle; no tile objects), a non-empty name, and its required properties of the right type
 * and value (`enemy` an EnemyId, `facing` n/e/s/w, `event` a contract value with its `group` or
 * `text`, counts ≥ 1, radii and delays ≥ 0). An object's Tiled `class` is read when `type` is
 * absent (Tiled ≥ 1.9). Unknown extra properties are ignored. A ground layer with empty cells
 * is a warning (conventions §3: fully filled).
 *
 * Contract rules (tiled-conventions §6; errors unless noted):
 * 1. Exactly one `squad-start` (named `mission.start.spawnId` when given) and one `portal` (named
 *    `mission.extraction.spawnId`).
 * 2. Per destroy objective: the `goblin-hut` objects whose `target` is the objective's target
 *    number exactly `count`; their `runeIndex` values are unique and cover 0..count−1. The portal's
 *    `runeCount`, when set, equals the total required. Its `radiusPx`, when set, should equal
 *    `extraction.radiusPx`: mission data wins, a mismatch is a **warning**.
 * 3. The final surge's `waveId` has at least one `surge-spawn`.
 * 4. Every `enemy-spawn.trigger` names a `trigger` zone; every trigger `group` names a group of an
 *    `enemy-spawn` or `archer-post`; every `hut-spawn.hut` names a `goblin-hut`; every
 *    `rune-slot.portal` names the portal.
 * 5. Object names are unique in the whole map.
 * 6. **Warning:** a spawn point (`squad-start`, `enemy-spawn`, `archer-post`, `surge-spawn`,
 *    `hut-spawn`) or a structure point (`portal`, `rune-slot`, `powder-keg`) on a non-empty
 *    `blockers` tile. Huts are exempt: their footprint is marked on purpose.
 *    **Warning** (review M7-T7 m2): a 1-tile passage, an open tile with blockers on both sides
 *    across one axis and open tiles along the other (a gap between two walls). The flow field
 *    treats it as walkable, but no body (r 10–12) fits through it (conventions §3: ≥ 5 tiles).
 * 7. No `powder-keg` inside a `safe-start` zone, and none within `KEG_MIN_START_DISTANCE_PX` of
 *    the squad start. **Warning** (conventions §4.3, review M7-T9 m1): an `enemy-spawn`,
 *    `archer-post`, `surge-spawn` or `hut-spawn` point inside a `safe-start` zone. The "96 px from the route centreline" part is not machine-checked: the
 *    contract has no route object (level-designer checks it by hand, conventions §8).
 */
import type { EnemyId, HutDef, MissionDef, Rect, TargetId, Vec2 } from '@core/types';
import { distance } from '@core/math/vec2';
import { CollisionGrid } from '@core/world/collisionGrid';

/** Conventions §6 rule 7: kegs stay this far from the squad start. */
export const KEG_MIN_START_DISTANCE_PX = 192;

export type Facing = 'n' | 'e' | 's' | 'w';

export interface MapPoint {
  readonly name: string;
  readonly position: Vec2;
}

export interface MapZone {
  readonly name: string;
  readonly rect: Rect;
}

export interface SquadStartObject extends MapPoint {
  readonly facing: Facing;
}

export interface PortalObject extends MapPoint {
  readonly radiusPx: number | null;
  readonly runeCount: number | null;
}

export interface RuneSlotObject extends MapPoint {
  readonly index: number;
  readonly portal: string;
}

/** Per-hut Tiled overrides of the HutDef spawn fields (conventions §4.2). */
export type HutOverrides = Partial<
  Pick<HutDef, 'spawnIntervalMs' | 'maxAlive' | 'spawnEnemy' | 'activateRadiusPx'>
>;

export interface HutObject extends MapPoint {
  readonly target: TargetId;
  readonly runeIndex: number;
  readonly overrides: HutOverrides;
  /** The first `hut-spawn` naming this hut, or null (hut.ts then uses its default door). */
  readonly door: Vec2 | null;
}

export interface KegObject extends MapPoint {
  readonly cluster: string | null;
  readonly chain: boolean;
}

export interface EnemySpawnObject extends MapPoint {
  readonly enemy: EnemyId;
  readonly group: string;
  readonly count: number;
  readonly radiusPx: number;
  /** Trigger zone name; null = active at mission start. */
  readonly trigger: string | null;
  /** 0 = none. */
  readonly leashPx: number;
}

export interface ArcherPostObject extends MapPoint {
  readonly group: string;
  readonly facing: Facing;
  readonly holdRadiusPx: number;
}

export interface SurgeSpawnObject extends MapPoint {
  readonly wave: string;
  readonly enemy: EnemyId;
  readonly count: number;
  readonly radiusPx: number;
  /** From portal open. */
  readonly delayMs: number;
}

export type TriggerEvent =
  | { readonly kind: 'activate-group'; readonly group: string }
  | { readonly kind: 'alert-group'; readonly group: string }
  | { readonly kind: 'bark'; readonly text: string };

export interface TriggerZone extends MapZone {
  readonly once: boolean;
  readonly event: TriggerEvent;
}

export interface SectionZone extends MapZone {
  readonly index: number;
  readonly label: string;
}

export interface PropObject extends MapPoint {
  readonly sprite: string;
  readonly depth: 'below' | 'above';
  readonly flipX: boolean;
}

export interface MissionMap {
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly tileSizePx: number;
  /** The whole map in px: world and camera bounds. */
  readonly bounds: Rect;
  /** Row-major gids of the `blockers` layer (0 = empty). */
  readonly blockers: readonly number[];
  readonly squadStart: SquadStartObject;
  readonly portal: PortalObject;
  /** Ascending `index`. */
  readonly runeSlots: readonly RuneSlotObject[];
  /** Ascending `runeIndex`. */
  readonly huts: readonly HutObject[];
  readonly kegs: readonly KegObject[];
  readonly enemySpawns: readonly EnemySpawnObject[];
  readonly archerPosts: readonly ArcherPostObject[];
  readonly surgeSpawns: readonly SurgeSpawnObject[];
  readonly triggers: readonly TriggerZone[];
  readonly sections: readonly SectionZone[];
  readonly safeStarts: readonly MapZone[];
  readonly boundsHint: Rect | null;
  readonly props: readonly PropObject[];
}

export interface MapIssue {
  readonly severity: 'error' | 'warning';
  readonly rule: 'format' | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly message: string;
  /** The object's name, when the issue is about one. */
  readonly object?: string;
}

export interface MapLoadResult {
  readonly map: MissionMap | null;
  readonly errors: readonly MapIssue[];
  readonly warnings: readonly MapIssue[];
}

// Exhaustive by type, like save.ts: a new EnemyId fails here until listed.
const ENEMY_IDS: Readonly<Record<EnemyId, true>> = {
  'goblin-grunt': true,
  'goblin-archer': true,
};
const TARGET_IDS: Readonly<Record<TargetId, true>> = { 'goblin-hut': true };
const FACINGS: Readonly<Record<Facing, true>> = { n: true, e: true, s: true, w: true };

type LayerName =
  'ground' | 'ground-detail' | 'blockers' | 'canopy' | 'zones' | 'spawns' | 'structures' | 'props';

const LAYERS: Readonly<
  Record<LayerName, { readonly kind: 'tilelayer' | 'objectgroup'; readonly required: boolean }>
> = {
  ground: { kind: 'tilelayer', required: true },
  'ground-detail': { kind: 'tilelayer', required: false },
  blockers: { kind: 'tilelayer', required: true },
  canopy: { kind: 'tilelayer', required: false },
  zones: { kind: 'objectgroup', required: true },
  spawns: { kind: 'objectgroup', required: true },
  structures: { kind: 'objectgroup', required: true },
  props: { kind: 'objectgroup', required: false },
};

type ObjectType =
  | 'section'
  | 'trigger'
  | 'safe-start'
  | 'bounds-hint'
  | 'squad-start'
  | 'enemy-spawn'
  | 'archer-post'
  | 'surge-spawn'
  | 'hut-spawn'
  | 'goblin-hut'
  | 'portal'
  | 'rune-slot'
  | 'powder-keg'
  | 'prop';

/** Layer and geometry per object type (conventions §4). */
const OBJECT_TYPES: Readonly<
  Record<ObjectType, { readonly layer: LayerName; readonly shape: 'point' | 'rect' }>
> = {
  section: { layer: 'zones', shape: 'rect' },
  trigger: { layer: 'zones', shape: 'rect' },
  'safe-start': { layer: 'zones', shape: 'rect' },
  'bounds-hint': { layer: 'zones', shape: 'rect' },
  'squad-start': { layer: 'spawns', shape: 'point' },
  'enemy-spawn': { layer: 'spawns', shape: 'point' },
  'archer-post': { layer: 'spawns', shape: 'point' },
  'surge-spawn': { layer: 'spawns', shape: 'point' },
  'hut-spawn': { layer: 'spawns', shape: 'point' },
  'goblin-hut': { layer: 'structures', shape: 'point' },
  portal: { layer: 'structures', shape: 'point' },
  'rune-slot': { layer: 'structures', shape: 'point' },
  'powder-keg': { layer: 'structures', shape: 'point' },
  prop: { layer: 'props', shape: 'point' },
};

/** Rule 6 applies to these. */
const BLOCKER_CHECKED: ReadonlySet<ObjectType> = new Set<ObjectType>([
  'squad-start',
  'enemy-spawn',
  'archer-post',
  'surge-spawn',
  'hut-spawn',
  'portal',
  'rune-slot',
  'powder-keg',
]);

/** Rule 7's safe-start warning applies to these. */
const ENEMY_SPAWN_TYPES: ReadonlySet<ObjectType> = new Set<ObjectType>([
  'enemy-spawn',
  'archer-post',
  'surge-spawn',
  'hut-spawn',
]);

/** Conventions §4 defaults. */
const DEFAULTS = {
  facing: 'e' as Facing,
  spawnCount: 1,
  spawnRadiusPx: 24,
  holdRadiusPx: 32,
  triggerOnce: true,
} as const;

/** One raw object after the generic checks. */
interface RawObject {
  readonly name: string;
  readonly type: ObjectType;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly props: ReadonlyMap<string, unknown>;
}

class Issues {
  readonly errors: MapIssue[] = [];
  readonly warnings: MapIssue[] = [];

  error(rule: MapIssue['rule'], message: string, object?: string): void {
    this.errors.push(
      object === undefined
        ? { severity: 'error', rule, message }
        : { severity: 'error', rule, message, object },
    );
  }

  warn(rule: MapIssue['rule'], message: string, object?: string): void {
    this.warnings.push(
      object === undefined
        ? { severity: 'warning', rule, message }
        : { severity: 'warning', rule, message, object },
    );
  }
}

export function parseMissionMap(json: unknown, mission: MissionDef): MapLoadResult {
  const issues = new Issues();
  const map = parse(json, mission, issues);
  return {
    map: issues.errors.length === 0 ? map : null,
    errors: issues.errors,
    warnings: issues.warnings,
  };
}

export function collisionGridOf(map: MissionMap): CollisionGrid {
  return CollisionGrid.fromTiles(map.widthTiles, map.heightTiles, map.tileSizePx, map.blockers);
}

function parse(json: unknown, mission: MissionDef, issues: Issues): MissionMap | null {
  if (!isRecord(json)) {
    issues.error('format', 'The map is not a JSON object');
    return null;
  }
  const width = json['width'];
  const height = json['height'];
  const tileW = json['tilewidth'];
  const tileH = json['tileheight'];
  if (!isPositiveInt(width) || !isPositiveInt(height)) {
    issues.error('format', 'Map width and height must be positive integers');
    return null;
  }
  if (!isPositiveInt(tileW) || tileW !== tileH) {
    issues.error('format', 'Tiles must be square, with a positive integer size');
    return null;
  }
  if (json['orientation'] !== 'orthogonal')
    issues.error('format', 'Orientation must be orthogonal');
  if (json['infinite'] === true) issues.error('format', 'Infinite maps are not supported');

  const layers = layersOf(json['layers'], width, height, issues);
  const ground = layers.tiles.get('ground');
  if (ground?.includes(0)) issues.warn('format', 'The ground layer has empty cells');
  const blockers = layers.tiles.get('blockers') ?? new Array<number>(width * height).fill(0);
  const objects = layers.objects;
  const bounds: Rect = { x: 0, y: 0, width: width * tileW, height: height * tileW };

  // Rule 5: unique names.
  const seen = new Set<string>();
  for (const o of objects) {
    if (seen.has(o.name)) issues.error(5, `Duplicate object name "${o.name}"`, o.name);
    seen.add(o.name);
  }

  const reader = new PropReader(issues);
  const of = (type: ObjectType) => objects.filter((o) => o.type === type);

  // Objects outside the map can't be placed anywhere sensible.
  for (const o of objects) {
    // A point on the far edge (x = width) belongs to no tile: outside too (review M7-T2 m3).
    const point = o.width === 0 && o.height === 0;
    const outside = point
      ? o.x >= bounds.width || o.y >= bounds.height
      : o.x + o.width > bounds.width || o.y + o.height > bounds.height;
    if (o.x < 0 || o.y < 0 || outside) {
      issues.error('format', `"${o.name}" lies outside the map`, o.name);
    }
  }

  const squadStart = squadStartOf(of('squad-start'), mission, reader, issues);
  const portal = portalOf(of('portal'), mission, reader, issues);

  const runeSlots = of('rune-slot')
    .map((o) => ({
      name: o.name,
      position: pointOf(o),
      index: reader.int(o, 'index', { min: 0 }) ?? 0,
      portal: reader.string(o, 'portal', { fallback: 'portal' }) ?? 'portal',
    }))
    .sort((a, b) => a.index - b.index);

  const doors = new Map<string, Vec2>();
  for (const o of of('hut-spawn')) {
    const hut = reader.string(o, 'hut', { required: true });
    if (hut !== null && !doors.has(hut)) doors.set(hut, pointOf(o));
  }
  const huts = of('goblin-hut')
    .map((o) => hutOf(o, reader, doors))
    .sort((a, b) => a.runeIndex - b.runeIndex);

  const kegs = of('powder-keg').map((o) => ({
    name: o.name,
    position: pointOf(o),
    cluster: reader.string(o, 'cluster'),
    chain: reader.bool(o, 'chain') ?? false,
  }));

  const enemySpawns = of('enemy-spawn').map((o) => ({
    name: o.name,
    position: pointOf(o),
    enemy: reader.enemy(o) ?? 'goblin-grunt',
    group: reader.string(o, 'group', { required: true }) ?? '',
    count: reader.int(o, 'count', { min: 1 }) ?? DEFAULTS.spawnCount,
    radiusPx: reader.number(o, 'radius', { min: 0 }) ?? DEFAULTS.spawnRadiusPx,
    trigger: nonEmpty(reader.string(o, 'trigger')),
    leashPx: reader.number(o, 'leash', { min: 0 }) ?? 0,
  }));

  const archerPosts = of('archer-post').map((o) => ({
    name: o.name,
    position: pointOf(o),
    group: reader.string(o, 'group', { required: true }) ?? '',
    facing: reader.facing(o) ?? DEFAULTS.facing,
    holdRadiusPx: reader.number(o, 'holdRadius', { min: 0 }) ?? DEFAULTS.holdRadiusPx,
  }));

  const surgeSpawns = of('surge-spawn').map((o) => ({
    name: o.name,
    position: pointOf(o),
    wave: reader.string(o, 'wave', { required: true }) ?? '',
    enemy: reader.enemy(o) ?? 'goblin-grunt',
    count: reader.int(o, 'count', { min: 1, required: true }) ?? DEFAULTS.spawnCount,
    radiusPx: reader.number(o, 'radius', { min: 0 }) ?? DEFAULTS.spawnRadiusPx,
    delayMs: reader.number(o, 'delayMs', { min: 0 }) ?? 0,
  }));

  const triggers = of('trigger').flatMap((o) => {
    const event = reader.triggerEvent(o);
    return event
      ? [
          {
            name: o.name,
            rect: rectOf(o),
            once: reader.bool(o, 'once') ?? DEFAULTS.triggerOnce,
            event,
          },
        ]
      : [];
  });

  const sections = of('section')
    .map((o) => ({
      name: o.name,
      rect: rectOf(o),
      index: reader.int(o, 'index', { min: 1 }) ?? 0,
      label: reader.string(o, 'label') ?? o.name,
    }))
    .sort((a, b) => a.index - b.index);

  const safeStarts = of('safe-start').map((o) => ({ name: o.name, rect: rectOf(o) }));
  const hint = of('bounds-hint')[0];
  const props = of('prop').map((o) => {
    const depth = reader.string(o, 'depth', { fallback: 'below' });
    if (depth !== 'below' && depth !== 'above') {
      issues.error('format', `"${o.name}".depth must be below or above`, o.name);
    }
    return {
      name: o.name,
      position: pointOf(o),
      sprite: reader.string(o, 'sprite', { required: true }) ?? '',
      depth: depth === 'above' ? ('above' as const) : ('below' as const),
      flipX: reader.bool(o, 'flipX') ?? false,
    };
  });

  checkObjectives(huts, portal, mission, issues);
  checkSurge(surgeSpawns, mission, issues);
  checkReferences(
    enemySpawns,
    archerPosts,
    triggers,
    of('hut-spawn'),
    huts,
    runeSlots,
    reader,
    portal,
    issues,
  );
  checkBlockers(objects, blockers, width, height, tileW, issues);
  checkKegs(kegs, safeStarts, squadStart, issues);
  checkSafeStartSpawns(objects, safeStarts, issues);
  checkNarrowGaps(blockers, width, height, tileW, issues);

  if (!squadStart || !portal) return null;
  return {
    widthTiles: width,
    heightTiles: height,
    tileSizePx: tileW,
    bounds,
    blockers,
    squadStart,
    portal,
    runeSlots,
    huts,
    kegs,
    enemySpawns,
    archerPosts,
    surgeSpawns,
    triggers,
    sections,
    safeStarts,
    boundsHint: hint ? rectOf(hint) : null,
    props,
  };
}

// ── Layers and objects ──────────────────────────────────────────────────────

interface Layers {
  readonly tiles: ReadonlyMap<LayerName, number[]>;
  readonly objects: readonly RawObject[];
}

function layersOf(raw: unknown, width: number, height: number, issues: Issues): Layers {
  const tiles = new Map<LayerName, number[]>();
  const objects: RawObject[] = [];
  if (!Array.isArray(raw)) {
    issues.error('format', 'The map has no layers array');
    return { tiles, objects };
  }
  const found = new Set<LayerName>();
  for (const layer of raw) {
    if (!isRecord(layer)) continue;
    const name = layer['name'];
    if (typeof name !== 'string' || !isKey(LAYERS, name)) continue;
    const spec = LAYERS[name];
    if (found.has(name)) {
      issues.error('format', `Layer "${name}" appears twice`);
      continue;
    }
    found.add(name);
    if (layer['type'] !== spec.kind) {
      issues.error('format', `Layer "${name}" must be a ${spec.kind}`);
      continue;
    }
    if (spec.kind === 'tilelayer') {
      const data = tileDataOf(layer, width * height, name, issues);
      if (data) tiles.set(name, data);
    } else {
      objects.push(...objectsOf(layer['objects'], name, issues));
    }
  }
  for (const [name, spec] of Object.entries(LAYERS)) {
    if (spec.required && !found.has(name as LayerName)) {
      issues.error('format', `Required layer "${name}" is missing`);
    }
  }
  return { tiles, objects };
}

function tileDataOf(
  layer: Record<string, unknown>,
  cells: number,
  name: string,
  issues: Issues,
): number[] | null {
  const compression = layer['compression'];
  if (typeof compression === 'string' && compression !== '') {
    issues.error(
      'format',
      `Layer "${name}" is compressed (${compression}); export it uncompressed`,
    );
    return null;
  }
  let data: number[] | null = null;
  const raw = layer['data'];
  if (Array.isArray(raw) && raw.every((n) => Number.isInteger(n) && (n as number) >= 0)) {
    data = raw as number[];
  } else if (typeof raw === 'string' && layer['encoding'] === 'base64') {
    data = decodeBase64Gids(raw);
  }
  if (!data) {
    issues.error('format', `Layer "${name}" has unreadable tile data`);
    return null;
  }
  if (data.length !== cells) {
    issues.error(
      'format',
      `Layer "${name}" has ${String(data.length)} cells, expected ${String(cells)}`,
    );
    return null;
  }
  return data;
}

function objectsOf(raw: unknown, layer: LayerName, issues: Issues): RawObject[] {
  if (!Array.isArray(raw)) {
    issues.error('format', `Object layer "${layer}" has no objects array`);
    return [];
  }
  const out: RawObject[] = [];
  for (const o of raw) {
    if (!isRecord(o)) continue;
    const name = o['name'];
    const label = typeof name === 'string' && name !== '' ? name : `#${String(o['id'])}`;
    if (typeof name !== 'string' || name === '') {
      issues.error('format', `An object on "${layer}" has no name (${label})`, label);
      continue;
    }
    const rawType = typeof o['type'] === 'string' && o['type'] !== '' ? o['type'] : o['class'];
    if (typeof rawType !== 'string' || !isKey(OBJECT_TYPES, rawType)) {
      issues.error('format', `"${name}" has unknown type ${JSON.stringify(rawType)}`, name);
      continue;
    }
    const spec = OBJECT_TYPES[rawType];
    if (spec.layer !== layer) {
      issues.error(
        'format',
        `"${name}" (${rawType}) belongs on layer "${spec.layer}", not "${layer}"`,
        name,
      );
      continue;
    }
    if ('gid' in o) {
      issues.error('format', `"${name}" is a tile object; use a point or rectangle`, name);
      continue;
    }
    const x = o['x'];
    const y = o['y'];
    const w = o['width'] ?? 0;
    const h = o['height'] ?? 0;
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(w) || !isFiniteNumber(h)) {
      issues.error('format', `"${name}" has no numeric position or size`, name);
      continue;
    }
    const isPoint = o['point'] === true || (w === 0 && h === 0);
    const isRect = !isPoint && w > 0 && h > 0 && o['ellipse'] !== true && !('polygon' in o);
    if (spec.shape === 'point' ? !isPoint : !isRect) {
      issues.error(
        'format',
        `"${name}" (${rawType}) must be a ${spec.shape === 'point' ? 'point' : 'rectangle'}`,
        name,
      );
      continue;
    }
    out.push({
      name,
      type: rawType,
      x,
      y,
      width: isPoint ? 0 : w,
      height: isPoint ? 0 : h,
      props: propertiesOf(o['properties']),
    });
  }
  return out;
}

/** Tiled's `[{ name, type, value }]` (or a plain object, from older exports) to a map. */
function propertiesOf(raw: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (Array.isArray(raw)) {
    for (const p of raw) {
      if (isRecord(p) && typeof p['name'] === 'string') out.set(p['name'], p['value']);
    }
  } else if (isRecord(raw)) {
    for (const [k, value] of Object.entries(raw)) out.set(k, value);
  }
  return out;
}

const pointOf = (o: RawObject): Vec2 => ({ x: o.x, y: o.y });
const rectOf = (o: RawObject): Rect => ({ x: o.x, y: o.y, width: o.width, height: o.height });
const nonEmpty = (s: string | null): string | null => (s === null || s === '' ? null : s);

// ── Properties ──────────────────────────────────────────────────────────────

interface PropOptions<T> {
  readonly required?: boolean;
  readonly fallback?: T;
  readonly min?: number;
}

/** Typed property reads; a missing optional property is null, a bad one is a format error. */
class PropReader {
  private readonly issues: Issues;

  constructor(issues: Issues) {
    this.issues = issues;
  }

  string(o: RawObject, key: string, options: PropOptions<string> = {}): string | null {
    const value = o.props.get(key);
    if (value === undefined) return this.missing(o, key, options);
    if (typeof value === 'string') {
      if (options.required === true && value === '') return this.bad(o, key, 'a non-empty string');
      return value;
    }
    return this.bad(o, key, 'a string');
  }

  number(o: RawObject, key: string, options: PropOptions<number> = {}): number | null {
    const value = o.props.get(key);
    if (value === undefined) return this.missing(o, key, options);
    if (!isFiniteNumber(value)) return this.bad(o, key, 'a number');
    if (options.min !== undefined && value < options.min) {
      return this.bad(o, key, `at least ${String(options.min)}`);
    }
    return value;
  }

  int(o: RawObject, key: string, options: PropOptions<number> = {}): number | null {
    const value = this.number(o, key, options);
    if (value === null || Number.isInteger(value)) return value;
    return this.bad(o, key, 'a whole number');
  }

  bool(o: RawObject, key: string): boolean | null {
    const value = o.props.get(key);
    if (value === undefined) return null;
    return typeof value === 'boolean' ? value : this.bad(o, key, 'true or false');
  }

  enemy(o: RawObject): EnemyId | null {
    const value = this.string(o, 'enemy', { required: true });
    if (value === null) return null;
    return isKey(ENEMY_IDS, value) ? value : this.bad(o, 'enemy', 'an enemy id');
  }

  facing(o: RawObject): Facing | null {
    const value = this.string(o, 'facing');
    if (value === null) return null;
    return isKey(FACINGS, value) ? value : this.bad(o, 'facing', 'n, e, s or w');
  }

  target(o: RawObject): TargetId | null {
    const value = this.string(o, 'target');
    if (value === null) return null;
    return isKey(TARGET_IDS, value) ? value : this.bad(o, 'target', 'a target id');
  }

  triggerEvent(o: RawObject): TriggerEvent | null {
    const event = this.string(o, 'event', { required: true });
    if (event === 'activate-group' || event === 'alert-group') {
      const group = this.string(o, 'group', { required: true });
      return group === null ? null : { kind: event, group };
    }
    if (event === 'bark') {
      const text = this.string(o, 'text', { required: true });
      return text === null ? null : { kind: 'bark', text };
    }
    return event === null ? null : this.bad(o, 'event', 'activate-group, alert-group or bark');
  }

  private missing<T>(o: RawObject, key: string, options: PropOptions<T>): T | null {
    if (options.required === true) {
      this.issues.error('format', `"${o.name}" (${o.type}) needs property "${key}"`, o.name);
    }
    return options.fallback ?? null;
  }

  private bad(o: RawObject, key: string, expected: string): null {
    this.issues.error('format', `"${o.name}".${key} must be ${expected}`, o.name);
    return null;
  }
}

// ── Typed objects ───────────────────────────────────────────────────────────

function squadStartOf(
  starts: readonly RawObject[],
  mission: MissionDef,
  reader: PropReader,
  issues: Issues,
): SquadStartObject | null {
  if (starts.length !== 1) {
    issues.error(1, `Expected exactly one squad-start, found ${String(starts.length)}`);
  }
  const wanted = mission.start?.spawnId;
  const o = wanted === undefined ? starts[0] : starts.find((s) => s.name === wanted);
  if (!o) {
    if (wanted !== undefined && starts.length > 0) {
      issues.error(1, `No squad-start named "${wanted}" (mission.start.spawnId)`);
    }
    return null;
  }
  return { name: o.name, position: pointOf(o), facing: reader.facing(o) ?? DEFAULTS.facing };
}

function portalOf(
  portals: readonly RawObject[],
  mission: MissionDef,
  reader: PropReader,
  issues: Issues,
): PortalObject | null {
  if (portals.length !== 1) {
    issues.error(1, `Expected exactly one portal, found ${String(portals.length)}`);
  }
  const wanted = mission.extraction.spawnId;
  const o = portals.find((p) => p.name === wanted);
  if (!o) {
    if (portals.length > 0) {
      issues.error(1, `No portal named "${wanted}" (mission.extraction.spawnId)`);
    }
    return null;
  }
  return {
    name: o.name,
    position: pointOf(o),
    radiusPx: reader.number(o, 'radiusPx', { min: 0 }),
    runeCount: reader.int(o, 'runeCount', { min: 0 }),
  };
}

function hutOf(o: RawObject, reader: PropReader, doors: ReadonlyMap<string, Vec2>): HutObject {
  const overrides: {
    -readonly [K in keyof HutOverrides]: HutOverrides[K];
  } = {};
  const interval = reader.number(o, 'spawnIntervalMs', { min: 1 });
  if (interval !== null) overrides.spawnIntervalMs = interval;
  const maxAlive = reader.int(o, 'maxAlive', { min: 0 });
  if (maxAlive !== null) overrides.maxAlive = maxAlive;
  const activate = reader.number(o, 'activateRadius', { min: 0 });
  if (activate !== null) overrides.activateRadiusPx = activate;
  if (o.props.has('spawnEnemy')) {
    const enemy = reader.string(o, 'spawnEnemy');
    if (enemy !== null && isKey(ENEMY_IDS, enemy)) overrides.spawnEnemy = enemy;
    else if (enemy !== null) reader.enemy({ ...o, props: new Map([['enemy', enemy]]) });
  }
  return {
    name: o.name,
    position: pointOf(o),
    target: reader.target(o) ?? 'goblin-hut',
    runeIndex: reader.int(o, 'runeIndex', { min: 0, required: true }) ?? -1,
    overrides,
    door: doors.get(o.name) ?? null,
  };
}

// ── Contract rules ──────────────────────────────────────────────────────────

/** Rule 2. */
function checkObjectives(
  huts: readonly HutObject[],
  portal: PortalObject | null,
  mission: MissionDef,
  issues: Issues,
): void {
  const byTarget = new Map<TargetId, HutObject[]>();
  for (const h of huts) byTarget.set(h.target, [...(byTarget.get(h.target) ?? []), h]);
  let required = 0;
  for (const objective of mission.objectives) {
    required += objective.count;
    const matching = byTarget.get(objective.target) ?? [];
    if (matching.length !== objective.count) {
      issues.error(
        2,
        `The objective needs ${String(objective.count)} ${objective.target}, the map has ${String(matching.length)}`,
      );
    }
    const indices = matching.map((h) => h.runeIndex).filter((i) => i >= 0);
    const unique = new Set(indices);
    if (unique.size !== indices.length) issues.error(2, 'Hut runeIndex values must be unique');
    for (let i = 0; i < objective.count; i++) {
      if (!unique.has(i)) issues.error(2, `No hut has runeIndex ${String(i)}`);
    }
    for (const h of matching) {
      if (h.runeIndex >= objective.count) {
        issues.error(
          2,
          `runeIndex ${String(h.runeIndex)} is out of range 0..${String(objective.count - 1)}`,
          h.name,
        );
      }
    }
  }
  if (!portal) return;
  if (portal.runeCount !== null && portal.runeCount !== required) {
    issues.error(
      2,
      `Portal runeCount ${String(portal.runeCount)} ≠ ${String(required)} required targets`,
      portal.name,
    );
  }
  if (portal.radiusPx !== null && portal.radiusPx !== mission.extraction.radiusPx) {
    issues.warn(
      2,
      `Portal radiusPx ${String(portal.radiusPx)} ≠ mission extraction.radiusPx ${String(mission.extraction.radiusPx)}; the mission wins`,
      portal.name,
    );
  }
}

/** Rule 3. */
function checkSurge(surge: readonly SurgeSpawnObject[], mission: MissionDef, issues: Issues): void {
  const wave = mission.extraction.finalSurge.waveId;
  if (!surge.some((s) => s.wave === wave)) {
    issues.error(3, `Wave "${wave}" has no surge-spawn`);
  }
}

/** Rule 4. */
function checkReferences(
  spawns: readonly EnemySpawnObject[],
  posts: readonly ArcherPostObject[],
  triggers: readonly TriggerZone[],
  hutSpawns: readonly RawObject[],
  huts: readonly HutObject[],
  runeSlots: readonly RuneSlotObject[],
  reader: PropReader,
  portal: PortalObject | null,
  issues: Issues,
): void {
  const triggerNames = new Set(triggers.map((t) => t.name));
  const groups = new Set([...spawns.map((s) => s.group), ...posts.map((p) => p.group)]);
  for (const s of spawns) {
    if (s.trigger !== null && !triggerNames.has(s.trigger)) {
      issues.error(4, `Trigger "${s.trigger}" does not exist`, s.name);
    }
  }
  for (const t of triggers) {
    if (
      (t.event.kind === 'activate-group' || t.event.kind === 'alert-group') &&
      !groups.has(t.event.group)
    ) {
      issues.error(4, `Group "${t.event.group}" does not exist`, t.name);
    }
  }
  const hutNames = new Set(huts.map((h) => h.name));
  for (const o of hutSpawns) {
    const hut = reader.string(o, 'hut');
    if (hut !== null && hut !== '' && !hutNames.has(hut)) {
      issues.error(4, `Hut "${hut}" does not exist`, o.name);
    }
  }
  for (const r of runeSlots) {
    if (portal && r.portal !== portal.name) {
      issues.error(4, `Portal "${r.portal}" does not exist`, r.name);
    }
  }
}

/** Rule 6. */
function checkBlockers(
  objects: readonly RawObject[],
  blockers: readonly number[],
  width: number,
  height: number,
  tile: number,
  issues: Issues,
): void {
  for (const o of objects) {
    if (!BLOCKER_CHECKED.has(o.type)) continue;
    const tx = Math.floor(o.x / tile);
    const ty = Math.floor(o.y / tile);
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
    if ((blockers[ty * width + tx] ?? 0) !== 0) {
      issues.warn(6, `"${o.name}" (${o.type}) sits on a blockers tile`, o.name);
    }
  }
}

/** Rule 7. */
function checkKegs(
  kegs: readonly KegObject[],
  safeStarts: readonly MapZone[],
  start: SquadStartObject | null,
  issues: Issues,
): void {
  for (const keg of kegs) {
    for (const zone of safeStarts) {
      if (inRect(keg.position, zone.rect)) {
        issues.error(7, `Keg inside safe-start "${zone.name}"`, keg.name);
      }
    }
    if (start && distance(keg.position, start.position) < KEG_MIN_START_DISTANCE_PX) {
      issues.error(
        7,
        `Keg within ${String(KEG_MIN_START_DISTANCE_PX)} px of the squad start`,
        keg.name,
      );
    }
  }
}

/** Rule 7 (warning): no enemy may spawn inside a safe-start zone (conventions §4.3). */
function checkSafeStartSpawns(
  objects: readonly RawObject[],
  safeStarts: readonly MapZone[],
  issues: Issues,
): void {
  for (const o of objects) {
    if (!ENEMY_SPAWN_TYPES.has(o.type)) continue;
    for (const zone of safeStarts) {
      if (inRect(pointOf(o), zone.rect)) {
        issues.warn(7, `"${o.name}" (${o.type}) spawns inside safe-start "${zone.name}"`, o.name);
      }
    }
  }
}

/** Rule 6 (warning): 1-tile passages between blockers. Outside the map counts as solid. */
function checkNarrowGaps(
  blockers: readonly number[],
  width: number,
  height: number,
  tile: number,
  issues: Issues,
): void {
  const solid = (tx: number, ty: number): boolean =>
    tx < 0 || ty < 0 || tx >= width || ty >= height || (blockers[ty * width + tx] ?? 0) !== 0;
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      if (solid(tx, ty)) continue;
      const betweenX =
        solid(tx - 1, ty) && solid(tx + 1, ty) && !solid(tx, ty - 1) && !solid(tx, ty + 1);
      const betweenY =
        solid(tx, ty - 1) && solid(tx, ty + 1) && !solid(tx - 1, ty) && !solid(tx + 1, ty);
      if (betweenX || betweenY) {
        issues.warn(
          6,
          `1-tile passage at tile (${String(tx)}, ${String(ty)}), px (${String(tx * tile)}, ${String(ty * tile)}): no unit fits through`,
        );
      }
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function inRect(p: Vec2, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Uncompressed base64 tile data: little-endian uint32 gids. Null when malformed. */
function decodeBase64Gids(text: string): number[] | null {
  const clean = text.replace(/\s+/g, '');
  if (clean.length % 4 !== 0) return null;
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const chunk = clean.slice(i, i + 4);
    const values = Array.from({ length: 4 }, (_, k) => {
      const c = chunk.charAt(k);
      return c === '=' ? 0 : BASE64.indexOf(c);
    });
    if (values.some((n) => n < 0)) return null;
    const [a = 0, b = 0, c = 0, d = 0] = values;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    const pad = chunk.endsWith('==') ? 2 : chunk.endsWith('=') ? 1 : 0;
    bytes.push((n >> 16) & 255);
    if (pad < 2) bytes.push((n >> 8) & 255);
    if (pad < 1) bytes.push(n & 255);
  }
  if (bytes.length % 4 !== 0) return null;
  const gids: number[] = [];
  for (let i = 0; i < bytes.length; i += 4) {
    const gid =
      (bytes[i] ?? 0) +
      (bytes[i + 1] ?? 0) * 256 +
      (bytes[i + 2] ?? 0) * 65536 +
      (bytes[i + 3] ?? 0) * 16777216;
    gids.push(gid);
  }
  return gids;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKey<K extends string>(set: Readonly<Record<K, unknown>>, key: string): key is K {
  return Object.prototype.hasOwnProperty.call(set, key);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveInt(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value > 0;
}
