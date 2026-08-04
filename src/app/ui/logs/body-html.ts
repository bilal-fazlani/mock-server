import { highlight } from '../highlight'
import type { LogBodyHtml } from './types'

/**
 * Shiki markup for an entry's request/response bodies.
 *
 * This runs server-side, not in the row, because the highlighter is async and
 * Node-only while the detail panel is a client component — so the markup has to
 * ride along with the payload it decorates.
 *
 * Only structured bodies are highlighted. A body stored as a raw string may be
 * XML, form-encoded, or plain text, and painting that with the JSON grammar
 * would mis-colour it rather than leave it alone, so those render unchanged. A
 * truncated body *is* highlighted: the grammar tolerates the unterminated tail,
 * and dropping colour exactly when a payload is hardest to read would be the
 * wrong trade.
 *
 * Returns `undefined` when neither side produced markup, so the response omits
 * the field rather than carrying an empty object.
 */
export async function buildBodyHtml(
  request: { body?: unknown } | undefined,
  response: { body?: unknown } | undefined,
): Promise<LogBodyHtml | undefined> {
  const [requestHtml, responseHtml] = await Promise.all([
    highlightBody(request?.body),
    highlightBody(response?.body),
  ])
  if (!requestHtml && !responseHtml) return undefined
  return { ...(requestHtml && { request: requestHtml }), ...(responseHtml && { response: responseHtml }) }
}

function highlightBody(body: unknown): Promise<string> | undefined {
  if (body == null || typeof body === 'string') return undefined
  return highlight(JSON.stringify(body, null, 2), 'json')
}
