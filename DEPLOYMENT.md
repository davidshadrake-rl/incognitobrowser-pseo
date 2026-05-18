# Deploying `/resources/` to WordPress

Full deployment flow for shipping the Next.js static site to
`incognitobrowser.io/resources/` on your WordPress server, with the cookie
scanner API on `api.incognitobrowser.io` via Vercel.

---

## 1. Build the static bundle locally

```bash
cd pseo
npm run build:static
```

This produces `out/` — 605 HTML files plus `_next/static/...` assets. Everything
in there is what ships to WordPress. The `.next/` directory from a server build
is different and you don't need it for WP.

Verify before uploading:

```bash
# Should list ~605 .html files
find out -name "*.html" | wc -l

# Sanity-check a page opens correctly
open out/tools/ad-tracking/cookie-tracker-scanner/index.html
```

The page will look broken when opened directly (CSS/JS paths expect `/resources/...`
prefix) — that's fine. It'll work once uploaded to the right path.

---

## 2. Upload `out/` contents to `public_html/resources/`

Whatever method you normally use to put files on the WordPress server:

- **SFTP** (Transmit, FileZilla, Cyberduck, WinSCP)
- **cPanel File Manager** → upload as zip, extract
- **SSH + rsync** (fastest if you have SSH access):

```bash
# From the pseo/ directory locally
rsync -avz --delete out/ user@incognitobrowser.io:~/public_html/resources/
```

**Critical:** upload the *contents* of `out/`, not the `out/` folder itself. Your
WP server's filesystem should end up looking like:

```
public_html/
├── wp-admin/
├── wp-content/
├── wp-includes/
├── index.php              ← WordPress
├── .htaccess              ← you edit this next
└── resources/             ← your Next.js static site
    ├── index.html
    ├── 404.html
    ├── _next/
    ├── guides/
    ├── tools/
    ├── checklists/
    ├── topics/
    ├── sitemap.xml
    └── ...
```

---

## 3. Stop WordPress from intercepting `/resources/`

**This is the step most likely to bite you.** WordPress's default `.htaccess`
rewrites every URL through `index.php`. Without this exception,
`incognitobrowser.io/resources/tools/...` returns a WP 404 instead of your
static HTML.

### Apache (most shared hosts)

Edit `public_html/.htaccess` and add this **above** the existing
`# BEGIN WordPress` block:

```apache
# --- Static resources directory: serve from disk, bypass WordPress ---
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteRule ^resources/ - [L]
</IfModule>

# BEGIN WordPress
# ... existing WP rules (leave untouched) ...
# END WordPress
```

That single `RewriteRule` tells Apache: "anything under `/resources/`, stop
rewriting and serve from disk." The `[L]` flag stops further rule processing.

### nginx (Kinsta, Cloudways, Runcloud, managed hosts)

Add this to your server block **before** the WordPress `try_files` line:

```nginx
location ^~ /resources/ {
  try_files $uri $uri/ =404;
}
```

Ask your host if you don't have filesystem access to the nginx config — they
can add it for you.

---

## 4. Verify it works

Test these URLs in a browser (hard refresh with Cmd+Shift+R to bypass cache):

| URL | Expected |
|---|---|
| `https://incognitobrowser.io/resources/` | Your homepage with the topic grid |
| `https://incognitobrowser.io/resources/tools/` | Tools index |
| `https://incognitobrowser.io/resources/topics/vpn-privacy/` | A niche hub page |
| `https://incognitobrowser.io/resources/sitemap.xml` | Plain XML, not a WP 404 |
| `https://incognitobrowser.io/some-wp-page/` | Normal WordPress page (routing still works) |

If the WP-side URL breaks, your rewrite rule is intercepting too broadly. Revert
and re-test.

---

## 5. Wire up the scanner API subdomain (Vercel)

The cookie-scanner tool calls `https://api.incognitobrowser.io/scan-url`. That
needs to be pointed at your Vercel project.

### In your Vercel dashboard

1. Open the project (the one that builds from `davidshadrake-rl/incognitobrowser-pseo`)
2. Settings → Domains → Add → `api.incognitobrowser.io`
3. Vercel will show a DNS record to add (usually `CNAME api cname.vercel-dns.com`)

### In your DNS provider

(Cloudflare/Namecheap/Route53/whoever manages incognitobrowser.io)

1. Add a `CNAME` record: `api` → `cname.vercel-dns.com`
2. If Cloudflare: set proxy status to **DNS only** (grey cloud) — orange cloud
   can break CORS

Propagation takes 1–30 minutes. Verify with:

```bash
curl -X OPTIONS https://api.incognitobrowser.io/scan-url \
  -H "Origin: https://incognitobrowser.io" -i
```

Should return `204` with `Access-Control-Allow-Origin: https://incognitobrowser.io`.

---

## 6. Submit the sitemap to Google

Once the site is live:

1. Google Search Console → your `incognitobrowser.io` property
2. Sitemaps → Add: `https://incognitobrowser.io/resources/sitemap.xml`
3. Watch coverage over the next few days — Google will index ~100–300/day

---

## 7. For future updates

Every time you change content and want to redeploy:

```bash
npm run build:static
rsync -avz --delete out/ user@incognitobrowser.io:~/public_html/resources/
```

The `--delete` flag removes files from the server that no longer exist in
`out/` — important so old stale pages don't linger.

---

## Common gotchas

| Symptom | Cause | Fix |
|---|---|---|
| All pages are WP 404s | `.htaccess` rule missing or after `# BEGIN WordPress` | Put the rule **above** WordPress's block |
| Pages load but CSS is broken | Uploaded `out/` as a folder not its contents | Re-upload so `index.html` is directly in `/resources/` |
| Mixed-content warnings | WP is HTTPS but assets load HTTP | Confirm `basePath` produces `https://` links (it does via relative paths — shouldn't happen) |
| Scanner says "network error" | `api.incognitobrowser.io` DNS not pointing to Vercel, or Cloudflare orange-cloud strips CORS | Set CNAME to `cname.vercel-dns.com`, grey cloud |
| Old content keeps appearing | Host-level or Cloudflare page cache | Purge CDN cache after each deploy |
| `/resources/tools/foo/` 404s but `/resources/tools/foo/index.html` works | nginx `try_files` missing the `$uri/` fallback | Make sure rule is `try_files $uri $uri/ =404;` |

---

## What you get after step 4

- `incognitobrowser.io/resources/` — 605 static pages, instant load, zero Vercel dependency
- `incognitobrowser.io` root — untouched WordPress
- `api.incognitobrowser.io/scan-url` — the one server-side endpoint (Vercel-hosted,
  CORS-locked to `incognitobrowser.io`, rate-limited to 10/min/IP)
