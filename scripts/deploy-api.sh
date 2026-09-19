#!/usr/bin/env bash
#
# Deploy the tools API to the droplet.
#
#   ./scripts/deploy-api.sh      (or: npm run deploy:api)
#
# scripts/deploy.sh ships the two STATIC sites. This ships the seven routes
# that need a Node runtime — /challenge, /scan-url, /ip, /dns-leak/*, /event,
# /stats — which run as the ib-api systemd service on 127.0.0.1:3100 behind
# Apache at /api/. See API-ON-DROPLET.md.
#
# The droplet holds only build OUTPUT: .next, next.config.ts, package.json and
# public/. There is no source and no git checkout there, so the build happens
# here and the result is rsync'd. This script exists because that was done by
# hand the first time (2026-09-18) and hand-done deploys are how a security fix
# ends up committed but not actually running.
#
# The login comes from .secrets, which is never committed.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .secrets ] || { echo "No .secrets file: copy .secrets.example to .secrets and fill it in." >&2; exit 1; }
# shellcheck disable=SC1091
source .secrets
: "${DEPLOY_HOST:?set DEPLOY_HOST in .secrets}" "${DEPLOY_USER:?set DEPLOY_USER in .secrets}"
: "${DEPLOY_SSH_KEY:?set DEPLOY_SSH_KEY in .secrets}" "${SITE_ORIGIN:?set SITE_ORIGIN in .secrets}"
SSH="ssh -i $DEPLOY_SSH_KEY -o IdentitiesOnly=yes"
TARGET="$DEPLOY_USER@$DEPLOY_HOST"
REMOTE=/opt/ib-api
LOG="$(mktemp)"

echo "== tests"
npx vitest run >"$LOG" 2>&1 || { cat "$LOG"; exit 1; }
npx tsc --noEmit >"$LOG" 2>&1 || { cat "$LOG"; exit 1; }

# Server mode: do NOT set BUILD_TARGET=static. The static export drops POST
# route handlers entirely, so a static build here would ship an API with no
# routes in it and every tool would start returning 404.
echo "== build (server mode)"
rm -rf .next
npx next build >"$LOG" 2>&1 || { cat "$LOG"; exit 1; }
[ -d .next/server/app ] || { echo ".next/server/app missing — that is a static export, not a server build" >&2; exit 1; }
for r in challenge scan-url ip event stats; do
  [ -e ".next/server/app/$r/route.js" ] || { echo "route $r missing from the build" >&2; exit 1; }
done
echo "   routes present: challenge scan-url ip event stats dns-leak"

echo "== upload -> $TARGET:$REMOTE"
BEFORE="$($SSH "$TARGET" "md5sum $REMOTE/package-lock.json 2>/dev/null | cut -d' ' -f1" || true)"
rsync -az --delete -e "$SSH" .next/            "$TARGET:$REMOTE/.next/"
rsync -az          -e "$SSH" next.config.ts package.json package-lock.json "$TARGET:$REMOTE/"
rsync -az --delete -e "$SSH" public/           "$TARGET:$REMOTE/public/"
AFTER="$($SSH "$TARGET" "md5sum $REMOTE/package-lock.json | cut -d' ' -f1")"

if [ "$BEFORE" != "$AFTER" ]; then
  echo "== dependencies changed, reinstalling"
  $SSH "$TARGET" "cd $REMOTE && sudo -u www-data env HOME=/tmp npm ci --omit=dev"
fi

$SSH "$TARGET" "chown -R www-data:www-data $REMOTE && systemctl restart ib-api"
sleep 5
$SSH "$TARGET" "systemctl is-active ib-api" | sed 's/^/   ib-api: /'

echo "== verify through Apache"
fail=0
code() { curl -sk -o /dev/null -w '%{http_code}' "$@"; }
ORIGIN="-H origin:$SITE_ORIGIN -H content-type:application/json"
# shellcheck disable=SC2086
[ "$(code -X POST "$SITE_ORIGIN/api/ip" $ORIGIN -d '{}')" = 200 ] || { echo "   FAIL /api/ip"; fail=1; }
# shellcheck disable=SC2086
[ "$(code -X POST "$SITE_ORIGIN/api/challenge" $ORIGIN -d '{}')" = 200 ] || { echo "   FAIL /api/challenge"; fail=1; }
# The co-hosted WordPress and both static sites must be untouched by this.
for u in / /resources/ /resources-pro/tools/; do
  [ "$(code "$SITE_ORIGIN$u")" = 200 ] || { echo "   FAIL $u"; fail=1; }
done
[ "$fail" = 0 ] && echo "   /api/ip /api/challenge WordPress /resources/ /resources-pro/tools/ all 200"
rm -f "$LOG"
exit "$fail"
