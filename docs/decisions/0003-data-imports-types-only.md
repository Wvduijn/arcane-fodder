# ADR 0003 — src/data imports only types from src/core

Status: accepted (creative director, 2026-10-12)

## Context
plan.md §7.1 said data imports "only types" from core; §7.3 said "only from core". They conflicted.

## Decision
`src/data/**` may use `import type` from `@core/**` and import other `src/data/**` files. Value imports
from core (e.g. `@core/math/vec2`) are forbidden, enforced by ESLint and covered by tests/tooling/boundaries.test.ts.
Data files stay plain typed definitions; any computation belongs in core.

## Also decided
All agent definitions with an explicit `tools:` list now include the context7 MCP tools (ADR 0002 follow-up).
