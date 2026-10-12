import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Oracle free-tier VM has limited memory. Limiting build workers prevents
  // the production build from exhausting memory when Docker reports host CPUs.
  experimental: {
    cpus: 1,
  },
};

export default nextConfig;
