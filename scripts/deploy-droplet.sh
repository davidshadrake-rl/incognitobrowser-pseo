#!/usr/bin/env bash
#
# Deploy free + Pro static exports to the DigitalOcean staging droplet.
#
# Layout on the server (plain Apache + WordPress at /var/www/html):
#   /resources/      free site   (basePath /resources,      NEXT_PUBLIC_TIER unset)
#   /resources-pro/  Pro site    (basePath /resources-pro,   NEXT_PUBLIC_TIER=pro)
#
# Both are pure static exports; WordPress is untouched. This script also owns
# the server-side config the exports depend on (scripts/droplet-htaccess.conf):
# security headers, the Pro noindex, real redirects for the Pro shells, the
# tool-page Permissions-Policy, bait-file noindex, immutable asset caching,
# and the rewrite bypass so WordPress never handles these paths.
#
# Pro-tier quirk (found 2026-09-08): every "Pro serves tools only" content
# route returns generateStaticParams() = [] when IS_PRO_DEPLOYMENT. Fine in
# Vercel's server mode, but Next's `output: "export"` REQUIRES at least one
# static param per dynamic route. The routes return one placeholder param
# (`_pro_export_placeholder_`) instead; the page's notFound() lookup fails
# for it, but output:export still WRITES that not-found page as a real file,
# so this script deletes every directory of that name before syncing.
#
# Usage: ./scripts/deploy-droplet.sh [host] [--server-config-only]
#   default host root@206.189.186.34
#   --server-config-only  re-applies the .htaccess/permissions block without
#                         rebuilding or syncing (e.g. after editing the conf).

set -euo pipefail
HOST="root@206.189.186.34"; SERVER_CONFIG_ONLY=0
for a in "$@"; do case "$a" in --server-config-only) SERVER_CONFIG_ONLY=1 ;; *) HOST="$a" ;; esac; done
WEB_ROOT="/var/www/html"
cd "$(dirname "$0")/.."

# Cross-tier links stay ON this droplet. Without these, "Pro version →" and the
# Pro pages' Related links point at the Vercel hosts and the staging copy is
# not self-contained. The API base is left at its static default (the free
# Vercel host); that project's ALLOWED_ORIGINS lists both droplet origins.
DROPLET_ORIGIN="${DROPLET_ORIGIN:-https://206-189-186-34.nip.io}"
CROSS="NEXT_PUBLIC_FREE_URL=${DROPLET_ORIGIN}/resources NEXT_PUBLIC_PRO_URL=${DROPLET_ORIGIN}/resources-pro"

build_and_sync() {
  local tier_env="$1" base_path="$2" remote_dir="$3" label="$4"
  echo "=== building $label (BASE_PATH=$base_path) ==="
  rm -rf out .next
  env $tier_env BUILD_TARGET=static BASE_PATH="$base_path" npx next build
  node scripts/write-build-marker.mjs --target static --tier "$( [[ "$tier_env" == *NEXT_PUBLIC_TIER=pro* ]] && echo pro || echo free )" --base "$base_path"
  find out -type d -name '_pro_export_placeholder_' -exec rm -rf {} +
  node scripts/audit-links.mjs out --mode static --base "$base_path"
  echo "=== syncing $label -> $HOST:$WEB_ROOT$remote_dir/ ==="
  rsync -az --delete out/ "$HOST:$WEB_ROOT$remote_dir/"
}

if [ "$SERVER_CONFIG_ONLY" = 0 ]; then
  echo "=== 1/4 unit suite (on a clean tree — a stale out/ must never be graded) ==="
  rm -rf out .next
  npm test
  echo "=== 2/4 build + sync both tiers ==="
  build_and_sync "$CROSS" "/resources" "/resources" "FREE"
  build_and_sync "$CROSS NEXT_PUBLIC_TIER=pro" "/resources-pro" "/resources-pro" "PRO"
fi

echo "=== 3/4 server config: ownership, rewrite bypass, managed .htaccess block ==="
HTTPS_HOST="${DROPLET_ORIGIN#https://}"
sed "s/__HTTPS_HOST__/${HTTPS_HOST}/g" scripts/droplet-htaccess.conf > /tmp/pseo-htaccess-block.conf
scp -q /tmp/pseo-htaccess-block.conf "$HOST:/tmp/pseo-htaccess-block.conf"
rm -f /tmp/pseo-htaccess-block.conf
ssh "$HOST" bash -s <<'REMOTE'
set -euo pipefail
HT=/var/www/html/.htaccess
[ -d /var/www/html/resources ] && chown -R www-data:www-data /var/www/html/resources
[ -d /var/www/html/resources-pro ] && chown -R www-data:www-data /var/www/html/resources-pro
for d in /var/www/html/resources /var/www/html/resources-pro; do
  [ -d "$d" ] || continue
  find "$d" -type d -exec chmod 755 {} \;
  find "$d" -type f -exec chmod 644 {} \;
done
if ! grep -q 'resources-pro/ - \[L\]' "$HT"; then
  sed -i '0,/RewriteRule \^resources\/ - \[L\]/s//RewriteRule ^resources\/ - [L]\n  RewriteRule ^resources-pro\/ - [L]/' "$HT"
fi
a2enmod -q headers expires >/dev/null 2>&1 || true
cp "$HT" "$HT.bak.$(date +%s)"
python3 - "$HT" /tmp/pseo-htaccess-block.conf <<'PY'
import re, sys
ht, blk = sys.argv[1], sys.argv[2]
s = open(ht).read()
s = re.sub(r"# BEGIN pseo-security-headers.*?# END pseo-security-headers\n?", "", s, flags=re.S)
open(ht, "w").write(open(blk).read().rstrip("\n") + "\n\n" + s)
PY
rm -f /tmp/pseo-htaccess-block.conf
apache2ctl configtest
systemctl restart apache2
echo "server config OK"
REMOTE

if [ "$SERVER_CONFIG_ONLY" = 0 ]; then
  echo "=== 4/4 restoring local repo to server-mode build (matches Vercel) ==="
  rm -rf out .next
  npm run build
fi

echo "=== verify ==="
B="$DROPLET_ORIGIN"
printf '  free /resources/tools/           %s\n' "$(curl -sL -o /dev/null -w '%{http_code}' "$B/resources/tools/")"
printf '  pro  /resources-pro/tools/       %s\n' "$(curl -sL -o /dev/null -w '%{http_code}' "$B/resources-pro/tools/")"
printf '  pro  /resources-pro/ redirects   %s\n' "$(curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}' "$B/resources-pro/")"
printf '  security headers on free (of 7)  %s\n' "$(curl -sI "$B/resources/tools/" | grep -ciE '^(content-security-policy|strict-transport-security|x-frame-options|x-content-type-options|referrer-policy|permissions-policy|cross-origin-opener-policy):')"
printf '  pro X-Robots-Tag                 %s\n' "$(curl -sI "$B/resources-pro/tools/" | grep -i '^x-robots-tag' | tr -d '\r')"
printf '  tool page Permissions-Policy     %s\n' "$(curl -sI "$B/resources/tools/webcam-privacy/permission-checker/" | grep -i '^permissions-policy' | grep -c 'camera=(self)')"
