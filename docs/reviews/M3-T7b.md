# Review M3-T7b — EventBus unit tests

Reviewer: reviewer · Date: 2026-10-15 · Owner of task: core-dev
Scope: `tests/game/bus/EventBus.test.ts` (19 tests) against `src/game/bus/EventBus.ts` (T7 rev 2).
Spec: M3-T7 m1 (a repeatable bus test) and the six edge cases in M3-T7 "Re-review 2".
Serves: D1, D5.

## Verdict: PASS

The bus contract is now pinned in CI. Every behaviour I probed by hand in the browser has a
deterministic Node test, and the three compile-time guarantees are proven through `tsc`, not just
asserted.

## Checks run (real output)

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0. `tests/` is in tsconfig `include` (tsconfig.json:31), so an unused `@ts-expect-error` would fail it |
| `pnpm lint` | exit 0 |
| `pnpm test` | `Test Files 13 passed (13)` / `Tests 298 passed (298)` |
| `pnpm exec vitest run tests/game/bus` | `Tests 19 passed (19)` |

## Requirement walk

| Case | Status | Evidence (test file line) |
|---|---|---|
| Per-event and total `listenerCount` | OK | :26-33 |
| Order; `once` fires once | OK | :35-44 |
| Payload passed through by identity | OK | :46-53 |
| `emit` returns false with no listeners | OK | :55-63 |
| `off` removes `once` registrations; only the given event and listener; unknown is safe | OK | :65-95 |
| Double registration: called twice, one `off` removes both | OK | :99-108 |
| Snapshot: `off`+`on` mid-emit take effect next emit (`[a,b]`, then `[b,late]`) | OK | :110-126 |
| Removed-by-earlier listener still runs this emit (`abcab`) | OK | :128-141 |
| Re-entrant `once` | OK | :143-153 |
| Added mid-emit not called | OK | :155-162 |
| Throwing listener propagates and skips the rest | OK | :164-173 |
| DEV warning, exact strings for one and two events; none on a clean destroy | OK | :177-209, asserting `import.meta.env.DEV` is true first, so the test can't pass vacuously |
| Dead bus: count 0, emit no-op, on/once throw, off and destroy safe | OK | :211-229 |
| Payload types per event | OK | `expectTypeOf` :233-241 |
| Compile-time rejects: wrong payload, widened name, wrong listener parameter | OK | :243-254. Each `@ts-expect-error` is real: `GameEventListener` is a function type, so `strictFunctionTypes` applies with no method bivariance |

Mutation check, done by reading the code rather than running it: dropping the emit snapshot breaks
`abcab`, removing `once` after the call instead of before breaks the re-entrant test, and dropping
the DEV guard's count check breaks "no warning on clean destroy". The tests bite.

## Findings
None.

M3-T7 m1 is now fully closed.
