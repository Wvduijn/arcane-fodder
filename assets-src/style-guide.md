# Arcane Fodder — Style Guide

> **Status: v3.1 FINAL (2026-10-13). Direction: stylised Warcraft-like, bright and heroic, 48 × 48.**
> v3.1: style lock approved (locked references in §15); enemy deaths get stylised elemental gore
> (§7.1, blood family in §4); wizard deaths stay non-gory.
> 2026-10-14: Stormcaller and Goblin Archer references locked (§15).
> Owner: art-director. Replaces v2.0 (too dark) and v1.1 (too childish). Rejected concept sets:
> assets-src/concept/style-lock/_rejected-v1/ and the v2 raws in assets-src/raw/<asset>/v2/.
> Sizes and radii are agreed with game-designer (readability.md rev 2, mvp.md) and level-designer
> (tiled-conventions.md); §12 tracks them.

Sources: creative-director direction via producer (2026-10-13); plan.md §2, §3.1, §8, §11;
docs/design/gdd/readability.md; docs/design/gdd/mvp.md; moodboard in assets-src/concept/moodboard/.

---

## 1. Look in one sentence

Bold, chunky, stylised high-fantasy pixel art in the spirit of Warcraft III and World of Warcraft:
exaggerated shapes (big hands, broad shoulders, oversized hats, staffs and weapons), rich saturated
colour, heroic with a little menace. Not childish (v1), not dark or grim (v2). Enemy deaths get
stylised, Warcraft-level elemental gore (§7.1); wizard deaths never do. The humour lives in the
writing (names, barks, Hat Hill).

**Value hierarchy:** the ground is the calmest layer (lower saturation and contrast); units are
bold, outlined and rim-lit; spells and FX are the brightest, most saturated things on screen.

### 1.1 What we take from the moodboard

| Reference | Take | Leave |
|---|---|---|
| `a_wise_old_wizard_with--1--ns7kx.webp` | **Wizard archetype:** grizzled veteran, long white beard, big wide-brimmed hat, gnarled flame staff, bold saturated rendering, glowing rune circle (portal, Convergence) | Teal rune colour (ours are arcane violet) |
| `pixel-art-wizard-with-staffs-vector-65770749.avif` | Beard spilling over the robe, hat dominating the silhouette, forked staff heads (Stormcaller) | Green hat (Hedge Druid reserved), dithering on characters |
| `lucid-origin_…goblin…jpg` | Chunky pixel goblin with crude leather and metal, bold shading | Shield and plate (too much detail), orc-like bulk |
| `green-goblin…jpg`, `pngtree-green-goblin…png`, `d6c4ed15…webp` | **Huge ears**, sneer, sharp teeth, glowing eyes, long arms, attitude | Goofy grins, red bandanas and war paint (fire family), purple cloaks (arcane) |
| `generative-ai-medieval-style-village-pixel-art-…webp` | Camera angle, chunky round tree canopies, timber and thatch for the hut, a colourful but readable world | Grass this saturated (ours is calmer than the units) |
| `f462871d…jpg` (hobbit hole) | Rich, warm terrain colour and pixel texture; log fences | Watermark; yellow-green lit grass (goblin clash) |
| `132132.jpg` | Colour ambition: saturated accents against a calmer world | Painterly rendering |
| `e41081a3…jpg`, `Dead-Cells (1).jpeg` | Only the principle: hero colour against a calmer backdrop | Darkness, fog, side view |

---

## 2. Scale and grid

Logical view **640 × 360** (40 × 22.5 tiles), integer scaling, nearest neighbour. Tiles **16 × 16**.
Characters **48 × 48** (3 × 3 tiles).

| Thing | Canvas (px) | Visible footprint | Notes |
|---|---|---|---|
| Tile | 16 × 16 | full | |
| Wizard (all classes) | 48 × 48 | ~20 w × 31 h body+head, plus hat; brim up to 28 w | §6. Anchor (24, 46). |
| Goblin Grunt | 48 × 48 | ~28 × 26 body; raised weapon to ~34 h | Body (weapon excluded) never taller than a wizard's body+head (31 px) |
| Goblin Archer | 48 × 48 | ~22 × 28 incl. bow | |
| Dropped hat (per class) | 24 × 24 | ~18 × 14–18 | |
| Powder Keg | 32 × 32 frame | barrel art ~20 × 24 | **16 × 16 (1-tile) collision** (matches mvp.md §8, readability.md §4) |
| Goblin Hut | 64 × 96 | 4 × 4 tile footprint (64 × 64); ≤ 96 tall intact, **≤ 32 tall rubble** | |
| Portal | 128 × 128 | arch on a 4 × 4 tile base; rises 64 px above the base | Rune sockets ≥ 9 × 9 |
| Trees | 48 × 64, 64 × 96 | | Canopy above units, trunk is collision |
| Projectiles | 12 × 12 – 24 × 24 | spark ≤ 9 × 4, fire bolt ~9 × 9, arrow ~12 × 3 pale stroke, Fireball ≥ 15 | |
| Area FX | sized to mvp.md radii | Fireball 44, Combust 32, Kaboom 72, Arcane Detonation 64, Convergence 90/120/140 | Impact edge reaches the ring (hit rule: radius + body radius) |

- Pixel scale is **1:1**. No mixels, no non-integer scaling, no in-engine rotation of character art.
- Anchor for all 48 × 48 characters: **(24, 46)**.

---

## 3. Camera angle and light

- **Camera:** top-down 3/4 (oblique ~45°). Not isometric, not side view.
- **Directions:** 4 — down, up, side (right; left is mirrored).
- **Key light:** warm, from the **top-left**. Shadows lean cool (blue-purple), never pure black.
- **Rim light on units:** 1 px light edge (the material's lightest tone) along the top-left of hats,
  shoulders, beards and weapons, inside the `ink` outline. readability.md §1.1: each unit's lit edge
  pixels are **≥ 50 luma above the floor average**.
- **Ground shadow:** engine-drawn ellipse (`ink`, ~40 % alpha), never baked.

---

## 4. Palette (38 colours, locked)

All art is quantised to these colours. Engine exceptions: white hit flash, alpha on shadows and glows.

**Saturation is reserved for gameplay** (readability.md §1.2): spells, FX, statuses, class accents,
gold. The ground is calmer than everything that moves. Never use a reserved family as decoration.

### Neutrals and outline
| Name | Hex | Use |
|---|---|---|
| ink | `#1a1020` | Outline on units, structures, props, enemy projectiles. Never pure black. Not on ground tiles. |
| dusk | `#33263f` | Deep cool shadow |
| slate | `#4f4a5e` | Stone and metal shadow |
| ash | `#807a8c` | Stone mid, beard shadow, smoke |
| bone | `#c4bcb4` | Stone light, beard mid, arrow shaft |
| cream | `#f4ecdc` | Beard highlight, rim light, eye glints. Units and FX only. |

### Skin (wizard base body)
| Name | Hex |
|---|---|
| skin-light | `#f0bf92` |
| skin-mid | `#c98558` |
| skin-dark | `#8a4f35` |

### Fire family — Pyromancer, fire FX, Burning, Kaboom
| Name | Hex |
|---|---|
| flame-white | `#fff4c2` |
| flame | `#ffab2e` |
| ember | `#f2581f` |
| crimson | `#c42a2a` |
| oxblood | `#6e1f17` (v3.1: shifted toward brown-red to keep it apart from blood) |

### Storm family — Stormcaller, sparks, Lightning
| Name | Hex |
|---|---|
| bolt | `#fff36b` (electric yellow-white) |
| cyan | `#6fe7ff` |
| azure | `#2f7fe0` |
| navy | `#1d3a8a` |

### Progress
| Name | Hex | Use |
|---|---|---|
| gold | `#f2b42a` | Lit portal runes, leader marker, HUD objective count. Nothing else. |

### Goblin family (bright lime, the v1 hue separation restored)
| Name | Hex |
|---|---|
| gob-light | `#b8d84a` |
| gob-mid | `#7fa632` |
| gob-dark | `#4a6b24` |

### Forest floor (cool, calm, lower saturation; never storm cyan or goblin lime)
| Name | Hex |
|---|---|
| moss-light | `#66907a` |
| moss | `#4f7a5f` |
| pine | `#3a5e4c` |
| deep-pine | `#284437` |

### Wood, leather, earth
| Name | Hex |
|---|---|
| tan | `#c8955a` |
| leather | `#8f5a34` |
| bark | `#5c3a24` |
| soil | `#3a2418` |

### Water (river, bog; teal, never storm cyan)
| Name | Hex |
|---|---|
| water-light | `#6aa3a8` (ripple highlights only) |
| water | `#3f7a8c` |
| water-deep | `#2a5470` |

### Blood family — enemy deaths only (v3.1)
| Name | Hex |
|---|---|
| blood-light | `#8e1c40` (wet highlight, 1–2 px only) |
| blood | `#5c1030` |
| blood-dark | `#350a1c` |

Blood is **dark, purple-leaning maroon** (hue ~335°), while fire is orange-red (crimson ~0°,
oxblood ~5°, ember ~16°). Blood is always darker than `crimson`, never has a near-white core, never
glows, never flickers, and is never used on wizards, props or tiles. That keeps it from reading as
Burning, a fire FX or the Pyromancer robe.

### Arcane family — bright magenta-violet (readability.md rev 2): Convergence beam core, Arcane Detonation, portal swirl
| Name | Hex |
|---|---|
| arcane-light | `#e07bff` |
| arcane | `#9a3fe0` |

### Value and hue checks (luma, 0–255)
- Floor: deep-pine ≈ 59, pine ≈ 79, moss ≈ 103, moss-light ≈ 129. Water ≈ 72–145, bluer than grass.
- Goblins: gob-light ≈ 190, gob-mid ≈ 141, both lighter than every floor colour; hue yellow-lime (~75°)
  versus a blue-green floor (~140°), and far more saturated.
- Wizards: beards (bone ≈ 189, cream ≈ 236) and rim light give lit edges ≥ 50 above the floor
  average. Robes: crimson ≈ 88 (Pyromancer) vs azure ≈ 114 (Stormcaller), one clear grayscale step.
- FX: flame-white, bolt, cyan, arcane-light, gold are the brightest saturated colours.

### Reserved for later classes
Pale ice blue (Frost Warden), leaf-green robes or hats (Hedge Druid), black and purple robes and
skulls on characters (Necromancer), glowing rune armour (Runesmith).

---

## 5. Outline, shading, glow

- **Units, structures, props, enemy projectiles:** 1 px `ink` outline plus top-left rim light.
  Interior lines may use the material's darkest tone.
- **Ground tiles:** no outline, no `ink`, no `cream`, no reserved family, lower saturation and
  contrast than units. Sparse 2-colour dithering allowed on tiles only.
- **Shading:** bold, chunky cel shading, 3–4 tones per material, big readable highlight shapes
  (Warcraft-style hand-painted look translated to clean pixel clusters). No noise, no pillow shading.
- **Hard edges:** no gradients, no anti-aliasing against the background, no baked glow on characters,
  no dithering on characters.
- **Glow (squad projectiles, spell FX, staff-tip beacon):** hard-edged stepped halo in the sprite plus
  engine additive blending. Enemy projectiles never glow: the arrow is a matte pale stroke with an
  `ink` outline.

---

## 6. Shared wizard base body: the heroic veteran

One body for every class: a broad, grizzled old battle-wizard with Warcraft proportions — **big
hands, broad shoulders, a barrel chest, a long full beard** to the belt, bushy eyebrows, a heavy robe
with a belt and pouches, and an **oversized gnarled staff** taller than the wizard. Classes change
only **hat, robe colour and staff head** (plan.md §3.1).

**Height budget in the 48 × 48 frame** (rows from the top):

| Part | Rows | Height |
|---|---|---|
| Stormcaller hat (very tall, crooked, wide brim) | 0–15 | 16 px |
| Pyromancer hat (tall straight cone, wide brim) | 5–15 | 11 px |
| Head + eyebrows, under the brim | 16–27 | 12 px |
| Beard | 22–35 | over the chest |
| Robe body, shoulders ~20 px wide | 28–43 | 16 px |
| Boots / hem | 44–46 | 3 px |

Pyromancer 42 px tall, Stormcaller 47 px: **5 px taller and crooked** (agreed with game-designer, D1).

- Face: weathered skin, big nose, bushy `bone` eyebrows, determined eyes (2 px with a `cream` glint).
  Stern and heroic, not cute, not grim.
- Beard: `cream` / `bone` / `ash`, full and long; its lit edge is part of the silhouette.
- Hands: big, chunky (3–4 px), clearly gripping the staff.
- Staff: gnarled `bark` / `leather`, knotted, oversized.

### Class sheet (MVP)

| | Pyromancer | Stormcaller |
|---|---|---|
| Hat | **Tall straight cone, very wide brim** (11 px), straight tip | **Very tall crooked hat with a zigzag kink** (16 px), wide brim |
| Hat colour | `crimson`, `ember` rim light, `oxblood` shadow, `flame` band | `azure`, `cyan` rim light, `navy` shadow, `bolt` band |
| Robe | `crimson` / `oxblood` with `ember` lights, `tan` or `leather` belt | `azure` / `navy` with `cyan` lights, `bolt` trim |
| Staff head | Gnarled wood holding a **big live flame** (`flame-white`, `flame`, `ember`) | Gnarled wood splitting into a **fork** with a crackling `cyan` / `bolt` spark |
| Staff-tip beacon (engine glow) | warm `flame` | cold `cyan` |
| Grayscale read | Shorter straight hat, darker robe | Taller crooked hat, lighter robe |

---

## 7. Goblins: mean, wiry, big-eared

- **Team read:** low, hunched, **horizontal**: **huge ears sticking out sideways** (the goblin cue;
  never hidden by a helmet), long arms, big hands and feet, crouched legs. Wiry, not bulky: no
  tusks, no orc mass (orcs are a post-MVP faction).
- **Face:** sneer, long hooked nose, sharp jagged `bone` teeth, small 2 px `flame` eyes under a
  heavy `gob-dark` brow. Mean, not goofy. Eyes are **static, no halo, and dimmer than the Burning
  core** (readability.md rev 3, R7), so Burning stays the only tall, bright, flickering orange on a
  goblin. Fallback if playtests confuse them: pale `bolt`-white eyes.
- **Skin:** `gob-light` / `gob-mid` / `gob-dark`, `ink` outline, rim light.
- **Gear:** goblin, wood and neutral families: `leather`/`bark` rags and straps, crude `slate`/`ash`
  metal, bone trinkets (no skulls). No fire, storm, gold or arcane colours except the eyes; no red
  scars or paint.

| | Goblin Grunt | Goblin Archer |
|---|---|---|
| Silhouette | **Wide crouched stance**, **oversized jagged cleaver or spiked club raised overhead**, ~28 × 26 body | **Narrow**, **hood** (ears still poking out), **long bow vertical along one side**, quiver, ~22 × 28 |
| Attack tell | Wind-up frame, weapon pulled far back | Bow-draw pose; 1–2 px `cream` arrowhead glint |
| Projectile | — | Arrow ~12 × 3 pale stroke: `bone` shaft, `slate` head, `ink` outline, matte |

### 7.1 Enemy deaths: elemental gore (v3.1)

Applies to **goblins only** (Grunt, Archer; later enemies follow the same rules). The death variant
is picked by the **element of the killing blow** (game-designer owns the rule and timings).
Stylised and chunky, Warcraft-level: readable shapes, no anatomy detail, no lingering on wounds.

Rules: docs/design/gdd/mvp.md §12a, readability.md §4a. **Frame-cost approach (agreed with
game-designer):** one shared collapse animation per enemy; the other variants come from a palette
remap, a single skeleton frame and engine FX.

| Killing element | Death | Ends in | Art cost |
|---|---|---|---|
| **Fire** | the shared collapse, **palette-remapped to charred** (`soil` / `dusk` / `ink`, 1–2 px `ember` cracks) with the Burning overlay on top | **Charred husk** corpse | recolour script, no new drawing |
| **Storm** | **one skeleton-flash frame** (120 ms), then the shared collapse | **Smoking corpse** | 1 drawn frame + engine `fx/electrocute`, `fx/corpse-smoke` |
| **Physical, arcane, Kaboom shrapnel** | the shared collapse + engine `fx/blood-burst` | **Slain corpse** + blood splat decal | engine FX only |

- **Skeleton flash exception (creative director approved, max 2 frames):** the x-ray skull is
  allowed only in the storm skeleton flash, which uses **1 frame** held 120 ms (`bolt` / `cream`
  skeleton on a `navy` silhouette). Skulls stay banned everywhere else.
- **Corpses never read as live** (readability.md §4a): flat, **≤ 14 px tall**, at least 50 %
  desaturated and darker than the live sprite (`gob-dark`, `soil`, `slate`, `dusk`; charred uses
  `dusk`/`ink`), eyes dark (no `flame` pixels), no weapon or bow raised. Still recognisably goblin
  (ears). Charred husk embers stop glowing after ~1 s (engine), so they never read as Burning.
- **Layer order (bottom to top):** ground → death decals → telegraph rings → corpses → live units →
  FX. Decals never cover a telegraph ring.
- **Death decals:** engine-spawned at runtime and pooled, **never** Tiled map decals. They live in
  the calm ground layer: low contrast, no outline, hard pixel edges, no gloss.
  - blood splat ~24–32 px (blood family only);
  - ash / scorch for fire and storm deaths (`soil` / `dusk` / `ash`);
  - one shared **crater** for ≥ 3 kills from one blast (`soil` / `dusk` / `bark` rim).
  Lifetime, fade and cap: game-designer.
- **Gore on/off setting (creative director approved):** with gore off, enemies use the shared
  collapse + the neutral grey `fx/death-puff`, with no decals, corpses, gibs, charred remap or
  skeleton frame. No extra art needed.
- **Gibs (creative director approved, including on Kaboom):** a gib **replaces** the death
  animation and corpse: the goblin bursts instantly into pieces. Trigger and counts are
  game-designer's data (mvp.md §12a: Kaboom, Volunteer! and Convergence hits ≥ 1.5 × max HP, at most
  4 gibbed goblins per blast; Fireball, Lightning, auto-attacks, Combust and Burning never gib). Each
  gib throws **3–5 pieces** (4 on average, the weapon always one of them), each ~6–12 px on a
  16 × 16 canvas, drawn from:
  - **weapon** (always one piece, so you can tell what died): Grunt axe head, Archer snapped bow half;
  - **1 ear**; **2 bones** (short knobbly bones, never a skull); **2 meat chunks** (rounded lumps,
    blood family with a `gob-mid` skin rim; no organ shapes).
  Ear, bones and meat are shared between Grunt and Archer. Matte, `ink` outline, no glow, no trail.
  Variants:
  - **bloody** (physical, arcane, Kaboom): drawn.
  - **charred** (fire) and **electrified** (storm): one blackened **palette remap** of the bloody
    set (`soil` / `dusk` / `ink`); electrified adds the engine's `fx/corpse-smoke` wisp.
  Gibs tumble through 4 pre-drawn spin frames (no arbitrary in-engine rotation of pixel art;
  `flipX` is fine), fly **300–450 ms with one bounce**, land in the corpse layer at corpse values
  (darker, desaturated), and fade with the gib lifetime.
  **Never read as projectiles:** short, high, tumbling arcs (arrows fly straight and never spin),
  landing ≤ 48 px from the death point, no pale shaft shapes longer than 8 px.
- **Wizard deaths stay non-gory:** collapse plus grey death puff and the dropped hat, whatever the
  killer's element. No blood, burn, skeleton or gib variants on wizards.
- **Readability:** gore is decoration and must never compete with gameplay reads. Blood decals and
  corpses stay below the value of living units and never use reserved gameplay hues at full
  saturation. Fire-death flames are short (they stop before the husk frame) so they don't read as a
  live Burning status.

---

## 8. Structures

### Goblin Hut (objective)
- **Intact:** a chunky Warcraft-style goblin hut: crooked timber frame, patched `leather`/`tan` hide
  and thatch roof, sharpened stakes, bone trinkets (no skulls), crooked chimney. Up to 96 px tall. A
  **lit doorway** (`flame` core, `flame-white` centre) as a static shape, plus an `ash`/`bone` smoke plume.
- **Destroyed:** collapsed rubble **≤ 32 px tall**, same 4 × 4 footprint, darker, no glow, no plume.

### Powder Keg
- **32 × 32 frame, barrel art ~20 × 24, 16 × 16 collision.** Banded `leather`/`bark` barrel with
  `slate` hoops, a thick `ink` powder band, a `cream` bomb stencil and a fuse stub. The only barrel in
  the game; no skull.

### Portal
- **Sealed:** an ancient stone arch (`slate`, `ash`, `bone`) on a 4 × 4 tile plinth, carved, heroic,
  a landmark. Two dark rune sockets (`dusk`, ≥ 9 × 9).
- **Rune lit:** `gold` with a `flame-white` centre.
- **Open:** bright `arcane` / `arcane-light` swirl with a `cream` core. Extraction ring and edge arrow
  are engine-drawn in `gold`.

---

## 9. Forest tiles and props (Goblin Woods)

A rich, colourful but calm forest. **Walkable ground is lighter and flatter than blockers; water is
bluer than both.** Level rules: corridors ≥ 5 tiles, open 8–9, so fills need variety (5 grass
variants, 3 tree-wall fills).

- **Ground:** `moss` / `moss-light` grass with `pine` tufts; low contrast. Never goblin lime, never cyan.
- **Dirt road:** `tan` / `leather` / `bark`, rutted.
- **Blockers** (outlined in `ink`): chunky round-canopy trees (`pine` / `deep-pine` with `moss-light`
  rim, `bark` trunks), mossy boulders, logs, cliffs.
- **Accents:** small `bone`/`tan` flowers and mushrooms, ferns. No fire, storm, gold or arcane hues
  on the ground or decorative props.
- **Goblin camp:** stakes, hide tents, drying racks, square crates, sacks, loose bones, cold ash fire
  rings with a grey smoke wisp. Cloth in `leather`/`tan`/`dusk`, never red or purple.
- **Water and bog:** water family only. **Map decals (Tiled):** scorch and mud in `soil`/`dusk`; no hats, no blood. Blood splats are
runtime engine decals only (§7.1).

---

## 10. Engine-drawn overlays (not in sprite frames)

Leader marker (`gold` pulsing ground ring **27 × 12**), health bars (**24 × 3** wizard, **18 × 3**
enemy, **48 × 4** hut), staff-tip beacon glow (class colour), Burning overlay sprite, Volunteer
blinking outline and fuse ring, keg fuse ground ring (Kaboom radius 72), Lightning reticle (~20 px,
strike radius 8), Convergence aim ring, extraction ring, off-screen portal arrow, hit flash, ground
shadows. Flash safety per readability.md §1.7.

**Burning overlay rule:** each flame tongue has a 1 px `ink` outline, an `ember` body and a
`flame-white` core, and rises above the head line so it reads on lime goblin skin and in grayscale.

**Gold on grass (readability.md rev 3 §1.4):** the leader marker, extraction ring and keg blast ring
are drawn with a 1 px `ink` outline (inside and outside the stroke), so gold and red read on bright
grass and dirt.

**FX core rule (readability.md rev 3 §1.6):** every gameplay FX has a near-white core
(`flame-white`, `bolt`, `cream`) plus a darker or saturated edge step of its family, so it reads on
both grass and dirt.

---

## 11. Tone and banned traits

**Yes:** heroic grizzled veterans, big hats and beards, chunky hands and staffs, mean big-eared
goblins with oversized weapons, a rich colourful forest, magic as the brightest thing on screen.

**Banned:**
- Gore on wizards, props, tiles or in Tiled map decals. Enemy gore only as defined in §7.1.
- Realistic or detailed anatomy, exposed organs, dismemberment beyond §7.1, gore that lingers on
  screen longer than game-designer's decal lifetime.
- Skulls on characters (except the 2-frame storm skeleton flash, §7.1) and on props.
- Childish or cute: chibi heads, big round eyes, toddler proportions, goofy grins (v1).
- Dark and grim: near-black worlds, heavy desaturation, fog, horror mood (v2).
- Photorealism, painterly brush texture, 3D render look, soft gradients, blur, baked bloom.
- Anti-aliased or semi-transparent sprite edges; mixels; non-integer scaling.
- Pure black (`#000000`); colours outside §4.
- Isometric or side-view perspective; baked shadows.
- Text, letters, logos or watermarks.
- Reserved hues as decoration; purple, pale-blue or green robes on MVP wizards.
- Orc-like goblins (tusks, bulk, helmets hiding the ears); goblins in floor green.
- Any barrel other than the Powder Keg; lit campfires or torches as decoration.

---

## 12. Agreements and open answers

| # | Item | Agreed value | With |
|---|---|---|---|
| D1 | Wizard heights | body+head ~20 × 31; Pyromancer 42, Stormcaller 47 (5 px taller, crooked) | game-designer |
| D2 | Goblin size | Grunt ~28 × 26 (weapon to ~34), Archer ~22 × 28; goblin body ≤ 31 px | game-designer |
| D3 | Overlays | leader ring 27 × 12; bars 24 × 3 / 18 × 3 / 48 × 4; sockets ≥ 9 × 9; spark ≤ 9 × 4; arrow ~12 × 3; Fireball ≥ 15 | game-designer |
| D4 | Radii | view stays 640 × 360; radii re-tuned in mvp.md: Fireball 44, Lightning 8 (+ ~20 px reticle), Combust 32, Kaboom 72, Arcane Detonation 64, Convergence 90/120/140, extraction 112 (pending approval) | game-designer, producer |
| D5 | Hue families | unchanged; arcane is bright magenta-violet; ground never cyan or goblin lime | game-designer |
| D6 | Footprints | hut 4 × 4 (64 × 96 sprite, rubble ≤ 32); portal 128 × 128 on 4 × 4, anchor point.y + 32; keg 32 × 32 frame, ~20 × 24 art, 16 × 16 collision | level-designer, game-designer |
| D7 | Corridors | min 5 tiles, chokes 5, open 8–9, ravine floor 6, bridge deck 5 wide, ledge gaps 3 | level-designer |
| D8 | Trees | props 48 × 64 / 64 × 96; canopy overhang ≤ 3 tiles, never over a corridor's central 3 tiles | level-designer |

Answers to readability.md rev 2 open questions (sent to game-designer):
- **R6 squad light pool:** dropped by both sides.
- **R7 goblin eyes:** agreed: 2 px `flame` eyes under a dark brow, static, no halo, dimmer than the
  Burning core (§7). M8 playtest item; fallback pale yellow-white.
- **R8 veteran look vs rookie writing:** escalated to the producer as a creative-director decision.
  Art follows the veteran look.
- **readability.md rev 3** (bright world) reconciled 2026-10-13: ground is the calmest layer (§4,
  §9), peak saturation reserved for gameplay (§4), goblin lime vs cool floor (§4, §7), dark outline on
  everything that matters (§5), FX near-white core rule and outlined gold rings (§10). The luma
  rule in §3 stays as an extra measurable check.

---

## 13. Higgsfield prompt block

Generate upscaled pixel-art sheets on a flat background; tech-artist downsamples (nearest neighbour)
and quantises to §4.

```
STYLE: stylised high-fantasy 16-bit pixel art game sprite in the spirit of Warcraft III and World of
Warcraft art, top-down 3/4 view (oblique, like classic SNES action RPGs), bold chunky exaggerated
shapes (big hands, broad shoulders, oversized hats and weapons), rich saturated colours, heroic with a
little menace, crisp hard square pixels with no anti-aliasing, low resolution chunky pixels, 1-pixel
dark outline around every silhouette, thin rim light on the top-left edges, bold cel shading with 3-4
tones per material, warm light from the top-left with cool shadows.
BACKGROUND: perfectly flat solid magenta #FF00FF background, no ground, no cast shadow, no scenery,
no gradient, no vignette.
LAYOUT: sprite sheet, figures evenly spaced on an invisible 2x2 grid, same scale for every figure,
each figure fully visible and not overlapping, no text, no labels, no frame borders.
AVOID: photorealistic, 3D render, painterly, blur, soft gradient, glow halo, bloom, anti-aliasing,
isometric, side-scroller view, text, watermark, signature, gore, blood, skulls, chibi, cute, big eyes,
dark gloomy, desaturated, barrels, extra limbs.
```

For enemy death sheets (§7.1) only, drop `gore, blood` (and `skulls` for the storm skeleton flash)
from AVOID, and add: `stylised chunky game gore, no realistic anatomy, no organs`.

Background key: magenta `#FF00FF` for characters and props; pure green `#00FF00` for violet FX and
portal art. Tiles: a flat top-down sheet, no key colour, with this STYLE line:

```
STYLE: stylised high-fantasy 16-bit pixel art game tileset in the spirit of Warcraft III and World of
Warcraft, top-down 3/4 view (like classic SNES action RPGs), rich colourful forest with a calm,
lower-saturation ground, chunky round shapes, crisp hard square pixels with no anti-aliasing, low
resolution chunky pixels, bold cel shading with 3-4 tones, warm light from the top-left.
```

Asset sections:

- **Pyromancer:** `SUBJECT: one grizzled, heroic old battle wizard with Warcraft proportions: broad
  shoulders, barrel chest, big chunky hands, long full grey-white beard reaching his belt, bushy
  eyebrows, determined eyes, a tall PERFECTLY STRAIGHT crimson-red cone hat with a very wide brim and an
  orange band (tip points straight up, no bend), heavy crimson robe with a leather belt and pouches,
  an oversized gnarled wooden staff taller than him holding a big live orange flame at the top. Same
  character shown facing down, facing up, facing right, and a casting pose with the staff raised.`
- **Goblin Grunt:** `SUBJECT: one mean, wiry goblin warrior with Warcraft proportions: bright lime
  green skin, HUGE ears sticking straight out sideways, long hooked nose, sneering mouth with sharp
  jagged teeth, small glowing orange eyes under a heavy brow, hunched wide crouching stance, long arms
  with big hands and feet, ragged brown leather straps and a crude scrap-metal shoulder piece, an
  oversized jagged cleaver raised overhead. No helmet, no tusks. Same goblin shown facing down, facing
  up, facing right, and a wind-up attack pose.`
- **Forest tiles:** `SUBJECT: top-down forest tileset sheet on a square 16x16 grid, no characters:
  five calm cool-green grass variants, a rutted brown dirt road with straight, corner and T pieces
  blending into grass, a dense wall of chunky round-canopy trees seen from above with edge and corner
  pieces, mossy boulders, a fallen log, ferns, small pale flowers, a river of teal water with grassy
  banks. Ground calmer and less saturated than the props; trees darker than the ground; water bluer
  than the grass.`

Record model, full prompt, seed and references in assets-src/PROVENANCE.md for every generation.

---

## 15. Locked references (creative-director gate, 2026-10-13)

Every new prompt for these assets attaches the matching locked reference image(s).

| Asset | Locked reference | Notes |
|---|---|---|
| Wizard base body (Pyromancer, and Stormcaller by reuse) | `assets-src/concept/style-lock/pyromancer/v2.png` ("Stout": braided beard with iron rings, bracers, satchel, scowl, split-wood flame staff) | Cleanup: brass buckles must not map to `gold` |
| Goblin (Grunt, and the Archer's body) | `assets-src/concept/style-lock/goblin-grunt/v3.png` ("Axe": black hair tuft, riveted leather vest, two-handed axe, bowed legs) | Mohawk accepted; ears stay the goblin cue |
| Stormcaller (locked 2026-10-14) | `assets-src/concept/style-lock/stormcaller/v1.png` ("Tall Bolt": Stout body, very tall lightning-bolt zigzag hat, two-pronged fork staff with a `bolt` orb and `cyan` sparks, `bolt` trim) | Cleanup: brass buckles (from the Stout body) must not snap to `gold`; map them to `tan`/`leather`. Hat must still measure 16 px at 48 × 48 (47 px total, §6). Orb and trim snap to `bolt`, never `gold`. |
| Goblin Archer (locked 2026-10-14) | `assets-src/concept/style-lock/goblin-archer/v2.png` ("Mantle": Axe goblin body, ragged tan hooded short cape, ears through holes in the hood, long vertical bow, hip quiver) | Cleanup: the ears come out through **holes in the hood** and must stay fully visible and outlined in every facing (the hood never covers the ear silhouette; §7 goblin cue). Hood and mantle snap to `tan`/`leather`, never floor green. Brass/metal bits never snap to `gold`. |
| Forest tiles | **All three sheets locked as one set:** `assets-src/concept/style-lock/forest-tiles/v1.png` (props and grass), `v2.png` (road, tree wall, river, bridge), `v3.png` (goblin camp) | tech-artist: at palette snap, **warm v2's blue-green grass slightly toward v1's olive** so the three sheets match. Still cooler and calmer than goblin lime. v3 bushes snap to the moss family. |

Non-selected v3 variations (Pyromancer v1, v3; Grunt v1, v2) stay in style-lock/ as alternates,
not references. Same for the 2026-10-14 concept pass: Stormcaller v2 "Crook", v3 "Stepped" and
Goblin Archer v1 "Hood", v3 "Hide Hood" are alternates, not references.

---

## 14. Acceptance checks (art-director, before handoff)

1. Viewed at 1× on a `moss` background and at phone size: class and team readable instantly.
2. Grayscale: Pyromancer vs Stormcaller vs Goblin by silhouette and value; lit edges ≥ 50 luma above
   the floor; goblin skin lighter than the floor.
3. Quantised to §4 without visible colour loss; goblin lime vs floor green clearly separate hues.
4. Light from top-left; outline unbroken; rim light; no baked shadow or glow on characters; no text.
5. Proportions match §6 and §7; feet on the anchor row; goblin ears visible from every facing.
6. Tone: heroic with menace. Not cute, not grim. Gore only on enemy deaths per §7.1; no reserved
   hue as decoration, no barrels.
7. Blood reads as blood, not fire: blood family only, darker than `crimson`, no bright core, no glow.
