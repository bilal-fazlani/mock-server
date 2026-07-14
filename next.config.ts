import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit .next/standalone with a minimal server.js for a lean Docker image.
  output: "standalone",
  // esbuild (used to transpile catalog _dynamic.ts resolvers) is a native
  // package with a platform-specific binary; keep it out of the bundle and
  // require it at runtime from node_modules. It only runs server-side.
  serverExternalPackages: ["esbuild"],
};

export default nextConfig;
