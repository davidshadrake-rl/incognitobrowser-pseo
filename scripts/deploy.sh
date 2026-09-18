#!/usr/bin/env bash
#
# Deploy both static sites to the droplet.
#
#   ./scripts/deploy.sh      (or: npm run deploy)
#
# Builds the free site and the Pro site as plain static files, uploads each to
# its folder, and prints the links. Then refresh the page in your browser.
#
# The droplet login comes from .secrets, which is never committed: copy
# .secrets.example to .secrets and fill it in.
#
# Cache busting: CSS/JS files are named after their contents, so changed ones
# get new names; the pages and data are served "no-cache" (scripts/site.htaccess,
# uploaded with each site). version.txt in each site says what's live.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .secrets ] || { echo "No .secrets file: copy .secrets.example to .secrets and fill it in." >&2; exit 1; }
# shellcheck disable=SC1091
source .secrets
: "${DEPLOY_HOST:?set DEPLOY_HOST in .secrets}" "${DEPLOY_USER:?set DEPLOY_USER in .secrets}"
: "${DEPLOY_SSH_KEY:?set DEPLOY_SSH_KEY in .secrets}" "${SITE_ORIGIN:?set SITE_ORIGIN in .secrets}"
WEB_ROOT="${DEPLOY_WEB_ROOT:-/var/www/html}"
SSH="ssh -i $DEPLOY_SSH_KEY -o IdentitiesOnly=yes"
TARGET="$DEPLOY_USER@$DEPLOY_HOST"
VERSION="$(git rev-parse --short HEAD)$(git diff --quiet HEAD || echo '+uncommitted') built $(date -u +%Y-%m-%dT%H:%MZ)"
LOG="$(mktemp)"

echo "== tests"
rm -rf out .next
npm test --silent >"$LOG" 2>&1 || { cat "$LOG"; exit 1; }

site() {  # label, folder, extra build env
  echo "== build $1"
  rm -rf out .next
  # NEXT_PUBLIC_SCAN_API=/api: the seven server routes run as the ib-api
  # systemd service on 127.0.0.1:3100, reverse-proxied by Apache at /api/
  # (API-ON-DROPLET.md). Same origin, so no CORS; namespaced under /api so it
  # can never collide with a WordPress permalink in the same DocumentRoot.
  env NEXT_PUBLIC_FREE_URL="$SITE_ORIGIN/resources" NEXT_PUBLIC_PRO_URL="$SITE_ORIGIN/resources-pro" \
    NEXT_PUBLIC_SCAN_API=/api $3 \
    BUILD_TARGET=static BASE_PATH="$2" npx next build >"$LOG" 2>&1 || { cat "$LOG"; exit 1; }
  find out -type d -name '_pro_export_placeholder_' -exec rm -rf {} +
  node scripts/audit-links.mjs out --mode static --base "$2"
  # audit-links only checks same-site hrefs; an absolute URL baked into a JS
  # chunk would sail past it. The old hosting platform is gone (2026-09-18)
  # and its hostnames will stop resolving, so shipping one is a silent outage.
  ! grep -rqi "vercel\.app" out || { echo "a vercel.app URL is in the $1 build — see API-ON-DROPLET.md" >&2; exit 1; }
  npx vitest run tests/client-bundle.test.ts >"$LOG" 2>&1 || { cat "$LOG"; exit 1; }
  # The page guards only grade an export whose marker says what it is; without
  # it they skipped silently on every deploy. The free site is the one they know.
  if [ "$2" = /resources ]; then
    node scripts/write-build-marker.mjs --target static --tier free --base /resources >/dev/null
    npx vitest run tests/rendered-pages.test.ts tests/link-audit.test.ts >"$LOG" 2>&1 || { cat "$LOG"; exit 1; }
  fi
  cp scripts/site.htaccess out/.htaccess
  echo "$VERSION" > out/version.txt
  echo "== upload $1 -> $WEB_ROOT$2/"
  rsync -az --delete -e "$SSH" out/ "$TARGET:$WEB_ROOT$2/"
}

site "free site" /resources ""
site "Pro site" /resources-pro "NEXT_PUBLIC_TIER=pro"
$SSH "$TARGET" "chown -R www-data:www-data $WEB_ROOT/resources $WEB_ROOT/resources-pro"
rm -f "$LOG"

echo
echo "Live: $VERSION"
echo "  $SITE_ORIGIN/resources/"
echo "  $SITE_ORIGIN/resources-pro/tools/"
