import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit .next/standalone with a minimal server.js for a lean Docker image.
  output: "standalone",
  // mongodb-memory-server: loaded via dynamic import() at runtime for the
  // embedded-Mongo fallback; force it (and its bundled tooling) into the
  // standalone output. esbuild: its platform-binary resolution (a dynamic
  // require keyed by process.platform/arch) breaks both the webpack and
  // Turbopack production bundlers if esbuild is bundled instead of left as
  // a plain runtime dependency — see src/lib/mock-engine/resolver.ts.
  serverExternalPackages: ["mongodb-memory-server", "esbuild"],
  outputFileTracingIncludes: {
    "**": ["./node_modules/mongodb-memory-server/**"],
  },
};

export default nextConfig;
