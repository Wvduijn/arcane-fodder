# GDD — Readability brief (MVP)

Owner: game-designer. Audience: art-director (style guide, concepts), tech-artist (sprites, FX).
Gameplay numbers referenced here live in docs/design/gdd/mvp.md.

This file says **what the player must tell apart, and how fast**. How it looks (palette values,
outline colour, shading style) is the art-director's call in assets-src/style-guide.md. Where I
name a hue, read it as a gameplay requirement ("these two must differ in hue family"), not a final
colour.

**Revision 3 (2026-10-13), creative-director direction change:** a brighter, colourful
Warcraft-style look (chunky stylised shapes, rich saturated colours). Sizes are unchanged: **48×48**
characters on a 16 px grid, 640×360 view (rev 2 sizes, agreed with art-director). The dark-world
rules from rev 2 are removed or softened. The main risk is back to **"busy"**: a colourful world
where everything competes, and green goblins on a green forest floor.

## 0. Viewing conditions

- Logical view: **640×360**, characters in **48×48** frames on a **16 px** tile grid, integer
  scaling, no smoothing. On a phone in landscape, one game pixel can be about 2 device pixels.
  Design for the phone.
- A busy fight: 4 wizards, up to **12 enemies** on screen (mvp.md §12), 10–20 projectiles,
  Burning on half the enemies, a Combust or Kaboom going off. Everything below must hold up in that
  scene, not in an isolated sprite sheet.
- **Read time:** "instant" means identifiable in a **≤ 200 ms glance** at phone size.

## 1. Global rules

1. **The ground is the calmest layer.** In a colourful style, the ground must still be
   **quieter than units and FX**: medium value, **medium-to-low saturation**, low internal contrast
   (no high-contrast texture noise, no busy flower dots). Units sit above it, FX above units.
   - **Measurable:** a 2 px blur ("squint test") of a fight screenshot still shows every unit and
     FX as a distinct blob against the ground.
   - **Measurable:** a ground-only screenshot (no units, no FX) should look calm. No tile detail
     reads as a unit, projectile or pickup at a glance.
   - **Measurable (style guide v3.0 keeps it):** unit lit edges are ≥ 50 luma above the local floor
     average. It's no longer about darkness, but it's a cheap, objective check that units sit
     above the ground.
2. **Saturation budget.** Rich colour is the style, but **peak saturation is reserved for gameplay
   meaning**: spells, FX, statuses, telegraphs, progress and class colours. Ground and props stay a
   clear step less saturated than any unit or FX. If a prop is as saturated as a spell, it's
   stealing readability.
3. **Hue families are reserved for gameplay meaning.** Don't reuse them for decoration.

   | Family | Meaning | Used by |
   |---|---|---|
   | Red / orange / yellow-hot | Fire | Pyromancer robe and staff, fire bolt, Fireball, Burning, Combust, Meteor, Kaboom |
   | Cyan / electric white | Storm | Stormcaller accents and staff, sparks, Lightning, Thunderstorm bolts |
   | Magenta-violet | Arcane | Convergence beam core, Arcane Detonation, portal swirl |
   | Gold (style guide `gold` #f2b42a, outlined in `ink` #1a1020; the style guide is authoritative) | Progress / "me" | Lit portal runes, leader marker, extraction ring, HUD objective count |
   | Goblin green skin; earthy gear | Goblins | Grunt, Archer, Hut |
   | **Dark crimson / maroon**, low value, matte | Blood (enemy deaths, §4a) | Blood burst, blood splat decal |

   - **Blood vs fire vs Pyromancer.** Blood is a clearly **darker** value than the Pyromancer's robe
     red and never orange. It doesn't glow, has no near-white core and no additive blending. Fire is
     bright, glowing and orange-yellow; blood is dark, matte and purple-leaning red. They must
     differ in grayscale (value) as well as hue.

   - **Ground versus goblins (the main hue risk).** Goblins are green, and the forest is green. The
     floor must separate from goblin skin in **both** hue and value. Goblin skin is **bright lime**
     (style guide v3.0); the floor leans **cooler/bluer green, moss-brown and dirt**, a clear value
     step darker than the skin. The ground is never cyan and never goblin lime.
   - **Exception, goblin eyes (R7):** 2 px flame-orange eyes under a dark brow. This is the only
     allowed decorative use of a reserved hue, under the constraints in §3.
   - Flowers, mushrooms and other props must not use fire red/orange, storm cyan, arcane violet or
     gold at full saturation. Muted versions are fine.
4. **Outlines.** Every unit, structure, keg and enemy projectile has a **dark outline** (colour and
   thickness per style guide; chunky Warcraft-style outlines suit this well). On a mid-value ground,
   the dark outline is the main separator again.
5. **Friendly vs hostile projectiles.** Squad projectiles **glow**: a near-white core, a saturated
   element hue and a hard-edged stepped halo plus engine additive blending (no soft pixels). Enemy
   projectiles are **matte, outlined and neutral**: a pale wood shaft and a steel head, as a pale
   stroke with a dark outline. Nothing on an arrow glows. The player should never mistake an arrow for a spark.
6. **FX must read on a bright ground.** Every FX has a **near-white core** and a **darker or
   saturated edge step**, so it stands out against both green grass and brown dirt. Additive-only
   FX that go pale on light ground aren't allowed for gameplay effects.
7. **Height cue.** Wizards are tall and upright, and hats add height. Goblins are hunched and wide.
   Team should be readable from the silhouette alone, in grayscale.
8. **Hit flash.** Full white flash, 60 ms, on the sprite only. Don't use team or element tints, so
   it never reads as a status.
9. **Flash safety** (kept from rev 2; it's photosensitivity, not darkness):
   - No full-screen white.
   - Screen flashes (portal opening only) ≤ 100 ms at ≤ 50% opacity.
   - Impact flashes stay local to their radius.
   - No more than 3 flashes per second anywhere.
10. **No information by colour alone.** Every gameplay distinction has at least one non-colour cue
    (shape, size, animation or position). That's what the checklist in §7 tests.

## 2. Wizards

Shared base body (plan §3.1 art budget). Classes are told apart by **hat, robe and staff**.
Shared features (beard, cloak, posture) belong to the base body and must not blur the class read.

| Element of read | Pyromancer | Stormcaller |
|---|---|---|
| Silhouette (the main cue) | Straight pointy hat with a floppy tip (11 px). Staff with a **flame tip**. | **Zigzag kinked hat** (16 px), **5 px taller** than the Pyromancer's. Staff with a **forked tip**. The kinks must read at 1x in grayscale; together with the 5 px they carry the class. |
| Robe hue | Rich red | Rich blue with yellow trim |
| Staff-tip glow | Small warm fire flicker (engine) | Small cyan crackle (engine) |
| Value contrast vs the other class | ≥ 1 clear value step in grayscale, or the hat shape carries the read alone | — |
| Size in the 48×48 frame | Body plus head about 20×31, hat 11: **42 px total**. Feet on the same baseline for every class (style guide §12). | Body plus head about 20×31, hat 16: **47 px total** |

**Leader vs followers (must read instantly; the player loses track of "me" in a fight)**
- A **gold ground marker** under the leader: an ellipse or chevron ring about **27×12 px**, drawn
  under the sprite, **with a dark outline**. Gold on yellow-green grass is a risk, and the outline
  plus the motion carry it. Slow pulse (≥ 800 ms period), so it reads by motion and doesn't depend on
  hue.
- Followers have no marker. Don't put the marker above the head; hats live there.
- The marker always draws on the ground layer, below every character. Followers partly hiding it
  (e.g. when walking north) is accepted; the marker never draws over a follower (CD playtest, M3).
- On succession, the marker moves to the new leader with a short pop (≤ 200 ms).

**Wizard state cues**
| State | Requirement |
|---|---|
| Damaged | **24×3 px** health bar under the sprite, shown only below full HP, outlined. Separate from the leader marker. Not gold. |
| Low HP (≤ 25%) | The health bar blinks. No sprite tint. |
| Death | Death puff, and the **hat stays on the ground** as an outlined prop for about 5 s before fading (Hat Hill tone, "who did I lose?"). The hat shape tells you the class. |
| Channelling (Convergence) | Casting pose (staff raised). A beam from the staff tip to the leader in the class's element colour: fire beam orange, storm beam cyan-white; both have a violet core where they meet the leader. |
| Volunteer sprinting | Sprint pose. A **blinking outline** (white/violet, about 150 ms), a fuse ring shrinking around the volunteer over 1.5 s, and a target marker at the aim point. The player must see *who* went and *where*. |
| Left-behind risk (portal open) | No per-wizard cue. The ground ring at the portal is enough (§4). |

## 3. Enemies

Menacing comes from posture, teeth and weapons, **not** from height. A goblin's body (weapon
excluded) is never taller than a wizard's body plus head (31 px), and is clearly wider for its
height. With hats, every wizard stands 11–21 px above every goblin. That's the team cue.

| | Goblin Grunt | Goblin Archer |
|---|---|---|
| Teaches | Swarm, so use area spells | Outranges you, so push or snipe |
| Silhouette | Hunched and wide, big ears, bare-headed, **big crude weapon raised above head** (cleaver or club). Body about 28×26 px; the raised weapon reaches about 34. | Hunched, **hooded** (the hood hides the ears' outline), **bow arc vertical along one side**. About 22×28 px. The read comes from weapon plus hood only. |
| Accent | Rust/brown scrap armour | Ochre/tan hood and quiver |
| Separation from the floor | Bright lime skin, a value step lighter than the floor, plus the dark outline (§1.3) | same |
| Eyes (R7) | 2 px flame-orange under a dark brow. **Static, with no halo and no flicker**, and dimmer than the Burning core. Burning stays the only *tall, bright, flickering* orange on a goblin. | same |
| Distinguish from each other | Wide + weapon-up versus narrow + bow-side. This must hold in grayscale and at 50% scale. | |
| Attack tell | Wind-up frame held ≥ 100 ms before the swing | **Bow draw pose held 300 ms** before every shot (mvp.md §12), plus a 1–2 px glint on the arrowhead. It's the "move now" cue. |
| Projectile | — | Arrow about **12×3 px**: a pale matte stroke (wood/steel) with a dark outline. |

- Enemy health bars: show only when damaged, **18×3 px**, outlined, hostile fill (not fire red,
  not gold).

## 4. Structures

### Goblin Hut (objective, spawner)
| State | Requirement |
|---|---|
| Intact | **64×64 px footprint (4×4 tiles)**, sprite up to 96 px tall. It reads as **the objective**: largest goblin object, a **lit doorway** (warm glow), a smoke plume, banners or other goblin colours. It should feel "alive". |
| Spawning tell | The doorway glow **pulses brighter for 500 ms** before each grunt appears. |
| Damaged (≤ 50%, optional, nice to have) | Missing thatch and a lean. Not required for the MVP. |
| Health bar | Wider bar (**48×4 px**) above the hut when damaged. |
| Burning | Same Burning overlay language as units, scaled to the footprint (3–4 flame clusters) and rising **above** the roofline. Shape and motion separate it from the door glow (R5). |
| Destroyed | **Rubble**: a much lower profile (≤ 32 px tall), no glow, no plume (lingering smoke ≤ 3 s, then none), desaturated and darker, same footprint. Intact and destroyed must differ in **height, glow and motion**, not only colour. |

### Powder Keg
| State | Requirement |
|---|---|
| Idle | **32×32 sprite frame** with the barrel art about 20×24 px inside it, on a **16×16 (1-tile) collision footprint** (agreed with art-director and level-designer). Uses a unique **danger mark**: a powder band, a bomb stencil and a fuse stub. No skull (reserved for the post-MVP Necromancer). No other prop uses this mark. |
| Tileset rule | **No non-explosive barrels or kegs anywhere in the tileset or props.** |
| Fuse (300 ms) | Rapid white/red blink, sparks from the fuse, **and the 72 px blast radius drawn as a ground ring** (outlined, so it reads on grass) for the duration of the fuse. That's the only friendly-fire area in the MVP, so it must be the clearest warning in the game. |

### Portal (exit and progress meter)
| State | Requirement |
|---|---|
| Sealed | Stone arch or ring, about 64–96 px wide, grey stone (desaturated, so it doesn't compete). Visible from far away (landmark). **One dark rune socket per objective** (2), each at least **9×9 px**. |
| Rune lit | The socket turns **gold, bright**, with a 300 ms flare when it lights. Lit versus dark reads by **value**. |
| Opening (1500 ms) | Burst: a violet swirl forms, light rays, a screen flash per §1.9. |
| Open (loop) | A violet swirl with a white core, animated. The **extraction ring** (radius **112 px**, APPROVED, mvp.md §13) is drawn on the ground as a dashed gold circle **with a dark outline** (gold on grass needs it). Keep it thin (1–2 px plus outline) so it doesn't hide enemies. |
| Off-screen | An edge-of-screen arrow points to the portal **from mission start** (APPROVED at the gate): a dim grey-gold "sealed" style, switching to a bright gold "open" style when the portal opens (HUD). The intro camera pan (APPROVED) shows the sealed portal once at mission start. |
| Extraction | A warp-out per saved wizard (a stretch upward plus a flash). Left-behind wizards visibly *aren't* warped. |

## 4a. Enemy deaths, corpses and decals (CD request; rules in mvp.md §12a)

Enemy deaths match the killing blow: **charred** (fire), **electrified** (storm) or **blood**
(physical, arcane, Kaboom). Stylised Warcraft-level gore. Wizard deaths stay non-gory (§2).

**Layer order (bottom to top):** ground → **death decals** → telegraph and ground rings (leader
marker, keg fuse ring, Lightning reticle, Convergence ring, extraction ring) → **corpses and
landed gibs** → live units → projectiles, FX and gibs in flight → UI. A decal must never cover a telegraph, and a corpse must never sit
on top of a live unit.

| Item | Requirement |
|---|---|
| Blood burst (death anim) | Dark crimson/maroon, matte, short (≤ 150 ms burst). Not orange, not glowing. A few droplets. |
| **Gibs** (APPROVED, mvp.md §12a and Q22; asset-list A10) | 3–5 pieces per goblin (data), picked from the final sheet of up to 6 (weapon fragment, ear, 2 bones, 2 meat chunks; 7 piece types, 4 tumble frames each). The **weapon fragment** is always included (Grunt axe head, Archer bow half). Bones never include a skull. Bloody art for blood deaths; a blackened remap for fire deaths; the same remap plus the engine smoke wisp for storm deaths. **Not projectiles or pickups:** they spin and arc (arrows fly straight and never spin), are matte and dark-outlined with no glow or trail, have no pale shaft > 8 px, and land within 450 ms and 48 px. Once landed they drop to corpse values (desaturated) in the corpse layer and fade after 8 s. |
| Blood splat decal | Dark crimson/maroon, **low contrast with the ground** (it's in the calm layer), irregular flat shape, about 24–32 px. Fades after 12 s (mvp.md §12a). |
| Charred husk | A curled, blackened silhouette with a few dim ember pixels that stop glowing after about 1 s, so it doesn't read as Burning. |
| Ash / scorch decal | Dark grey-brown, flat, low contrast. |
| Electrified | **One** skeleton flash (pale bones **including the skull**, APPROVED by the CD with the skull visible for at most 2 frames; cyan edge, held 120 ms, local only), then the collapse and a smoking corpse with a thin grey smoke wisp. No body/skeleton alternation: a double flicker per goblin, across a Thunderstorm kill, would break the flash-safety cap (§1.9: 3 flashes per 333 ms). |
| Shared crater decal (≥ 3 kills from one blast) | One decal sized to the blast radius in the dominant variant, low contrast. |

**Corpses must never read as live enemies.**
- **Flat and low:** a lying silhouette, ≤ 14 px tall. No standing pose, no raised weapon, no
  drawn bow.
- **Desaturated** at least 50% versus the live sprite, and darker. A lime goblin becomes a grey-olive
  corpse.
- **No eyes** (the R7 orange eyes go dark), no health bar, no outline pulse.
- **Fade** after 6 s (mvp.md §12a), and drawn below live units.
- Grayscale check: a corpse next to a live goblin is told apart by height and posture alone.

**Gore off (APPROVED setting, default on):** every enemy death plays the plain collapse, then a
neutral grey puff. No corpses, decals, gibs or skeleton flash, and no extra art (style guide v3.1
§7.1).

**Calm rule.** All death decals belong to the ground layer (§1.1): they lower the ground's calm
only slightly. With the pool caps (≤ 24 decals, ≤ 16 corpses, ≤ 32 gib pieces) and the shared crater
rule, a cleared area should look *marked*, not *painted*.

**Timings for the death animations** (mvp.md §12a; the art budget per style guide v3.1 §7.1 fits):
| Variant | Max total | Frame notes |
|---|---|---|
| death-fire (6 frames) | ≤ 500 ms (about 83 ms/frame) | The flames are gone before the husk frame. |
| death-storm | ≤ 400 ms | Body → skeleton with skull (held 120 ms, skull ≤ 2 frames) → body → collapse. One flash only. |
| death-blood (5 frames) | ≤ 350 ms (70 ms/frame) | Plus blood-burst FX ≤ 150 ms. |
| Gib burst | instant (replaces the death anim and corpse) | Pieces tumble 300–450 ms (4 spin frames), land within 48 px. |

The art side is one drawn 5-frame collapse per enemy, a palette remap for charred, one skeleton
frame and engine FX for blood (7 hand-drawn death and corpse frames per enemy, style guide v3.1
§7.1).

## 5. FX and telegraphs

All area FX are drawn at the data `radiusPx`. Hits also count bodies the ring only touches
(mvp.md §0, area hit rule). So the edge of an impact should **reach to** the ring, not stop short.
Every FX follows §1.6 (a near-white core plus an edge step).

| FX | Must communicate | Requirement |
|---|---|---|
| Fire bolt | Pyro auto, applies Burning | Orange glowing orb about 6 px with a 3–4 px trail. Slower than sparks. |
| Spark | Storm auto | Small cyan-white zig-zag dash, fast. There are many on screen, so keep them ≤ 9×4. |
| Fireball travel | Your big fire spell | Orb clearly larger than a fire bolt (≥ 15 px) with a flame trail. |
| Fireball impact | 44 px area | Burst that fills the radius (± 4 px). |
| Lightning telegraph (250 ms) | "Strike lands here" | A **reticle about 20 px across** at the aim point, cyan-white with a dark edge, shrinking. The hit radius is only 8 px, so a ring at 8 px would be a dot. Rule: whatever body the reticle centre touches gets hit. |
| Lightning strike | Hit | A vertical bolt from the top of the screen, plus a local ground flash. |
| Burning (status) | "This target is primed for Combust" | A **flame overlay rising above the head and shoulders** (2–3 frame flicker) plus embers. Orange on green goblin skin is complementary and reads well. Readable in grayscale (bright flicker). No sprite tint. |
| Combust | Reaction triggered, and fire spreads | A small sharp orange-white pop (32 px) plus **ember arcs flying to the neighbours** that caught Burning. It must look different from Kaboom: smaller, faster, no smoke column. |
| Kaboom | Big explosion, friendly fire | Large (72 px) blast, a smoke column, debris, a light screen shake. |
| Convergence aim ring | "The ultimate will land here, this big" | Outlined ground ring at the combo radius (90 / 120 / 140 px), shown during the channel, coloured by combo: Meteor fire, Thunderstorm storm, Firestorm fire rim with storm ticks. |
| Meteor | Huge impact plus burning ground | A **shadow grows for 400 ms** (shadows read again on a bright ground), then impact. Burning ground is a flame decal with a clear edge for 4 s. It doesn't hurt wizards, so don't make it look like the keg danger ring. |
| Thunderstorm | Area barrage, 2 s | A dark cloud tint over the area, plus bolts. |
| Firestorm | Both of the above | Meteorlets plus bolts. Should read as "the best one", the largest and busiest of the three. |
| Arcane Detonation | Volunteer! blast | Violet burst, 64 px, with a hat flying up (tone). |
| Hit flash / death puff | Damage / wizard death | White 60 ms sprite flash. A neutral grey puff for **wizard** deaths. Enemy deaths use the variants in §4a. |

**Telegraph rule.** Everything that can hurt the **squad** has a tell of at least 100 ms: the grunt
wind-up, the archer draw (300 ms) and the keg fuse with ring (300 ms). Everything the **player**
aims shows where it will land before or when it lands.

## 5a. Sprite vs engine split (agreed with art-director)

Sprites carry identity and pose only: 4 facings (down, up, side mirrored), no state baked into
frames, and no text. Everything below is **engine-drawn** and goes on the FX/UI list:

| Engine-drawn item | Kind |
|---|---|
| Leader marker (gold pulsing ground ring with outline, 27×12) | ground decal |
| Health bars (wizard 24×3, enemy 18×3, hut 48×4) and the low-HP blink | UI overlay |
| Hit flash (white, 60 ms) | tint |
| Burning flame overlay, embers, staff-tip flicker (both classes) | overlay (pooled) |
| Convergence beams, channel aim ring (per combo radius) | FX plus ground decal |
| Lightning reticle | ground decal |
| Fireball / Volunteer aim and target marker, Volunteer blinking outline and fuse ring | decal plus tint |
| Keg fuse blink and 72 px blast ring | tint plus ground decal |
| Hut door glow and spawn pulse, smoke plume | overlay |
| Portal runes (dark/lit, per socket), swirl, extraction ring, off-screen arrow | overlay, decal, UI |
| Meteor shadow, burning ground, Thunderstorm cloud | decal / FX |
| Dropped hat (persists about 5 s) and the Arcane Detonation hat-fly | prop sprite reused as FX |
| Death decals (blood splat, ash/scorch, shared crater), corpse fade and recycling | pooled ground decal plus engine fade |
| Blood burst droplets, smoke wisp on electrified corpses | pooled FX |
| Names, epitaphs, numbers | UI text |

**Frame holds.** These are time-based and unchanged:
- **Archer attack:** draw frame held 300 ms (the dodge tell), then release.
- **Grunt attack:** wind-up frame held ≥ 100 ms before the swing.
- **Wizard cast:** the staff-raised frame held for the 1.2 s Convergence channel.
- **Volunteer sprint:** reuses walk at a higher playback rate.
- **Hut:** two static states (intact, rubble). Life comes from engine overlays.

Frame-count budgets are the art-director's call. The design needs no more frames than the holds
above.

**Death variants (cost note).** Three variants per enemy type could triple death frames. Cheaper
options are the art-director's call. For example: one shared collapse animation per enemy, with
**charred** as a palette/tint swap to black, **electrified** as one extra skeleton frame per enemy
type, and **blood** as the base animation plus engine FX. The corpse pose (last frame) is shared,
with the variant shown by palette and decal.

## 6. The "instant reads" list

In a busy fight, at phone scale, in ≤ 200 ms, the player must be able to answer:

1. **Which wizard am I?** Gold pulsing, outlined ground marker.
2. **Which class is that wizard?** Hat height and shape, then robe colour.
3. **Which spells do I still have?** HUD slots, plus hats among the living. Lost slots are greyed
   *and* crossed or desaturated.
4. **Is that goblin an archer or a grunt?** Narrow with a bow at its side, versus wide with a weapon
   raised.
5. **Is that an arrow or my spark?** Matte outlined stick, versus a glowing coloured dash.
6. **Which enemies are Burning?** A tall flame overlay above the head.
7. **Is that hut still alive?** Tall, glowing door and smoke, versus low grey rubble.
8. **Is that a powder keg?** Unique danger mark, and no lookalike barrels exist.
9. **Is a keg about to blow and am I in it?** Blink plus ground ring.
10. **How many targets are left and where's the exit?** Portal runes (gold/dark), the HUD count, and
    the edge arrow.
11. **Is the portal open and where is safe?** Swirl plus the gold extraction ring.
12. **Is my ultimate ready?** HUD meter glow (plan §6).
13. **Is that a goblin or part of the forest?** Bright lime skin a value step off the floor, plus
    the outline.

## 7. Squint, grayscale and colour-blind checklist

Run on a **staged busy-fight screenshot**: 4 wizards including the leader, 12 goblins with mixed
archers (some standing on the greenest grass tile), 4+ Burning, one intact and one destroyed hut,
one keg mid-fuse, sealed portal with 1 lit rune. Use 640×360 shown at phone size. Reviewer records
the results in docs/reviews/.

**Busy / squint (new for rev 3)**
- [ ] 2 px blur: every unit and FX is still a distinct blob against the ground.
- [ ] A ground-only screenshot looks calm. No tile or prop detail reads as a unit, projectile,
      pickup or keg.
- [ ] Goblins on the greenest grass tile separate from it by hue and value (§1.3).
- [ ] No prop uses a reserved gameplay hue at full saturation.
- [ ] The gold leader marker and extraction ring are visible on the brightest grass tile.

**Grayscale (desaturate 100%)**
- [ ] Leader can be found in ≤ 200 ms.
- [ ] Pyromancer and Stormcaller can be told apart (hat height and shape).
- [ ] Every goblin separates from the ground and foliage (outline plus value step).
- [ ] Grunt and Archer can be told apart by silhouette.
- [ ] Burning enemies are identifiable (tall bright flicker), and never confused with the 2 px
      orange eyes of a non-burning goblin.
- [ ] Arrows and sparks can be told apart (matte versus glow).
- [ ] Hut intact and destroyed can be told apart (height, glow).
- [ ] The keg can be told apart from every other prop. The fuse ring is visible.
- [ ] Lit and dark portal runes can be told apart (value).
- [ ] Combust and Kaboom can be told apart (size, smoke).
- [ ] Corpses and live goblins can be told apart (height, posture). Add 6 corpses to the staged
      screenshot.
- [ ] Gibs (landed and in flight) are never mistaken for projectiles or pickups. Add a Kaboom gib
      burst to the staged screenshot.
- [ ] Blood is darker than the Pyromancer's robe and every fire FX.
- [ ] No decal covers a telegraph ring (layer order, §4a).

**Colour-vision simulation** (deuteranopia, protanopia, tritanopia)
- [ ] Deuter/Protan: the red Pyromancer robe separates from green goblins and the forest (the
      hat and outline must carry it). This is the biggest risk in a red-and-green world.
- [ ] Deuter/Protan: goblin skin still separates from the floor (value step, not hue).
- [ ] Deuter/Protan: Burning flames stay visible on goblin skin (shape plus brightness).
- [ ] Deuter/Protan: the keg danger mark and fuse ring stay visible on grass.
- [ ] Deuter/Protan: blood splats don't read as fire or Burning (value and no glow carry it).
- [ ] Tritan: Stormcaller blue/yellow and the gold leader marker don't merge (the marker's pulse,
      outline and position carry it).
- [ ] Tritan: gold runes versus the violet portal swirl can still be told apart by value.
- [ ] All: no gameplay state relies on hue alone.

**Motion and safety**
- [ ] Flash rules from §1.9 hold.
- [ ] Screen shake only on Kaboom, Meteor/Firestorm impacts and the portal opening. It's subtle and
      never needed for reading the game (a post-MVP setting can disable it).

## 8. Open questions (readability)

| # | Question | Recommendation |
|---|---|---|
| R1 | Leader marker: ground ring or a floating icon? | **Ground ring** (27×12, outlined). Hats occupy the space above heads. |
| R2 | Should damaged wizards show health bars all the time? | **Only below full HP.** |
| R3 | Dropped hats as a death marker: worth the art cost? | **Yes, cheap win.** |
| R4 | Should the portal use violet (arcane) when Arcane Detonation is also violet? | **Yes.** They differ in shape (static ring versus burst) and context. |
| R5 | The hut doorway glow and Burning are both fire hues. | Told apart by **shape and motion**: a static door rectangle versus a tall flickering overlay above the roofline. **M8 playtest item.** If they're confused, dim the door glow toward amber. |
| R6 | Squad light pool | **Dropped in rev 3** (art-director agrees). It existed for the dark look. The outlined gold marker carries "me". |
| R7 | Goblin eye colour | **Resolved with art-director.** Acid green is dropped because it vanishes on lime skin. Instead: **2 px flame-orange eyes under a dark brow**, static, no halo or flicker, and dimmer than the Burning core. This bends the reserved-fire-hue rule, but at 2 px with no motion it can't read as Burning (tall, bright, flickering). The §7 grayscale check guards it. M8 playtest item: any confusion means the eyes go pale yellow-white. |
| R8 **APPROVED** | The veteran wizard look versus the "fresh recruits / rookie volunteers" writing (plan §2 Tone) | **Keep the "rookie" joke** (creative director, at the gate). Art follows the veterans. The game-designer writes `barks.ts` with veterans being called rookies as the running gag. |
| R10 **DECIDED (CD)** | How far does the gore go? | **Gibs are in** (mvp.md Q22 and §12a). My readability concern stands as a constraint in §4a: spinning arcs, matte, desaturated on landing, ≤ 450 ms and 48 px, capped. The **gore toggle (Q23) is APPROVED**, on by default. |
| R9 (new) | Green goblins on a green forest: how is the floor kept apart? | **The floor shifts cooler and earthier** (blue-green grass, moss-brown, dirt paths), and goblin skin stays a warmer, lighter yellow-green. Goblins keep their identity; the floor carries the change. Art-director's call on exact values. The §7 squint and Deuter/Protan checks decide it. |
