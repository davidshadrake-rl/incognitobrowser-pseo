# Production Cutover — AWS EC2

Deploys the static `/resources/` bundle to the production WordPress
EC2 instance and serves it directly (Apache or nginx). WP itself is
untouched.

> **Difference from CUTOVER.md:** the original was written for the
> DigitalOcean droplet (root + Apache). EC2 has a non-root default
> user, uses .pem-key auth or SSM, and the WordPress AMI marketplaces
> ship indifferent flavors (Bitnami → Apache + custom paths; AWS WP
> AMI → standard /var/www/html). This guide branches on what's there.

---

## Variables to fill in

```bash
export EC2_HOST=<public IPv4 or public DNS>
export EC2_USER=<ec2-user|ubuntu|admin|bitnami>     # depends on AMI
export EC2_KEY=~/.ssh/<your-key>.pem
# Discovered in step 1:
export WP_ROOT=<filled in after probe>
export WEB_SERVER=<apache|nginx>
```

The standard SSH command pattern used throughout:
```bash
ssh -i $EC2_KEY $EC2_USER@$EC2_HOST '<command>'
```

If you're using Systems Manager Session Manager instead of SSH, swap
the ssh + scp + rsync commands as noted in **Appendix A**.

---

## 1. Pre-flight probe

Identify the web server, WordPress install location, and existing
permissions before touching anything.

```bash
ssh -i $EC2_KEY $EC2_USER@$EC2_HOST '
  echo "=== OS ==="
  cat /etc/os-release | head -2
  echo "=== Web server ==="
  systemctl is-active apache2 httpd nginx 2>&1 | head -5
  ps -ef | grep -E "apache|nginx|httpd" | grep -v grep | head -3
  echo "=== Web roots ==="
  ls -d /var/www/html /opt/bitnami/wordpress /usr/share/nginx/html 2>/dev/null
  find /var/www /opt/bitnami /usr/share/nginx -maxdepth 4 -name wp-config.php 2>/dev/null
  echo "=== /resources/ already exists? ==="
  find /var/www /opt/bitnami /usr/share/nginx -maxdepth 4 -type d -name resources 2>/dev/null
'
```

**Set `WP_ROOT` and `WEB_SERVER`** based on the output:

- `/var/www/html` + apache2 → AWS-standard WordPress AMI, Apache
- `/opt/bitnami/wordpress` + apache → Bitnami WordPress AMI
- `/usr/share/nginx/html` or `/var/www/html` + nginx → custom or LEMP setup

**Take an EBS snapshot now.** AWS Console → EC2 → Volumes → select the
root volume → Actions → Create snapshot. Wait until it completes
before continuing. Cost: pennies. Insurance: total rollback.

---

## 2. Build the static bundle locally

```bash
cd "/Users/davidshadrake/Documents/Radius Labs/incognitobrowser pseo2.0/pseo"
npm install
npm run build:static    # outputs to ./out/ (~142 MB, 8,300+ files)
```

Sanity check:
```bash
test -f out/checklists/browser-privacy/browser-privacy-security-checklist/index.html && echo OK
test -f out/robots.txt && echo OK
grep -c 'related-card\|atlas-card' out/checklists/browser-privacy/browser-privacy-security-checklist/index.html
# expect >= 1 (pSEO internal-link rule)
```

---

## 3. Push the bundle to the EC2 instance

The default user `$EC2_USER` typically can't write directly to
`/var/www/html` — sudo is required. The clean pattern:

```bash
# Stage to a writable scratch dir, then sudo-move it into place.
ssh -i $EC2_KEY $EC2_USER@$EC2_HOST "mkdir -p ~/pseo-stage"
rsync -avz --delete -e "ssh -i $EC2_KEY" out/ $EC2_USER@$EC2_HOST:~/pseo-stage/

ssh -i $EC2_KEY $EC2_USER@$EC2_HOST "
  sudo rsync -a --delete ~/pseo-stage/ $WP_ROOT/resources/
  sudo chown -R www-data:www-data $WP_ROOT/resources/   # Ubuntu Apache/nginx default
  # For AWS Linux / Bitnami substitute:
  #   sudo chown -R apache:apache $WP_ROOT/resources/   # AWS Linux
  #   sudo chown -R daemon:daemon $WP_ROOT/resources/   # Bitnami
  rm -rf ~/pseo-stage
"
```

---

## 4. Install security headers

### 4a. Apache instance → use `.htaccess`

```bash
scp -i $EC2_KEY HEADERS-WP.md $EC2_USER@$EC2_HOST:~/
ssh -i $EC2_KEY $EC2_USER@$EC2_HOST "
  sudo nano $WP_ROOT/resources/.htaccess
  # Paste the Apache block from HEADERS-WP.md
  sudo a2enmod headers expires 2>/dev/null
  sudo apache2ctl configtest && sudo systemctl reload apache2
"
```

> If the WP AMI is **Bitnami Apache** the command is
> `sudo /opt/bitnami/ctlscript.sh restart apache` instead of
> `systemctl reload apache2`.

### 4b. Nginx instance → server-block snippet

`.htaccess` does not work on nginx. Use `HEADERS-NGINX.md` (in this
repo) and append the location block to the existing site config.

```bash
scp -i $EC2_KEY HEADERS-NGINX.md $EC2_USER@$EC2_HOST:~/
ssh -i $EC2_KEY $EC2_USER@$EC2_HOST "
  # Find the nginx config that serves incognitobrowser.io:
  sudo grep -rln 'server_name.*incognitobrowser' /etc/nginx/
  # Edit that file and paste the location block from HEADERS-NGINX.md
  sudo nano /etc/nginx/sites-available/<your-site>.conf  # adjust path
  sudo nginx -t && sudo systemctl reload nginx
"
```

---

## 5. CloudFront invalidation (only if you use CloudFront)

If `incognitobrowser.io` is fronted by CloudFront, the new files
won't be visible to users until the cache is invalidated.

```bash
# From your Mac (requires aws CLI + credentials):
aws cloudfront create-invalidation \
  --distribution-id <DIST_ID> \
  --paths "/resources/*"
```

Skip if you're hitting the EC2 instance directly (DNS A record → EC2
public IP or EIP).

---

## 6. Smoke test

From your Mac:
```bash
curl -sI https://incognitobrowser.io/resources/ | head -10
curl -sI https://incognitobrowser.io/resources/checklists/browser-privacy/browser-privacy-security-checklist/ | head -10
```

Both should return:
- `HTTP/2 200` (or `HTTP/1.1 200 OK`)
- `Content-Security-Policy:` header present
- `Strict-Transport-Security:` header present

---

## 7. Full audit (433 tests)

```bash
cd "/Users/davidshadrake/Documents/Radius Labs/incognitobrowser pseo2.0/pseo"
npm run test:pages:prod   # 27 rendered-pages tests
npm run test:e2e:prod     # 15 tool E2E tests + 2 contextual skips
```

Expected: **27 pages-test pass + 15 e2e pass + 2 skipped**.

---

## 8. Post-cutover monitoring (first 48h)

- [ ] Google Search Console — watch for crawl errors on /resources/*
- [ ] Vercel logs — scanner API (`/api/scan-url`) traffic + error rate
- [ ] AWS CloudWatch — EC2 CPU / disk usage trends
- [ ] Confirm WordPress homepage, login, and existing posts still work
- [ ] Confirm `/resources/` 404 rate is near zero
- [ ] Schedule the pen test

---

## Rollback

If anything is wrong, this restores the prior 404 state within seconds.
WordPress is unaffected.

```bash
ssh -i $EC2_KEY $EC2_USER@$EC2_HOST "
  sudo mv $WP_ROOT/resources $WP_ROOT/resources.broken
  sudo systemctl reload apache2    # or nginx
"
```

If something deeper went wrong (e.g. config edit broke the whole
vhost): restore the EBS snapshot from step 1 via AWS Console → EC2 →
Snapshots → Create Volume from Snapshot → swap volume on the instance.

---

## Appendix A — AWS Systems Manager Session Manager (no SSH)

If the instance is locked down to IAM-only access:

```bash
# Connect:
aws ssm start-session --target i-<INSTANCE_ID>

# Push the bundle (via S3 intermediate, since SSM has no file-copy):
aws s3 cp --recursive out/ s3://<your-bucket>/pseo-stage/
# Then in the SSM session:
sudo aws s3 cp --recursive s3://<your-bucket>/pseo-stage/ $WP_ROOT/resources/
```

Slower than rsync but works without opening port 22 to the world.

---

## Appendix B — Auto-scaling group / multiple instances

If the WordPress site runs behind an Application Load Balancer with
multiple EC2 instances in an ASG, **Path A (subdirectory on each
instance) is the wrong approach.** Two better options:

1. **S3 + CloudFront** — upload `out/` to an S3 bucket, point a
   CloudFront behavior at the bucket for `/resources/*`. The WP
   instances never see this path. Zero ASG impact.
2. **Bake into a new AMI** — push the bundle to one instance, bake an
   AMI, update the launch template, do a rolling instance refresh on
   the ASG. Higher operational cost but keeps the same single-server
   model.

Decision depends on your ASG size and how often you'll redeploy.
S3+CloudFront is the right answer for >2 instances.
