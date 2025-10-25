import type { NextConfig } from "next";

// tell TS “trust me, this is fine”
const nextConfig: NextConfig = {
  experimental: {
    // @ts-expect-error - allowedDevOrigins not typed yet
    allowedDevOrigins: ["http://100.70.87.108:3000", "http://localhost:3000"],
  },
};

export default nextConfig;
