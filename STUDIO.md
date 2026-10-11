# Arcane Fodder Studio — how to run it

## Setup (once)
1. Copy this folder's contents into the root of the `arcane-fodder` repo.
2. Check Claude Code is v2.1.32+ (`claude --version`).
3. Connect Higgsfield as an MCP server for Claude Code (teammates inherit your MCP servers).
4. Optional but recommended: add a browser MCP (e.g. Playwright) so `reviewer` can actually play the game.
5. Trust the project folder when Claude Code asks, so the agent definitions in .claude/agents load.

## The loop
| Phase | Command | Team |
|---|---|---|
| Pre-production | `/preproduction` | game-designer, art-director, level-designer |
| Each milestone | `/milestone M1` … `/milestone M9` | 3–4 roles per milestone (see skill) |
| Gate | `/review-gate M<N>` | reviewer + you |

Start each phase in a fresh session, in plan mode (Shift+Tab). You approve, playtest, commit and tag.

## Roles
| Agent | Owns | Model |
|---|---|---|
| producer | the lead session: plan.md, contracts, sprints | your session model |
| game-designer | src/data tuning, GDD | opus |
| art-director | style guide, concept, Higgsfield generations | opus |
| level-designer | missions, Tiled maps | sonnet |
| tech-artist | sprites, atlases, animation data | sonnet |
| core-dev | src/core + tests | opus |
| game-dev | Phaser layer | opus |
| reviewer | reviews + playtests (read-only) | opus |

## Folder contract
- `docs/design/` GDD, level docs, sprint plans
- `docs/decisions/` ADRs: every approved decision
- `docs/reviews/` reviewer verdicts
- `assets-src/` raw → sprites, style guide, PROVENANCE.md
