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
};

export default nextConfig;
