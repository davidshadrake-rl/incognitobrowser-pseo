# Security Headers for the WordPress `/resources/` Static Deploy

Next.js's `headers()` config doesn't apply to the static export (`output: "export"`)
because there's no Next server in front of the files. The WordPress/Apache
host has to set the headers itself.

Add this to `public_html/.htaccess` on the WordPress server, **above** the
`# BEGIN WordPress` block and **above** the existing `RewriteRule ^resources/`
exception:

```apache
# ------------------------------------------------------------------
#  Security headers for /resources/* (the Next.js static export)
#  Mirrors the headers our Vercel API serves so the whole site has
#  consistent protection. mod_headers must be enabled.
# ------------------------------------------------------------------
<IfModule mod_headers.c>
    <FilesMatch "\.(html|htm|xml|json|js|css|svg|woff2?|png|jpg|jpeg|gif|webp|ico)$">

        # Anti-MIME-sniffing
        Header always set X-Content-Type-Options "nosniff"

        # Anti-clickjacking (paired with CSP frame-ancestors below)
        Header always set X-Frame-Options "DENY"

        # Don't leak full URLs to other origins
        Header always set Referrer-Policy "strict-origin-when-cross-origin"

        # HSTS: force HTTPS for 2 years, include subdomains, preload-list eligible
        # ONLY enable on production HTTPS. Will break local non-HTTPS testing.
        Header always set Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"

        # Permissions-Policy: lock down browser features the site doesn't use
        Header always set Permissions-Policy "accelerometer=(), ambient-light-sensor=(), autoplay=(), camera=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(self), sync-xhr=(), usb=(), interest-cohort=()"

        # Cross-Origin-Opener-Policy: prevent window.opener cross-origin attacks
        Header always set Cross-Origin-Opener-Policy "same-origin"

        # Content-Security-Policy: defense in depth against XSS and injection
        # Same policy as the API. unsafe-inline + unsafe-eval needed for Next.js
        # hydration; tighten to nonces in a future hardening pass.
        Header always set Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://api.incognitobrowser.io https://incognitobrowser-pseo.vercel.app; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests"

    </FilesMatch>
</IfModule>

# ------------------------------------------------------------------
#  Long-cache the immutable Next.js assets (hashed filenames)
#  Optional but recommended — drops repeat-visitor bandwidth dramatically.
# ------------------------------------------------------------------
<IfModule mod_expires.c>
    ExpiresActive On
    <FilesMatch "_next/static/">
        ExpiresDefault "access plus 1 year"
        Header set Cache-Control "public, max-age=31536000, immutable"
    </FilesMatch>
</IfModule>

# ------------------------------------------------------------------
#  /resources/ → serve from filesystem, bypass WordPress
#  (this rule should already exist from the original deploy)
# ------------------------------------------------------------------
<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteRule ^resources/ - [L]
</IfModule>

# BEGIN WordPress
# (existing WP rules — leave untouched)
# END WordPress
```

## How to verify the headers are working

After uploading to prod, run this from your laptop:

```bash
curl -sI https://incognitobrowser.io/resources/ | grep -iE "content-security|strict-transport|x-frame|x-content|referrer|permissions|cross-origin"
```

You should see all seven headers in the response. If any are missing, the
most common causes are:

| Header missing | Likely cause |
|---|---|
| All headers | `mod_headers` not enabled (run `sudo a2enmod headers && sudo systemctl restart apache2`) |
| Just `Strict-Transport-Security` | Page served over `http://` not `https://` — HSTS only sets on HTTPS responses |
| Just `Content-Security-Policy` | `FilesMatch` pattern didn't match the file extension — add it to the pattern |
| `Permissions-Policy` (only) | Some older Apache versions need `Header set` instead of `Header always set` |

## nginx equivalent

If the production host runs nginx instead of Apache, put this in the server
block above the existing `location ^~ /resources/` directive:

```nginx
location ^~ /resources/ {
    # Security headers — match the Vercel API's set
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header Permissions-Policy "accelerometer=(), ambient-light-sensor=(), autoplay=(), camera=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(self), sync-xhr=(), usb=(), interest-cohort=()" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://api.incognitobrowser.io https://incognitobrowser-pseo.vercel.app; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests" always;

    # Long-cache immutable Next.js assets
    location ~* ^/resources/_next/static/ {
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    try_files $uri $uri/ =404;
}
```

## CSP-Report-Only first (recommended for any plugin-heavy WP install)

If you're worried CSP might break something specific to your WordPress
plugins/theme, switch the CSP line to **Report-Only mode** first:

```apache
Header always set Content-Security-Policy-Report-Only "default-src 'self'; ..."
```

Browsers will report violations to the console (or to a reporting endpoint
if `report-uri` is added) without blocking anything. Watch console logs for
a week, refine the policy, then flip to enforcing.

## Why the FilesMatch pattern

We only set headers on response types where they make sense — HTML/JSON/JS/etc.
Without it, mod_headers would try to attach the headers to PHP responses too,
which WordPress already manages. This way the static files get our hardened
headers and WordPress's own pages are unaffected.
