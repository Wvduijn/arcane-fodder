# Arcane Fodder

Top-down fantasy squad action game inspired by Cannon Fodder, built with Phaser 4, TypeScript and Vite.
`plan.md` is the source of truth for scope, architecture and milestones.

## Setup

Requires Node 22 (>= 22.13) and pnpm 10. pnpm is the only supported package manager (ADR 0002).

```sh
nvm install        # reads .nvmrc (22)
nvm use
corepack enable    # provides the pnpm version pinned in package.json "packageManager"
pnpm install
pnpm dev           # http://localhost:5173
```

## Scripts

| Script            | What it does                                                          |
| ----------------- | --------------------------------------------------------------------- |
| `pnpm dev`        | Vite dev server with hot reload                                       |
| `pnpm build`      | Typecheck, then production build into `dist/`                         |
| `pnpm preview`    | Serve the production build locally                                    |
| `pnpm typecheck`  | `tsc --noEmit` over `src/`, `tests/` and `vite.config.ts`             |
| `pnpm test`       | Run the Vitest suite once                                             |
| `pnpm test:watch` | Vitest in watch mode                                                  |
| `pnpm lint`       | ESLint (type-aware, includes layer boundaries)                        |
| `pnpm lint:fix`   | ESLint with autofix                                                   |
| `pnpm format`     | Prettier over code and config (docs owned by other roles are ignored) |

Quality gate before any task is reported done:

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Layers

Dependencies point down only (plan.md §7.1):

```
platform/   storage, lifecycle, Capacitor bridge
game/       Phaser scenes, entities, systems, input, FX, in-canvas UI
data/       typed definitions (classes, spells, missions, ...)
core/       pure TS rules: math, combat, AI, reactions, RNG
```

Enforced by ESLint (`eslint.config.js`) and guarded by `tests/tooling/boundaries.test.ts`:

- `src/core/**` may import only other core modules (`@core` or relative paths inside core): no
  `phaser`, upper layers, packages or Node built-ins, no dynamic `import()`, and no DOM/Node
  globals (`window`, `globalThis`, `document`, `localStorage`, `performance`, `process`, ...).
- `src/data/**` may import other data modules, and only types from core (`import type`, ADR 0003).
  No dynamic `import()`.
- All of `src/**`: no `setTimeout`/`setInterval` (use the Phaser clock). Browser storage is reachable
  only from `src/platform/**`.

## Path aliases

Defined in both `tsconfig.json` (`paths`) and `vite.config.ts` (`resolve.alias`):

| Alias         | Path             |
| ------------- | ---------------- |
| `@core/*`     | `src/core/*`     |
| `@data/*`     | `src/data/*`     |
| `@game/*`     | `src/game/*`     |
| `@platform/*` | `src/platform/*` |

## Rendering

Logical resolution is 640×360, scaled with `Scale.FIT` and centered. `pixelArt` (nearest-neighbour)
and `roundPixels` are on. Scale sprites by whole numbers only so every texel stays the same size.

## Phaser 4 references

Phaser ships agent skill files in `node_modules/phaser/skills/` (one folder per subsystem, plus
`v3-to-v4-migration` and `v4-new-features`). Read them before writing Phaser API code; do not use
Phaser 3-only APIs.
