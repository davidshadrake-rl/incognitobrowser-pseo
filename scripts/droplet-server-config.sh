#!/usr/bin/env bash
#
# One-time / rare server setup on the droplet. NOT part of a normal deploy
# (that's scripts/deploy.sh). Already applied; run it again only after editing
# scripts/droplet-htaccess.conf.
#
# It splices the managed block (security headers, Pro noindex, redirects for
# the Pro shells, immutable caching for hashed assets) into the web root's
# .htaccess and restarts Apache. That .htaccess is shared with the other site
# on the droplet, which is why deploys don't touch it.
#
# Reads the droplet login from .secrets, like deploy.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .secrets ] || { echo "No .secrets file: copy .secrets.example to .secrets and fill it in." >&2; exit 1; }
# shellcheck disable=SC1091
source .secrets
HOST="$DEPLOY_USER@$DEPLOY_HOST"
DROPLET_ORIGIN="$SITE_ORIGIN"
export SSH_OPTS="-i $DEPLOY_SSH_KEY -o IdentitiesOnly=yes"

echo "== server config: security headers, rewrite bypass, managed .htaccess block"
HTTPS_HOST="${DROPLET_ORIGIN#https://}"
sed "s/__HTTPS_HOST__/${HTTPS_HOST}/g" scripts/droplet-htaccess.conf > /tmp/pseo-htaccess-block.conf
scp -q $SSH_OPTS /tmp/pseo-htaccess-block.conf "$HOST:/tmp/pseo-htaccess-block.conf"
rm -f /tmp/pseo-htaccess-block.conf
ssh $SSH_OPTS "$HOST" bash -s <<'REMOTE'
set -euo pipefail
HT=/var/www/html/.htaccess
# root:www-data: www-data is the WordPress uid on this box and only needs to
# read these. See the note in scripts/deploy.sh.
[ -d /var/www/html/resources ] && chown -R root:www-data /var/www/html/resources
[ -d /var/www/html/resources-pro ] && chown -R root:www-data /var/www/html/resources-pro
for d in /var/www/html/resources /var/www/html/resources-pro; do
  [ -d "$d" ] || continue
  find "$d" -type d -exec chmod 750 {} \;
  find "$d" -type f -exec chmod 640 {} \;
done
if ! grep -q 'resources-pro/ - \[L\]' "$HT"; then
  sed -i '0,/RewriteRule \^resources\/ - \[L\]/s//RewriteRule ^resources\/ - [L]\n  RewriteRule ^resources-pro\/ - [L]/' "$HT"
fi
a2enmod -q headers expires >/dev/null 2>&1 || true
# Backups go OUTSIDE the web root, and only the last 10 are kept.
#
# This used to write "$HT.bak.<epoch>" next to the file, i.e. into
# /var/www/html — a directory Apache serves. 18 copies of the server's
# .htaccess had accumulated there, each one a map of the rewrite rules, the
# header policy and the paths behind them. They answer 403 on THIS box only
# because a dotfile deny was added on 2026-09-19; on a host that has not had
# that rule applied yet they are readable, and this script is what would put
# them there. A config backup is not site content and does not belong in a
# directory whose entire job is to hand files to strangers.
BACKUP_DIR=/root/htaccess-backups
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
cp "$HT" "$BACKUP_DIR/htaccess.$(date +%s)"
ls -1t "$BACKUP_DIR"/htaccess.* 2>/dev/null | tail -n +11 | xargs -r rm -f
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

