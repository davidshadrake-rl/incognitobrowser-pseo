import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // output: "export",         // Enable for static HTML export
  // basePath: "/resources",   // Enable when deploying to incognitobrowser.io/resources/
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
