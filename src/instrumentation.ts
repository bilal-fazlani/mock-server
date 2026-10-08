export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { verifyRuntimeAtBoot } = await import('./lib/boot-check')
  verifyRuntimeAtBoot()
}
