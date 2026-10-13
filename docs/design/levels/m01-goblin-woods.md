# M01 Goblin Woods: level design

Owner: level-designer. Rules and numbers come from `docs/design/gdd/mvp.md`; tile and object contract from `docs/design/levels/tiled-conventions.md`.
All coordinates are pixels in world space, accurate to about one tile. Final positions live in the Tiled map; if the map and this file disagree the map wins and this file gets fixed.

## 1. Intent

A forest that teaches the whole kit in order: swarms and Kaboom (section 1), archers and Lightning (section 2), and a fighting retreat that asks for everything (section 3). The portal is seen across a river early, and reaching it requires the long way round. The player destroys Hut A, then Hut B in the far north-west, and then runs the length of the map back east under pressure.

Mission data (see section 8): squad `['pyromancer','stormcaller','pyromancer','stormcaller']`, `objectives: destroy goblin-hut x2`, `extraction.radiusPx: 112` (approved at the gate, Q8 change; trail is 78 px, portal trigger 24 px), `finalSurge: surge-01`.

## 2. Numbers the design depends on

| Fact | Value | Source |
|---|---|---|
| View | 640x360 px | GDD §0 |
| Squad speed | 110 px/s | GDD Q9 |
| Full trail length | 54 px | GDD §1 |
| Grunt / archer speed | 85 / 70 px/s | GDD §12 |
| Archer range | 220 px (squad outranged: 180/160) | GDD §12 |
| Kaboom | r 72, 60 dmg, half to wizards; chains within 80 px | GDD §8 |
| Hut | 300 HP, footprint 64x64 (4x4 tiles), active within 400 px, 1 grunt/6 s, max 4 alive | GDD §12 |
| Meter | start 40, +4/kill, +0.1/dmg, +10/hut, +50 at portal open | GDD §9 |
| Surge-01 | 12 grunts + 4 archers over 8 s, max 12 on screen; no spawn within 160 px of a wizard | GDD §12 |
| Extraction | radius 80, leader trigger 16 | GDD §13 |

## 3. Map

- 128 x 96 tiles = 2048 x 1536 px. One long loop: start SW, Hut A south-centre, Hut B far NW, portal east across a river.
- River: x 1536-1616 (5 tiles wide), full height, impassable (in `blockers`). It ends at the map edges, so there is no way around. One crossing: the **Old Bridge** at y 264-344 (5 tiles wide = 80 px, 80 px long plus ramps).
- Route centreline is a 9-tile wide forest road (144 px) wherever possible, never narrower than 5 tiles (80 px). Units are 48x48 (3 tiles), so the old 3-tile chokes no longer fit a unit plus a follower.
- **Scale update (48 px units).** At the unchanged 640x360 view a 48 px unit is 7.5% of the screen width, so the view shows about 13 units across. Distances in this doc are not rescaled (ranges and speeds are in px and owned by game-designer); corridors, chokes, ledge gaps and clearances are widened instead. Producer decision: the view stays 640x360 (it may change at the creative director's exit gate; the producer will say). The layout works at either size; at 640x360 the Ravine and Bridge fights are tight by design.
- Footprints of hut, keg and portal follow `src/data/structures.ts` and art-director's sheet; confirmed by art-director and game-designer: hut 4x4 tiles (64 px), portal base 4x4 with a 128 px canvas, keg 1-tile collision with a 32x32 sprite. Bridge deck and chokes are 5 tiles (GDD asks at least 4).

### Sketch (1 char = 64 px, 32 x 24 cells; north up)

```
col  0         1         2         3
     01234567890123456789012345678901
r00  TTTTTTTTTTTTTTTTTTTTTTTTWWTTTTTT   T tree wall   W river
r01  TTTTTTTTTTTTTTTTTTTTTTTTWWTTTTTT   . open ground  = road / path
r02  TTTTTTTTTTTTTTTTTTTTTTTTWWTTTTTT
r03  TT.......TTTTTTTTTTTTTTTTWWTT..TT   (E bank, north)
r04  T.. B ...====================B==>E.. [BR] Old Bridge at c24-25, r4/5
r05  T.......=.s2...==s3=.....ss=WW.....
r06  TTTT..TT=.=TTT..=TTT...==TTWW..|..T   | = east-bank path S to portal
r07  TTTTTTTT=.=TTTTTT=TTTT.=TTTWW..|..T
r08  TTTTTTTT=.=TTTTTT=TTTTTTTTTWW..|..T
r09  TTTTTTTTT.=Ra....Rb.TTTTTTTTWW..|..T   R = ravine ledges (archers)
r10  TTTTTTTTTTT=.....=TTTTTTTTTWW..|..T
r11  TTTTTTTTTTT=.....=TTTTTTTTTWW..|..T
r12  TTTTTTTTTTT=T...T=TTTTTTTTTTWW.P...   P = portal (sealed), east bank
r13  TTTTTTTTTTT==...==TTTTTTTTTTWW.....
r14  TTTTTTTTTTTTT=====~~~~~~~~~~TWW..TTT
r15  TTTTTTTTTTTTTT====.........A.WW..TTT   A = Hut A clearing (c19-23)
r16  TTTTTTTTTTTTTTTTTT.........  WW..TTT
r17  TTTTTTTTTTTTTTTTTT.........TWW..TTT
r18  TTTTTTTTTTTTTTTTTTTTTTTTTTTTWW.TTTT
r19  TTTTTTTTTTTT.....==.TTTTTTTTWWTTTTT
r20  TTTT=====F=======...TTTTTTTTWWTTTTT   F = Ford choke (c9-10, r20)
r21  TT S ====F~~~Mdw....TTTTTTTTWWTTTTT   S = squad start, M = meadow pack
r22  TT...==..TTTTTTTTTTTTTTTTTTTWWTTTTT
r23  TTTTTTTTTTTTTTTTTTTTTTTTTTTTWWTTTTT   (river meets lake in the south)
```

The ASCII is a topology sketch, not to scale in every corner. Authoritative numbers are the coordinate tables below.

Route in words (sections follow the GDD's three-section split):

1. **Hollow Road** (section 1): Start (192,1344) -> east along the road -> **Ford choke** (640,1300, 5 tiles wide) -> **Fallen Log Meadow** (700-1000, 1150-1300) -> **Bramble Path** NE -> **Hut A clearing** (1420,980) on the west river bank.
2. **Ridge Pass** (section 2): Hut A -> west along the Bramble Path (1300,940 -> 1000,900) -> north through the **Ravine** (floor x 752-848 = 6 tiles, y 480-860) with archer ledges on both sides -> **Drum Hollow** (rear ambush site, 800,560) -> Gallery west end -> **Bog clearing** (130-580, 190-580) with **Hut B** at (330,360).
3. **Fighting Retreat** (section 3): Hut B -> east along the **Gallery** (y 240-440, x 600-1536, about 1200 px) -> **Old Bridge** (1536-1616, 300) -> east bank, then south along the **Rune Path** to the **portal** (1720,760) (about 450 px).

### Sealed portal visibility

- The portal sits on the east bank at (1720,760), 100 px east of the river, and is the biggest object on the map (4x4 tile base, arch about 128 px, rune ring, glow).
- First sight: from the Hut A clearing the player at x >= 1420 sees it across the river (dx about 300, dy about 140). Rocks are not placed in that sight line.
- Earlier cues (approved at the gate, built when their milestone opens): (a) a 3 s skippable camera pan start -> portal -> start at mission begin; (b) an off-screen indicator for the **sealed** portal, not only the open one. Without them the portal is first visible at roughly the 2 minute mark.
- The two dark runes are shown from the start (GDD §13).

## 4. Beat chart

Times assume a competent but cautious player; the fast estimate is in brackets. Convergence uses: C.

| # | Beat | Type | Place | Intent | Enemies | Props | Time | C |
|---|---|---|---|---|---|---|---|---|
| **Section 1: Hollow Road (teach)** |
| 1.1 | Safe Landing | teach | Start, safe-start 10x10 tiles | Show the squad, movement and auto-attack with zero pressure. First look at the camera. | none | stumps, path | 0:20 | - |
| 1.2 | Two Strays | teach | Road (400,1320) | First fight: two grunts stroll up. Auto-attacks do all the work. Pyromancer Burning shows, Stormcaller spark pops it (Combust) by accident. | 2 grunts | log pile | 0:25 | - |
| 1.3 | The Ford | teach | Ford choke (640,1300) + Log Meadow | Teach **Kaboom**. The grunt pack waits in the meadow beyond a 5-tile choke, and a chained keg pair sits beside their rally point. Aim Fireball at the kegs. | 5 grunts (group `grunts-meadow`) | 2 kegs (chain) | 0:40 | - |
| 1.4 | Stray Cut-through | teach | Meadow edge (1000,1180) | Teach **Combust** on purpose: three grunts mill about with a lone keg in reach of Lightning. Lightning on a Burning grunt. | 3 grunts | 1 keg | 0:30 | - |
| 1.5 | Hut A | test | Hut A clearing (1420,980) | First hut. Door glow tells the spawn; the squad learns to ignore spawn trickle or burst the hut. Portal is seen across the river. Keg pair 48 px from the hut NW corner softens it by 40% (2 x 60 of 300 HP). | Hut A: first grunt at 1.5 s after activation, then 1 per 6 s, max 4 | 3 kegs (2 near hut, 1 at the Bramble Path mouth) | 1:00 | **1** (meter reads about 90-100 on arrival) |
| 1.6 | First Rune | payoff | Hut A | Rune 1 lights (HUD "Huts 1/2"). A short quiet walk west. | - | - | 0:20 | - |
| **Section 2: Ridge Pass (test, then twist)** |
| 2.1 | Lone Archer | teach | Bramble Path west (1000,900) | Teach **Lightning snipe**: one archer on a ledge outranges the squad (220 vs 180/160). The choice: push in or Lightning. | 1 archer (`archer-bramble-01`) | stump cover | 0:25 | - |
| 2.2 | The Ravine | test | Ravine x 760-840, y 480-860 | Test push-and-snipe: two archers on opposing ledges, each beside a keg (Lightning on the keg kills the archer plus anything near). A small grunt group blocks the floor of the ravine so the squad stays put to fight. | 2 archers (`archer-ravine-01/02`), 3 grunts | 2 kegs (one per ledge) | 0:50 | **1** (optional, meter about 100) |
| 2.3 | Drum Hollow (twist) | twist | Ravine top (800,560) | Ambush from behind: once the leader passes a trigger, 6 grunts activate in the ravine mouth behind the squad. The squad is trapped between ambush and Hut B. A keg in the ravine choke detonates under them if the player turns and aims. | 6 grunts (`grunts-ambush`) | 1 keg at the ravine exit | 0:45 | - |
| 2.4 | The Bog and Hut B | test | Bog clearing, Hut B (330,360) | Hut B is guarded by 2 archers on the flanks and a steady spawn. The player must choose: clear flanks first, or burst the hut. Meter banked from the Ravine decides if C is available for the climax (see pacing notes). | Hut B + 2 archers (`archer-bog-01/02`), hut grunts | 3 kegs (2 at entrance flanks, 1 behind the hut) | 1:10 | **0-1** |
| **Section 3: Fighting Retreat (climax)** |
| 3.1 | The Lock | climax | Hut B | Last rune lights. Portal opens (1.5 s sequence, burst). **Surge-01 spawns** from the 5 surge points (below). HUD arrow to the portal appears. | surge starts | - | 0:10 | - |
| 3.2 | The Gallery | climax | Gallery (600-1536, 240-440) | Fighting retreat east. Grunts from behind (4), two flank pockets fire out of the tree line at mid-range, each next to a keg for a Kaboom reward. The player must keep the trail together: stragglers hit the 112 px radius edge. | 4+6 grunts, 2 archers | 4 kegs on the flank clearings | 1:20 | **1** (needs meter; ideally saved) |
| 3.3 | The Bridge | climax | Old Bridge (1536-1616, 300) | The choke. 2 grunts and an archer at the west bridge head, and 2 archers on the east bank beyond the bridge. A chained keg pair at the west head and one on the east bank. Volunteer! has its best use here (a rookie dashes the bridge head). | 2 grunts, 3 archers | 3 kegs | 0:40 | optional |
| 3.4 | Rune Path | climax | East bank (1550-1720, 330-760) | Open run south to the portal (about 450 px, 4 s). Remaining pursuit spills over the bridge. The leader enters the portal while the 112 px radius decides who is saved. | pursuers | none | 0:20 | - |
| **Totals** |  |  |  |  | about 55 enemies | 16 kegs | **about 9:00 cautious, about 6:00 fast** | **3-4** |

Time breakdown of the cautious run: section 1 about 3:15, section 2 about 3:30, section 3 about 2:30 (includes the surge).

### Beat intents for reviewer playtests

| Beat | Should feel like |
|---|---|
| 1.1 | Calm. "I steer one wizard, the others follow." Nothing attacks for 20 s. |
| 1.2 | Easy and slightly funny; squad handles it alone. |
| 1.3 | "Oh, those barrels." A single aimed Fireball wipes most of the pack and the player grins. |
| 1.4 | Combust reads as a deliberate trick, not an accident. |
| 1.5 | A first real fight. Spawn trickle is manageable. The portal on the far side feels like a promise. |
| 2.1 | Annoyance that resolves with one Lightning cast ("snipe"). |
| 2.2 | Tense but fair: a moving squad dodges most arrows; the Lightning/keg shot is a reward. |
| 2.3 | Surprise and a spike of panic, then a keg turns it around. |
| 2.4 | The hardest fight before the end; success feels earned. |
| 3.1 | A big moment: portal bursts open, enemies pour in, the music of the retreat begins. |
| 3.2 | Running and shooting. Wizards fall behind unless the player stays tight. |
| 3.3 | The pinch point. Win it with Convergence, Kaboom or a rookie. |
| 3.4 | Relief with a sprint. Someone almost gets left behind. |

## 5. Encounter objects (spawns)

Group ids are Tiled `group` values (conventions §4.1). Counts are enemy counts at that point; hut spawns are on top.

### Section 1

| name | type | enemy / count | position | notes |
|---|---|---|---|---|
| `squad-start` | squad-start | - | (192,1344) | facing e |
| `grunts-stray-01` | enemy-spawn | grunt x2 | (460,1320) | radius 24, active at start |
| `grunts-meadow-01` | enemy-spawn | grunt x5 | (900,1180) | radius 48; rally point is 120 px east of the keg pair |
| `grunts-cut-01` | enemy-spawn | grunt x3 | (1060,1170) | radius 40 |
| `hut-01` | goblin-hut | - | (1420,980) | `runeIndex` 0, activateRadius 400 |

### Section 2

| name | type | enemy / count | position | notes |
|---|---|---|---|---|
| `archer-bramble-01` | archer-post | archer | (1010,880) | faces east, holdRadius 24 |
| `archer-ravine-01` | archer-post | archer | (720,640) | west ledge, 48 px from `keg-07` |
| `archer-ravine-02` | archer-post | archer | (880,760) | east ledge, 48 px from `keg-08` |
| `grunts-ravine-01` | enemy-spawn | grunt x3 | (800,780) | floor of the ravine |
| `trig-drum` | trigger zone | - | rect (760,520,80,48) | event `activate-group` group `grunts-ambush` |
| `grunts-ambush-01` | enemy-spawn | grunt x6 | (800,860) | `trigger` = `trig-drum` (appear behind the squad, ravine mouth) |
| `archer-bog-01` | archer-post | archer | (450,250) | north flank of Hut B entrance |
| `archer-bog-02` | archer-post | archer | (450,470) | south flank |
| `hut-02` | goblin-hut | - | (330,360) | `runeIndex` 1 |

### Section 3: surge-01 (12 grunts + 4 archers)

All use `wave: surge-01` and aggro always (see pacing note 3). Surge points are ahead of and beside the retreat, so outrunning is not a plan.

| name | position | enemy / count | delayMs | role |
|---|---|---|---|---|
| `surge-rear-01` | (200,360) | grunt x4 | 0 | chasers from the Bog; keep the squad moving |
| `surge-mid-n-01` | (1000,200) | grunt x3 + archer x1 | 2000 | north flank pocket of the Gallery |
| `surge-mid-s-01` | (1100,500) | grunt x3 + archer x1 | 4000 | south flank pocket; `keg-13/14` here |
| `surge-bridge-w-01` | (1480,300) | grunt x2 | 6000 | the bridge head blockers; `keg-15/16` here |
| `surge-bridge-e-01` | (1680,320) | archer x2 | 8000 | the east-bank guard, outranging the bridge |

Total 12 grunts, 4 archers.

## 6. Kegs

Keg footprint per structures data (was 16x16; may grow with the 48 px scale). All kegs are at least 112 px from the route centreline (GDD asks 96; r72 plus half a unit is 96, I keep 16 px margin where terrain allows) and at least 192 px from `squad-start`. Chain pairs keep centres 32-48 px apart (chain range is 80 px; 32x32 sprites must not overlap). None sits on the route at spawn time. Chain = intentionally within 80 px of another.

| name | position | purpose |
|---|---|---|
| `keg-01`, `keg-02` | (784,1148), (784,1188) | **First lesson.** Chain pair beside the meadow pack's rally point; 112 px from the road line (y 1300). |
| `keg-03` | (1090,1130) | Lightning-on-keg alongside the Combust demo grunts. |
| `keg-04`, `keg-05` | (1380,940), (1396,988) | Beside Hut A's NW corner; 40% hut damage plus the guards. |
| `keg-06` | (1250,990) | At the Bramble Path mouth; punishes spawn-camping grunts. |
| `keg-07`, `keg-08` | (740,650), (870,770) | Under the ravine archers. Lightning/Fireball on the keg kills the archer. |
| `keg-09` | (800,880) | Ravine mouth: punishes the Drum Hollow ambush. |
| `keg-10`, `keg-11` | (420,300), (420,420) | Bog entrance flanks, close to the bog archers. |
| `keg-12` | (260,360) | Behind Hut B, a late choice for the finishing blow. |
| `keg-13`, `keg-14` | (1100,520), (1130,532) | Chain pair in the south flank pocket of the Gallery. |
| `keg-15`, `keg-16` | (1470,340), (1486,356) | West bridge head, chain pair. |
| `keg-17` | (1650,340) | East bank, beside the surge archers. |

17 kegs. Cut `keg-03` and `keg-12` first if playtests show kegs are too plentiful.

## 7. Obstacles and terrain

- Tree walls (`blockers`) frame all corridors; the Ford choke and the Old Bridge are the only 5-tile gaps. All other corridors are 6-9 tiles and the Gallery and meadows are wider.
- Ledge lines in the Ravine: a one-tile row of trunks with 3-tile gaps (a 48 px unit's width), so arrows and Lightning telegraphs are not fully blocked but cover breaks line of sight. Fireball explodes on trunks (per GDD, collision tiles stop projectiles), so aiming at the gap matters.
- Fallen logs and stumps are `prop` decoration with partial `blockers`.
- Hut footprint (planned 4x4 tiles, was 3x3) in `blockers` under each hut; rubble keeps the same footprint (GDD Q16).
- Water tiles in `blockers`.
- `canopy` overhangs along the Gallery north edge give depth; no gameplay effect.

## 8. Mission data sketch (for `src/data/missions/m01-goblin-woods.ts`, written at M7)

```ts
objectives: [{ kind: 'destroy', target: 'goblin-hut', count: 2 }],
extraction: {
  kind: 'portal',
  spawnId: 'portal',
  radiusPx: 112,                     // GDD Q8 re-scaled for 48 px units (78 px trail); plan example said 48
  finalSurge: { waveId: 'surge-01', spawnPoints: 'all-remaining' },
},
squad: ['pyromancer', 'stormcaller', 'pyromancer', 'stormcaller'],
```

Map objects: `squad-start`, `portal` (1720,760), `hut-01`, `hut-02`, `keg-01..17`, `surge-*`, and the spawn and trigger objects above. Sections are `section` zones: `sec-01` Hollow Road, `sec-02` Ridge Pass, `sec-03` Fighting Retreat.

## 9. Pacing notes and open items

1. **Length.** With the GDD numbers, walking totals about 1 minute and a hut dies in under 10 s, so about 55 enemies in 13 encounters are needed to reach about 9 minutes. Fast play is about 6 minutes. Reviewer measures.
2. **Meter (resolved, GDD Q20).** `chargePerHutDestroyed` stays 10; `convergence.chargeOnPortalOpen` = 50 is added at `portal:opened`, so the surge always starts with at least half a meter. Beats 3.1 and 3.2 assume this.
3. **Surge reach (resolved, GDD §13).** Surge enemies use `aggro: 'always'` and converge from spawn. New rule: no surge enemy spawns within 160 px of any wizard (`surge.minSpawnDistancePx`); a skipped point's share moves to the next one. Surge points are at least 600 px from Hut B and from the bridge approach the squad is on, so skips should be rare; `surge-bridge-e-01` is the only point that can be skipped late if the squad is already on the bridge, and its archers then shift to the nearest remaining point.
4. **Sealed portal visibility.** Camera pan and off-screen sealed-portal arrow are approved at the gate.
5. **Tiled `trigger` and `hut` property overrides** are new conventions game-dev has to implement.
6. **Art lists** (forest ground, blockers, canopy, river, bridge, hut, keg, portal) go to `art-director` as a separate message.
