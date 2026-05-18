# Production Cutover — Path A (subdir on existing WP server)

Pushes the static `/resources/` bundle to the production WordPress droplet
and serves it directly from Apache. WP itself is untouched.

## Prerequisites on the cutover machine

- Node 20+
- `git`, `rsync`, `ssh`, `curl`
- SSH key authorized on the prod droplet (`ssh root@<PROD_IP>` works)
- This repo cloned: `git clone https://github.com/davidshadrake-rl/incognitobrowser-pseo.git`

## Variables to fill in

```bash
export PROD_IP=<droplet_ipv4>
export WP_ROOT=<e.g. html or incognitobrowser.io>   # confirmed via pre-check
```

---

## 1. Pre-flight

```bash
# Confirm web root, server software, and that /resources/ is empty.
ssh root@$PROD_IP "ls /var/www/ && which apache2 nginx && ls /var/www/$WP_ROOT/resources/ 2>&1"
```

Expected:
- `apache2` resolves to a path (we assume Apache; adapt if nginx)
- `/var/www/$WP_ROOT/resources/` does NOT exist yet (or is safely removable)

**Take a DigitalOcean snapshot now.** Web console → Droplet → Snapshots → Take Snapshot. Wait for it to complete before continuing.

---

## 2. Build the static bundle

```bash
cd incognitobrowser-pseo
npm install
npm run build:static    # outputs to ./out/
```

Sanity check:
```bash
test -f out/resources/tools/vpn-privacy/whats-my-ip/index.html && echo OK
grep -c 'related-card\|atlas-card' out/resources/tools/vpn-privacy/whats-my-ip/index.html
# expect >= 12 (pSEO internal-link rule)
```

---

## 3. Push the bundle to prod

```bash
rsync -avz --delete out/resources/ root@$PROD_IP:/var/www/$WP_ROOT/resources/
```

---

## 4. Install the .htaccess (security headers)

```bash
scp HEADERS-WP.md root@$PROD_IP:/tmp/
ssh root@$PROD_IP
```

On the server:
```bash
# Open HEADERS-WP.md, copy the Apache block, paste into:
nano /var/www/$WP_ROOT/resources/.htaccess
# Save, then:
apache2ctl configtest
systemctl reload apache2
exit
```

---

## 5. Smoke test

```bash
curl -sI https://incognitobrowser.io/resources/ | head -10
curl -sI https://incognitobrowser.io/resources/tools/vpn-privacy/whats-my-ip/ | head -10
```

Both should return:
- `HTTP/2 200` (or `HTTP/1.1 200 OK`)
- `Content-Security-Policy:` header present
- `Strict-Transport-Security:` header present

---

## 6. Full E2E audit against prod

```bash
npx playwright install chromium --with-deps    # first time only
npm run test:e2e:prod
```

Expected: **15 passed, 2 skipped, 0 failed.**
(The 2 skips are HTTP-only banner tests — they intentionally skip on HTTPS.)

---

## 7. Post-cutover monitoring (first 48h)

- [ ] Google Search Console — watch for crawl errors
- [ ] Vercel logs — scanner API (`/api/scan-url`) traffic + error rate
- [ ] Confirm WP homepage, login, existing posts still work
- [ ] Confirm `/resources/` 404s are zero
- [ ] Pen test vendor lined up

---

## Rollback

If anything is wrong, this restores the prior 404 state within seconds:

```bash
ssh root@$PROD_IP "mv /var/www/$WP_ROOT/resources /var/www/$WP_ROOT/resources.broken && systemctl reload apache2"
```

WordPress is unaffected. To restore the bundle later: `mv resources.broken resources && systemctl reload apache2`.
