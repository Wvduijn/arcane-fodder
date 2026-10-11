# Arcane Fodder — Project Instructions

Top-down fantasy squad action game inspired by Cannon Fodder. The player leads a squad of
expendable wizards against goblins and orcs. Followers move and fight automatically. Each
mage class grants the player a spell (lost when that class dies out). Signature mechanics:
Convergence ultimate, Volunteer! sacrifice, elemental reactions. Every mission is "destroy X
targets, then extract through the portal"; wizards outside the portal radius are left behind.
Full scope, roster, architecture and milestones: see plan.md. plan.md is the source of truth.

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

## Studio
Roles live in .claude/agents/. The main session is the **producer** (team lead). The human
is **creative director**: they approve every phase transition, every contract change and every
design question plan.md says to ask about (for example the Convergence channel interrupt in M6).

### File ownership
Only the owner edits a path. Everyone else reads it and messages the owner by name.

| Path | Owner |
|---|---|
| plan.md, CLAUDE.md, .claude/**, docs/decisions/** | producer (human approval) |
| src/core/types.ts, src/game/events.ts (contracts) | producer (human approval) |
| src/core/** (except types.ts), tests/** | core-dev |
| src/game/** (except events.ts), src/app/**, src/platform/**, src/main.ts | game-dev |
| src/data/** (except missions/ and animations.ts), docs/design/gdd/** | game-designer |
| src/data/missions/**, public/assets/tilemaps/**, docs/design/levels/** | level-designer |
| assets-src/style-guide.md, assets-src/concept/**, assets-src/raw/** | art-director |
| assets-src/sprites/**, public/assets/atlases/**, src/data/animations.ts, scripts/assets/** | tech-artist |
| docs/reviews/** | reviewer |
| assets-src/PROVENANCE.md | art-director, tech-artist (append only) |

### Collaboration rules
- Handoffs happen through files. A message points to a file; it never replaces it.
- Contract changes (types.ts, events.ts) are proposed to the producer by message, never edited directly.
- Designers change numbers in src/data, never code. Developers change code, never tuning values.
- When blocked on another role, message that role by name and continue with other work.
- A task is only complete when its deliverable file exists and the quality gate passes.

## Workflow
- Work on one milestone at a time, as named in the prompt. Do not start the next one.
- Read the relevant files before editing. Don't rewrite unrelated working code.
- Present a short plan before any architectural change.
- Run typecheck, lint, test and build before reporting. Never claim a check passed unless it ran.
- Never weaken tsconfig or lint rules, or delete tests, to make the build pass.
- Report what changed, what was verified and any known limitations.

## Assets
- Raw generations go in assets-src/raw/; cleaned frames in assets-src/sprites/; packed atlases in public/assets/atlases/.
- Every generated image follows assets-src/style-guide.md and uses its locked reference images.
- Inspect generated sprite sheets before use; never assume the frames are valid.
- Use placeholders when final art is unavailable. Record provenance in assets-src/PROVENANCE.md.

## Out of scope for the MVP
Backend, multiplayer, accounts, procedural generation, meta-progression, inventory, skill
trees, and all Post-MVP classes and enemies.
