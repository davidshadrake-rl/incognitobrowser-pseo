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
