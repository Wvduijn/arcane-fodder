# M3 Gate — Squad following

Reviewer: reviewer · Date: 2026-10-15 · Branch: m3-phase (uncommitted work on top of 5c071d4 "M2 phase")
Inputs: plan.md §9 M3, docs/design/sprints/M3.md (D1–D6, CD answers, review decisions), task reviews
docs/reviews/M3-T0 … M3-T10 and M3-T7b.

## Verdict: PASS WITH NOTES

Every Done-when item is met and every task review ended PASS or PASS WITH NOTES, with no open blocker
or major. The automated playtest held all D2 limits for 60 s (max overlap 3.0 px, slot error 46 px,
step exactly on the cap, zero follower motion at rest). The K×3 run promoted cleanly with held input,
a continuous camera and a marker pop, and the 4th kill left an empty squad. Names reproduce per
attempt, three restarts leak nothing, and the console is clean. The notes are the seven CD-accepted
D6 limitations listed at the end, plus a handful of nits and observations for the CD playtest. The
"feels like ducklings" verdict belongs to the human.

## Quality gate (real output)

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` | `Test Files 14 passed (14)` / `Tests 319 passed (319)` |
| `pnpm build` | exit 0 (`✓ built in 361ms`) |
| `pnpm exec prettier --check .` | `All matched files use Prettier code style!` |

## Done-when walk

| Item | Status | Evidence |
|---|---|---|
| **plan.md §9 M3:** no oscillation | PASS | Playtest A: 327 frames with the leader still for > 1 s, and 0 frames with any follower velocity ≠ 0. The stop-start sims at 144/60/30 fps assert exact zero velocity and unchanged positions for ≥ 2 s (follow.test.ts) |
| **§9 M3:** no bunching | PASS (with D6 items 5–6) | Playtest A max overlap 2.999 px. Reviewer fuzz over 120 one-minute dev-arena runs: ≤ 3.0 px open, ≤ 4.8 px at edges for legs ≥ 300 ms (M3-T6 Re-review 1) |
| **§9 M3:** no teleporting | PASS | max follower step 1.0000 × the cap (on the bound, never over; game-dev measured 0.9999999999999998), leader 0.556 × the cap. Core sims assert the cap at every fps and dt 100 ms |
| **§9 M3:** killing the leader (debug key) promotes the next wizard cleanly | PASS | Playtest B, see below |
| **D1** gate green; trail, follow/formation, succession, RNG and names in pure core with tests | PASS | gate above. src/core/{squad,rng,names,ids} import only `@core/*` (grep). Reviews T3, T4, T5, T6 |
| **D2** GDD §1 verify for 60 s circles/zig-zags/stop-starts: overlap ≤ 6, no oscillation or creep, ≤ 96 from slot, step cap; proven by core sim and reviewer playtest | PASS | core: follow.test.ts and fuzz.test.ts at 144/60/30 fps. Reviewer: playtest A (overlap 3.0, slot error 45.9, step ratio 1.0, rest velocity 0) |
| **D3** succession per GDD §2: K×3 while moving keeps control, held input carries over, camera eases over `successionEaseMs` with no jump, marker pops, trail compacts without snapping, same-frame multi-deaths promote the lowest index, 4th kill leaves an empty squad | PASS | playtest B. Rebase fold fix (M3-T4 Re-review 1: 0 slot jump, exactly −26 px). Lowest-index promotion and wipe in roster.test.ts / follow.test.ts |
| **D4** seeded unique names, fresh per restart (base + attempt), reproducible | PASS | playtest C: attempts 1–4 match `generateRecruitNames(createRng(attemptSeed(1337, a)), RECRUIT_NAMES, 4)` exactly; every squad has 4 distinct names. recruitNames.test.ts |
| **D5** K/L debug keys; overlay shows names, follow targets, spacing, trail; restart leaks no bus listeners, keys or sprites | PASS | M3-T10 (K/L only while visible, auto-repeat ignored). Playtest C: lifecycle identical across 3 restarts. EventBus.test.ts (19 tests) |
| **D6** gate report lists the obstacle-navigation limitations | PASS | final list at the end of this file |

## Automated playtest (row G)

Setup: my own Vite on :5321 with HMR and watch off (a scratch config spreading vite.config.ts),
headless Chrome on CDP :9521, both stopped by PID afterwards. Real keyboard events through CDP. An
in-page `requestAnimationFrame` logger recorded `__ARCANE_DEBUG__.snapshot()` once per game frame.
dt was 16.7 ms throughout. The step cap is 110 × (1.3 + 0.5) = 198 px/s.

**A. 60 s following.** 20 s of octagon circles (400 ms per 8-way key), 20 s of zig-zags (NE/SE ×4,
then NW/SW ×4), 20 s of stop-starts (700 ms walk / 1.6 s stand, including a reversal and a diagonal).

| Metric | Result | Limit |
|---|---|---|
| Frames | 4131 | |
| Max body overlap | **2.999 px** | ≤ 6 |
| Max slot error | **45.9 px** | ≤ 96 |
| Max follower step / cap | **1.0000** | ≤ 1 |
| Max leader step / cap | 0.556 (= 110 / 198) | |
| Frames still > 1 s / with a moving follower | 327 / **0** | 0 |
| Max camera scroll per frame | 4.47 px | |

**B. K×3 while holding D, then a 4th K.**

| Kill | Leader after | Deaths | `lastLeaderChange` | Marker on the new leader (dx, pop) | New leader vx, next 3 frames |
|---|---|---|---|---|---|
| 1 | 2 | 1 | 2 | 0 px, 0.65 at +60 ms | 110, 110, 110 |
| 2 | 3 | 1,2 | 2→3 | 0 px, 0.65 | 110, 110, 110 |
| 3 | 4 | 1,2,3 | 3→4 | 0 px, 0.65 | 110, 110, 110 |
| 4 | none | 1,2,3,4 | stays 4 (no event on a wipe) | hidden | — |

Camera continuity: 53 frames were easing over 3 successions (about 300 ms each = `successionEaseMs`).
Max scroll change per frame while easing was **1.93 px**, against 3.57 px in ordinary walking in the
same run, so the camera never jumped. After the wipe the scroll was identical 500 ms later (it holds
still). Max follower step in this run was 0.587 × the cap, and the max slot error was 2.4 px.

**C. Restarts.** Three Backspace restarts (attempts 2, 3, 4) after the B run (attempt 1):

| Attempt | Names | Lifecycle |
|---|---|---|
| 2 | Cuthbert the Short-Lived / Archibald the Unlucky / Benedict the Once Fireproof / Eustace the Twice-Buried | keys 19, keyDown 11, shutdown 13, bus 4, displayObjects 16, pointer 1/1, overlaysLive 1 |
| 3 | Wilfred the Uninsured / Magnus the Replaceable / Ignatius the Brave, Briefly / Eustace the Expendable | identical |
| 4 | Eustace the Optimistic / Neville the Brave, Briefly / Mungo the Ashen / Magnus the Smouldering | identical |

All three match the independently computed names for those attempts. Earlier runs (M3-T8/T10)
showed the same lifecycle numbers over 7 restarts.

**D. Screenshots** (docs/reviews/M3-screenshots/): `gate-390x844.png`, `gate-1280x720.png` and
`gate-2560x1440.png` (no debug, after walking north), `gate-debug-*.png` (overlay), and
`gate-wiped.png`.
- 1280×720 and 2560×1440: crisp pixel art. The gold marker with its ink outline is clearly visible
  under the leader walking north, drawn over follower 1's hat (CD option a).
- 390×844: letterboxed at 0.61×, the same as M2 (portrait isn't an M3 target). The squad is small but
  readable.

**E. Console.** The page console showed no errors, warnings or exceptions in the gate run, and none
in any of my earlier M3 runs. The only `console.warn` source, EventBus's DEV leftover-listener
warning, never fired from the game.

## Diff review since 5c071d4 (against CLAUDE.md)

| Rule | Status | Evidence |
|---|---|---|
| Ownership | OK | every changed path matches its owner's task in M3.md: types.ts and events.ts (producer, T0); src/data trail/camera/devArena/names and GDD mvp.md/readability.md (game-designer); src/core and tests (core-dev); src/game (game-dev). plan.md, CLAUDE.md, .claude, docs/decisions, assets, tsconfig, eslint config, package.json and the lockfile are unchanged |
| Contracts only as approved | OK | `git diff HEAD -- src/core/types.ts` is additions only, the M3.md block (M3-T0). events.ts matches the approved map |
| Pure core | OK | src/core imports only `@core/*`. No Phaser, DOM, `window` or `Math.random` (grep) |
| No tuning in systems | OK | all follow and succession numbers come from `TRAIL`, `MOVEMENT` and `CAMERA`. Remaining literals are layout or algorithm constants (`SPAWN_BEHIND`, 16 fallback directions) or placeholder marker presentation (M3-T9 n1, deferred to M8) |
| Phaser clock only | OK | no `setTimeout`, `setInterval`, `Date.now` or `performance.now` in src (grep). All animation is driven by scene dt |
| Cleanup on SHUTDOWN | OK | MissionScene tears down systems in reverse, then input, then the bus. Every `bus.on` has a matching `off`. Lifecycle flat over restarts |
| No weakened rules or tests | OK | no `eslint-disable`, `@ts-ignore`, `.skip`, `.only` or `todo` in src or tests. No config diffs. Test count went from 120 to 319 |
| Phaser 4 APIs only | OK | EventEmitter dropped (pure-TS bus). Graphics, Easing and Text APIs checked against node_modules/phaser 4.2.1 |
| Pointer to world coordinates | n/a | no new pointer gameplay in M3 |

## Open notes (nothing blocks)

- M3-T3 n1, n2: `Rng.int` is uniform only up to 2^32, and the seed is silently truncated. Doc only.
- M3-T6 n2: under extreme dt jitter the overlap fallback can reverse a follower for 3–4 frames (D6 item 7).
- M3-T9 n1: marker timings move to src/data if the M8 marker stays procedural.
- M3-T10 n2, n3: crumbs stay drawn after a wipe, and the debug panel reaches the leader's hat at
  spawn on narrow and very large viewports (`gate-debug-2560x1440.png`). Debug only.
- Carry-forward to M4: enemies y-sort in the Units band, so the leader and the marker (bands 11/12)
  will draw above any enemy overlapping the leader's feet (M3-T9 Re-review 3).

## Observations for the CD playtest (feel is the human's call)

1. Walk circles and zig-zags, then stop. Do the followers settle like ducklings, or does the 26 px
   single file read as a conga line?
2. Walk straight back through the squad. Followers now visibly step aside or pause (the T6 fallback).
   Does that read as polite or as twitchy?
3. Press K three times while walking (overlay on with `?debug`, or toggle with backtick). Is the
   300 ms camera ease and the 180 ms marker pop enough of a "Next!" jolt?
4. With the leader drawn above its followers (CD option a), walking north the leader overlaps
   follower 1's face. Is that acceptable?
5. Do the names land? ("Ignatius the Brave, Briefly", "Ulric the Volunteered": GDD §16 playtest
   item 11.)

## D6: obstacle-navigation limitations (final list, from M3.md)

1. Followers aren't resolved against a collision layer, so separation and sidesteps can push a
   follower into a blocker. M7 needs follower collision.
2. Beyond `catchUpDistancePx` a follower heads straight for its slot, not along the trail, so it may
   clip corners in M7.
3. No path-finding around new blockers (GDD §1, out of scope).
4. Look-ahead follows input, not movement, so the camera leans into walls (ADR 0008, M7).
5. Wall pin: a follower squeezed between the leader and a wall or corner, with a follower ahead
   blocking escape along the wall, can overlap beyond 6 px (2.5% of 240 one-minute walled fuzz runs,
   worst 18 px) and drift up to 130 px from its slot. Needs path planning, or followers blocking the
   leader (ruled out by the GDD). Revisit with M7's maps.
6. Very fast input (direction legs of 150–600 ms) in open ground can still reach 7.5 px of overlap
   (reviewer fuzz). Legs of 300 ms or more stay ≤ 3 px open and ≤ 4.8 px at edges.
7. Under extreme frame-time jitter the overlap fallback can briefly reverse a follower for 3–4
   frames. Watch at the playtest.

Resolved during M3: the edge creep (T6 edge fix) and rapid-reversal overlap (T6 M1).

## Addendum (2026-10-15, after the CD playtest): marker depth reverted

The CD reversed M3-T9 option (a). The leader marker is back on the ground layer below every character,
and the leader y-sorts with its followers again (M3-T9 Re-review 4, readability.md:108-109). Effect on
this report:
- Screenshot D notes and playtest prompt 4 described option (a). They're superseded. Partial marker
  occlusion by follower 1 when walking north is now accepted by rule and isn't a defect.
- The M4 carry-forward about enemies drawing under the leader band is withdrawn.
- Re-checked: typecheck, lint and build exit 0, `Tests 319 passed (319)`, prettier clean. game-dev
  reports flat lifecycle over 4 restarts and pop frames on each change. Nothing else in the gate
  depends on draw order: D3's "marker moves with a pop" still holds.

Verdict unchanged: **PASS WITH NOTES**.
