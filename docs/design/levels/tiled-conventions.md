# Tiled conventions (contract between level-designer and game-dev)

Owner: level-designer. Changing anything marked **[contract]** needs a message to `producer`, who informs `game-dev`.
Coordinates, counts and timings live in Tiled objects or mission data, never in code.

## 1. Files

| What | Where |
|---|---|
| Tiled JSON maps (runtime) | `public/assets/tilemaps/<mission-id>.json` (example: `m01-goblin-woods.json`) |
| Tiled source (`.tmx`/`.tiled-project`), optional | `assets-src/` is art-director territory, so keep `.tmx` out of the repo; export JSON only |
| Mission data | `src/data/missions/<mission-id>.ts` |
| Level docs | `docs/design/levels/<mission-id>.md` |

`MissionDef.map` is the path relative to `public/assets/` (`tilemaps/m01-goblin-woods.json`), as in plan.md §4.4.
Tilesets are embedded in the JSON (not external `.tsx`), with the image name equal to the Phaser texture key listed in section 7.

## 2. Map setup

- Orientation: `orthogonal`, render order `right-down`, infinite = **off**.
- Tile size: **16 x 16 px**. Characters are 48x48 px (3x3 tiles) since the 2026-10 art direction change. Structure footprints are set by `src/data/structures.ts` and art-director; the map reads them, never the other way round.
- Map size for M01: 128 x 96 tiles (2048 x 1536 px). Other missions may differ; the loader reads `width`/`height` from the JSON and sets world and camera bounds from it.
- Layer compression: none (CSV or uncompressed base64). Export as JSON.
- No Tiled "tile objects" (objects with a gid). Use only **point** and **rectangle** objects, so anchors are unambiguous: a point's x,y is the entity centre; a rectangle's x,y is its top-left, in pixels.

## 3. Layer order (bottom to top) **[contract]**

Names are lowercase kebab-case and must match exactly. Missing optional layers are tolerated; missing required layers are a load error.

| # | Layer | Kind | Required | Purpose |
|---|---|---|---|---|
| 1 | `ground` | tile | yes | Base terrain (grass, dirt, path, water). Fully filled, no empty cells. |
| 2 | `ground-detail` | tile | no | Flowers, puddles, path edges, scorch and mud decals, canopy shadow dither. Under units. Never blood or gore: enemy-death gore is spawned by the engine as pooled decals, not authored in Tiled. |
| 3 | `blockers` | tile | yes | Solid tiles: trees trunks, rocks, cliffs, water edge, huts footprint. Any non-empty tile collides. Rendered under units (sorted by y is not done at tile level). |
| 4 | `canopy` | tile | no | Tree tops and overhangs drawn **above** units. Never collides. Overhangs may be up to 3 tiles deep but must never cover the central 3 tiles of a route corridor, any keg, archer-post, or hut/portal footprint (units and threats must stay readable). |
| 5 | `zones` | object | yes | Rectangles: `bounds-hint`, `safe-start`, `section`, `trigger` |
| 6 | `spawns` | object | yes | Points: squad start, enemy spawn points, wave spawns, archer posts |
| 7 | `structures` | object | yes | Points: huts, portal, kegs |
| 8 | `props` | object | no | Points: purely decorative props (stumps, bones, tents). No gameplay effect. |

Collision is the `blockers` tile layer. Units are 48 px wide, so one unit fills 3 tiles. A navigable gap of at least **5 tiles (80 px)** is required everywhere a squad must pass, so formation followers can separate and pass each other without jamming. Chokepoints the design wants tight (Ford, Old Bridge) are exactly 5 tiles; never narrower. Open corridors are 8 tiles (128 px) or wider. (Previously 3 tiles minimum at 32 px units.)

Structures also block movement at runtime via their own physics bodies. Mark the tile footprint under a hut or portal in `blockers` as well, so enemy pathing and the squad agree.

## 4. Object types

Every object has a Tiled `name` (unique string id in the map, see section 5) and a `type` (Tiled "Class"). Custom property types are Tiled types: `string`, `int`, `float`, `bool`.

### 4.1 `spawns` layer

| type | Geometry | Properties |
|---|---|---|
| `squad-start` | point | `facing` string (`n`/`e`/`s`/`w`, default `e`). Exactly one per map. The leader spawns here; followers use formation offsets. |
| `enemy-spawn` | point | `enemy` string (`goblin-grunt`/`goblin-archer`), `group` string (id, see below), `count` int (default 1), `radius` int px scatter (default 24), `trigger` string (name of a `trigger` zone, empty = active at mission start), `leash` int px (default 0 = none). |
| `archer-post` | point | `group` string, `facing` string, `holdRadius` int px (archer stays within this of the post until the squad is spotted, default 32). Always spawns `goblin-archer`, `count` fixed at 1. |
| `surge-spawn` | point | `wave` string (wave id, e.g. `surge-01`), `enemy` string, `count` int, `radius` int, `delayMs` int (offset from portal-open, default 0). |
| `hut-spawn` | point | `hut` string (name of the owning `goblin-hut` structure). Where the hut's grunts appear (usually its door). Optional: if absent, spawn around the hut using `SpawnerDef` radius. |

`group` ids tie several spawn objects into one encounter so mission data and triggers can refer to them as one unit.
`surge-spawn` objects are the "remaining spawn points" in `finalSurge.spawnPoints: 'all-remaining'`: all `surge-spawn` objects whose `wave` matches the wave id.

### 4.2 `structures` layer

| type | Geometry | Properties |
|---|---|---|
| `goblin-hut` | point (centre of the 4x4-tile footprint) | `target` string (target id counted by objectives, default `goblin-hut`), `runeIndex` int (0-based; which portal rune this hut lights), `spawnIntervalMs` int, `maxAlive` int, `spawnEnemy` string (default `goblin-grunt`), `activateRadius` int px (hut only starts spawning when the squad is within it; 0 = always active). Numbers here are the level designer's *requests*; `game-designer` owns the defaults in `src/data/structures.ts`. A property set here overrides the data default. |
| `portal` | point (centre) | `radiusPx` int (extraction radius; must equal `MissionDef.extraction.radiusPx`, mission data wins and the loader warns on mismatch), `runeCount` int (must equal number of objective targets). Exactly one per map. |
| `rune-slot` | point | `index` int (0-based), `portal` string (portal name, default `portal`). Optional: world position of each rune so art can place them; if absent, PortalSystem lays runes out from the portal sprite. |
| `powder-keg` | point | `cluster` string (optional group id for design notes only), `chain` bool (informational: intentionally within blast radius of another keg). |

### 4.3 `zones` layer (rectangles)

| type | Properties |
|---|---|
| `section` | `index` int (1-based order along the route), `label` string (human name, e.g. "Hollow Road"). Sections partition the map for pacing, debug overlay and reviewer playtests. Cosmetic: no gameplay logic reads them except the debug overlay. |
| `trigger` | `once` bool (default true), `event` string (see below). Fires when the leader enters. |
| `safe-start` | No enemy may spawn or path-aim inside. Also the zone in which no `powder-keg` may be placed (lint check, see section 8). |
| `bounds-hint` | Optional camera clamp tighter than the map. |

`trigger.event` values **[contract]**: `activate-group` (needs `group`: enables all `enemy-spawn` with `trigger` equal to this trigger's name), `alert-group` (needs `group`: group aggro the squad), `bark` (needs `text` string: narrative line, optional). Anything else needs a producer message.

### 4.4 `props` layer

| type | Properties |
|---|---|
| `prop` | `sprite` string (full frame key from `atlas-environment`, e.g. `env/stump-small`; animated props such as `env/banner-goblin` loop their frames), `depth` string (`below`/`above`, default `below`), `flipX` bool. |

## 5. Naming rules

- `name` is the stable string id. **Mission data references objects by `name`, never by Tiled's numeric `id`** (numeric ids change when objects are copied or recreated).
- Format: lowercase kebab-case, `<role>-<nn>` or `<role>-<descriptor>`, unique within the whole map (not only per layer). Examples: `squad-start`, `portal`, `hut-01`, `hut-02`, `keg-03`, `archer-ridge-01`, `grunts-ford-01`, `surge-n-01`, `trig-ford`, `sec-02`.
- Numbering is two digits and never reused after deleting an object.
- `group`, `wave`, `target` values use the same kebab-case style.
- Reserved names: `squad-start`, `portal`.

## 6. How mission data references the map **[contract]**

`src/data/missions/<id>.ts` holds *what* the mission is; the map holds *where*. The link is by object `name` and `type`.

```ts
objectives: [{ kind: 'destroy', target: 'goblin-hut', count: 2 }]
// count must equal the number of `goblin-hut` objects whose `target` is 'goblin-hut'. Loader validates.

extraction: {
  kind: 'portal',
  spawnId: 'portal',        // name of the `portal` object
  radiusPx: 48,
  finalSurge: { waveId: 'surge-01', spawnPoints: 'all-remaining' },
  // spawnPoints 'all-remaining' = every `surge-spawn` with wave === waveId
},
```

Approved by the creative director at the gate (applied when the milestone opens): optional `MissionDef.start: { spawnId: 'squad-start' }`, and the wave-entry field `aggro: 'radius' | 'always'` (surge-01 uses `'always'`). Until the field exists in `MissionDef`, the loader uses the single `squad-start` object.

Loader validation rules (game-dev implements, level-designer relies on them; failures are loud errors in dev):
1. Exactly one `squad-start` and one `portal`.
2. `goblin-hut` count with the objective `target` equals `objectives[].count`; `runeIndex` values are unique and cover `0..count-1`.
3. Every `surge-spawn.wave` used by the mission exists; at least one spawn per wave.
4. Every `enemy-spawn.trigger` and `trigger` `group` resolves to an existing name or group.
5. All object names unique.
6. Warn if a spawn or structure point lies on a non-empty `blockers` tile (except structures, whose footprint is intentionally marked).
7. No `powder-keg` within `safe-start` and none within 192 px of `squad-start`. Every keg is at least 96 px from the route centreline (Kaboom r64 plus half a 48 px unit plus margin).

Units: all positions in **pixels**, world space; tile coordinates are never used in properties.

## 7. Texture keys (handoff to art-director / tech-artist)

| Tileset image | Phaser key | Notes |
|---|---|---|
| `forest-ground` | `tiles-forest-ground` | ground, ground-detail |
| `forest-blockers` | `tiles-forest-blockers` | trunks, rocks, cliffs, water edge, hut footprint |
| `forest-canopy` | `tiles-forest-canopy` | tree tops |

Tile indices are authored in Tiled; no tile ids appear in code. Per-biome tile lists go to `art-director` from the level docs.

## 8. Authoring checklist (level-designer, per map)

- [ ] Layer names and order match section 3.
- [ ] Every object has a unique `name` and valid `type`.
- [ ] Corridors are at least 5 tiles wide along the intended route (8+ in the open).
- [ ] Portal visible from the start region or revealed by a camera pan/landmark early (see level doc), and far from `squad-start`.
- [ ] No keg inside or near `safe-start`.
- [ ] Beat chart and sketch in `docs/design/levels/<id>.md` match the map.
