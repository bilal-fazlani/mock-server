import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit .next/standalone with a minimal server.js for a lean Docker image.
  output: "standalone",
  // mongodb-memory-server: loaded via dynamic import() at runtime for the
  // embedded-Mongo fallback; force it (and its bundled tooling) into the
  // standalone output. esbuild (used to transpile catalog _dynamic.ts
  // resolvers): its platform-binary resolution is a dynamic require keyed by
  // process.platform/arch that breaks both the webpack and Turbopack
  // production bundlers if bundled instead of left as a plain runtime
  // dependency — see src/lib/mock-engine/resolver.ts.
  serverExternalPackages: ["mongodb-memory-server", "esbuild"],
  outputFileTracingIncludes: {
    "**": ["./node_modules/mongodb-memory-server/**"],
  },
};

export default nextConfig;
