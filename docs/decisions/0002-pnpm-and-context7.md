# ADR 0002 — pnpm and context7

Status: accepted (creative director, 2026-10-12)

## Decision
- pnpm is the only package manager. Dependencies are pinned exactly (`pnpm add -E`). npm, npx and yarn are denied in .claude/settings.json; pnpm install/add and scripts are allowed.
- Every role fetches current library documentation through the context7 MCP before writing code against a library API.
- Logical game resolution is 640×360 with `Scale.FIT`.

## Consequences
plan.md §9, the milestone skill, the quality-gate hook and tech-artist instructions now use `pnpm`.

## Amendment (M1 gate, findings G1/G2/G5, approved 2026-10-12)
- Only plain `pnpm install` (lockfile install) is auto-allowed. `pnpm add` and `pnpm install <pkg>` prompt the human, so adding a dependency is always asked for.
- `pnpm dlx` (the npx equivalent) is denied. The `pnpm --silent:*` wildcard was removed; the quality-gate hook does not go through tool permissions.
- The quality-gate hook also runs when `index.html` or `pnpm-lock.yaml` changes.
