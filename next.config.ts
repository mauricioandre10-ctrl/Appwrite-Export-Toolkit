import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: [
    "localhost",
    "preview.tecnovacenter.com",
    "backen.tecnovacenter.com",
  ],
};

export default nextConfig;
