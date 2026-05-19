#!/usr/bin/env bash
#
# Production deploy script — Bitnami WordPress + nginx on AWS EC2.
#
# Designed for:
#   - Debian 11 / Bitnami WordPress AMI
#   - nginx at /opt/bitnami/nginx/
#   - WP at /opt/bitnami/wordpress/ owned bitnami:daemon
#   - server block /opt/bitnami/nginx/conf/server_blocks/wordpress-https-server-block.conf
#
# The script:
#   1. Builds the static bundle locally
#   2. Tars it
#   3. SCPs the tarball to the server
#   4. SSHes in and:
#      a. Backs up any existing /resources/ to resources.bak.<timestamp>
#      b. Extracts the new bundle into /opt/bitnami/wordpress/resources/
#      c. chown bitnami:daemon, mode 755 dirs / 644 files
#      d. Optionally installs the nginx /resources/ location block with
#         security headers (HEADERS-NGINX.md content) and reloads nginx
#      e. Smoke-tests the deploy from the server itself
#
# Usage:
#   ./scripts/deploy-prod-bitnami.sh <host> [<ssh-key>] [--install-nginx-config]
#
# Examples:
#   ./scripts/deploy-prod-bitnami.sh ec2-XX-XX.compute.amazonaws.com ~/.ssh/prod.pem
#   ./scripts/deploy-prod-bitnami.sh root@incognitobrowser.io
#   ./scripts/deploy-prod-bitnami.sh root@host --install-nginx-config
#
# Notes:
#   - First run requires --install-nginx-config to get security headers active.
#   - Subsequent re-deploys can skip the flag (config persists; only files change).
#   - Bitnami nginx reload: /opt/bitnami/ctlscript.sh restart nginx
#     (NOT systemctl; Bitnami runs its own service tree).

set -euo pipefail

# ---------- args ----------

HOST="${1:-}"
KEY=""
INSTALL_NGINX=0

for arg in "${@:2}"; do
  case "$arg" in
    --install-nginx-config) INSTALL_NGINX=1 ;;
    *.pem|*/id_*|~/.ssh/*) KEY="$arg" ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

if [[ -z "$HOST" ]]; then
  cat <<EOF >&2
Usage: $0 <host> [<ssh-key>] [--install-nginx-config]
  host:                  EC2 public DNS or IP. Can include user (root@host).
  ssh-key:               optional path to .pem file.
  --install-nginx-config: install the /resources/ nginx location block.
                          Required on first deploy; safe to omit on re-deploys.
EOF
  exit 1
fi

# Default to root if no user prefix
if [[ "$HOST" != *"@"* ]]; then
  SSH_TARGET="root@$HOST"
else
  SSH_TARGET="$HOST"
fi

SSH_OPTS=()
if [[ -n "$KEY" ]]; then
  SSH_OPTS=(-i "$KEY")
fi

SSH="ssh ${SSH_OPTS[*]} -o StrictHostKeyChecking=accept-new $SSH_TARGET"
SCP="scp ${SSH_OPTS[*]} -o StrictHostKeyChecking=accept-new"

# ---------- 1. Build locally ----------

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Building static bundle..."
rm -rf out .next
BUILD_TARGET=static npx next build > /tmp/pseo-build.log 2>&1 || {
  echo "Build failed. Last 30 lines:" >&2
  tail -30 /tmp/pseo-build.log >&2
  exit 1
}
HTML_COUNT=$(find out -name "*.html" | wc -l | tr -d ' ')
BUNDLE_SIZE=$(du -sh out | cut -f1)
echo "    $HTML_COUNT HTML files, $BUNDLE_SIZE"

# ---------- 2. Run local guardrails ----------

echo "==> Running local rendered-pages tests against the bundle..."
npm run test:pages > /tmp/pseo-test.log 2>&1 || {
  echo "Local pages tests failed. Aborting deploy." >&2
  tail -30 /tmp/pseo-test.log >&2
  exit 1
}
echo "    27/27 pages tests passed"

# ---------- 3. Tar + transfer ----------

TS=$(date +%Y%m%d-%H%M%S)
TARBALL="/tmp/pseo-bundle-${TS}.tgz"

echo "==> Creating tarball..."
tar czf "$TARBALL" -C out .
echo "    $(du -sh "$TARBALL" | cut -f1) compressed"

echo "==> Transferring to $SSH_TARGET..."
$SCP "$TARBALL" "${SSH_TARGET}:/tmp/pseo-bundle.tgz"
$SCP "$REPO_ROOT/HEADERS-NGINX.md" "${SSH_TARGET}:/tmp/HEADERS-NGINX.md"

# ---------- 4. Install on the server ----------

echo "==> Installing on the server..."

REMOTE_SCRIPT=$(cat <<'REMOTE'
set -euo pipefail

WP_ROOT=/opt/bitnami/wordpress
TARGET=$WP_ROOT/resources
TS=$(date +%Y%m%d-%H%M%S)
TARBALL=/tmp/pseo-bundle.tgz

if [[ ! -f $TARBALL ]]; then
  echo "Missing $TARBALL on server" >&2
  exit 1
fi

# Backup any existing /resources/.
if [[ -d $TARGET ]]; then
  echo "    Backing up existing $TARGET -> ${TARGET}.bak.${TS}"
  sudo mv "$TARGET" "${TARGET}.bak.${TS}"
fi

# Fresh dir + extract.
sudo mkdir -p "$TARGET"
echo "    Extracting bundle into $TARGET..."
sudo tar xzf "$TARBALL" -C "$TARGET"

# Bitnami conventions: web root is bitnami:daemon, 775 dirs, 664 files.
# But for the static export we'll be conservative (read-only mode):
#   directories 755, files 644.
echo "    Setting ownership bitnami:daemon, mode 755/644..."
sudo chown -R bitnami:daemon "$TARGET"
sudo find "$TARGET" -type d -exec chmod 755 {} +
sudo find "$TARGET" -type f -exec chmod 644 {} +

echo "    Removing tarball..."
rm -f "$TARBALL"

echo "    Files in place:"
ls -la "$TARGET" | head -8
echo
echo "    Total file count:"
find "$TARGET" -type f | wc -l
REMOTE
)

$SSH "$REMOTE_SCRIPT"

# ---------- 5. Optional: install nginx config block ----------

if [[ $INSTALL_NGINX -eq 1 ]]; then
  echo "==> Installing nginx /resources/ location block..."

  NGINX_SCRIPT=$(cat <<'NGINX_REMOTE'
set -euo pipefail

CONF=/opt/bitnami/nginx/conf/server_blocks/wordpress-https-server-block.conf
SNIPPET=/opt/bitnami/nginx/conf/server_blocks/resources-location.conf

# Write the /resources/ location snippet. This goes inside the existing
# server { ... } block in wordpress-https-server-block.conf via include.
sudo tee "$SNIPPET" > /dev/null <<'EOF'
# /resources/ — Next.js static export with security headers.
# Managed by pseo deploy-prod-bitnami.sh; do not edit by hand.

location ^~ /resources/ {
    root /opt/bitnami/wordpress;
    try_files $uri $uri/ $uri/index.html =404;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header Permissions-Policy "accelerometer=(), ambient-light-sensor=(), autoplay=(), camera=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(self), sync-xhr=(), usb=(), interest-cohort=()" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://api.incognitobrowser.io https://incognitobrowser-pseo.vercel.app; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests" always;

    location ^~ /resources/_next/static/ {
        root /opt/bitnami/wordpress;
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        add_header X-Content-Type-Options "nosniff" always;
    }
}
EOF

# Include the snippet from the main server block if not already included.
if ! sudo grep -q 'resources-location.conf' "$CONF"; then
  echo "    Adding include directive to $CONF"
  # Backup first
  sudo cp "$CONF" "${CONF}.bak.$(date +%Y%m%d-%H%M%S)"
  # Insert the include before the closing brace of the server block.
  # Bitnami's server block ends with a single } on its own line.
  sudo awk '
    /^}/ && !inserted { print "    include /opt/bitnami/nginx/conf/server_blocks/resources-location.conf;"; inserted=1 }
    { print }
  ' "$CONF" | sudo tee "${CONF}.new" > /dev/null
  sudo mv "${CONF}.new" "$CONF"
fi

echo "    Validating nginx config..."
sudo /opt/bitnami/nginx/sbin/nginx -t

echo "    Reloading nginx (Bitnami)..."
sudo /opt/bitnami/ctlscript.sh restart nginx
NGINX_REMOTE
)

  $SSH "$NGINX_SCRIPT"
fi

# ---------- 6. Server-side smoke test ----------

echo "==> Smoke testing from the server..."

$SSH "
  set -e
  echo '    --- /resources/ ---'
  curl -sI http://127.0.0.1/resources/ | head -6
  echo '    --- /resources/checklists/.../ ---'
  curl -sI http://127.0.0.1/resources/checklists/browser-privacy/browser-privacy-security-checklist/ | head -3
"

# ---------- 7. External smoke test ----------

echo "==> Smoke testing from the deploy machine (incognitobrowser.io)..."

curl -sI https://incognitobrowser.io/resources/ | head -6
echo "    ---"
curl -sI https://incognitobrowser.io/resources/sitemap.xml | head -3
echo "    ---"
curl -sI https://incognitobrowser.io/resources/robots.txt | head -3

echo ""
echo "==> Done. Next: run the full audit suite against prod:"
echo "    npm run test:pages:prod"
echo "    npm run test:e2e:prod"
