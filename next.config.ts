import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/resources",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
