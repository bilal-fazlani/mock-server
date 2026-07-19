// @ts-check
// Optional editor support: the JSDoc block below gives `ctx.` autocomplete in
// any editor with nothing installed — see the fixtures guide. Safe to delete.
/** @typedef {{request: {method: string, path: string,
 *   pathParams: Record<string,string>, query: Record<string,string[]>,
 *   headers: Record<string,string>, body: unknown},
 *   now: Date, seed: string}} FnContext */

// Prefer explicit params (the taught default); context is the escape hatch.
/** @param {FnContext} _ctx */
export const label = (_ctx, status) => `CUSTOMER: ${String(status).toUpperCase()}`
