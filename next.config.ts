import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// Build info baked in at build time. Version comes from package.json; the git
// SHA is passed in via GIT_SHA (Docker build-arg) or GITHUB_SHA (CI), and falls
// back to "unknown" for local builds where neither is set.
const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as {
  version: string;
};
const gitSha = process.env.GIT_SHA ?? process.env.GITHUB_SHA ?? "unknown";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_GIT_SHA: gitSha,
  },
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
