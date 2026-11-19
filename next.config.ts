import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page here is per-user and reads live data, so pages render on request.
  cacheComponents: false,
  // Used from Node only; must not be bundled.
  serverExternalPackages: ["mysql2", "puppeteer", "sharp"],
  experimental: {
    // Adverts are uploaded as pictures of up to 30 MB.
    serverActions: { bodySizeLimit: "32mb" },
    proxyClientMaxBodySize: "32mb",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
