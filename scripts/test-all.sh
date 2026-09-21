#!/usr/bin/env bash
#
# Everything, in one command.
#
#   npm run test:all                 types + unit + security (all cadences) + live smoke
#   npm run test:all -- --e2e        ...and the browser suite (slow: ~2 min)
#   npm run test:all -- --offline    types + unit only; no network, no droplet
#   npm run test:all -- --json DIR   write machine-readable reports into DIR
#
# Why this exists: "complete testing" spans four suites that answer different
# questions, and before this there was no single way to run them. A release
# gate that takes four commands is one somebody runs three of.
#
#   1. types      tsc --noEmit
#   2. unit       vitest — 2,900+ tests, and it carries the 48 every-commit
#                 security checks via tests/security-suite.test.ts, which is why
#                 those are already deploy-blocking
#   3. security   the nightly + weekly cadences: live probes and host posture
#   4. smoke      the live API regression (solves a real proof-of-work)
#   5. e2e        Playwright against the deployed site (opt-in: it is the slow one)
#
# Exit code is the first failure's, and every stage runs regardless so one run
# tells you everything that is wrong rather than only the first thing.
set -uo pipefail
cd "$(dirname "$0")/.."

E2E=0; OFFLINE=0; JSON_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --e2e) E2E=1 ;;
    --offline) OFFLINE=1 ;;
    --json) JSON_DIR="${2:-}"; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$JSON_DIR" ] && mkdir -p "$JSON_DIR"

ORIGIN="https://206-189-186-34.nip.io"
[ -f .secrets ] && ORIGIN="$(grep -E '^SITE_ORIGIN=' .secrets | cut -d= -f2- | tr -d '"'"'"' ' || echo "$ORIGIN")"

FAILED=""
STATUS=0
stage() { # name, command...
  local name="$1"; shift
  printf '\n\033[1m== %s\033[0m\n' "$name"
  if "$@"; then
    printf '   \033[32mok\033[0m  %s\n' "$name"
  else
    local rc=$?
    printf '   \033[31mFAIL\033[0m  %s (exit %d)\n' "$name" "$rc"
    FAILED="$FAILED $name"
    [ "$STATUS" = 0 ] && STATUS=$rc
  fi
}

stage "types"    npx tsc --noEmit
stage "unit + every-commit security" npx vitest run

if [ "$OFFLINE" = 1 ]; then
  printf '\n\033[2m   --offline: skipped security cadences, smoke and e2e (they need the network and the host)\033[0m\n'
else
  if [ -n "$JSON_DIR" ]; then
    stage "security (nightly + weekly)" node scripts/security/run.mjs --cadence=nightly --cadence=weekly --opt-in=all --json "$JSON_DIR/security.json"
  else
    stage "security (nightly + weekly)" node scripts/security/run.mjs --cadence=nightly --cadence=weekly --opt-in=all
  fi
  stage "live smoke" node scripts/security-smoke.mjs "$ORIGIN/resources" --free --api "$ORIGIN/api"
  if [ "$E2E" = 1 ]; then
    stage "browser e2e" env E2E_BASE_URL="$ORIGIN" npx playwright test --reporter=line
  else
    printf '\n\033[2m   e2e not run (pass --e2e; it takes about two minutes)\033[0m\n'
  fi
fi

printf '\n\033[1msummary\033[0m\n'
if [ -z "$FAILED" ]; then
  printf '   \033[32mall stages passed\033[0m\n'
else
  printf '   \033[31mfailed:\033[0m%s\n' "$FAILED"
fi
exit "$STATUS"
