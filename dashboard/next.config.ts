import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // API calls to FastAPI backend
  async rewrites() {
    return [
      {
        source: "/api/pipeline/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
