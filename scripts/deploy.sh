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
#
# Before anything else it checks that the security headers live on the droplet
# still match scripts/droplet-htaccess.conf, and refuses to deploy if they do
# not — see the long note above htaccess_check below.
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

# == the managed .htaccess block ==
#
# Security headers, Options -Indexes, the HTTPS redirect and the Pro shell
# redirects all live in scripts/droplet-htaccess.conf, which is spliced into
# the SHARED $WEB_ROOT/.htaccess by scripts/droplet-server-config.sh. A deploy
# does NOT write that file, on purpose: it is also the other site's .htaccess
# on this droplet, and a routine content push must never rewrite another
# application's rewrite rules while nobody is watching.
#
# The cost of that separation is drift, and drift is not theoretical here. The
# live CSP went on allowing two origins from the old hosting platform for three
# weeks after the repo stopped naming them, because editing the .conf changes
# nothing until someone remembers to run the other script. Every deploy in
# those three weeks reported success and shipped none of it.
#
# So the deploy refuses to pretend: it reads the block that is actually live,
# compares it to the one in the repo, and stops if they differ. Verification
# rather than an automatic edit, and rather than moving the headers into the
# per-site scripts/site.htaccess — that would ship them with each deploy, but
# it would also leave two files defining the same headers during and after the
# move, and one CSP in two places is how this bug was born.
#
# Checked before the build so a drifted deploy costs seconds, not minutes.
htaccess_check() {
  if [ -n "${DEPLOY_SKIP_HTACCESS_CHECK:-}" ]; then
    echo "!! DEPLOY_SKIP_HTACCESS_CHECK set: shipping without checking the live security headers." >&2
    echo "!! Whatever is on the server stays on the server. Run scripts/droplet-server-config.sh." >&2
    return 0
  fi
  echo "== check live .htaccess block"
  local want live https_host
  # Same substitution droplet-server-config.sh does, so an identical block
  # compares equal (a raw-IP https URL has no certificate, hence the hostname).
  https_host="${SITE_ORIGIN#https://}"
  want="$(sed "s/__HTTPS_HOST__/${https_host}/g" scripts/droplet-htaccess.conf)"
  # sed exits 0 whether or not the range matched, so a non-zero status here is
  # ssh or the file being unreadable — never "the block is gone". Say which,
  # because "MISSING" for what is really a dropped connection sends whoever is
  # deploying off to re-run the server script for no reason.
  if ! live="$($SSH "$TARGET" "sed -n '/^# BEGIN pseo-security-headers\$/,/^# END pseo-security-headers\$/p' $WEB_ROOT/.htaccess")"; then
    echo "Could not read $WEB_ROOT/.htaccess on $TARGET over ssh — check the host and DEPLOY_SSH_KEY." >&2
    exit 1
  fi
  if [ "$live" = "$want" ]; then
    echo "   live block matches scripts/droplet-htaccess.conf"
    return 0
  fi
  if [ -z "$live" ]; then
    echo "The managed block is MISSING from $WEB_ROOT/.htaccess." >&2
    echo "The sites are being served with no security headers at all." >&2
  else
    echo "The live $WEB_ROOT/.htaccess block does NOT match scripts/droplet-htaccess.conf." >&2
    echo "Left = live on the droplet, right = this repo:" >&2
    diff -u <(printf '%s\n' "$live") <(printf '%s\n' "$want") >&2 || true
  fi
  echo >&2
  echo "Deploy stopped. Uploading pages now would ship the content and silently" >&2
  echo "leave the headers as they are — the exact failure this check exists for." >&2
  echo "Apply the block, then deploy:   ./scripts/droplet-server-config.sh" >&2
  echo "To ship anyway (headers unchanged): DEPLOY_SKIP_HTACCESS_CHECK=1 ./scripts/deploy.sh" >&2
  exit 1
}
htaccess_check

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
  ! grep -rqi "vercel\.app" out || { echo "a vercel.app URL is in the $1 build — see API-ON-DROPLET.md" >&2; exit 1; }  # no-vercel-guard: names the host in order to refuse it
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
# root:www-data 750/640, NOT www-data:www-data.
#
# Apache serves WordPress PHP as www-data on this same box, so anything that
# uid can write, a WordPress compromise can rewrite: 1,400 static pages to
# inject script into, and /opt/ib-api to replace the API with. www-data only
# ever READS these trees — writes arrive by rsync as root — so it does not need
# to own them. Found live on 2026-09-19 by the security suite
# (cnast webroot-ownership-shared-fate); it re-checks this every night.
$SSH "$TARGET" "chown -R root:www-data $WEB_ROOT/resources $WEB_ROOT/resources-pro && find $WEB_ROOT/resources $WEB_ROOT/resources-pro -type d -exec chmod 750 {} + && find $WEB_ROOT/resources $WEB_ROOT/resources-pro -type f -exec chmod 640 {} +"
rm -f "$LOG"

echo
echo "Live: $VERSION"
echo "  $SITE_ORIGIN/resources/"
echo "  $SITE_ORIGIN/resources-pro/tools/"
