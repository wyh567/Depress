import type { NextConfig } from "next";

function productionApiOrigin(): string {
  const configured = process.env["DEPRESS_API_ORIGIN"];
  if (!configured) {
    if (process.env["NODE_ENV"] === "production") {
      throw new Error("DEPRESS_API_ORIGIN is required for production Web builds");
    }
    return "http://localhost:3001";
  }
  const url = new URL(configured);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== configured) {
    throw new Error("DEPRESS_API_ORIGIN must be an HTTP(S) origin without a path");
  }
  return url.origin;
}

const nextConfig: NextConfig = {
  // @depress/ast ships raw TS source; Next must transpile it.
  transpilePackages: ["@depress/ast"],
  async rewrites() {
    const apiOrigin = productionApiOrigin();
    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
