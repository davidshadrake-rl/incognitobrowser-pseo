import type { NextConfig } from "next";

// Dual-target build:
//   BUILD_TARGET=static → fully static export for WordPress (incognitobrowser.io/resources/)
//   default              → server mode for Vercel (api.incognitobrowser.io/scan-url)
//
// Static export disables API route handlers that rely on Request (POST /scan-url),
// so the scanner must ship via the server build. Keeping both in one repo lets the
// static pages still call the Vercel API by absolute URL.
const isStatic = process.env.BUILD_TARGET === "static";

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
        basePath: "/resources",
        trailingSlash: true,
      }
    : {}),
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
