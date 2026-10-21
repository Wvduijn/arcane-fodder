# MVP asset list

Owner: art-director (Task 7). Status: **v3.1 FINAL (2026-10-13), 48 × 48, style guide v3.1
(Warcraft-like, bright; elemental enemy gore).** Supersedes v2.0. Level-side numbers are agreed with level-designer;
character, overlay and FX sizes and radii are agreed with game-designer (style guide §12, D1–D8;
radii from mvp.md). Items still marked **[gd]** depend on a pending approval.

Sources: plan.md §11, docs/design/gdd/readability.md §2–§5a, docs/design/levels/tiled-conventions.md,
docs/design/levels/m01-goblin-woods.md, assets-src/style-guide.md v2.0.

All art follows the style guide: 1:1 pixels, palette-quantised, `ink` outline plus top-left rim
light on units, structures, props and enemy projectiles; no outline on ground tiles. **Engine**
means drawn in code (Graphics, tint, tween), not by art.

## 0. Conventions

**Facings:** `down`, `up`, `side` (faces right; left is `flipX`). "×3" means one set per facing.

**Atlases and texture keys** (proposed; `tech-artist` owns atlases and `src/data/animations.ts`
and publishes the final keys back here):

| Phaser key | Contents |
|---|---|
| `atlas-units` | wizards, goblins, dropped hats |
| `atlas-structures` | hut, keg, portal |
| `atlas-fx` | projectiles, impacts, overlays, runtime decals |
| `atlas-environment` | decorative props for the Tiled `props` layer (`env/<name>`) |
| `atlas-ui` | in-world HUD sprites (edge arrow) |
| `tiles-forest-ground` | tileset image `forest-ground` |
| `tiles-forest-blockers` | tileset image `forest-blockers` |
| `tiles-forest-canopy` | tileset image `forest-canopy` |

**Frame key format:** `<subject>/<anim>-<facing>-<nn>`, two-digit index from `00`
(e.g. `pyromancer/walk-side-02`). Single frames drop facing and index (`hut/intact`).

**Autotile "13-set":** 1 fill + 4 edges + 4 outer corners + 4 inner corners, one terrain against
grass.

---

## 1. Wizards (`atlas-units`)

Canvas **48 × 48**, anchor **(24, 46)**. Heroic grizzled veteran base body; classes differ only in
hat, robe and staff head (style guide §6). Heights: Pyromancer 42 px, Stormcaller 47 px.

| Anim | Facings | Frames | Loop | Notes |
|---|---|---|---|---|
| `idle` | ×3 | 2 | yes | breathing, beard sway |
| `walk` | ×3 | 4 | yes | also the Volunteer sprint (faster playback) |
| `cast` | ×3 | 3 | no | wind-up, **staff raised** (held 1.2 s for the Convergence channel), release |
| `death` | down | 5 | no | collapses; hat falls off and becomes `hat/<class>` |

**Per class: 32 frames.**

| Subject | Frames | Notes |
|---|---|---|
| `pyromancer` | 32 | straight crimson cone hat with wide drooping brim, crimson robe, gnarled flame staff |
| `stormcaller` | 32 | taller crooked zigzag hat, steel-blue robe, forked crackling staff; reuses the base body frames |
| `hat/pyromancer`, `hat/stormcaller` | 1 each, 24 × 24 | dropped hat (~5 s) and Arcane Detonation hat-fly |

Hit reaction is the engine white flash, so there are no hit frames.

## 2. Goblins (`atlas-units`)

Canvas **48 × 48**, anchor **(24, 46)**. Grunt body ~28 × 26 (weapon to ~34), Archer ~22 × 28.
Huge sideways ears are visible in every facing (the Archer's hood leaves them poking out).

| Subject | Anim | Facings | Frames | Notes |
|---|---|---|---|---|
| `goblin-grunt` | `idle` | ×3 | 2 | weapon low, snarling |
| | `walk` | ×3 | 4 | |
| | `attack` | ×3 | 3 | **wind-up** (held ≥ 100 ms), swing, recover |
| `goblin-archer` | `idle` | ×3 | 2 | hood, ears poking out, bow vertical at its side |
| | `walk` | ×3 | 4 | |
| | `attack` | ×3 | 3 | **draw** (held 300 ms), release, recover |

**Elemental deaths (style guide §7.1, mvp.md §12a, readability.md §4a)**, for each of
`goblin-grunt` and `goblin-archer`. Facing `down` only. Frame-cost approach agreed with
game-designer: one drawn collapse, a scripted recolour for charred, one skeleton frame.

| Anim / frame | Frames | Drawn? | Notes |
|---|---|---|---|
| `death` | 5 | drawn | shared collapse for every element: recoil (1), fall (3), settle (1) |
| `death-charred` | 5 | **palette remap of `death`** (tech-artist script) | fire deaths; the engine plays the Burning overlay on top, embers stop after ~1 s |
| `death-skeleton` | 1 | drawn | storm deaths: held 120 ms, then `death` plays; engine adds `fx/electrocute` |
| `corpse-charred` | 1 | remap of `corpse-slain` | fire |
| `corpse-smoking` | 1 | remap of `corpse-slain` (darker, ash-grey) | storm; engine adds `fx/corpse-smoke` |
| `corpse-slain` | 1 | drawn | physical / arcane / Kaboom shrapnel; paired with `fx/blood-burst` and a splat decal |

Corpses: flat, **≤ 14 px tall**, ≥ 50 % desaturated and darker than the live sprite, eyes dark, no
weapon raised; 48 × 48 canvas, same anchor.

**Per enemy: 30 (idle/walk/attack) + 11 (deaths) + 3 (corpses) = 44 frames**, of which only 7
death/corpse frames are hand-drawn (5 + 1 + 1). **Gore off** (approved setting): `death` +
`fx/death-puff` only. The skeleton flash is 1 frame (the creative director approved up to 2).
The Archer needs a concept pass before sprites, using the locked goblin reference (style guide §15).

## 3. Structures (`atlas-structures`)

| Subject | Canvas | Frames | Notes |
|---|---|---|---|
| `hut/intact` | 64 × 96 | 1 | 4 × 4 tile footprint, door on the south side, ≤ 96 px tall |
| `hut/rubble` | 64 × 96 | 1 | ≤ 32 px tall, same footprint, darker, no glow |
| `hut/door-glow` (`normal`, `bright`) | 16 × 24 | 2 | overlay on the door; engine pulses `bright` for 500 ms before a spawn |
| `keg/idle` | 32 × 32 | 1 | barrel art ~20 × 24; collision 16 × 16 (1 tile), centred (mvp.md §8) |
| `keg/fuse` | 32 × 32 | 2 | white/red blink for the 300 ms fuse; sparks are `fx/fuse-spark` |
| `portal/sealed` | 128 × 128 | 1 | cracked stone arch on a 4 × 4 tile base; arch rises 64 px above the base; 2 empty rune sockets |
| `portal/rune-dark` | 12 × 12 | 1 | overlay per socket (sockets ≥ 9 × 9) |
| `portal/rune-lit` | 12 × 12 | 1 | `gold` with a `flame-white` centre |
| `portal/rune-flare` | 24 × 24 | 3 | 300 ms flare |
| `portal/opening` | 128 × 128 | 8 | 1500 ms swirl forming plus light rays |
| `portal/swirl` | 96 × 96 | 6 | open loop inside the arch |

**Anchors (match tiled-conventions.md §4.2).**
- `goblin-hut` and `portal`: the Tiled point is the centre of the 4 × 4 footprint. Sprite origin
  is **centre-bottom at (point.x, point.y + 32)**, so the sprite's bottom edge sits on the
  footprint's bottom edge.
- `powder-keg`: the point is the centre of its 1-tile collision. Sprite origin centre-bottom at
  (point.x, point.y + 8). The 32 × 32 sprite overlaps neighbouring cells visually; level-designer
  keeps chain pairs 32–48 px apart.

**Offsets tech-artist publishes here** (px from the sprite origin):
- `hut/intact` door (south side, centre): spawn point and `hut/door-glow` placement.
- `portal/sealed` rune sockets 0 and 1: `rune-slot` points and rune overlays.
- Pyromancer staff tip per wizard frame: `fx/staff-flame` placement.

Hut smoke plume is `fx/smoke-plume` (§5). Health bars are engine-drawn (§6).

## 4. Tiles and props (Goblin Woods)

16 × 16 tiles. Numbering follows level-designer's list. Level rules (tiled-conventions.md):
minimum corridor 5 tiles (80 px), chokes exactly 5, open corridors 8–9, ravine floor 6, bridge deck
5 wide, ledge gaps 3. Wide open areas mean more fill variants so fills don't read as a pattern.

**Contrast rule:** in a desaturated screenshot, walkable ground (`moss`/`moss-light`, packed dirt)
is lighter and flatter than blockers (dark trees with `ink` outline), and water is darker and bluer
than both grass and dirt.

### 4.1 `tiles-forest-ground` (layers `ground`, `ground-detail`)

| # | Set | Tiles | Notes |
|---|---|---|---|
| 1 | Grass | 6 | **5 base variants** + 1 leaf-litter accent; dark muted, sparse ordered dither |
| 2 | Dirt road | 13-set + 2 fill = 15 | packed, rutted; T-junctions and ends from corners |
| 3 | Worn footpath (1 tile wide) | 10 | straight H, straight V, 4 corners, 4 ends; decorative line in the Bramble Path |
| 4 | Meadow | 13-set + 1 fill = 14 | slightly lighter grass, still below unit values |
| 5 | Bog floor | 13-set + 1 fill + 2 puddle = 16 | `soil`/`deep-pine` mud, `water` puddles; walkable |
| 6 | Ravine floor | 2 fill + 3 ledge-top = 5 | packed earth and stone |
| 7 | Stone bridge deck | 9 | 3 distinct rows (N edge, middle, S edge) × (W ramp, mid, E ramp). The middle row repeats to make the 5-tile-wide deck; the mid column repeats along the 5-tile span. |
| 9 | Camp ground | 13-set + 1 fill = 14 | trampled dark mud with ash flecks |
| 10 | Ground-detail overlays | 17 | leaf tufts 3, mushrooms 2 (`bone`/`tan`), pebbles 2, puddles 2, reeds 2, dirt edge decals 4, static scorch 2 |
| 19b | Canopy shadow | 13-set = 13 | dithered `deep-pine` shade on `ground-detail` |

**Total ≈ 119 tiles.**

**Transition rule (agreed):** every 13-set blends against grass only. Bog, meadow, camp ground and
ravine floor never touch the road or each other directly; road meets bridge through the ramp tiles.

### 4.2 `tiles-forest-blockers` (layer `blockers`, every tile collides)

| # | Set | Tiles | Notes |
|---|---|---|---|
| 11 | Tree wall | 13-set + **3 fill** = 16 | dense dark trunks and undergrowth; `ink` outer edge; 3 fills for 8-tile-deep forest |
| 12 | Ledge trunk line | 4 | left end, mid, right end, single trunk (3-tile gaps are empty cells) |
| 13 | Rocks | 3 × 1×1 + 2 × 2×2 = 11 | mossy `slate`/`ash`/`bone` |
| 14 | Cliff / ravine wall | 13-set = 13 | |
| 15 | River | (W bank + E bank + 2 deep fill) × 3 anim frames = 12 | full map height, banks only on W and E. ~250 ms per frame; animating the banks is optional. |
| 16 | Bridge railings | 6 | N and S rails × (W end, mid, E end), each with a **water-family background baked in** (they sit on river cells) |
| 17 | Hut footprint | 16 + 16 rubble = 32 | 4 × 4 trampled-mud base under `hut/intact`, and the rubble version |
| 17b | Portal base | 16 | 4 × 4 cracked stone plinth under `portal/sealed` |
| 18 | Logs and stump | 2 (2×1) + 2 (1×2) + 1 = 5 | partial blockers, dead wood |

**Total ≈ 115 tiles.**

### 4.3 `tiles-forest-canopy` (layer `canopy`, above units, never collides)

| # | Set | Tiles | Notes |
|---|---|---|---|
| 19 | Tree-top overhang | 13-set + 2 fill = 15 | up to 3 tiles deep; never over the central 3 tiles of a corridor, kegs, archer posts or hut/portal footprints (level rule) |

### 4.4 `atlas-environment` (Tiled `props` layer, decoration only)

| Frame key | Canvas | Frames | Notes |
|---|---|---|---|
| `env/tree-large` | 64 × 96 | 1 | old dark tree, decorative (collision comes from tiles) |
| `env/tree-medium` | 48 × 64 | 1 | |
| `env/tree-dead` | 48 × 64 | 1 | leafless, twisted |
| `env/stump-small` | 16 × 16 | 1 | |
| `env/stump-large` | 32 × 32 | 1 | |
| `env/bones-01`, `env/bones-02` | 16 × 16 | 1 each | loose bones, no skulls |
| `env/tent-goblin` | 48 × 48 | 1 | stitched hide tent |
| `env/banner-goblin` | 16 × 48 | 2 | spiked post with ragged dark cloth, flutter; no red |
| `env/palisade-01`, `env/palisade-02` | 16 × 48 | 1 each | sharpened stakes; decorative, no collision |
| `env/drying-rack` | 48 × 48 | 1 | |
| `env/campfire-cold` | 24 × 24 | 1 | ash ring, never lit |
| `env/smoke-wisp` | 16 × 24 | 3 | grey loop over the cold fire |
| `env/crate` | 16 × 16 | 1 | square, unbanded |
| `env/sack` | 16 × 16 | 1 | |
| `env/rags` | 16 × 32 | 2 | hanging cloth near huts |
| `env/reeds-01`, `env/reeds-02` | 16 × 16 | 1 each | |
| `env/lilypad-01`, `env/lilypad-02` | 16 × 16 | 1 each | |
| `env/mushrooms` | 16 × 16 | 1 | `bone`/`tan` caps |
| `env/bush-thorn-small` | 16 × 16 | 1 | dark thorny undergrowth |
| `env/bush-thorn-large` | 32 × 32 | 1 | |
| `env/roots-01`, `env/roots-02` | 32 × 16 | 1 each | gnarled exposed roots |

**30 frames.**

---

## 5. FX (`atlas-fx`)

Squad FX glow with a hard-edged stepped halo, plus optional engine additive blending; enemy
projectiles are matte. Area FX are sized to the mvp.md radii, and the impact edge must reach the
ring (the hit rule is distance ≤ radius + body radius).

| Frame key prefix | Canvas | Frames | Loop | Notes |
|---|---|---|---|---|
| `fx/firebolt` | 12 × 12 | 3 | yes | ~9 × 9 orb + trail; rotates |
| `fx/spark` | 12 × 8 | 2 | yes | ≤ 9 × 4 cyan-white zigzag |
| `fx/arrow` | 16 × 16 | 1 | — | ~12 × 3 pale stroke, `bone` shaft, `ink` outline, matte; rotates |
| `fx/fireball` | 24 × 24 | 4 | yes | ≥ 15 px orb + flame trail |
| `fx/fireball-impact` | 96 × 96 | 6 | no | edge reaches the 44 px radius (± 4 px) |
| `fx/lightning-bolt` | 24 × 96 | 3 | no | vertical segment tiled from the screen top |
| `fx/lightning-flash` | 48 × 48 | 4 | no | ground flash; reused by Thunderstorm and Firestorm |
| `fx/burning` | 24 × 24 | 3 | yes | `ink`-outlined tongues, `ember` body, `flame-white` core, above the head line; huts use 2–3 |
| `fx/ember` | 4 × 4 | 2 | yes | particle |
| `fx/staff-flame` | 12 × 12 | 3 | yes | Pyromancer staff-tip flicker |
| `fx/combust` | 64 × 64 | 5 | no | sharp orange-white pop to the 32 px radius, no smoke |
| `fx/kaboom` | 160 × 160 | 8 | no | 72 px radius blast |
| `fx/kaboom-smoke` | 48 × 96 | 6 | no | smoke column |
| `fx/debris` | 8 × 8 | 3 | — | wood and stone particles |
| `fx/scorch` | 48 × 48 | 2 variants | — | runtime post-Kaboom decal |
| `fx/fuse-spark` | 8 × 8 | 3 | yes | |
| `fx/beam-fire`, `fx/beam-storm` | 16 × 12 | 3 each | yes | Convergence beam segment, tiled and rotated |
| `fx/beam-core` | 24 × 24 | 3 | yes | violet core at the leader |
| `fx/meteor` | 48 × 48 | 4 | yes | falling rock; shadow is engine |
| `fx/meteor-impact` | 192 × 192 | 8 | no | fills the 90 px radius |
| `fx/burning-ground` | 32 × 32 | 3 | yes | flame decal with a clear edge, scattered for 4 s |
| `fx/meteorlet` | 24 × 24 | 3 | yes | Firestorm rain; impact reuses `fx/combust` |
| `fx/arcane-detonation` | 144 × 144 | 7 | no | bright magenta-violet burst to the 64 px radius; hat-fly reuses `hat/<class>` |
| `fx/lightning-reticle` | 24 × 24 | 3 | no | ~20 px telegraph reticle shrinking over 250 ms (strike radius 8); `cyan` / `bolt` |
| `fx/warp-out` | 48 × 72 | 5 | no | stretch up plus flash, per saved wizard |
| `fx/death-puff` | 48 × 48 | 5 | no | neutral grey puff: all wizard deaths, and every enemy death when the **Gore setting is off** (approved) |
| `fx/blood-burst` | 48 × 48 | 6 | no | physical/arcane enemy death; blood family only, no bright core, no glow |
| `fx/blood-splat` | 32 × 32 | 4 variants | — | ~24–32 px; **runtime decal, engine-spawned and pooled** (never a Tiled decal); low-contrast, ground layer; random variant and `flipX` |
| `fx/ash-scorch` | 32 × 32 | 2 variants | — | runtime death decal for fire and storm kills (`soil`/`dusk`/`ash`); pooled |
| `fx/crater` | 64 × 64 | 1 | — | shared runtime decal for ≥ 3 kills from one blast; pooled |
| `fx/blood-drops` | 16 × 16 | 3 variants | — | small satellite drops around a splat, same pool |
| `fx/electrocute` | 48 × 48 | 3 | yes | `cyan`/`bolt` crackle overlay played over `death-storm` skeleton frames |
| `gib/<piece>-<variant>-<nn>` | 16 × 16 | 4 per piece × variant | yes (spin) | **Goblin gib sheet** (style guide §7.1). Pieces (~6–12 px): `ear`, `bone-a`, `bone-b`, `meat-a`, `meat-b` (shared), `axe-head` (Grunt), `bow-half` (Archer). Variants: `bloody` (drawn), `charred` (palette remap; also used for electrified, + engine `fx/corpse-smoke`). 7 pieces × 2 variants × 4 spin frames = **56 frames**, of which 28 hand-drawn. A gib throws up to 6 pieces from the set weapon + ear + 2 bones + 2 meat; the count per death is game-designer data (currently 3–5, seeded, weapon always included). It replaces the death animation and corpse. Pool of 32 pieces. |
| `fx/corpse-smoke` | 16 × 24 | 3 | yes | `ash`/`bone` wisp over smoking and charred corpses for a few seconds |
| `fx/smoke-plume` | 24 × 48 | 4 | yes | hut chimney; also ≤ 3 s rubble smoke |
| `fx/leader-marker` | 32 × 16 | 1 | — | `gold` ellipse ~27 × 12 with a 1 px `ink` outline; engine pulses (≥ 800 ms) and pops it on succession |
| `fx/target-marker` | 24 × 24 | 1 | — | Volunteer aim point |

**193 frames** (incl. 56 gib frames). (Portal opening burst is `portal/opening`, §3.)

**Death playback (mvp.md §12a; tech-artist sets the rates in `src/data/animations.ts`):**
- fire: `death-charred` 5 frames in ≤ 500 ms (~100 ms each);
- storm: `death-skeleton` held 120 ms, then `death` 5 frames in the remaining ≤ 280 ms (~56 ms each);
  only one flash per goblin, and core caps flashes at 3 per 1000 ms (the rest skip the skeleton frame);
- blood: `death` 5 frames in ≤ 350 ms (70 ms each).

**Element of the killing blow:** fire → charred; storm → electrified; physical, arcane, Kaboom,
unknown → blood. Combust: spark kill = storm, explosion kill = fire.

**Lifetimes and caps** (data, mvp.md §12a; oldest recycled first with a 250 ms fast fade): corpses
6 s + 1 s fade, max 16; decals 12 s + 2 s fade, max 24; gib pieces 8 s + 1 s fade, max 32. A blast
with ≥ 3 kills leaves one shared `fx/crater` instead of per-victim splats.

**Gore pooling and layering (readability.md §4a):** ground → death decals (splats, drops,
ash/scorch, crater) → telegraph rings → corpses and landed gibs → live units → FX. Decals never
cover a telegraph ring. Everything is pooled and fades per game-designer's lifetime and cap (oldest
recycled first). Wizards never spawn gore.

## 6. Engine-drawn items (no art)

From readability.md §5a (rev 2), sizes agreed for 48 px units.

| Item | Kind | Colour (style guide §4) |
|---|---|---|
| Health bars: wizard 24 × 3, enemy 18 × 3, hut 48 × 4; low-HP blink | Graphics | friendly `cyan`, hostile `ember`, back `ink` |
| Hit flash, 60 ms | tint | white |
| Staff-tip beacon glow (class colour beacon) | additive glow at the staff-tip offset | Pyromancer `flame`, Stormcaller `cyan` |
| Convergence aim ring (combo radius) | Graphics | Meteor `ember`, Thunderstorm `cyan`, Firestorm `ember` rim with `cyan` ticks |
| Keg blast ring (Kaboom radius 72) during the fuse | Graphics with 1 px `ink` outline | `cream`/`ember` dashed, blinking |
| Volunteer blinking outline and fuse ring | tint + Graphics | `cream` / `arcane-light` |
| Meteor shadow | Graphics ellipse | `ink` with alpha |
| Thunderstorm cloud tint | Graphics | `navy` with alpha |
| Extraction ring (radius 112, pending approval **[gd]**) | Graphics, dashed, 1 px `ink` outline | `gold` |
| Unit ground shadows | Graphics ellipse | `ink` ~45 % alpha |
| Off-screen portal arrow | `atlas-ui` sprite `ui/edge-arrow` (24 × 24, 1 frame), rotated; state-neutral name, so a sealed-portal arrow can be the same sprite dimmed | `gold` |
| Screen flash (≤ 100 ms), screen shake | camera | — |
| Names, epitaphs, numbers | UI text | — |

## 7. Production order (plan.md §11, M8)

1. Pyromancer (32 frames) + `hat/pyromancer` → atlas → in game → readability check at 48 px.
2. Stormcaller (reuses the base body).
3. Goblin Grunt, then Goblin Archer (concept pass first).
4. Tiles, level-designer priority first: grass (#1), dirt road (#2), tree wall (#11), river (#15).
5. Structures: hut, keg, portal.
6. Spell FX, Convergence FX, remaining FX, environment props.

## 8. Totals

| Group | Frames / tiles |
|---|---|
| Wizards (2 classes + 2 hats) | 66 |
| Goblins (2, incl. elemental deaths + 3 corpses each) | 88 |
| Structures | 27 |
| Ground tiles | ~119 |
| Blocker tiles | ~115 |
| Canopy tiles | 15 |
| Environment props | 30 |
| FX (incl. 56 gib frames) | 193 |
| UI | 1 |

Pixel area per character frame is 2.25× the 32 px version, so expect roughly twice the cleanup
time per frame for tech-artist.

## 9. Open items

| # | Item | Owner |
|---|---|---|
| A1 | Final atlas keys and frame naming published here | tech-artist |
| A2 | Goblin Archer and Stormcaller concepts before sprite production | art-director |
| A4 | `rune-slot` points on the arch sockets, once offsets are published (§3) | level-designer, tech-artist |
| A5 | Publish door, rune-socket and staff-tip offsets (§3) | tech-artist |
| A6 | Sealed-portal edge arrow (dimmed `ui/edge-arrow`) | producer decision |
| A7 | ~~Sizes and radii (D1–D4)~~ Done: agreed; extraction radius 112 still pending approval | game-designer, producer |
| A8 | ~~Style lock v3 approval~~ Done: locked references are Pyromancer v2 (Stout), Grunt v3 (Axe), all three tile sheets as one set (style guide §15) | creative director |
| A9 | ~~Death frame counts~~ Settled: shared collapse + palette remap + 1 skeleton frame (§2). Corpse/decal lifetime, fade and cap are tuning data in mvp.md §12a, not art. | game-designer (data) |
| A10 | ~~Gib trigger and counts~~ Done: mvp.md §12a (Kaboom, Volunteer! or Convergence kill at ≥ 1.5 × max HP: Grunt ≥ 36, Archer ≥ 27; max 4 per blast; 3–5 pieces each, weapon always included). Art fixed at 56 frames (§5). | game-designer |
