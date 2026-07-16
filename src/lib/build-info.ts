// Build-time version and git SHA, injected as inlined public env vars by
// next.config.ts. Import from here instead of reading process.env directly so
// there is a single source of truth for what "this build" is.
export const BUILD_INFO = {
  version: process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0-dev',
  gitSha: process.env.NEXT_PUBLIC_GIT_SHA ?? 'unknown',
} as const

// Short SHA for compact display; leaves sentinel values ("unknown", "dev") intact.
export const gitShaShort =
  BUILD_INFO.gitSha.length >= 7 && /^[0-9a-f]+$/i.test(BUILD_INFO.gitSha)
    ? BUILD_INFO.gitSha.slice(0, 7)
    : BUILD_INFO.gitSha
