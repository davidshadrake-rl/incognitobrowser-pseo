# Security Headers for nginx — `/resources/` Static Deploy

Equivalent to `HEADERS-WP.md` (which is Apache-only). Add this block
inside the existing `server { ... }` that handles
`incognitobrowser.io`. Place it AFTER the WordPress location block
so the more-specific `/resources/` location wins.

```nginx
# ------------------------------------------------------------------
#  /resources/ → serve the Next.js static export directly.
#  WordPress at the site root keeps serving everything else.
# ------------------------------------------------------------------
location ^~ /resources/ {
    # Adjust root to whatever WP_ROOT resolved to in the cutover.
    # The block expects the bundle to live at $WP_ROOT/resources/.
    root /var/www/html;

    # Pretty URLs: /resources/foo/ → /resources/foo/index.html
    try_files $uri $uri/ $uri/index.html =404;

    # ------------------------------------------------------------------
    #  Security headers — must match the Vercel API headers so the
    #  whole site has consistent protection.
    # ------------------------------------------------------------------

    # Anti-MIME-sniffing
    add_header X-Content-Type-Options "nosniff" always;

    # Anti-clickjacking (paired with CSP frame-ancestors below)
    add_header X-Frame-Options "DENY" always;

    # Don't leak full URLs to other origins
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # HSTS: force HTTPS for 2 years, preload-eligible.
    # Enable ONLY on production HTTPS.
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    # Permissions-Policy: lock down browser features the site doesn't use.
    add_header Permissions-Policy "accelerometer=(), ambient-light-sensor=(), autoplay=(), camera=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(self), sync-xhr=(), usb=(), interest-cohort=()" always;

    # Cross-Origin-Opener-Policy: prevent window.opener cross-origin attacks
    add_header Cross-Origin-Opener-Policy "same-origin" always;

    # Content-Security-Policy: defense in depth against XSS and injection.
    # unsafe-inline + unsafe-eval needed for Next.js hydration; tighten
    # to nonces in a future hardening pass.
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://api.incognitobrowser.io https://incognitobrowser-pseo.vercel.app; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests" always;

    # ------------------------------------------------------------------
    #  Long-cache the immutable Next.js assets (hashed filenames).
    # ------------------------------------------------------------------
    location ^~ /resources/_next/static/ {
        root /var/www/html;
        try_files $uri =404;

        # Hashed filenames → cache forever.
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable" always;

        # Re-emit the security headers for assets too (nginx doesn't
        # inherit add_header into nested location blocks).
        add_header X-Content-Type-Options "nosniff" always;
    }

    # ------------------------------------------------------------------
    #  Don't cache HTML — content changes need to propagate immediately.
    # ------------------------------------------------------------------
    location ~* \.html$ {
        root /var/www/html;
        try_files $uri =404;
        add_header Cache-Control "public, max-age=0, must-revalidate" always;
        add_header X-Content-Type-Options "nosniff" always;
    }
}
```

## Apply + reload

```bash
sudo nginx -t                # validate config first; refuses to reload if invalid
sudo systemctl reload nginx  # zero-downtime reload
```

## How to verify the headers are live

```bash
curl -sI https://incognitobrowser.io/resources/ | grep -i 'content-security-policy\|strict-transport\|x-content-type\|permissions-policy'
```

Should print all four headers.

## Gotchas

- **`add_header` does NOT inherit across nested location blocks.** That's why the security headers are repeated inside `/resources/_next/static/` and `*.html`. Removing them silently disables protection on those file types.
- **`always` is mandatory** for the headers to apply to non-2xx responses (404 pages, redirects). Without it, a 404 page would skip CSP / HSTS.
- **`try_files` ordering matters.** `$uri $uri/ $uri/index.html =404` resolves `/resources/foo/` → `/resources/foo/index.html`. If your Next config ever changes the output structure, this needs to match.
- **If CloudFront fronts the instance**, headers can be set there instead (or in addition). Setting them at both layers is fine — the more-restrictive wins. CloudFront's "Response Headers Policy" is the AWS-native way.
