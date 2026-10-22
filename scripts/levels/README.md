# Level source format and `pnpm maps:build`

Owner: game-dev (generator). The sources live in `assets-src/levels/<mission-id>/` (owner
level-designer). The generator writes `public/assets/tilemaps/<mission-id>.json`, a plain Tiled
JSON map (it still opens in Tiled). The map contract is
`docs/design/levels/tiled-conventions.md`; this file only says how to write the source.

```
pnpm maps:build                       # every folder in assets-src/levels/
pnpm maps:build m01-goblin-woods      # one mission
node scripts/levels/build-tilemap.js --src scripts/levels/stub --out <file.json>   # any folder
```

The build fails loudly (non-zero exit, every problem listed with its line or object name) on any
format error. It does not run the gameplay validation of conventions §6; the game's loader does.

## Files in `assets-src/levels/<mission-id>/`

| File           | Required | What                                               |
| -------------- | -------- | -------------------------------------------------- |
| `terrain.txt`  | yes      | The tile grid: one character per 16 px tile.       |
| `objects.json` | yes      | Every point and rectangle object (conventions §4). |
| `legend.json`  | no       | Extra or replaced legend characters for this map.  |

## `terrain.txt`

- One line per tile row, top to bottom; one character per tile, left to right.
- Every row has the same length. Map size comes from the grid: 128 columns × 96 rows for M01.
- Lines that are empty or start with `#` are comments and are skipped (so `#` is never a tile).
  Trailing spaces are stripped, so a space is never a tile either.
- **Runs:** `(cN)` is N copies (N ≥ 1) of the legend char `c`, mixable with literal chars on the
  same line: `(T96)(W5)(T27)` or `(T8),,,mm(.5)(T19)`. Runs are expanded before the width check; a
  row whose expanded width differs from the first row is an error naming the line. `(`, `)` and
  digits are never tile chars (a stray one, or `(c0)`, is an error with its column).
- Each character expands to up to four tiles, one per tile layer (`ground`, `ground-detail`,
  `blockers`, `canopy`). Any non-empty `blockers` tile collides; `canopy` draws above units and
  never collides.

### Default legend

| Char | ground     | ground-detail | blockers      | canopy      | Use                                           |
| ---- | ---------- | ------------- | ------------- | ----------- | --------------------------------------------- |
| `.`  | grass      |               |               |             | open ground                                   |
| `,`  | grass-dark |               |               |             | darker grass, variety                         |
| `:`  | dirt       |               |               |             | clearings, hut yards                          |
| `=`  | road       |               |               |             | road / path                                   |
| `m`  | mud        |               |               |             | bog                                           |
| `*`  | grass      | flowers       |               |             | decoration                                    |
| `o`  | grass      | puddle        |               |             | decoration                                    |
| `s`  | grass      | shadow        |               |             | canopy shadow dither                          |
| `-`  | road       | path-edge     |               |             | road edge                                     |
| `B`  | bridge     |               |               |             | bridge deck (walkable)                        |
| `\|` | bridge     |               | bridge-rail   |             | bridge rail (solid)                           |
| `W`  | water      |               | water         |             | river (solid)                                 |
| `T`  | grass      |               | trunk         | canopy      | tree wall: trunk plus canopy on the same tile |
| `t`  | grass      |               | trunk         |             | lone trunk, no canopy (ravine ledge trunks)   |
| `R`  | grass      |               | rock          |             | rock                                          |
| `C`  | dirt       |               | cliff         |             | cliff / ledge face                            |
| `H`  | dirt       |               | hut-footprint |             | under a hut (4×4); the rubble keeps it        |
| `^`  | grass      |               |               | canopy      | canopy overhang over walkable ground          |
| `v`  | road       |               |               | canopy-edge | thin canopy edge over the road                |
| `P`  | portal-pad |               |               |             | portal pad: **walkable**, see note            |

Portal note: GDD §13 has the leader walk onto the pad (trigger at ≤ 24 px from the centre), so
the portal footprint is **not** a blocker. Huts are.

### `legend.json` (optional)

Adds characters or replaces default ones for this map. Each value names tiles from the tile
catalogue below; omit a layer for "empty". `ground` is required on every entry (the ground layer
is fully filled, conventions §3).

```json
{
  "Q": { "ground": "dirt", "blockers": "rock", "canopy": "canopy-edge" }
}
```

### Tile catalogue (placeholder tilesets)

The generator writes three embedded tilesets, named by conventions §7. Each tile carries a
`name` property; the game paints placeholder textures from those names, so no tile ids appear in
code. Ask game-dev to add a tile name; don't invent ids.

| Tileset (image → Phaser key)                | Tiles                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `forest-ground` → `tiles-forest-ground`     | grass, grass-dark, dirt, road, mud, water, bridge, portal-pad, flowers, puddle, shadow, path-edge, scorch |
| `forest-blockers` → `tiles-forest-blockers` | trunk, rock, cliff, water, hut-footprint, bridge-rail                                                     |
| `forest-canopy` → `tiles-forest-canopy`     | canopy, canopy-edge                                                                                       |

`ground` and `ground-detail` both use `forest-ground`.

## `objects.json`

```json
{
  "objects": [
    {
      "name": "squad-start",
      "type": "squad-start",
      "x": 192,
      "y": 1344,
      "properties": { "facing": "e" }
    },
    { "name": "safe-start", "type": "safe-start", "x": 112, "y": 1264, "w": 160, "h": 160 },
    {
      "name": "hut-01",
      "type": "goblin-hut",
      "x": 1420,
      "y": 980,
      "properties": { "runeIndex": 0 }
    },
    {
      "name": "trig-drum",
      "type": "trigger",
      "x": 752,
      "y": 560,
      "w": 96,
      "h": 32,
      "properties": { "event": "activate-group", "group": "grunts-ambush" }
    }
  ]
}
```

- `name`, `type`, `x`, `y` are required; `properties` is optional (an object of name → value).
- Positions are world pixels. A point's x,y is its centre; a rectangle (`w` and `h` given, both
  > 0) has x,y at its top-left (conventions §2).
- The layer follows from `type` (conventions §4):

  | Layer        | Types                                                                   | Geometry  |
  | ------------ | ----------------------------------------------------------------------- | --------- |
  | `zones`      | `section`, `trigger`, `safe-start`, `bounds-hint`                       | rectangle |
  | `spawns`     | `squad-start`, `enemy-spawn`, `archer-post`, `surge-spawn`, `hut-spawn` | point     |
  | `structures` | `goblin-hut`, `portal`, `rune-slot`, `powder-keg`                       | point     |
  | `props`      | `prop`                                                                  | point     |

  Any other type, or the wrong geometry for a type, is a build error.

- Property types are taken from the JSON value: string → `string`, `true`/`false` → `bool`,
  whole number → `int`, other number → `float`. To force a float that happens to be whole, write
  `{ "type": "float", "value": 2 }`.
- Names must be unique in the map. Tiled numeric ids are assigned by the generator in file order;
  never refer to them (conventions §5).
- Objects outside the map bounds are a build error.

## Output

Orthogonal, `right-down`, finite, 16×16 tiles, uncompressed CSV-style `data` arrays, layers in
conventions §3 order: `ground`, `ground-detail`, `blockers`, `canopy` (tile layers; empty ones are
still written), then `zones`, `spawns`, `structures`, `props` (object layers). Point objects have
`point: true` and zero size. No tile objects (no `gid`).

The embedded tilesets name images (`tiles-forest-*.png`) that don't exist yet: the game paints
placeholder textures from each tile's `name` at boot. Opened in Tiled, the map shows
missing-image warnings and blank tiles until tech-artist publishes the tileset art (M8); object
layers and properties are fully editable meanwhile.
