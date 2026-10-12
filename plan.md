# Arcane Fodder — Development Plan

> A single-player, top-down squad action game in the spirit of *Cannon Fodder*.
> A small band of expendable wizards fights its way through orc and goblin territory.
> Squadmates follow and fight automatically. The player commands the squad, aims the spells,
> and decides when to unleash the squad's combined ultimate, or when a rookie must "volunteer".

This document is the source of truth for scope, architecture and milestones.
Claude CLI should read it before every milestone, alongside `CLAUDE.md` (template in Appendix A).

---

## 1. Guiding principles

1. **Fun before big.** A ten-minute mission that makes you want to replay it beats ten unfinished systems.
2. **Every milestone ships.** Each one ends with a working, committed, playable build.
3. **Pure core, thin engine layer.** Gameplay rules live in plain TypeScript that runs and tests without Phaser.
4. **Data over code.** Classes, enemies, spells, reactions and missions are typed data definitions.
5. **One codebase, every platform.** Desktop browser, mobile browser, iOS and Android all run the same build.
6. **No backend for v1.** No accounts, servers, multiplayer, cloud saves or leaderboards.

---

## 2. Game pillars

| Pillar | What it means in play |
|---|---|
| **Squad command** | You move one leader; the squad follows in formation and engages on its own. |
| **The squad *is* your spellbook** | Each mage class grants the player one spell. Lose the mage, lose the spell. |
| **Expendable heroes** | Wizards die permanently within a mission. Losses sting, with dark humour. |
| **Big, readable moments** | Convergence ultimates, elemental combos and volunteer explosions are the highlights. |
| **Readable chaos** | Lush, colourful pixel art with clear silhouettes, so a busy fight stays legible. |

### Tone

Cannon Fodder's dark comedy translated to fantasy: fresh recruits with silly names, pointy hats, rookies who "volunteer", and a hill of hats marking the fallen (**Hat Hill**).

---

## 3. Characters

### 3.1 Mage classes

Every class has an **auto-attack** (used automatically as a follower), a **granted spell** (cast by the player while at least one mage of that class is alive) and a **Convergence element** (feeds the ultimate, §4.1).

| Class | Role | Auto-attack | Grants spell | Element | Silhouette cue | Phase |
|---|---|---|---|---|---|---|
| **Pyromancer** | Damage | Fire bolt, applies *Burning* | **Fireball**: projectile, area damage, applies *Burning* | Fire | Red robe, flame-tipped staff | **MVP** |
| **Stormcaller** | Fast damage | Rapid sparks, low damage | **Lightning**: instant strike at aim point | Storm | Blue/yellow robe, tall crooked hat | **MVP** |
| **Frost Warden** | Frontline / control | Slow ice shard, applies *Chilled* | **Frost Nova**: freezes enemies around the squad | Frost | Pale blue, broad shoulders, extra health | Post-MVP 1 |
| **Hedge Druid** | Healer | Thorn dart; heals the most wounded ally | **Entangle**: roots enemies in an area | Nature | Green hood, antlers or leaves | Post-MVP 1 |
| **Necromancer** | Summoner | Life drain | **Raise Dead**: a fallen goblin fights for you briefly | Death | Black and purple, skull staff | Post-MVP 2 |
| **Runesmith** | Tank / support | Staff melee strike | **Arcane Ward**: temporary shield on the whole squad | Arcane | Stocky, glowing rune armour | Post-MVP 2 |

**Art budget rule:** use one shared base body, with classes differentiated by hat shape, robe colour and staff. At 32×32 px, silhouette and colour are what make a class readable.

**Leader succession:** if the leader dies, the next wizard in line is promoted (Cannon Fodder style). The mission is lost only when the whole squad is gone.

### 3.2 Enemies

Every enemy must **teach the player something** and require a different response.

**Goblins (weak, numerous, sneaky)**

| Enemy | Behaviour | Teaches | Phase |
|---|---|---|---|
| **Goblin Grunt** | Swarms in melee | Basics; area spells against groups | **MVP** |
| **Goblin Archer** | Keeps its distance and shoots | Push forward, or snipe with Lightning | **MVP** |
| **Goblin Sapper** | Runs at the squad with a lit bomb and explodes (destroys nearby obstacles too) | Kill it before it arrives; spread out | Post-MVP 1 |
| **Goblin Shaman** | Heals and hastes nearby goblins, stays at the back | Target priority | Post-MVP 2 |
| **Wolf Rider** | Fast flanker | Watch your flanks; control spells | Post-MVP 2 |

**Orcs (few, tough, hard-hitting)**

| Enemy | Behaviour | Teaches | Phase |
|---|---|---|---|
| **Orc Brute** | Slow tank with knockback that scatters formation | Kite it; control spells | Post-MVP 1 |
| **Orc Berserker** | Telegraphed straight-line charge, enrages at low health | Dodge the charge | Post-MVP 2 |
| **Orc Javelineer** | Slow, heavy ranged throws that can one-shot a mage | Ward and positioning | Post-MVP 2 |
| **Orc Warchief** | Mini-boss that rallies and buffs nearby orcs | Boss fight | Post-MVP 3 |

**Structures (Cannon Fodder staple)**

| Structure | Behaviour | Phase |
|---|---|---|
| **Goblin Hut** | Spawns grunts until destroyed; doubles as an objective | **MVP** |
| **Watchtower** | Archer behind cover; only area damage reaches it | Post-MVP 1 |
| **Powder Keg** | Explodes when hit by fire or lightning, damaging everything nearby | **MVP** |

---

## 4. Signature mechanics

### 4.1 Convergence (the ultimate)

The squad's combined ultimate.

- **Charge:** a Convergence meter fills from kills and damage dealt (tuned so it is ready roughly once or twice per mission section).
- **Activate:** R or Space on desktop; the ultimate button on mobile. The player aims the strike.
- **Channel (1.2 s):** the squad stops, and every living mage sends a beam into the leader. Wizards are **vulnerable** during the channel, which is the risk-and-reward moment.
- **Strike:** a massive area attack at the aim point.
  - **Element** comes from the classes still alive (lookup table in data).
  - **Power scales with the number of living mages** (×1.0 / ×1.5 / ×2.0 / ×2.5 for 1 to 4), so keeping the squad alive matters.

| Living elements | Convergence | Effect | Phase |
|---|---|---|---|
| Fire | **Meteor** | One huge impact, leaves burning ground | **MVP** |
| Storm | **Thunderstorm** | Rapid bolts over an area for 2 s | **MVP** |
| Fire + Storm | **Firestorm** | Meteor rain plus lightning; everything hit is *Burning* | **MVP** |
| + Frost | **Blizzard** | Freezes the area, then shatters | Post-MVP 1 |
| + Nature | **Overgrowth** | Roots everything, then heals the squad | Post-MVP 1 |

Rule: the highest-priority combo whose required elements are all present wins (data-driven priority list).

### 4.2 Volunteer! (signature Cannon Fodder mechanic)

The rookie always volunteers.

- **Activate:** F on desktop; the volunteer button on mobile.
- The **last wizard in the trail** (never the leader) shouts a randomly picked line, sprints toward the aim point and detonates after 1.5 s or on contact: a big **Arcane Detonation**.
- They die permanently. If they were the last of their class, **their granted spell is lost**.
- They go to Hat Hill with the epitaph *"Volunteered."*
- Unavailable when only the leader remains, and on a short cooldown.

No unit-selection UI is needed, which keeps it within MVP scope.

### 4.3 Elemental reactions

Statuses combine into reactions, defined in a data table (`src/data/reactions.ts`) and resolved in `src/core/combat/reactions.ts`.

| Status on target | Hit by | Reaction | Effect | Phase |
|---|---|---|---|---|
| Burning | Storm | **Combust** | Small explosion that spreads *Burning* to neighbours | **MVP** |
| Any | Fire/Storm on a Powder Keg | **Kaboom** | Large explosion, friendly fire included | **MVP** |
| Chilled/Frozen | Storm | **Shatter** | Bonus damage, ends freeze | Post-MVP 1 |
| Rooted | Fire | **Wildfire** | Roots burn, so *Burning* spreads across the area | Post-MVP 1 |
| Frozen | Fire | **Steam** | Cloud that blinds archers | Post-MVP 2 |

### 4.4 Mission structure: Destroy & Extract through the Portal

Every mission follows the same readable loop: **destroy X targets, then reach the portal and get out alive.**

1. **Sealed portal.** The extraction portal is visible on the map from the start, sealed, with one dark rune per objective target. The player always knows where the exit is.
2. **Destroy targets.** Each destroyed target (Goblin Hut in the MVP; War Totems, Orc Banners and Siege Engines later) **lights one rune on the portal**. Progress is shown in the world as well as in the HUD.
3. **Portal opens.** When the last rune lights, the portal opens with a big visual and audio moment. Enemies notice: a **final surge wave** spawns from the remaining spawn points and converges on the squad.
4. **Extract.** Mission success triggers when the **leader enters the portal**.
   - Wizards inside the portal radius at that moment are saved.
   - Wizards outside it are **left behind**. They count as fallen and go to Hat Hill with the epitaph *"Left behind."*
   - So the final run is a fighting retreat: keep the squad together, use Convergence to clear the path, or let a rookie volunteer to buy time.
5. **Score.** The results screen shows time, kills, wizards saved and wizards lost (by name and cause).

Mission definitions are data, so X and the target types vary per mission:

```ts
// src/data/missions/m01-goblin-woods.ts
export const M01_GOBLIN_WOODS = {
  id: 'm01-goblin-woods',
  name: 'Goblin Woods',
  map: 'tilemaps/m01-goblin-woods.json',
  squad: ['pyromancer', 'pyromancer', 'stormcaller', 'stormcaller'],
  objectives: [{ kind: 'destroy', target: 'goblin-hut', count: 2 }],
  extraction: {
    kind: 'portal',
    spawnId: 'portal',
    radiusPx: 48,
    finalSurge: { waveId: 'surge-01', spawnPoints: 'all-remaining' },
  },
} as const satisfies MissionDef;
```

Post-MVP portal variants (data-driven, per mission):

| Variant | Twist |
|---|---|
| **Collapsing portal** | Open for N seconds only; a countdown ring shrinks around it |
| **Unstable portal** | Must be channelled open for X seconds while the squad holds the area |
| **Moving portal** | Relocates when a mini-boss dies, forcing a reroute |
| **Multi-objective** | Mixed targets, for example 3 huts and 1 totem, and an optional bonus target |

### 4.5 Post-MVP fun mechanics backlog

- **Caged apprentices:** free them mid-mission to recruit a new squad member (refills losses).
- **Wild Surge:** a rare random spell side effect; for example, a goblin turns into a chicken.
- **Mana shards:** pickups that refund the cooldown of one spell.
- **Hardcore mode:** player spells cause friendly fire.

---

## 5. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Game runtime | **Phaser 4** (pinned, 4.x) | Stable since April 2026. Ships official AI agent skill files (see §5.1). |
| Build | Vite | Vanilla TS template, no UI framework in the game runtime |
| Tests | Vitest | Pure `core/` logic first; scene smoke tests later if useful |
| Quality | ESLint (flat config) + Prettier | Import boundaries enforced by lint rules (§7.3) |
| Mobile | Capacitor 8 | Added in M9, not before. Requires Node 22+. |
| Persistence | `localStorage` behind a versioned `SaveRepository` | Swap for Capacitor Preferences later without touching gameplay |
| Runtime | Node 22 LTS or newer | Pin via `.nvmrc` and `engines` in `package.json` |

**Why Phaser 4 instead of Phaser 3:** the project starts from scratch, so there is no migration cost. Phaser 4 is the actively developed line with a rebuilt renderer, and its API is largely familiar to anyone who knows Phaser 3. Pin the exact version in the lockfile and never upgrade a major version without approval.

**Why no Vue/React/Nuxt in the game:** Phaser owns the canvas and the game loop. A UI framework would add state synchronisation between two render loops for no gain. All in-game UI (HUD, menus, results) is built in Phaser. If a marketing site comes later, that can be a separate Nuxt or Next.js app.

### 5.1 Phaser 4 agent skills

Phaser 4's repository ships a `skills/` folder of agent skill files covering its subsystems. At M1, check whether they are included in `node_modules/phaser`. If they aren't, copy them from the Phaser GitHub repo into `.claude/skills/phaser/`. Claude should consult them before writing Phaser API code rather than relying on Phaser 3 habits.

---

## 6. Controls

All platforms produce the same high-level actions through one interface:

```ts
// src/game/input/GameInput.ts
export type InputAction = 'spell1' | 'spell2' | 'convergence' | 'volunteer' | 'pause';

export interface GameInput {
  /** Normalised movement vector, length 0..1 */
  readonly moveVector: Readonly<Vec2>;
  /** Aim target in WORLD coordinates (camera-adjusted) */
  readonly aimWorld: Readonly<Vec2> | null;
  /** Edge-triggered: true only on the frame the action was requested */
  consume(action: InputAction): boolean;
  update(): void;
  destroy(): void;
}
```

| Action | Desktop | Mobile |
|---|---|---|
| Move squad | WASD / arrow keys | Virtual joystick (left half of screen) |
| Aim | Mouse position | Drag on right half of screen |
| Spell slot 1 | Q or left click | Spell button 1, then drag and release |
| Spell slot 2 | E or right click | Spell button 2, then drag and release |
| Convergence | R or Space | Ultimate button (glows when charged) |
| Volunteer! | F | Volunteer button |
| Pause | Esc / P | Pause button, plus automatic on app background |

Spell slots are filled by the granted spells of the living classes. A greyed-out slot means the spell has been lost.

Movement and aiming must be **independent** on mobile, so the player can retreat while firing forward.

---

## 7. Architecture

### 7.1 Layers

```
┌──────────────────────────────────────────────────┐
│ platform/   storage, lifecycle, Capacitor bridge │
├──────────────────────────────────────────────────┤
│ game/       Phaser scenes, entities, systems,    │
│             input adapters, FX, in-canvas UI     │
├──────────────────────────────────────────────────┤
│ data/       typed definitions (classes, spells…) │
├──────────────────────────────────────────────────┤
│ core/       pure TS rules: math, combat, AI      │
│             state machines, reactions, RNG       │
└──────────────────────────────────────────────────┘
       dependencies point DOWN only
```

- **`core/`** never imports Phaser, the DOM or `platform/`. This is where the unit tests live.
- **`game/`** adapts core rules to Phaser: sprites, physics bodies, tweens, cameras.
- **`data/`** imports only types from `core/`.
- **`platform/`** isolates everything that differs between web and native.

### 7.2 Folder structure

```
arcane-fodder/
├── .claude/
│   └── skills/phaser/            # Phaser 4 agent skills (if not in node_modules)
├── assets-src/                    # Source art (not shipped) + PROVENANCE.md
├── public/
│   └── assets/                    # Runtime assets: atlases, tilemaps, audio
├── src/
│   ├── main.ts
│   ├── app/
│   │   ├── config.ts              # Phaser game config (pixelArt, scale, physics)
│   │   └── registry.ts            # Scene registration
│   ├── core/                      # ⚠ NO Phaser imports
│   │   ├── math/                  # Vec2 helpers, angles, clamp, lerp
│   │   ├── combat/                # damage, area of effect, Cooldown, statuses, reactions
│   │   ├── targeting/             # selectTarget() strategies
│   │   ├── ai/                    # StateMachine<TState, TContext>
│   │   ├── squad/                 # formation, breadcrumb trail, succession, volunteer pick
│   │   ├── convergence/           # meter charge, combo resolution, power scaling
│   │   ├── mission/               # objective evaluation, win/lose rules
│   │   ├── names/                 # silly recruit name generator (seeded)
│   │   ├── rng/                   # seeded RNG
│   │   └── types.ts               # EntityId, Team, Vec2, Element, StatusId…
│   ├── data/
│   │   ├── classes.ts             # mage classes (§3.1)
│   │   ├── enemies.ts             # goblins, orcs (§3.2)
│   │   ├── structures.ts          # hut, watchtower, powder keg
│   │   ├── spells.ts              # granted spells
│   │   ├── statuses.ts            # burning, chilled, rooted…
│   │   ├── reactions.ts           # elemental reaction table (§4.3)
│   │   ├── convergences.ts        # combo table + priority (§4.1)
│   │   ├── barks.ts               # volunteer lines, death yelps
│   │   ├── missions/
│   │   │   └── m01-goblin-woods.ts
│   │   └── index.ts
│   ├── game/
│   │   ├── scenes/                # Boot, Preload, MainMenu, Mission, Results
│   │   ├── entities/              # Wizard, Enemy, Structure, Projectile
│   │   ├── systems/               # each has update(dt) and destroy()
│   │   │   ├── SquadSystem.ts
│   │   │   ├── TargetingSystem.ts
│   │   │   ├── CombatSystem.ts
│   │   │   ├── StatusSystem.ts
│   │   │   ├── SpellSystem.ts
│   │   │   ├── ConvergenceSystem.ts
│   │   │   ├── VolunteerSystem.ts
│   │   │   ├── EnemyAiSystem.ts
│   │   │   ├── SpawnerSystem.ts
│   │   │   ├── MissionSystem.ts   # objectives, win/lose
│   │   │   └── PortalSystem.ts    # runes, opening, final surge, extraction
│   │   ├── input/                 # GameInput, KeyboardMouseInput, TouchInput
│   │   ├── world/                 # CameraController, TilemapLoader
│   │   ├── fx/                    # hit flash, screen shake, particles, beams
│   │   ├── ui/                    # Hud, SpellSlots, ConvergenceMeter, TouchControls
│   │   ├── pools/                 # object pools for projectiles/FX
│   │   └── events.ts              # typed game event map
│   ├── platform/
│   │   ├── storage/               # SaveRepository + LocalStorage implementation
│   │   └── lifecycle.ts           # pause on visibility change / app background
│   └── styles/game.css
├── tests/                         # mirrors src/core
├── CLAUDE.md
├── plan.md
└── package.json
```

Create folders **when a milestone needs them**, not all up front.

### 7.3 Enforced boundaries

Configure ESLint `no-restricted-imports` so that:

- `src/core/**` cannot import `phaser`, `src/game/**` or `src/platform/**`
- `src/data/**` can import only **types** from `src/core/**` (`import type`), plus other `src/data/**` files (ADR 0003)

Configure path aliases (`@core/*`, `@data/*`, `@game/*`, `@platform/*`) in both `tsconfig.json` and `vite.config.ts`.

### 7.4 Core patterns

**Typed data definitions**

```ts
// src/data/classes.ts
import type { ClassDef } from '@core/types';

export const CLASSES = {
  pyromancer: {
    id: 'pyromancer',
    role: 'damage',
    element: 'fire',
    maxHp: 60,
    moveSpeed: 110,
    attack: { kind: 'projectile', damage: 8, rangePx: 180, cooldownMs: 900, applies: 'burning' },
    grantsSpell: 'fireball',
  },
  stormcaller: {
    id: 'stormcaller',
    role: 'damage',
    element: 'storm',
    maxHp: 50,
    moveSpeed: 120,
    attack: { kind: 'projectile', damage: 4, rangePx: 160, cooldownMs: 400 },
    grantsSpell: 'lightning',
  },
} as const satisfies Record<string, ClassDef>;

export type ClassId = keyof typeof CLASSES;
```

```ts
// src/data/convergences.ts: first match by priority wins
export const CONVERGENCES = [
  { id: 'firestorm', requires: ['fire', 'storm'], priority: 10, baseDamage: 120, radius: 140 },
  { id: 'meteor', requires: ['fire'], priority: 1, baseDamage: 150, radius: 90 },
  { id: 'thunderstorm', requires: ['storm'], priority: 1, baseDamage: 100, radius: 120 },
] as const satisfies readonly ConvergenceDef[];

export const CONVERGENCE_SCALING = [1.0, 1.5, 2.0, 2.5] as const; // index = living mages - 1
```

**Typed event bus.** Systems communicate through events instead of reaching into each other:

```ts
// src/game/events.ts
export interface GameEvents {
  'unit:damaged': { id: EntityId; amount: number; source: EntityId | null };
  'unit:died': { id: EntityId; team: Team; cause: 'combat' | 'volunteer' };
  'squad:leader-changed': { id: EntityId };
  'spell:cast': { spell: SpellId; at: Vec2 };
  'spell:lost': { spell: SpellId };
  'status:applied': { id: EntityId; status: StatusId };
  'reaction:triggered': { reaction: ReactionId; at: Vec2 };
  'convergence:charged': Record<string, never>;
  'convergence:released': { combo: ConvergenceId; power: number; at: Vec2 };
  'volunteer:detonated': { id: EntityId; name: string; at: Vec2 };
  'mission:target-destroyed': { target: TargetId; progress: number; required: number };
  'portal:opened': { at: Vec2 };
  'portal:extracted': { saved: EntityId[]; leftBehind: EntityId[] };
  'mission:ended': { result: 'victory' | 'defeat' };
}
```

**One authoritative state per entity.** Health, statuses and alive/dead state live in one component. Sprites, health bars and counters only *read* it.

**Derived spell availability.** Available spells are computed from living squad classes, never stored separately.

**Lifecycle discipline.** Every system implements `update(dt)` and `destroy()`. Scenes call `destroy()` on `SHUTDOWN` so a restart never leaks listeners or timers. Use only Phaser's clock; no `setInterval` or `setTimeout`.

**Object pooling** for projectiles, beams and particle bursts from M5 onward.

**Debug overlay** toggled with `?debug` in the URL or the backtick key: FPS, entity counts, follow targets, aggro ranges, statuses, Convergence meter value. In debug mode, `C` fills the meter.

**Versioned saves**

```ts
interface SaveDataV1 {
  version: 1;
  settings: Settings;
  bestTimes: Record<MissionId, number>;
  hatHill: FallenWizard[]; // name, class, mission, cause: 'combat' | 'volunteered' | 'left-behind'
}
```

Migrations run on load. Never read raw `localStorage` outside `platform/storage`.

---

## 8. MVP scope

### In scope

- **One mission:** "Goblin Woods", a handcrafted forest map with a goblin camp, obstacles, powder kegs, two Goblin Huts and a sealed extraction portal
- **Squad of four:** a mix of **Pyromancer** and **Stormcaller** (for example 2 + 2), with silly generated names and leader succession
- **Spells:** Fireball and Lightning, granted by living classes and lost with them
- **Statuses and reactions:** *Burning*, **Combust** (Burning + Storm) and **Kaboom** (powder kegs)
- **Convergence:** meter, channel, and the three MVP combos (Meteor, Thunderstorm, Firestorm) with living-mage scaling
- **Volunteer!**, with Hat Hill epitaph data recorded (the full Hat Hill screen is post-MVP)
- **Enemies:** Goblin Grunt, Goblin Archer; **structures:** Goblin Hut, Powder Keg
- **Mission loop (§4.4):** destroy both huts (each lights a portal rune), the portal opens and a final surge wave spawns, the leader enters the portal, survivors inside its radius are saved, then results and instant restart
- **Defeat:** when the entire squad is dead

### Explicitly out of scope for the MVP

Procedural levels · more than one mission · recruitment or meta-progression · inventory and equipment · multiplayer or online features · individual unit selection · skill trees · fire-spread simulation beyond Combust · large bespoke animation sets · backend of any kind · classes and enemies marked Post-MVP.

### MVP definition of done

- [ ] Launches in a desktop browser with zero console errors
- [ ] Squad moves with WASD; the camera follows and stays within map bounds
- [ ] Followers keep formation without overlapping, oscillating or getting stuck
- [ ] Each class auto-attacks with its own behaviour; Pyromancer attacks apply Burning
- [ ] Goblins chase and attack; archers keep range and shoot; huts spawn until destroyed
- [ ] Fireball and Lightning hit the aimed world position at any camera scroll
- [ ] Losing the last mage of a class greys out and disables its spell
- [ ] Combust and Kaboom trigger reliably and are visually obvious
- [ ] Convergence charges, channels, resolves the correct combo and scales with living mages
- [ ] Volunteer picks the last trail wizard, never the leader, and handles spell loss correctly
- [ ] Leader succession works; defeat only triggers when the whole squad has died
- [ ] Each destroyed target lights a portal rune; the portal opens and the final surge spawns after the last one
- [ ] Extraction saves only wizards inside the portal radius; the rest are recorded as "Left behind"
- [ ] Restart works without a page reload and without leaks (listener and entity counts stay stable across 10 restarts)
- [ ] Playable with touch on a real phone
- [ ] Installable test builds on iOS and Android

---

## 9. Milestones

Each milestone ends with: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` passing, a manual play test, and a git commit tagged `m<N>`.

Effort assumes 8–12 hours a week with Claude assisting. The total estimate for a playable MVP is roughly **10–16 weeks**.

### M1 — Foundation (2–4 h)
Scaffold Vite, TypeScript and Phaser 4. Set up strict tsconfig, path aliases, ESLint boundaries, Prettier and Vitest. Add a Boot scene and an empty Mission scene, pixel-art config and `Scale.FIT`. Add `.nvmrc` and a README.
**Done when:** all scripts pass and a placeholder sprite renders crisply at multiple viewport sizes.

### M2 — Movement and camera (4–8 h)
Placeholder leader, `GameInput` with `KeyboardMouseInput`, normalised diagonal movement, world bounds, smooth camera follow with deadzone, and the debug overlay.
**Done when:** movement feels responsive and the camera never shows space outside the map.

### M3 — Squad following (6–10 h)
Three followers using a breadcrumb trail plus formation offsets, separation steering, `SquadSystem` and leader succession. Recruits get generated names.
**Done when:** no oscillation, bunching or teleporting, and killing the leader (debug key) promotes the next wizard cleanly.

### M4 — Classes and auto-combat (8–12 h)
Pyromancer and Stormcaller class data with distinct auto-attacks. Goblin Grunt and Archer, `StateMachine`, `EnemyAiSystem`, `TargetingSystem`, `CombatSystem`, `StatusSystem` (Burning), hit flash and knockback.
**Done when:** the squad beats a goblin group with no player input, Burning ticks and expires, and dead units never act or take damage. Unit tests cover damage, cooldowns, targeting, statuses and the state machine.

### M5 — Granted spells and reactions (8–12 h)
`SpellSystem` with spell slots derived from living classes, Fireball (pooled projectile) and Lightning (telegraph, then strike). Reaction resolver with Combust, Powder Keg with Kaboom, and HUD spell slots with cooldown and lost states.
**Done when:** spells land precisely at every camera position, losing the last Pyromancer disables Fireball, and Combust and Kaboom trigger reliably.

### M6 — Convergence and Volunteer (8–12 h)
`ConvergenceSystem` (meter, channel, combo resolution from `CONVERGENCES`, scaling), beam FX and the HUD meter. `VolunteerSystem` (pick the last trail wizard, sprint, detonate, record the Hat Hill entry) with barks.
**Done when:** each MVP combo resolves correctly for every living-squad composition (unit-tested), the channel is interruptible by damage only if that is the design decision, and Volunteer never picks the leader.

### M7 — Complete mission: Destroy & Extract (10–16 h)
Tiled map for Goblin Woods with collision, spawn and prop layers. Goblin Huts with `SpawnerSystem`, powder kegs placed for combos, data-driven `MissionSystem` objectives, and `PortalSystem` (sealed portal with runes, opening moment, final surge wave, extraction radius, "left behind" handling) per §4.4. A results screen shows time, kills, and wizards saved and lost by name and cause; restart is clean.
**Done when:** a full mission can be played from start to result, extraction correctly splits saved and left-behind wizards, and the restart leak check passes.

### M8 — Art and touch controls (1–3 weeks)
Swap placeholders for final art incrementally (Pyromancer → Stormcaller → goblins → tiles → spell FX → Convergence FX). Add `TouchInput`, joystick, drag-to-aim, ultimate and volunteer buttons, and handle safe areas.
**Done when:** the game looks coherent and is comfortable to play on a physical phone.

### M9 — Cross-platform hardening (1–3 weeks)
Add Capacitor 8 with iOS and Android projects. Pause and resume on app background, handle audio unlock and orientation lock, tune performance on a low-end Android device and a real iPhone, and validate save migrations.
**Done when:** every platform passes the MVP definition of done.

### Post-MVP roadmap (ordered by expected fun per hour)
1. **Hat Hill** memorial screen using the recorded fallen-wizard data
2. **Batch 1:** Frost Warden, Hedge Druid, Orc Brute, Goblin Sapper, Watchtower, plus Shatter, Wildfire, Blizzard and Overgrowth
3. Missions 2 and 3
4. Caged apprentices (mid-mission recruitment) and a pre-mission squad picker
5. **Batch 2:** Necromancer, Runesmith, Goblin Shaman, Wolf Rider, Orc Berserker, Orc Javelineer, Steam
6. Audio pass: spell sounds, death yelps, volunteer barks, music
7. Orc Warchief boss mission
8. Wild Surge, mana shards, Hardcore friendly-fire mode
9. Itch.io release of the web build; app stores later

---

## 10. Claude CLI prompts

Run one prompt per milestone. Review the work, play test it and commit before moving on. Every prompt begins with:

> Read `CLAUDE.md` and `plan.md`. We are working on milestone **M<N>** only.

### M1
```
Read CLAUDE.md and plan.md. We are working on milestone M1 only.

Scaffold the project as described in plan.md §5 and §7:
- Vite vanilla-ts, Phaser 4 (pinned exact version), strict TypeScript with the flags in §5.
- Path aliases @core, @data, @game, @platform in tsconfig and vite config.
- ESLint flat config with the import boundaries from §7.3, Prettier, Vitest.
- Scripts: dev, build, preview, typecheck, test, test:watch, lint, format.
- .nvmrc (Node 22+), engines field, README with setup steps.
- Check whether Phaser 4's agent skills ship in node_modules/phaser. If not, tell me
  so I can add them to .claude/skills/phaser.
- BootScene and an empty MissionScene showing one placeholder sprite.
- Pixel-art friendly config and responsive scaling.
Do not implement gameplay. Run all checks and report exactly what passed.
```

### M2
```
Read CLAUDE.md and plan.md. We are working on milestone M2 only.

Implement the GameInput interface from plan.md §6 and a KeyboardMouseInput adapter
(all actions mapped, even those not used yet). Add a placeholder squad leader with
normalised diagonal movement, world bounds and a CameraController with smooth follow and
deadzone. Movement math lives in src/core with unit tests. Add the debug overlay
(?debug or backtick). Clean up input on scene shutdown.
No followers, enemies or combat. Run all checks.
```

### M3
```
Read CLAUDE.md and plan.md. We are working on milestone M3 only.

Add three followers and a SquadSystem: breadcrumb-trail following with formation offsets,
separation steering and leader succession (§3.1). Add a seeded silly-name generator in
src/core/names. Trail, formation and succession logic are pure and tested. Add debug keys
to kill the leader or a random follower. Extend the overlay with follow targets and spacing.
No combat yet. Report any obstacle-navigation limitations.
```

### M4
```
Read CLAUDE.md and plan.md. We are working on milestone M4 only.

Implement plan.md §3.1 (Pyromancer, Stormcaller only) and §3.2 (Goblin Grunt, Goblin
Archer only) as typed data. Add a generic StateMachine in src/core/ai, EnemyAiSystem,
TargetingSystem (deterministic nearest enemy), CombatSystem with per-class auto-attacks,
and StatusSystem with Burning (data in src/data/statuses.ts). Use the typed event bus
from §7.4. One authoritative state per entity; dead units never act or receive damage.
Add hit flash and knockback. Unit-test damage, cooldowns, targeting, statuses and the
state machine.
No player spells. Verify the full fight in the running game.
```

### M5
```
Read CLAUDE.md and plan.md. We are working on milestone M5 only.

Implement SpellSystem per plan.md §3.1 and §6: spell slots derived from living classes,
Fireball (pooled projectile, area damage, applies Burning) and Lightning (telegraph, then
strike). Emit spell:lost when the last mage of a class dies. Implement the reaction
resolver from §4.3 (Combust, Kaboom) with data in src/data/reactions.ts, plus a Powder
Keg structure. HUD spell slots show cooldown and lost states. Convert aim to world
coordinates via the camera. Unit-test cooldowns, area damage, slot derivation and reaction
resolution. Test at several camera positions.
```

### M6
```
Read CLAUDE.md and plan.md. We are working on milestone M6 only.

Implement Convergence (§4.1): meter charge from kills and damage, 1.2 s channel with beam
FX, combo resolution by priority from src/data/convergences.ts, power scaling by living
mages, and a HUD meter. Before coding, propose whether damage interrupts the channel and
wait for my decision.
Implement Volunteer! (§4.2): pick the last trail wizard (never the leader), bark, sprint
to the aim point, detonate, handle spell loss and record a Hat Hill entry in the save
model (§7.4).
Pure logic in src/core/convergence and src/core/squad with exhaustive tests for every
MVP squad composition.
```

### M7
```
Read CLAUDE.md and plan.md. We are working on milestone M7 only.

Build mission m01-goblin-woods per plan.md §4.4 and §8: a Tiled JSON map with collision,
spawn and prop layers (powder kegs placed to invite combos, the portal placed far from the
start), two Goblin Huts driven by SpawnerSystem, and a data-driven MissionSystem using the
MissionDef from §4.4.
PortalSystem: sealed portal showing one rune per target, a rune lights on each
mission:target-destroyed, the portal opens with FX and triggers the final surge wave, and the
leader entering completes the mission. Wizards inside radiusPx are saved; the others are
recorded as "left-behind" on Hat Hill.
Objective progress, extraction splitting and win/lose rules are pure logic in
src/core/mission with tests. Add a ResultsScene (time, kills, saved and lost by name and
cause). Restart must not leak: log listener and entity counts and verify they are stable
across 10 restarts.
```

M8 and M9 prompts are written once M7 is done, informed by what the play tests reveal.

---

## 11. Asset pipeline

1. **Style lock first.** Generate concept art for the Pyromancer, a Goblin Grunt and one tile set. Agree on the palette, outline style and sprite scale (for example, 32×32 characters on a 16 px tile grid).
2. **One character end to end.** Pyromancer idle, 4-direction walk and cast animations → atlas → in game → check readability. Then the Stormcaller, reusing the base body.
3. **MVP sprite list:** Pyromancer, Stormcaller, Goblin Grunt, Goblin Archer, Goblin Hut (intact and destroyed), Powder Keg, a forest tileset, and the Portal (sealed with dark runes, lit runes, opening animation, open swirl loop).
4. **MVP FX list:** fire bolt, spark, fireball travel and impact, lightning telegraph and strike, Burning overlay, Combust and Kaboom explosions, Convergence beams plus Meteor, Thunderstorm and Firestorm, Arcane Detonation, portal opening burst, extraction warp-out, hit flash and death puff.

Rules:
- Raw generations (for example from Higgsfield) go in `assets-src/`; only cleaned, packed atlases go in `public/assets/`.
- Expect manual cleanup of AI sprite sheets: frame alignment, stray pixels, inconsistent sizes.
- Record the source and licence of every asset in `assets-src/PROVENANCE.md`.

---

## 12. Mobile packaging (M9)

1. Deploy the web build to a test URL and test it in mobile browsers first.
2. Add Capacitor 8 and set the app ID (for example `nl.<yourdomain>.arcanefodder`).
3. Generate the iOS and Android projects and build them in Xcode and Android Studio.
4. Test touch, safe areas, orientation, pause/resume, audio unlock and performance on real devices.
5. Swap `LocalStorageSaveRepository` for a Capacitor Preferences implementation if needed.

Needed: a Mac with current Xcode for iOS, an Apple Developer account for TestFlight or the App Store, and the Android SDK with a signing key.

---

## 13. Week-one checklist

- [ ] Create the repo `arcane-fodder`, add `plan.md` and `CLAUDE.md`
- [ ] Complete M1 and tag `m1`
- [ ] Complete M2 and play-test the movement feel yourself
- [ ] Start M3 squad following
- [ ] Commit a known-good build before combat begins

---

## Appendix A — `CLAUDE.md` template

```markdown
# Arcane Fodder — Project Instructions

Top-down fantasy squad action game inspired by Cannon Fodder. The player leads a squad of
expendable wizards against goblins and orcs. Followers move and fight automatically. Each
mage class grants the player a spell (lost when that class dies out). Signature mechanics:
Convergence ultimate, Volunteer! sacrifice, elemental reactions. Every mission is "destroy X
targets, then extract through the portal"; wizards outside the portal radius are left behind.
Full scope, roster, architecture and milestones: see plan.md.

## Stack
TypeScript (strict) · Phaser 4 (pinned) · Vite · Vitest · ESLint + Prettier · Capacitor 8 (M9 only).
Never upgrade a major version or add a dependency without asking.
Consult .claude/skills/phaser (or node_modules/phaser/skills) before writing Phaser API code.
Do not use Phaser 3-only APIs.

## Architecture rules
- src/core is pure TypeScript: no Phaser, DOM or platform imports. Put game rules here and test them.
- src/data holds typed definitions using `as const satisfies`. No magic numbers in systems.
- Only build classes, enemies and mechanics marked MVP unless the milestone says otherwise.
- Systems talk through the typed event bus in src/game/events.ts.
- One authoritative state per entity. Views only read it. Spell availability is derived, not stored.
- Every system has update(dt) and destroy(). Clean up on scene SHUTDOWN.
- Use the Phaser clock only. No setInterval or setTimeout.
- Convert pointer positions to world coordinates before any gameplay use.
- Pool projectiles, beams and FX.
- Storage only through platform/storage.

## Workflow
- Work on one milestone at a time, as named in the prompt. Do not start the next one.
- Read the relevant files before editing. Don't rewrite unrelated working code.
- Present a short plan before any architectural change.
- Run typecheck, lint, test and build before reporting. Never claim a check passed unless it ran.
- Never weaken tsconfig or lint rules, or delete tests, to make the build pass.
- Report what changed, what was verified and any known limitations.

## Assets
- Raw art goes in assets-src/; runtime-ready atlases go in public/assets/.
- Inspect generated sprite sheets before use; never assume the frames are valid.
- Use placeholders when final art is unavailable. Record provenance in assets-src/PROVENANCE.md.

## Out of scope for the MVP
Backend, multiplayer, accounts, procedural generation, meta-progression, inventory, skill
trees, and all Post-MVP classes and enemies.
```
