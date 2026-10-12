#!/usr/bin/env bash
# Quality gate for agent-team tasks.
# Runs on TaskCompleted. Exit 2 blocks completion and feeds stderr back to the teammate.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Before M1 there is no package.json yet: design and art tasks pass through.
if [[ ! -f package.json ]]; then
  exit 0
fi

# Only gate when code, data or contracts changed (art/doc-only tasks skip the build).
changed="$(git status --porcelain 2>/dev/null | awk '{print $2}')"
if [[ -n "$changed" ]] && ! grep -qE '^(src/|tests/|public/assets/|package\.json|pnpm-lock\.yaml|index\.html|tsconfig|vite\.config|eslint\.config)' <<<"$changed"; then
  exit 0
fi

failures=()
run() {
  local label="$1"; shift
  if ! output="$("$@" 2>&1)"; then
    failures+=("✗ ${label}"$'\n'"$(tail -n 40 <<<"$output")")
  fi
}

run "typecheck" pnpm --silent typecheck
run "lint"      pnpm --silent lint
run "test"      pnpm --silent test

if (( ${#failures[@]} > 0 )); then
  {
    echo "Quality gate failed. Do not mark this task complete until these pass."
    echo "Never weaken tsconfig/lint rules or delete tests to get past this gate."
    printf '%s\n\n' "${failures[@]}"
  } >&2
  exit 2
fi

exit 0
