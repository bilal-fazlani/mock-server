export default function pick(input: {
  request: { method: string; path: string; body: unknown }
  history: string[]
  profileId: string | null
}): string {
  const body = input.request.body as { forceFail?: boolean } | null
  if (body?.forceFail) return 'failure'
  return input.history.length < 2 ? 'pending' : 'default'
}
