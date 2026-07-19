# mjs-only authoring for functions and resolvers — design

**Status:** design approved
**Date:** 2026-07-19
**Issue:** [#26](https://github.com/bilal-fazlani/mock-server/issues/26)
**Supersedes:** [#21](https://github.com/bilal-fazlani/mock-server/issues/21)
(ship `MockFn`/`FnContext` types in the published npm package — closed as not
planned)
**Related:** #20 (function calling from fixture placeholders — introduced
`_functions.ts`/`_functions.mjs`), the 2026-07-16 code-backed-scenarios design
(introduced `<slug>.ts` resolvers)

## Problem

Catalogs contain two kinds of author-written code, with inconsistent formats:

- **`_functions` files** — `.ts` *or* `.mjs` (per #20)
- **Scenario resolvers** — `.ts` only (`resolverFilePath` hard-codes the
  extension in `src/lib/mock-engine/resolver.ts`)

The `.ts` form carried a promise (#20's design: "ships a `MockFn` type export
so `.ts` authors get editor type-checking") that #21 then had to deliver.
Designing that delivery exposed its real cost — an `exports` subpath, a
generated `.d.ts` with a drift check, dual resolution for legacy
`moduleResolution` settings, a tsconfig requirement in the docs, and a
divergent story for npm-installed vs npx-only vs Docker users (the last group
may have **no Node toolchain at all** and would need a copy-paste ambient-shim
workaround). All of that apparatus exists to serve twelve lines of types.

Worse, the `.ts` extension itself over-promises. Nothing type-checks these
files — no `tsc` runs anywhere; esbuild strips annotations unverified before
the vm sandbox runs the result. An author can annotate wrongly and never find
out. The extension advertises checking that no part of the system performs;
runtime behavior is, and always was, the only enforced contract.

## Decision

**`.mjs` is the only supported format for author-written catalog code**, for
both surfaces:

- `_functions.mjs` (the `.ts` variant is dropped)
- `<slug>.mjs` resolvers (replacing `<slug>.ts`)

No types are published. No helper packages exist. Editor support is a
self-contained JSDoc block documented in the guide (below).

This is a **breaking change**: `feat!`, which pre-1.0 bumps the minor per
`release-please-config.json`. Migration is mechanical — rename the file,
strip type annotations.

## Rationale

1. **Honest file format.** What you write is what runs. `.mjs` makes no claim
   the system doesn't keep; `.ts` did.
2. **Deletes the delivery apparatus, not just the issue.** No published
   types → no `exports` map, no `.d.ts` generation or drift check, no
   tsconfig documentation, no npx/Docker fork in the guide, no shim. The
   entire #21 design surface disappears rather than being built well.
3. **One convention across both surfaces.** Functions and resolvers were
   already compiled by the same esbuild+vm pipeline; now they share one file
   format and one loader configuration. The "both `.ts` and `.mjs` present"
   ambiguity error in `functions-load.ts` also disappears.
4. **No-toolchain users become first-class.** A Docker user editing a mounted
   catalog gets the identical authoring experience to an npm user — because
   the experience depends on nothing installed.

### Editor support without types — the JSDoc block

Autocomplete is not lost; it is decoupled from the package. A self-contained
JSDoc `@typedef` needs nothing to resolve:

```js
// @ts-check
/** @typedef {{request: {method: string, path: string,
 *   pathParams: Record<string,string>, query: Record<string,string[]>,
 *   headers: Record<string,string>, body: unknown},
 *   now: Date, seed: string}} FnContext */

/** @param {FnContext} ctx */
export const label = (ctx, status) => `CUSTOMER: ${String(status).toUpperCase()}`
```

Full `ctx.request.` completion in any editor with TypeScript's JS language
service (VS Code out of the box), no package install, no tsconfig, works
identically for npx and Docker users. The guide offers this as an **optional**
copy-paste block for both `_functions.mjs` and resolvers (resolvers use the
analogous `ResolverInput` shape). The block is a convenience, not a contract:
the documented context shape in the guide remains the source of truth.

Drift risk (the block is a copy of `FnContext`) is accepted: the context is
three fields and stable, and the docs pass for any future context change
already includes the guide pages where the block lives.

## Mechanics

- **`functions-load.ts`** — drop the `.ts` probe and the `'ts' | 'js'` loader
  branch; always `loader: 'js'`.
- **`resolver.ts`** — `resolverFilePath` returns `<slug>.mjs`;
  `compileResolver` uses `loader: 'js'`. Error labels change from
  `…/<slug>.ts` to `…/<slug>.mjs` (also in `runtime.ts`, which builds labels
  independently).
- **Fail loudly on leftover `.ts` files — this is a hard requirement.** Both
  loaders probe exact filenames, so silently dropping `.ts` support would make
  existing files *vanish* (functions unregistered, scenarios missing) with
  only confusing downstream errors. Instead, catalog load must error when a
  `.ts` counterpart is present:
  - `_functions.ts` present → `"<system>: _functions.ts is no longer
    supported; rename to _functions.mjs and remove type annotations"`
  - `<slug>.ts` present for a scenario slug without fixture or `.mjs`
    resolver → same shape of message.
  The error is the migration guide, delivered at the moment it's needed.
- **esbuild stays.** `.mjs` files use `import`/`export` syntax and the vm
  sandbox is CJS, so the ESM→CJS transform is still required. Only the `'ts'`
  loader usage is removed. (Type-only imports are no longer meaningful and
  need no special-casing — there is nothing to import.)
- **UI** — scenario source view (`src/app/ui/catalog/scenario-view.ts`):
  filename labels and shiki highlighting language switch from
  typescript to javascript.
- **Example catalog** — `catalog/hello-system/_functions.ts` →
  `_functions.mjs` (annotations and the relative `import type` removed;
  optionally carries the JSDoc block as the worked example of it);
  `catalog/hello-system/account_balance/dynamic.ts` → `dynamic.mjs`.
- **Docs** — `building/dynamic.md` is retitled (it is currently
  "Code-backed scenario resolvers (`<slug>.ts`)") and every `.ts` filename in
  the guide (`dynamic.ts`, `default.ts`, `by-amount.ts`, …) becomes `.mjs`;
  `building/fixtures.md` `_functions` sections likewise; the JSDoc block is
  added where authoring is taught. Full sweep of `docs/site/docs` for `.ts`
  references to catalog files.

## Decided questions

- **Export shapes stay asymmetric.** Resolvers default-export one function
  (one file = one routing decision); `_functions.mjs` forbids default exports
  and requires named exports (one file = a namespace of callables addressed
  by name). The asymmetry is semantically motivated, and unifying it would be
  a second breaking change with no payoff. Both error messages already
  explain their rule; they remain.
- **No `init`/`types`/scaffold subcommand.** The CLI has no subcommand
  dispatch (first positional = catalog path), and the JSDoc block removes the
  need. Revisit only as part of a deliberate onboarding feature.
- **No grace period / dual support.** Supporting both formats "for one
  release" keeps all the #21 obligations alive for that release. The loud
  load-time error is the deprecation path.

## Alternatives considered

- **Publish types via an `exports` subpath + committed `.d.ts`** (the #21
  plan): workable, but the apparatus-to-value ratio was poor, and the
  no-toolchain (Docker) user still needed a documented shim — a second
  divergent path in the guide. Rejected.
- **Separate `…-types`/contract npm package**: clean for consumers, but a
  second publishing pipeline and version-lockstep obligation for an
  unreported problem. Rejected; would only be revisited with evidence (was
  the from-scratch answer, not the retrofit answer).
- **Local ambient-shim `.d.ts` documented for no-install users**: pushes the
  drift problem onto users and requires a tsconfig for the shim to load at
  all. Rejected as a primary path.
- **Deno counterfactual** (for the record): on Deno, native TS + JSR imports
  + `deno check` would make `.ts` authoring genuinely checked and freely
  deliverable, reversing this decision — confirming mjs-only is the correct
  response to *Node's* type-delivery economics, not a universal stance. A
  runtime move is out of scope and only worth reopening if the dashboard
  stack is ever replaced.

## Out of scope

- Runtime type/shape checking of author functions (unchanged: none; runtime
  errors surface at call time).
- Any change to the placeholder grammar, `CALLABLE_BUILTINS`, or evaluation
  pipeline (#24, #13, #11, #10, #9, #14, #15 are unaffected).
- Sandbox policy changes (empty vm context, timeouts) — unchanged.
