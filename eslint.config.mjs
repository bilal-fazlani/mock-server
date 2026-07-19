import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "ui/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Docs site: authored Markdown/TOML plus generated build output
    // (docs/site/site) and a Python venv (docs/site/.venv) with vendored
    // minified JS — none of it is lintable app source.
    "docs/site/**",
    // Feature worktrees checked out under the repo: they are full copies of
    // the tree, so linting them double-reports every file and applies this
    // config's path-based overrides (e.g. bin/**) to the wrong paths.
    ".claude/worktrees/**",
  ]),
  {
    // bin/ scripts are plain CommonJS (no "type": "module" in package.json,
    // and no build step runs before they're executed by npx), so they use
    // require() intentionally rather than ESM imports.
    files: ["bin/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
