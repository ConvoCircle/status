#!/usr/bin/env bash
# Commit this probe's snapshot. Retry on rebase/push races so a concurrent
# Status probe / ci-feed push does not fail the workflow.
#
# Optional env:
#   PUSH_RETRIES       default 5
#   PUSH_RETRY_SLEEP   default $attempt seconds
#   HISTORY_BRANCH     default main
#   PROBE_JS           override path to probe.mjs
set -euo pipefail

PUSH_RETRIES="${PUSH_RETRIES:-5}"
BRANCH="${HISTORY_BRANCH:-main}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROBE_JS="${PROBE_JS:-$SCRIPT_DIR/../probe.mjs}"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

if [[ ! -f data/status.json || ! -f data/history.json ]]; then
  echo "commit-history: missing data/status.json or data/history.json" >&2
  exit 1
fi

OURS="$(mktemp -d)"
trap 'rm -rf "$OURS"' EXIT
cp data/status.json "$OURS/status.json"
cp data/history.json "$OURS/history.json"

apply_ours() {
  # Prefer this run's live probe snapshot; merge history samples with HEAD.
  cp "$OURS/status.json" data/status.json
  if [[ -f data/history.json ]]; then
    node "$PROBE_JS" merge-history "$OURS/history.json" data/history.json data/history.json
  else
    cp "$OURS/history.json" data/history.json
  fi
}

commit_snapshot() {
  git add data/status.json data/history.json
  if git diff --cached --quiet; then
    return 1
  fi
  git commit -m "$(cat <<EOF
chore: status snapshot $(date -u +%Y-%m-%dT%H:%MZ)

[skip ci]
EOF
)"
}

cleanup_rebase() {
  if [[ -d .git/rebase-merge || -d .git/rebase-apply ]]; then
    git rebase --abort || true
  fi
}

if ! commit_snapshot; then
  echo "commit-history: no history change"
  exit 0
fi

attempt=1
while true; do
  if git pull --rebase --autostash origin "$BRANCH" && git push origin "HEAD:${BRANCH}"; then
    echo "commit-history: pushed snapshot"
    exit 0
  fi
  cleanup_rebase
  if (( attempt >= PUSH_RETRIES )); then
    echo "commit-history: push failed after ${PUSH_RETRIES} attempts (rebase / non-fast-forward)" >&2
    exit 1
  fi
  echo "commit-history: conflict — reset to origin/${BRANCH}, re-merge this run, retry $((attempt + 1))/${PUSH_RETRIES}"
  sleep "${PUSH_RETRY_SLEEP:-$attempt}"
  git fetch origin "$BRANCH"
  git reset --hard "origin/${BRANCH}"
  apply_ours
  if ! commit_snapshot; then
    echo "commit-history: no history change after re-merge"
    exit 0
  fi
  attempt=$((attempt + 1))
done
