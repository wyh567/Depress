import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @depress/ast ships raw TS source; Next must transpile it.
  transpilePackages: ["@depress/ast"],
};

export default nextConfig;
