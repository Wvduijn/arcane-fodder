# M1 Review Gate — Foundation

Reviewer: reviewer · Date: 2026-10-12
Scope: everything since the initial commit `593049f`, including untracked files (scaffold, src,
tests, README, ADR 0002/0003, sprint doc) and the producer's tracked changes to CLAUDE.md,
plan.md, .claude/settings.json, .claude/hooks/quality-gate.sh, .claude/skills/milestone/SKILL.md
and .claude/agents/*.md.
Task reviews: M1-T1.md … M1-T5.md (this directory).

## Verdict: PASS WITH NOTES

Every M1 "Done when" item passes with evidence, and there are **no blockers**. One major finding
is a process/permissions issue in `.claude/settings.json`, not in the deliverable. It goes to the
producer and needs human approval to change. The rest are minor, plus two observations for the
human's playtest.

## Quality gate (my own run on the final tree)

eslint.config.js 17:01:27, boundaries.test.ts 17:02:11; src/ unchanged since 16:57:08.

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0, no messages |
| `pnpm test` | `Test Files 2 passed (2)` / `Tests 68 passed (68)`, exit 0 |
| `pnpm build` | `dist/index.html 0.51 kB` · `dist/assets/index-BaeltcYu.js 1,376.10 kB │ gzip: 358.34 kB` · `✓ built in 366ms`, exit 0 |
| `pnpm exec prettier --check .` | `All matched files use Prettier code style!` |

## Done-when walk

### plan.md §9 M1

| Item | Verdict | Evidence |
|---|---|---|
| Scaffold Vite, TypeScript and Phaser 4 | PASS | package.json: vite 8.3.4, typescript 6.0.3 (accepted deviation from 7), phaser 4.2.1, all exact pins; lockfile specifiers match (M1-T1) |
| Strict tsconfig | PASS | tsconfig.json: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` + 6 further strict flags |
| Path aliases | PASS | `@core/@data/@game/@platform` in tsconfig.json `paths` and vite.config.ts `resolve.alias` |
| ESLint boundaries | PASS | eslint.config.js allow-list per layer (`layerBoundary`); 38-case adversarial probe, 0 mismatches (see below); 68 tests incl. tests/tooling/boundaries.test.ts |
| Prettier | PASS | .prettierrc, .prettierignore, eslint-config-prettier last; `prettier --check .` clean |
| Vitest | PASS | vite.config.ts `test` block; 68 tests; `passWithNoTests` removed |
| Boot scene and empty Mission scene | PASS | src/game/scenes/BootScene.ts, MissionScene.ts; Boot → Mission handoff observed (sprite renders) |
| Pixel-art config and `Scale.FIT` | PASS | src/app/config.ts `pixelArt: true` (implies roundPixels), `Scale.FIT` + `CENTER_BOTH`, 640×360 |
| `.nvmrc` and README | PASS | `.nvmrc` = `22`; README.md (setup, scripts, layers, aliases, rendering, Phaser skills) |
| **Done when:** all scripts pass | PASS | quality gate above |
| **Done when:** placeholder sprite renders crisply at multiple viewport sizes | PASS | smoke test below |

### docs/design/sprints/M1.md

| Item | Verdict | Evidence |
|---|---|---|
| **D1** typecheck, lint, test, build pass | PASS | quality gate above |
| **D2** crisp sprite, no smoothing, multiple sizes, `Scale.FIT` | PASS | 4 viewports; exact palette, zero blended pixels, `image-rendering: pixelated` |
| **D3** scaffold matches §5/§7 (flags, aliases, boundaries, Prettier, Vitest, scripts, `.nvmrc`, `engines`, README) | PASS | M1-T1 (PASS WITH NOTES), M1-T3 (PASS), M1-T5 (PASS); `engines.node >=22.13.0` (accepted deviation) |
| **D4** Phaser 4 agent-skills availability reported to the human | PASS (relay pending) | `node_modules/phaser/skills/` has 28 folders, each with a `SKILL.md` (M1-T5). Reported to the producer; the producer still has to tell the human (Q3: nothing to add to `.claude/skills/phaser`) |

## Browser smoke test (`pnpm build && pnpm preview`)

Headless Chrome over CDP with `Emulation.setDeviceMetricsOverride`, not a window resize. The
mobile runs use `mobile: true`, DPR 3, touch (5 points) and an iPhone UA. Network and console were
captured per page and the screenshots were decoded for colour and texel analysis. The bundle
tested is `index-BaeltcYu.js`, the same file the final `pnpm build` produced.

| Viewport | Canvas CSS rect | HTTP | Console | Colours | Texel widths |
|---|---|---|---|---|---|
| 1280×720 @1 | 0,0 1280×720 (2×) | `/` 200, `index-BaeltcYu.js` 200 | Phaser banner only (+ SwiftShader `GPU stall due to ReadPixels` warnings from capture) | 9 = 8 sprite + bg | 8·n px, uniform |
| 2560×1440 @1 | 0,0 2560×1440 (4×) | same | Phaser banner only | 9 | 16·n px, uniform |
| 390×844 @3 mobile | 0,312 390×219 (0.61×) | same | Phaser banner only | 10 (+ `#000` letterbox) | 7/8 mixed (O1) |
| 844×390 @3 mobile | 75,0 693×390 (1.08×) | same | Phaser banner only | 10 (+ `#000` pillarbox) | 12/13 mixed (O1) |

- **Favicon 404 gone:** no `/favicon.ico` request at all. The only HTTP requests are `/` and the
  bundle, both 200. The 5 extra responses are Phaser's internal `data:` URIs.
- Zero exceptions, zero console errors.
- Evidence: docs/reviews/M1-screenshots/{1280x720,2560x1440,390x844-mobile,844x390-mobile-landscape}.png
  and docs/reviews/M1-screenshots/console.md (full console and network log per viewport).

## eslint.config.js re-probe (current file, 17:01:27)

On n1-n3: my Re-review 2 *did* read an older config (16:52:32). Re-review 3 in M1-T1.md had
already confirmed n1-n3 closed on the 16:55:40 version. Since then game-dev has also landed fixes
for my Re-review 3 findings n4-n6. I re-ran the same 38-case probe on the current file with
**0 mismatches**:

| Finding | Status | Evidence |
|---|---|---|
| n1 bare built-ins in core | closed | `'fs'`, `'node:path'`, `'lodash'` blocked (allow-list); tests :109-117 |
| n2 globalThis / self | closed | blocked in core; storage via `window/globalThis/self` blocked in src/** outside src/platform; tests :118-131, :310-330 |
| n3 `game`/`main` false positives | closed | `./game`, `../main`, `../ai/main` clean; tests :145-153 |
| n4 non-canonical relative paths | closed | `NON_CANONICAL_RELATIVE` (eslint.config.js:37-41) in every layer block; tests core :69-80, data :247-253 |
| n5 depth beyond `MAX_LAYER_DEPTH` | closed | `MAX_LAYER_DEPTH = 8` (:48); depth-5 `'../../../../types'` now clean; test :154-159 |
| n6 inline `type` specifier side effect | closed | `'@typescript-eslint/no-import-type-side-effects': 'error'` for src/** (:126); tests :255-262, :301-308 |
| ADR 0003 | enforced | value imports from core rejected via alias, relative, mixed, `export *`; `import type` / `export type` accepted |
| m4 `@types/node` global | deferred (accepted) | tsconfig.json:7 |

Nit: the comment at eslint.config.js:43-46 still says "(review M1-T1 n5, deferred)". n5 was fixed
by raising the depth to 8; only the fail-safe behaviour beyond 8 remains. Reword when convenient.

## Diff review against CLAUDE.md

**Code (untracked):** layering is lint-enforced and verified by the probe and tests. There are no
tuning values in src/core or src/data. Neither has gameplay content yet; the only numbers are the
engine resolution (ADR 0002) and the placeholder scale in src/game. There are no timers, no
storage, no listeners, so there's nothing to destroy yet. `textures.exists` makes Boot idempotent.
The code uses Phaser 4 APIs only. `src/core/types.ts` matches the sprint contract exactly
(`EntityId`, `Vec2`), and `events.ts` is correctly deferred to M2. I saw no file-ownership
violations: each file was changed by its owning role, as far as the messages and mtimes show.

**Producer changes (tracked diff vs 593049f):** CLAUDE.md (+pnpm, +context7), plan.md §7.3
(ADR 0003 wording) and §9 (pnpm), quality-gate.sh and milestone SKILL.md (npm → pnpm),
tech-artist.md (`pnpm assets:validate`), all agent `tools:` lists (+context7), settings.json
(pnpm allow-list; npm/npx/yarn deny). These match ADR 0002/0003. A grep for stale `npm`/`npx` in
CLAUDE.md, plan.md, README.md, .claude/ and docs/decisions found only the intended "never use npm"
statements and deny rules.

## Findings

### Blocker
None.

### Major

**G1. `Bash(pnpm --silent:*)` auto-approves any pnpm command, which weakens the npx deny.** (owner: producer, human approval)
.claude/settings.json:20. The entry exists so the quality-gate hook can run
`pnpm --silent typecheck|lint|test`. As a prefix wildcard, though, it also auto-approves
`pnpm --silent dlx <any-package>` (pnpm's equivalent of `npx`, which ADR 0002 denies),
`pnpm --silent exec …` and `pnpm --silent add <pkg>`, without a permission prompt. This doesn't
affect the M1 deliverable, but it is a hole in the guardrails the human approved.
Fix: replace it with the three exact entries `Bash(pnpm --silent typecheck)`,
`Bash(pnpm --silent lint)`, `Bash(pnpm --silent test)`, and add `Bash(pnpm dlx:*)` and
`Bash(pnpm --silent dlx:*)` to `deny`.

### Minor

**G2. Adding dependencies no longer prompts.** (owner: producer, human decision)
settings.json:9-11 auto-allow `pnpm install:*` and `pnpm add:*`. CLAUDE.md says "never … add a
dependency without asking", and that permission prompt was the only mechanical check. ADR 0002
explicitly allows install/add, so this is the human's call. I'm flagging it only so the trade-off
is a deliberate one. Option: keep the bare `Bash(pnpm install)` (lockfile restore) allowed and let
`pnpm add` prompt.

**G3. Four `.DS_Store` files are tracked and show up as modified.** (owner: producer, at commit time)
`git ls-files` lists `.DS_Store`, `assets-src/.DS_Store`, `assets-src/concept/.DS_Store` and
`assets-src/concept/moodboard/.DS_Store`. The new .gitignore lists `.DS_Store`, but that doesn't
untrack files that are already committed.
Fix: `git rm --cached` those four files in the M1 commit.

**G4. The sprint doc still says "npm install".** (owner: producer)
docs/design/sprints/M1.md:48 (T5 row). It's historical, but it contradicts ADR 0002. Fix: change
it to `pnpm install`.

**G5. The quality-gate hook's trigger misses `index.html` and `pnpm-lock.yaml`.** (owner: producer)
.claude/hooks/quality-gate.sh:15. A task that changes only `index.html` (which the build depends
on) or the lockfile skips the gate. Fix: add `index\.html|pnpm-lock\.yaml|\.nvmrc` to the regex.
Low impact, because the hook doesn't run `build` anyway.

### Observations for the human (playtest)

- **O1. Pixel uniformity on phones (M1-T4).** Desktop at 2× and 4× gives uniform texels. At the
  fractional FIT scales on phones, the colours stay pure but texel widths differ by 1 device px
  (7/8 and 12/13). If uniform pixels matter, decide in M8/M9 between an integer zoom with
  letterboxing and the current FIT.
- **O2. The portrait playfield is 390×219 CSS px.** Consider an orientation lock or a
  "rotate device" prompt in M8/M9.
- The fun verdict and the manual playtest are the human's. M1 has no gameplay; the check is that
  the wizard shows up centred and sharp in a desktop browser and on a phone.

## Open items carried forward

| Item | Owner | When |
|---|---|---|
| G1 settings wildcard | producer (human approval) | before M2 |
| G2-G5 | producer | at the M1 commit, or before M2 |
| T1 m4 `@types/node` global | game-dev | when src/platform lands (M7/M9) |
| eslint.config.js:43-46 stale "deferred" comment | game-dev | any time |
| D4 relay to the human | producer | now |
| O1/O2 | human | M8/M9 |

## Addendum (freeze confirmation)

The producer declared the code frozen at 68/68. That is the tree this gate reviewed:
eslint.config.js 17:01:27, boundaries.test.ts 17:02:11, src/ 16:57:08, bundle `index-BaeltcYu.js`.
`find` for files newer than 17:02:12 (excluding node_modules, dist, .git and docs/reviews) turns up
only docs/design/sprints/M1.md, where the producer fixed **G4**: line 48 now reads "corepack
enable, pnpm install". **G4 is closed.** Everything else is unchanged and the verdict stands:
**PASS WITH NOTES**, no blockers, with G1 (major, producer, human approval) and G2, G3, G5 open.
