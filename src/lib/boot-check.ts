import { getRuntime } from './runtime'

export interface BootCheckDeps {
  build: () => unknown
  write: (text: string) => void
  exit: (code: number) => void
  isProduction: boolean
}

const defaults: BootCheckDeps = {
  build: getRuntime,
  write: (text) => process.stderr.write(text),
  exit: (code) => process.exit(code),
  isProduction: process.env.NODE_ENV === 'production',
}

// Builds the runtime (configuration and catalog, never MongoDB) once at boot; next dev only logs, so a catalog edit doesn't kill the dev server.
export function verifyRuntimeAtBoot(deps: Partial<BootCheckDeps> = {}): void {
  const { build, write, exit, isProduction } = { ...defaults, ...deps }
  try {
    build()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (isProduction) {
      write(`mock-server: cannot start: ${message}\n`)
      exit(1)
    } else {
      write(`mock-server: runtime failed to build (dev server keeps running): ${message}\n`)
    }
  }
}
