import type { NextConfig } from "next";

// Dual-target build:
//   BUILD_TARGET=static → fully static export for WordPress (incognitobrowser.io/resources/)
//   default              → server mode for Vercel (api.incognitobrowser.io/scan-url)
//
// Static export disables API route handlers that rely on Request (POST /scan-url),
// so the scanner must ship via the server build. Keeping both in one repo lets the
// static pages still call the Vercel API by absolute URL.
const isStatic = process.env.BUILD_TARGET === "static";

// basePath defaults to /resources for the WordPress-layered static deploy,
// but can be overridden via BASE_PATH env var. Set BASE_PATH="" for deploys
// where out/ is served at the root of the host (Cloudflare Pages, Netlify,
// dev tunnels). Set BASE_PATH=/some-other-path for unusual subdirectories.
const explicitBasePath = process.env.BASE_PATH;
const basePath =
  explicitBasePath !== undefined ? explicitBasePath : (isStatic ? "/resources" : "");

// Security headers applied to every response from the Vercel deploy (API +
// server-rendered pages). For the static export deploy, equivalent headers
// must be configured on the host (see HEADERS-WP.md for the .htaccess version
// to put on the WordPress server).
//
// CSP rationale:
//   - script-src includes 'unsafe-inline' + 'unsafe-eval' because Next.js
//     inlines hydration scripts and some bundled deps use eval. Moving to a
//     nonce-based CSP would be the next-level hardening but isn't trivial
//     with the App Router's current architecture.
//   - connect-src whitelists the API host so the cookie scanner can call
//     /scan-url; allows the Vercel preview URL too for staging.
//   - frame-ancestors 'none' kills clickjacking regardless of X-Frame-Options.
//   - object-src 'none' blocks Flash/legacy plugin-based attacks.
//   - upgrade-insecure-requests forces any http:// asset references to https.
//
// HSTS only enables once we're on the real production domain. Vercel's default
// *.vercel.app domain auto-HSTS, but we set it explicitly to keep behavior
// consistent across environments.
const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://api.incognitobrowser.io https://incognitobrowser-pseo.vercel.app",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: [
      "accelerometer=()",
      "ambient-light-sensor=()",
      "autoplay=()",
      "camera=()",
      "encrypted-media=()",
      "fullscreen=(self)",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "midi=()",
      "payment=()",
      "picture-in-picture=()",
      "publickey-credentials-get=(self)",
      "sync-xhr=()",
      "usb=()",
      "interest-cohort=()",
    ].join(", "),
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // COEP intentionally omitted — `require-corp` breaks third-party images and
  // the WordPress site occasionally embeds external content. Revisit if a real
  // case for cross-origin isolation comes up.
];

const nextConfig: NextConfig = {
  // Pin Turbopack to this project's directory. Without this, Next.js 16 walks
  // up the filesystem looking for a lockfile and may pick a parent directory's
  // node_modules — which contains an incompatible React JSX runtime and breaks
  // builds with "Export jsxs doesn't exist in target module".
  turbopack: {
    root: __dirname,
  },
  ...(isStatic
    ? {
        output: "export" as const,
        basePath: basePath || undefined,
        trailingSlash: true,
      }
    : {}),
  images: {
    unoptimized: true,
  },
  // headers() is a no-op when output: "export" is set (there's no server to
  // attach them). For static deploys, see HEADERS-WP.md for the .htaccess
  // equivalent. For Vercel server deploys, these apply to every response.
  async headers() {
    if (isStatic) return [];
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
