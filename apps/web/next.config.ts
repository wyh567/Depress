import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @depress/ast ships raw TS source; Next must transpile it.
  transpilePackages: ["@depress/ast"],
  async rewrites() {
    const apiOrigin = process.env["API_INTERNAL_URL"] ?? "http://localhost:3001";
    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
