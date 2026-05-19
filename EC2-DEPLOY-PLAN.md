# EC2 / Bitnami deploy plan

Response to the production server info you shared. Captures:
- The deploy script (committed as `scripts/deploy-prod-bitnami.sh`)
- The staging-environment question
- The repo-migration + GitHub Actions question

---

## 1. The deploy script — what it does

`scripts/deploy-prod-bitnami.sh` is the production cutover script,
tuned to your stack (Debian 11, Bitnami nginx, WP at
`/opt/bitnami/wordpress`, bitnami:daemon ownership, Bitnami's own
service controller).

```bash
# First-ever deploy (installs nginx security-headers block):
./scripts/deploy-prod-bitnami.sh root@incognitobrowser.io --install-nginx-config

# Subsequent re-deploys (config persists, only files change):
./scripts/deploy-prod-bitnami.sh root@incognitobrowser.io

# With explicit key:
./scripts/deploy-prod-bitnami.sh ec2-XX.compute.amazonaws.com ~/.ssh/prod.pem --install-nginx-config
```

What it does, in order:

1. Builds the static bundle locally (`BUILD_TARGET=static next build`)
2. Runs `npm run test:pages` against the bundle as a local guardrail
   (refuses to deploy if any of the 27 rendered-pages tests fail)
3. Tars + scp's the bundle + `HEADERS-NGINX.md` to `/tmp/` on the server
4. SSHes in and:
   - Backs up any existing `/resources/` to `resources.bak.<timestamp>`
   - Extracts the bundle into `/opt/bitnami/wordpress/resources/`
   - `chown -R bitnami:daemon` + `chmod 755` dirs / `644` files
   - **If `--install-nginx-config`:** writes
     `/opt/bitnami/nginx/conf/server_blocks/resources-location.conf`,
     adds an `include` directive to your existing
     `wordpress-https-server-block.conf`, validates with
     `nginx -t`, and reloads via `/opt/bitnami/ctlscript.sh restart nginx`
5. Smoke-tests from the server (curl 127.0.0.1) and from your Mac
   (curl the public URL)
6. Reports next-step commands for the full audit suite

**Rollback** is one SSH command:
```bash
sudo mv /opt/bitnami/wordpress/resources \
       /opt/bitnami/wordpress/resources.failed && \
sudo mv /opt/bitnami/wordpress/resources.bak.<timestamp> \
       /opt/bitnami/wordpress/resources
```

If the nginx config itself broke (extremely unlikely — we validate
with `nginx -t` before reloading): restore the auto-generated
`wordpress-https-server-block.conf.bak.<timestamp>` and reload.

---

## 2. Your nginx location concern — confirmed safe

You wrote:

> The nginx location block that might cause problems:
> `location / { try_files $uri $uri/ /index.php?$args; }`
> But I think this is fine for static files actually — try_files
> should serve them directly if they exist before falling through
> to WP.

Confirmed. `try_files` checks the filesystem first. `/resources/foo/`
hits `index.html` directly and never reaches the `/index.php?$args`
fallback. WP permalinks are unaffected.

However: that path serves the static files WITHOUT the security
headers (CSP / HSTS / Permissions-Policy / etc.) we built for the
rest of the surface. That's why the script ships a dedicated
`location ^~ /resources/` block. The `^~` prefix makes nginx prefer
this block over the regex/default block, and it emits the same
header set the Vercel API serves.

If you want to launch without the headers initially and add them
later, omit the `--install-nginx-config` flag and the script will
deploy files only, leaving WP's `location /` to serve them.

---

## 3. Staging environment — yes, recommended

You're right that the current test droplet doesn't validate the
Bitnami-nginx-WP path. The Bitnami AMI on AWS has a Bitnami-equivalent
on DigitalOcean: **"WordPress packaged by Bitnami"** in the DO
Marketplace. Spinning that up takes ~3 minutes; the result is the
same `/opt/bitnami/wordpress/`, same `bitnami:daemon` ownership,
same nginx server-block layout.

**Recommended sequence:**

1. Spin up a Bitnami WordPress droplet on DigitalOcean
   - Marketplace → "WordPress packaged by Bitnami"
   - $6/mo plan is fine for staging
   - Save the IP, add your SSH key
2. Point a throwaway domain (or nip.io) at it, install Let's Encrypt
   (`sudo /opt/bitnami/bncert-tool`)
3. Run the deploy script with `--install-nginx-config` against that
   staging host
4. Run the full audit (`PAGES_TEST_BASE_URL=https://<staging>
   npm run test:pages`) and the e2e suite
5. If green, run the script against prod EC2 with the same flag
6. Tear down the staging droplet

This catches Bitnami-specific issues (the `ctlscript.sh` reload, the
`bitnami:daemon` ownership, the `/opt/bitnami/nginx/` paths) that
the existing vanilla-Apache test droplet doesn't exercise.

I can write the staging-droplet setup script if you want — it's
~10 lines of `doctl` calls plus the deploy script. Say the word.

---

## 4. GitHub repo migration + Actions

Current state of the repo: `github.com/davidshadrake-rl/incognitobrowser-pseo`.
Visibility: presumably private under your personal account.

CI/CD presently:
- **Vercel deploys** the API + server-mode build via the GitHub
  integration on push to `main`. This is a Vercel-side webhook, not a
  GitHub Action — I checked `.github/workflows/` and there are no
  workflows in this repo.
- The `dependencies` / `devDependencies` are vanilla npm; no special
  build secrets baked in. The only env vars Vercel needs are:
  `ANTHROPIC_API_KEY`, `ALTCHA_HMAC_KEY`, `REDIS_URL`,
  `ALLOWED_ORIGINS` (and the tuning knobs in `lib/tuning.ts`).

**Migration steps (you / someone with org admin will run):**

1. Create the destination org repo (e.g.
   `incognitobrowser-org/incognitobrowser-pseo`)
2. Add a new git remote and push: `git remote add enterprise <new-url>
   && git push enterprise --all`
3. Update Vercel project:
   - Project → Settings → Git → disconnect old repo
   - Reconnect to the new `incognitobrowser-org/incognitobrowser-pseo`
   - Vercel re-runs from `main`; no env-var changes needed
4. (Optional) Archive or delete the old personal-account repo
5. Update `package.json` `repository` field if you want; not required

**About a GitHub user for me:** the agent doesn't need a GitHub
account. What I need is read-write access to a working copy of the
repo via SSH or HTTPS-with-token. That can be:

- The current setup (HTTPS with your `davidshadrake-rl` PAT, which
  is what we've been using), OR
- A bot account / service account on the enterprise org (preferred
  long-term — agent commits attributed to a specific bot identity,
  not your personal one)

If you create a `incognito-bot` user, add it as a Collaborator with
write access to the new repo, and put its PAT in `~/.git-credentials`
on this machine, every future push goes out under that identity.
That's the clean separation.

---

## 5. What I need from you to actually deploy

| # | Item | Who | Notes |
|---|---|---|---|
| 1 | EC2 host (DNS or IP) | You | For the deploy command |
| 2 | Bitnami staging droplet IP (recommended) | You | After spinning up the Marketplace image |
| 3 | EBS snapshot of prod taken | You | One-click in AWS Console; insurance |
| 4 | Decision: staging-first vs straight-to-prod | You | I recommend staging-first |
| 5 | (Eventually) repo moved + Vercel reconnected | You or org admin | Not blocking launch |

Once you have item 1 (and ideally 2), I run the deploy.

---

## 6. What WILL change in your nginx config

The script writes ONE new file and adds ONE include line to the
existing server block. The diff is:

**New file:** `/opt/bitnami/nginx/conf/server_blocks/resources-location.conf`
(content: the `location ^~ /resources/` block from `HEADERS-NGINX.md`)

**Modified file:** `wordpress-https-server-block.conf`
```diff
  server {
      ...
+     include /opt/bitnami/nginx/conf/server_blocks/resources-location.conf;
  }
```

Plus a backup of the original at
`wordpress-https-server-block.conf.bak.<timestamp>`.

Nothing else in your nginx config is touched. The reload is via
`/opt/bitnami/ctlscript.sh restart nginx` (Bitnami's idiomatic
command — `systemctl reload nginx` does NOT work on Bitnami).
