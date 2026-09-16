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
  env NEXT_PUBLIC_FREE_URL="$SITE_ORIGIN/resources" NEXT_PUBLIC_PRO_URL="$SITE_ORIGIN/resources-pro" $3 \
    BUILD_TARGET=static BASE_PATH="$2" npx next build >"$LOG" 2>&1 || { cat "$LOG"; exit 1; }
  find out -type d -name '_pro_export_placeholder_' -exec rm -rf {} +
  node scripts/audit-links.mjs out --mode static --base "$2"
  npx vitest run tests/client-bundle.test.ts >"$LOG" 2>&1 || { cat "$LOG"; exit 1; }
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
