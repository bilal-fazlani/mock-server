// Optional editor support (see the dynamic-scenarios guide). Safe to delete.
/** @typedef {{request: {method: string, path: string,
 *   pathParams: Record<string,string>, query: Record<string,string[]>,
 *   headers: Record<string,string>, body: unknown},
 *   history: string[], profileId: string | null}} ResolverInput */

/** @param {ResolverInput} input */
export default function pick(input) {
  const body = input.request.body
  if (body && typeof body === 'object' && 'forceFail' in body && body.forceFail) return 'failure'
  return input.history.length < 2 ? 'pending' : 'default'
}
