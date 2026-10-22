import type Phaser from 'phaser';
import type { MissionDef, Rect } from '@core/types';
import { parseMissionMap, type MapIssue, type MissionMap } from '@core/mission/mapData';
import { Depth } from '../depths';
import { createPlaceholderTilesets, isTilesetName, TilesetTextures } from './tilesets';

/** Tile layers in tiled-conventions §3 order, with their depth and whether the map must have them. */
const TILE_LAYERS = [
  { name: 'ground', depth: Depth.Ground, required: true },
  { name: 'ground-detail', depth: Depth.GroundDetail, required: false },
  { name: 'blockers', depth: Depth.Blockers, required: true },
  { name: 'canopy', depth: Depth.Canopy, required: false },
] as const;

export type TileLayerName = (typeof TILE_LAYERS)[number]['name'];

/** Cache key of a mission's Tiled JSON. Boot loads it; the mission builds from it. */
export function mapCacheKey(mission: MissionDef): string {
  return `map-${mission.id}`;
}

/** URL of a mission's Tiled JSON (`MissionDef.map` is relative to public/assets/). */
export function mapUrl(mission: MissionDef): string {
  return `assets/${mission.map}`;
}

/**
 * The rendered map of one mission run. Layers are scene game objects; {@link destroy} removes
 * them (call it on SHUTDOWN, the scene's display list would also take them down).
 */
export interface LoadedTilemap {
  readonly tilemap: Phaser.Tilemaps.Tilemap;
  /** Map size in world px: world and camera bounds (tiled-conventions §2). */
  readonly bounds: Rect;
  /** Every spawn, structure, zone and the portal, parsed and validated by core (mapData.ts). */
  readonly map: MissionMap;
  /** Layer objects by name, for the debug overlay. Optional layers may be absent. */
  readonly layers: ReadonlyMap<TileLayerName, Phaser.Tilemaps.TilemapLayerBase>;
  destroy(): void;
}

/**
 * Builds the mission's tilemap from the JSON Boot loaded: placeholder tilesets, the four tile
 * layers at their depths (canopy above units), the map bounds, and core's parsed MissionMap. Missing
 * JSON, unknown tilesets or a missing required layer throw: the map is broken, fail loudly.
 */
export function loadMissionTilemap(scene: Phaser.Scene, mission: MissionDef): LoadedTilemap {
  const key = mapCacheKey(mission);
  const cached = scene.cache.tilemap.get(key) as { readonly data?: unknown } | undefined;
  if (cached?.data === undefined) {
    throw new Error(`Map "${mapUrl(mission)}" is not loaded (run pnpm maps:build?)`);
  }
  const map = parsedMap(cached.data, mission);
  const tilemap = scene.make.tilemap({ key });
  createPlaceholderTilesets(scene.textures, tilemap);
  const tilesets = tilemap.tilesets.map((tileset) => {
    const added = tilemap.addTilesetImage(tileset.name, textureKeyOf(tileset));
    if (!added) throw new Error(`Map "${key}": tileset "${tileset.name}" has no texture`);
    return added;
  });

  const layers = new Map<TileLayerName, Phaser.Tilemaps.TilemapLayerBase>();
  for (const spec of TILE_LAYERS) {
    if (!tilemap.getLayer(spec.name)) {
      if (spec.required) throw new Error(`Map "${key}": required layer "${spec.name}" is missing`);
      continue;
    }
    const layer = tilemap.createLayer(spec.name, tilesets);
    layer.setDepth(spec.depth);
    layers.set(spec.name, layer);
  }

  return {
    tilemap,
    bounds: { x: 0, y: 0, width: tilemap.widthInPixels, height: tilemap.heightInPixels },
    map,
    layers,
    destroy: () => {
      tilemap.destroy();
    },
  };
}

function textureKeyOf(tileset: Phaser.Tilemaps.Tileset): string {
  if (!isTilesetName(tileset.name)) {
    throw new Error(`Map tileset "${tileset.name}" has no texture key (tiled-conventions §7)`);
  }
  return TilesetTextures[tileset.name];
}

/**
 * Parsed maps by their cached JSON object: a restart reuses the parse, so validation runs and
 * warns once per session, not once per attempt.
 */
const parsedMaps = new WeakMap<object, MissionMap>();

/**
 * Core's parse plus the tiled-conventions §6 rules. Any error throws with the whole list (a broken
 * map fails loudly); warnings go to the console once.
 */
function parsedMap(json: unknown, mission: MissionDef): MissionMap {
  const cached = typeof json === 'object' && json !== null ? parsedMaps.get(json) : undefined;
  if (cached) return cached;
  const result = parseMissionMap(json, mission);
  if (result.warnings.length > 0) {
    console.warn(`Map "${mission.map}" warnings:\n${result.warnings.map(describe).join('\n')}`);
  }
  if (!result.map) {
    const message = `Map "${mission.map}" failed validation:\n${result.errors.map(describe).join('\n')}`;
    console.error(message);
    throw new Error(message);
  }
  if (typeof json === 'object' && json !== null) parsedMaps.set(json, result.map);
  return result.map;
}

function describe(issue: MapIssue): string {
  const where = issue.object === undefined ? '' : ` [${issue.object}]`;
  return `  rule ${String(issue.rule)}${where}: ${issue.message}`;
}
