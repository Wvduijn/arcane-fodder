# ADR 0001 — Build with a Claude Code agent studio

Status: accepted

## Context
Arcane Fodder is built by one developer with Claude Code. Work spans design, art, levels and code.

## Decision
Use Claude Code agent teams per phase, with roles in .claude/agents, strict file ownership (CLAUDE.md),
file-based handoffs and a TaskCompleted quality gate. The human is creative director and approves every gate.

## Consequences
Higher token use than a single session. Sequential or same-file work stays in a single session.
Agent teams are experimental; sessions with teammates can't be resumed, so each phase starts fresh and
all state lives in files.
