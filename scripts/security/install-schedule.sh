#!/usr/bin/env bash
#
# Put the security suite on a schedule.
#
#   ./scripts/security/install-schedule.sh          install
#   ./scripts/security/install-schedule.sh --status show what is scheduled
#   ./scripts/security/install-schedule.sh --remove uninstall
#
# Installs two launchd agents for the logged-in user on macOS:
#   nightly 03:15  — the live probes, the API contract and the droplet posture
#   weekly  Mon 04:15 — the slower drift and freshness checks
#
# Reports land in reports/security/<cadence>-YYYY-MM-DD.json, and the newest
# run is also written to reports/security/latest-<cadence>.json so a dashboard
# or a later script has a stable path to read.
#
# ## What this does NOT give you, stated plainly
#
# This runs on a developer's Mac. A closed laptop does not run it. launchd will
# fire a missed StartCalendarInterval job the next time the machine wakes, so
# runs are "most nights" rather than "every night", and a machine off for a
# week produces one catch-up run, not seven.
#
# That is a deliberate trade, not an oversight. The alternatives both cost
# something the owner has not agreed to:
#   - GitHub Actions would need the droplet's SSH key and STATS_TOKEN in the
#     secrets of a PUBLIC repository, and there is no CI here today.
#   - A systemd timer ON the droplet would be reliable, but the droplet holds
#     no source, and the infrastructure checks are written to inspect the box
#     over ssh FROM somewhere else — running them on the box they audit means
#     a compromise of that box also silences its own alarm.
#
# The every-commit checks do not depend on any of this: they run inside
# `npx vitest run` via tests/security-suite.test.ts, which already gates
# `npm run build` and both deploy scripts.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO="$(pwd)"
LABEL_PREFIX="com.radiuslabs.incognitobrowser.security"
AGENTS="$HOME/Library/LaunchAgents"
NODE="$(command -v node)"

if [ "$(uname)" != "Darwin" ]; then
  cat >&2 <<EOF
This installer is macOS/launchd only. On Linux, the equivalent two crontab lines are:

  15 3 * * *   cd $REPO && $NODE scripts/security/run.mjs --cadence=nightly --json reports/security/latest-nightly.json >> reports/security/nightly.log 2>&1
  15 4 * * 1   cd $REPO && $NODE scripts/security/run.mjs --cadence=weekly  --json reports/security/latest-weekly.json  >> reports/security/weekly.log  2>&1
EOF
  exit 1
fi

status() {
  for c in nightly weekly; do
    if launchctl list 2>/dev/null | grep -q "$LABEL_PREFIX.$c"; then
      echo "  $c: scheduled ($AGENTS/$LABEL_PREFIX.$c.plist)"
    else
      echo "  $c: not scheduled"
    fi
  done
  local latest
  latest="$(ls -t reports/security/*.json 2>/dev/null | head -1 || true)"
  [ -n "$latest" ] && echo "  newest report: $latest" || echo "  no reports yet"
}

remove() {
  for c in nightly weekly; do
    launchctl bootout "gui/$(id -u)/$LABEL_PREFIX.$c" 2>/dev/null || true
    rm -f "$AGENTS/$LABEL_PREFIX.$c.plist"
  done
  echo "removed."
}

case "${1:-install}" in
  --status) status; exit 0 ;;
  --remove) remove; exit 0 ;;
esac

mkdir -p "$AGENTS" reports/security

plist() { # cadence, hour, minute, [weekday]
  local cadence="$1" hour="$2" minute="$3" weekday="${4:-}"
  local cal="    <key>Hour</key><integer>$hour</integer>
    <key>Minute</key><integer>$minute</integer>"
  [ -n "$weekday" ] && cal="$cal
    <key>Weekday</key><integer>$weekday</integer>"
  cat > "$AGENTS/$LABEL_PREFIX.$cadence.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL_PREFIX.$cadence</string>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>$NODE scripts/security/run.mjs --cadence=$cadence --json reports/security/latest-$cadence.json &amp;&amp; cp reports/security/latest-$cadence.json "reports/security/$cadence-\$(date +%Y-%m-%d).json"; cp reports/security/latest-$cadence.json "reports/security/$cadence-\$(date +%Y-%m-%d).json" 2>/dev/null; true</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
$cal
  </dict>
  <key>StandardOutPath</key><string>$REPO/reports/security/$cadence.log</string>
  <key>StandardErrorPath</key><string>$REPO/reports/security/$cadence.log</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL_PREFIX.$cadence" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$LABEL_PREFIX.$cadence.plist"
}

plist nightly 3 15
plist weekly 4 15 1

echo "installed:"
status
cat <<EOF

The report is written even when the run fails — a non-zero exit is the point,
not a reason to discard the evidence. Read the newest with:

  node -e "const r=require('./reports/security/latest-nightly.json'); console.log(r.counts); r.results.flatMap(x=>x.findings.map(f=>({check:x.id,...f}))).forEach(f=>console.log(f.severity, f.title))"

Nothing emails or pages anyone. Wiring that up is a decision for the owner,
and doing it badly (a nightly mail nobody reads) is how a suite gets ignored.
EOF
