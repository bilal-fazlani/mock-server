# Design: `now` relative-time offsets

**Issue:** [#7](https://github.com/bilal-fazlani/mock-server/issues/7)
**Date:** 2026-07-17

## Summary

Support relative time offsets on the `now` placeholder so fixtures can express
timestamps relative to request time:

```
{{now+3d:iso}}
{{now-15m:iso}}
{{now+90m:YYYYMMDD}}
```

Today `now` supports only the current instant (`now:iso`, `now:YYYYMMDD`). Any
relative time has to be hard-coded and goes stale.

## Scope

This issue adds **only the offset grammar**, composing with the existing
`iso` and `YYYYMMDD` formats. Additional named formats (`epoch`, `epochMillis`,
`date`, `time`) are owned by issue
[#8](https://github.com/bilal-fazlani/mock-server/issues/8). The two compose as
"offsets × formats": #7 handles the `±<n><unit>` prefix, #8 extends the format
whitelist. The design keeps those concerns separated so #8 never touches offset
code.

## Grammar

```
now[±<n><unit>]:<format>
```

- `unit ∈ {s, m, h, d}` (seconds, minutes, hours, days)
- `n` is a non-negative integer
- The offset segment is optional — `now:iso` keeps working unchanged
- Exactly one offset segment (no `now+1d+2h`)
- `now+0d:iso` is allowed (zero offset)

The grammar is a closed, statically validatable set — no format-string
mini-language, nothing executed. The catalog validator continues to accept or
reject placeholders without evaluating them.

## Architecture

A new module `src/lib/mock-engine/now.ts` owns all `now` logic. This gives
issue #8 a single, unambiguous home to extend.

```ts
export class NowFormatError extends Error {}

export const NOW_FORMATS = ['iso', 'YYYYMMDD'] as const
export type NowFormat = (typeof NOW_FORMATS)[number]

export interface NowSpec {
  offsetMs: number
  format: NowFormat
}

// Returns null when `expr` is not a now-expression (caller falls through to
// selector parsing). Returns a NowSpec when valid. Throws NowFormatError when
// `expr` is now-shaped but malformed (bad unit, empty/unknown format).
export function parseNow(expr: string): NowSpec | null

// Applies the offset to the injected `now` and renders the format.
export function renderNow(spec: NowSpec, now: Date): string
```

### `parseNow`

1. Guard: if `expr` does not start with `now` followed by `+`, `-`, or `:`,
   return `null` (not a now-expression — e.g. `nowhere:iso`).
2. Match against `^now(?:([+-])(\d+)([smhd]))?:(.+)$`.
   - No match while now-shaped (e.g. `now+3x:iso`, `now+:iso`, `now:`) →
     throw `NowFormatError`.
3. If the captured format is not in `NOW_FORMATS` → throw `NowFormatError`
   (e.g. `now:nope`), with a message listing the valid formats.
4. Compute `offsetMs = sign × n × UNIT_MS[unit]`, where
   `UNIT_MS = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }`. No offset segment → `0`.

### `renderNow`

`new Date(now.getTime() + spec.offsetMs)`, then the format switch:

- `iso` → `d.toISOString()`
- `YYYYMMDD` → `d.toISOString().slice(0, 10).replace(/-/g, '')`

Both render in **UTC**, matching the existing formatters. This preserves the
injected-`now` determinism guarantee (same string on any machine, pinnable in
tests) and introduces no regression to today's `now:YYYYMMDD` behavior.

## Integration points

### `src/lib/mock-engine/template.ts`

`resolvePlaceholder` replaces its current `now:iso` / `now:YYYYMMDD` /
`now:`-reject branch with:

```ts
try {
  const spec = parseNow(expr)
  if (spec) return renderNow(spec, now)
} catch (err) {
  if (err instanceof NowFormatError) throw new PlaceholderError(err.message)
  throw err
}
// ...fall through to selector parsing
```

`NowFormatError` is converted to `PlaceholderError` so the existing error
contract (resolution failures are `PlaceholderError`) is unchanged. This avoids
an import cycle between `now.ts` and `template.ts`.

### `src/lib/catalog/validate.ts`

The `now:iso` / `now:YYYYMMDD` skip near line 177 becomes:

```ts
try {
  if (parseNow(expr)) continue
} catch {
  errors.push(`${label}: fixture ${file} has invalid placeholder "{{${expr}}}"`)
  continue
}
// ...else fall through to selector validation
```

Valid offsets pass catalog validation; malformed now-expressions are reported
statically.

## Testing

`tests/mock-engine/template.test.ts`:

- Offset resolution for each unit and sign: `now+3d:iso`, `now-15m:iso`,
  `now+1h:iso`, `now-30s:iso`.
- Day-boundary crossing on `YYYYMMDD` (e.g. `now+1d` late-UTC-day rolls over).
- Zero offset: `now+0d:iso` equals `now:iso`.
- No-offset regression: existing `now:iso` / `now:YYYYMMDD` still pass.
- Malformed now-expressions throw `PlaceholderError`: `now+3x:iso`, `now+:iso`,
  `now:`, `now:nope`.
- `nowhere:iso` is not treated as a now-expression (falls through, errors as an
  ordinary invalid placeholder).

`tests/mock-engine/now.test.ts` (new, optional but preferred): direct unit tests
of `parseNow` (null / spec / throw branches) and `renderNow`.

`tests/catalog/validate.test.ts`:

- A fixture using a valid offset (`{{now+3d:iso}}`) passes validation.
- A fixture using a malformed now-expression (`{{now+3x:iso}}`) is reported.

## Documentation

- `docs/site/docs/building/fixtures.md` — add offset grammar rows/notes to the
  `now` placeholder table (the canonical reference).
- `docs/site/docs/reference/gotchas.md`,
  `docs/site/docs/reference/configuration.md`,
  `docs/site/docs/get-started/first-mock.md` — update only where they enumerate
  `now` formats, to stay consistent.

## Non-goals

- New named formats (issue #8).
- Multiple offset segments in one expression.
- Timezone-aware or local-time rendering.
- Calendar-aware offsets (months/years) — only fixed-duration units.
