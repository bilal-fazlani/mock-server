import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit .next/standalone with a minimal server.js for a lean Docker image.
  output: "standalone",
  // Loaded via dynamic import() at runtime for the embedded-Mongo fallback;
  // force it (and its bundled tooling) into the standalone output.
  serverExternalPackages: ["mongodb-memory-server"],
  outputFileTracingIncludes: {
    "**": ["./node_modules/mongodb-memory-server/**"],
  },
};

export default nextConfig;
