import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @libsql/client loads a native addon for local file databases; keep it out
  // of the bundler so it resolves at runtime.
  serverExternalPackages: ["@libsql/client", "libsql"],
};

export default nextConfig;
