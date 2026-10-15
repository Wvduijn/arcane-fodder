# Review M2-T2b — ActionBuffer (edge-trigger extraction)

Reviewer: reviewer · Date: 2026-10-14 · Owner of task: core-dev
Scope: src/core/input/actionBuffer.ts, tests/core/input/actionBuffer.test.ts. This is the core half
of M2-T3 m2. KeyboardMouseInput doesn't use it yet, so T3 m2 stays open until game-dev wires it in.

## Verdict: PASS

`ActionBuffer` holds the same pending → ready → consume logic as KeyboardMouseInput.ts:47-50 and
:98-105, Phaser-free and generic over the action type. The tests cover every case M2-T3 m2 asked
for and more. Naming the method `update()` instead of `advance()` is fine: it matches the
`GameInput.update()` / `System.update()` convention, and the doc comment (:20) says exactly what it
does.

## Checks run (real output)

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 (core boundary: no imports at all) |
| `pnpm test` | `Test Files 5 passed (5)` / `Tests 112 passed (112)` (12 new) |
| `pnpm build` | exit 0 |
| `pnpm exec prettier --check src/core/input tests/core/input` | clean |

## M2-T3 m2 cases

| Asked for | Test |
|---|---|
| consume is true once only | actionBuffer.test.ts:18-23, :25-31 (several presses in one frame count as one) |
| A press is invisible until `update()` | :47-53 |
| An unconsumed press is dropped after one more `update()` | :40-45 |
| A press and release in one frame still counts | :33-38 |
| Extra: consumed stays consumed, re-press in the same frame, independent actions, `reset()` | :55-101 |

### Mutation reasoning
I checked by hand that each plausible regression breaks at least one test:
- `update()` clearing `pending` before promoting it → :18 fails.
- `update()` dropping the `ready.clear()` → :40 fails.
- `consume()` using `has` instead of `delete` → :22 fails.
- `reset()` missing either clear → :81 or :88 fails.

## Findings

### Blocker / Major / Minor
None.

### Nits (optional)
- **n1 (core-dev).** The test at :33-38 can't really model a release, because the buffer has no
  release input, so it runs the same steps as :18-21. Its comment says this honestly. The real
  guarantee (the adapter only calls `press()` on key down) belongs to KeyboardMouseInput. Keep it
  as documentation, or fold it into :18.
- **n2 (producer).** plan.md §7.2 doesn't list `src/core/input/`. The plan says to create folders
  when they're needed, so this is fine. Add it to §7.2 the next time the plan is edited, so the
  folder map stays accurate.
- **n3 (game-dev, for T3 m2).** When adopting it, also call `reset()` on window blur
  (`GameEvents.BLUR`) so that a click that focuses the window doesn't leave a stale press queued,
  and in `destroy()`.
