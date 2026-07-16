import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // The UI now uses shadcn-style `@/…` imports (e.g. `@/app/components/ui/badge`,
  // `@/lib/utils`). Vitest does not read tsconfig `paths`, so mirror the `@ → ./src`
  // alias here so the component/UI tests can resolve those imports.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
    hookTimeout: 120000, // mongodb-memory-server downloads a binary on first run
  },
})
