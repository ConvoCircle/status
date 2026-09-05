#!/usr/bin/env bash
# Open/close a public incident issue in this repo when a component is down.
# Does not email, SMS, or notify Linear — owner paging stays on CON-25.
set -euo pipefail

STATUS_FILE="${STATUS_FILE:-data/status.json}"
if [[ ! -f "$STATUS_FILE" ]]; then
  echo "no status file"
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh not available; skip incident issue"
  exit 0
fi

OVERALL="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["overall"])' "$STATUS_FILE")"
SUMMARY="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); i=d.get("incident") or {}; print(i.get("summary") or "")' "$STATUS_FILE")"

EXISTING="$(gh issue list --label incident --state open --json number,title --jq '.[0].number' || true)"

if [[ "$OVERALL" == "down" ]]; then
  TITLE="[STATUS] ${SUMMARY}"
  BODY="Public status check reported an outage.

**${SUMMARY}**

This issue is a public log only. It does **not** page the owner.
Owner alerts remain the socialTrainer prod-smoke path (CON-25).

See https://convocircle.github.io/status/"
  if [[ -n "${EXISTING:-}" ]]; then
    gh issue comment "$EXISTING" --body "Still down: ${SUMMARY}"
  else
    gh label create incident --description "Public status outage" --color B3261E 2>/dev/null || true
    gh issue create --title "$TITLE" --label incident --body "$BODY"
  fi
  exit 0
fi

if [[ -n "${EXISTING:-}" ]]; then
  gh issue close "$EXISTING" --comment "All probed components recovered. Public banner cleared."
fi
