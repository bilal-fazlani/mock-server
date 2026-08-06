/**
 * Every /ui/api/* error response shares one JSON envelope:
 * `{ "error": "<message>", "code": "<code>" }`. `error` is a human-readable
 * message and may change wording between releases; `code` is the stable,
 * machine-readable identifier a caller can safely match on. Both are
 * documented in the OpenAPI spec (openapi.json) and the API guide.
 *
 * `GET /ui/api/health`'s `503` is the one exception — it keeps the health
 * body shape and adds a bare `error` field, not this envelope — so it builds
 * its response directly rather than through this helper.
 *
 * Naming rule for new codes, verified to hold for all nine below:
 * `unknown_*` is a 404 from looking up a URL path segment (system, endpoint,
 * scenario slug) against the catalog; `*_not_found` is a 404 from looking up
 * an opaque store ID (profileId, logId) against Mongo. Every code maps to
 * exactly one HTTP status — never reuse one across two.
 */
export type ControlApiErrorCode =
  | 'invalid_json'
  | 'unknown_endpoint'
  | 'unknown_scenario'
  | 'endpoint_not_global'
  | 'scenario_required'
  | 'scenario_not_declared'
  | 'invalid_scenario_selection'
  | 'profile_not_found'
  | 'log_not_found'

/** Builds the `{ error, code }` JSON response for a /ui/api/* error path. */
export function errorResponse(
  message: string,
  code: ControlApiErrorCode,
  status: number,
): Response {
  return Response.json({ error: message, code }, { status })
}
