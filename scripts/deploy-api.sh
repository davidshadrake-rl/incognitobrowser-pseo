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
# .npmrc ships too: it sets ignore-scripts, and the remote npm ci below reads it
# from $REMOTE because that is the working directory. See the file for why.
# --exclude cache/: .next/cache is Turbopack's LOCAL build cache and the
# production server does not need it. It also had a live ANTHROPIC_API_KEY
# from .env sitting in it verbatim (found 2026-09-19 by the suite's
# secret-known-value-in-build-output check, which blocked this very deploy).
# The key had not reached the droplet yet, but this line is what would have
# carried it there — a build cache is not an artifact, and shipping one moves
# whatever the build happened to touch.
rsync -az --delete --exclude 'cache/' -e "$SSH" .next/  "$TARGET:$REMOTE/.next/"
rsync -az          -e "$SSH" next.config.ts package.json package-lock.json .npmrc "$TARGET:$REMOTE/"
rsync -az --delete -e "$SSH" public/           "$TARGET:$REMOTE/public/"

# The reinstall gate. This used to md5 the remote lockfile BEFORE the rsync and
# again AFTER it, and reinstall when the two differed. That reads as correct and
# fails open. `set -euo pipefail` is in force, so a single failed `npm ci` — a
# registry 503, a network blip, a full disk — aborts the script AFTER the new
# lockfile has already been written over the old one on the droplet. From then
# on every run computes BEFORE == AFTER, concludes nothing changed, and never
# reinstalls again. Production keeps running on a node_modules that does not
# match its lockfile, indefinitely, while deploys carry on reporting success.
#
# So the decision is not derived from what the rsync did. It hangs off a marker
# holding the md5 of the lockfile that was last SUCCESSFULLY installed, written
# only once npm ci has exited 0. A failed install leaves the marker stale or
# absent, which is exactly the state that makes the next run try again.
#
# (First run after this change: the marker does not exist yet, so one reinstall
# happens regardless of whether dependencies changed. That is intended — it is
# also what re-does the install with scripts disabled.)
INSTALLED_MARKER="$REMOTE/.npm-ci-installed.md5"
SHIPPED_LOCK="$($SSH "$TARGET" "md5sum $REMOTE/package-lock.json | cut -d' ' -f1")"
INSTALLED_LOCK="$($SSH "$TARGET" "cat $INSTALLED_MARKER 2>/dev/null || true")"
# node_modules itself can go missing without the lockfile changing — a wiped
# directory, a half-finished manual fix — and the marker alone would not notice.
HAVE_MODULES="$($SSH "$TARGET" "[ -d $REMOTE/node_modules ] && echo yes || echo no")"

if [ "$SHIPPED_LOCK" != "$INSTALLED_LOCK" ] || [ "$HAVE_MODULES" != yes ]; then
  echo "== node_modules is not known-installed at this lockfile, reinstalling"
  # Three separate ssh calls, deliberately. Clearing the marker first means that
  # if npm ci fails, set -e stops the script with the marker already gone, and
  # the next deploy is guaranteed to retry.
  #
  # --ignore-scripts belongs here as well as in the shipped .npmrc: this install
  # runs as www-data on the box that also serves WordPress and MySQL, and the
  # protection should not depend on a config file having arrived intact.
  $SSH "$TARGET" "rm -f $INSTALLED_MARKER"
  $SSH "$TARGET" "cd $REMOTE && sudo -u www-data env HOME=/tmp npm ci --omit=dev --ignore-scripts"
  $SSH "$TARGET" "printf '%s\n' '$SHIPPED_LOCK' > $INSTALLED_MARKER"
else
  echo "   dependencies unchanged since the last successful install"
fi

# root:www-data 750/640, NOT www-data:www-data.
#
# Apache serves WordPress PHP as www-data on this same box, so anything that
# uid can write, a WordPress compromise can rewrite: 1,400 static pages to
# inject script into, and /opt/ib-api to replace the API with. www-data only
# ever READS these trees — writes arrive by rsync as root — so it does not need
# to own them. Found live on 2026-09-19 by the security suite
# (cnast webroot-ownership-shared-fate); it re-checks this every night.
# .next/cache is the one exception: the service may write cache entries there.
$SSH "$TARGET" "chown -R root:www-data $REMOTE && find $REMOTE -type d -exec chmod 750 {} + && find $REMOTE -type f -exec chmod 640 {} + && mkdir -p $REMOTE/.next/cache && chown -R www-data:www-data $REMOTE/.next/cache && systemctl restart ib-api"
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
