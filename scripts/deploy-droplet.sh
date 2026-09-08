#!/usr/bin/env bash
#
# Deploy free + Pro static exports to the DigitalOcean staging droplet.
#
# Layout on the server (plain Apache + WordPress at /var/www/html):
#   /resources/      free site   (basePath /resources,      NEXT_PUBLIC_TIER unset)
#   /resources-pro/  Pro site    (basePath /resources-pro,   NEXT_PUBLIC_TIER=pro)
#
# Both are pure static exports; WordPress and Apache are untouched otherwise.
# .htaccess on the server bypasses WordPress's rewrite for both paths (see
# the sed block below — idempotent, only adds the /resources-pro/ line once).
#
# Pro-tier quirk (found 2026-09-08): every "Pro serves tools only" content
# route (guides, checklists, comparisons, calculators, templates, glossary,
# topics, authors, site/[domain]) returns generateStaticParams() = [] when
# IS_PRO_DEPLOYMENT. That is fine in Vercel's server mode, but Next's
# `output: "export"` REQUIRES at least one static param per dynamic route
# ("Page ... is missing generateStaticParams()") — an empty array throws.
# The fix (already in the route files): return one placeholder param
# (`_pro_export_placeholder_`) instead of `[]`. The page's own notFound()
# lookup then genuinely fails for that fake slug — but output:export still
# WRITES that not-found page as a real, servable HTML file (it doesn't know
# to drop it), so this script deletes every directory literally named
# `_pro_export_placeholder_` from the Pro build before syncing. Skipping
# this step ships ~14 crawlable junk 404-as-200 pages under /resources-pro/.
#
# Usage: ./scripts/deploy-droplet.sh [host]   (default: root@206.189.186.34)

set -euo pipefail
HOST="${1:-root@206.189.186.34}"
WEB_ROOT="/var/www/html"
cd "$(dirname "$0")/.."

echo "=== 1/6 unit suite ==="
npm test

build_and_sync() {
  local tier_env="$1" base_path="$2" remote_dir="$3" label="$4"
  echo "=== building $label (BASE_PATH=$base_path) ==="
  rm -rf out .next
  env $tier_env BUILD_TARGET=static BASE_PATH="$base_path" npx next build
  find out -type d -name '_pro_export_placeholder_' -exec rm -rf {} +
  node scripts/audit-links.mjs out --mode static --base "$base_path"
  echo "=== syncing $label -> $HOST:$WEB_ROOT$remote_dir/ ==="
  rsync -az --delete out/ "$HOST:$WEB_ROOT$remote_dir/"
}

build_and_sync "" "/resources" "/resources" "FREE"
build_and_sync "NEXT_PUBLIC_TIER=pro" "/resources-pro" "/resources-pro" "PRO"

echo "=== fixing ownership + .htaccess bypass on the server ==="
ssh "$HOST" bash -s <<'REMOTE'
set -euo pipefail
chown -R www-data:www-data /var/www/html/resources /var/www/html/resources-pro
find /var/www/html/resources /var/www/html/resources-pro -type d -exec chmod 755 {} \;
find /var/www/html/resources /var/www/html/resources-pro -type f -exec chmod 644 {} \;
if ! grep -q 'resources-pro' /var/www/html/.htaccess; then
  sed -i '0,/RewriteRule \^resources\/ - \[L\]/s//RewriteRule ^resources\/ - [L]\n  RewriteRule ^resources-pro\/ - [L]/' /var/www/html/.htaccess
fi
apache2ctl configtest
systemctl reload apache2
echo "server config OK"
REMOTE

echo "=== restoring local repo to server-mode build (leaves working tree matching Vercel's build) ==="
rm -rf out .next
npm run build

echo "=== DONE. Verify: ==="
echo "  curl -sL -o /dev/null -w '%{http_code}\n' https://206-189-186-34.nip.io/resources/"
echo "  curl -sL -o /dev/null -w '%{http_code}\n' https://206-189-186-34.nip.io/resources-pro/tools"
