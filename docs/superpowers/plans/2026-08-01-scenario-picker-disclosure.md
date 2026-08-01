# Scenario Picker Disclosure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the profile and global-mocks pages, hovering/focusing any scenario chip or sequence step shows a summary card (label + HTTP status pill + summary + "View full response →"), which opens a modal with the catalog-style rendered response — without leaving the page. Resolver chips swap the radio circle for a `file-code` icon, passthrough for a `globe`.

**Architecture:** Summaries/status/kind ship with the server-rendered pages by widening the existing `scenariosWithPassthrough()` chokepoint from `Record<string, string>` to `Record<string, ScenarioOption>`. Full response content stays server-only (fs + Shiki) behind a new lazy route `GET /ui/api/catalog/[system]/[endpoint]/scenarios/[slug]`, reusing a single-scenario refactor of `buildScenarioViews`. One new client component (`ScenarioDisclosure` = Radix HoverCard + Dialog + module-level fetch cache) wraps chips and sequence-step triggers.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, `radix-ui` (already a dependency — HoverCard + Dialog primitives), lucide-react, Shiki (existing `highlight.ts`), Vitest + `renderToStaticMarkup`.

**Spec:** `docs/superpowers/specs/2026-08-01-scenario-picker-disclosure-design.md`

## Global Constraints

- No new npm dependencies — `radix-ui@^1.6.2` and `lucide-react` are already installed.
- Every file under `src/app/ui/**` (pages AND api routes) must `export const dynamic = 'force-dynamic'` (enforced by `tests/ui/force-dynamic.test.ts` / `scripts/check-ui-prerender.mjs`).
- Component tests run in Vitest `environment: 'node'` with `renderToStaticMarkup` + string assertions — no jsdom, no user-event. Design components so static SSR output is assertable; fetching components accept an `initialView` prop (precedent: `LogRow`'s `initialDetail`).
- shadcn-style primitives live in `src/app/components/ui/*` and import `{ X as XPrimitive } from "radix-ui"` (unified package, see `dropdown-menu.tsx`) and `cn` from `@/lib/utils`. App components otherwise use relative imports — follow each file's existing style.
- The public runtime-control API (`/ui/api/catalog`) contract is **unchanged** (slug → label only).
- Status tone convention everywhere: 2xx green, 3xx yellow, 4xx/5xx red (`--success*`, `--warning*`, `#d92d20` literals).
- Passthrough auto-summary copy, exactly: `Forwards the request to the live upstream service.`
- Conventional commits (`feat:`/`refactor:`/`test:`/`docs:`), each ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Run tests with `npx vitest run <file>` (or `npm test` for the full suite). Node 22+, npm 11.

---

### Task 1: Widen the option shape — `ScenarioOption` end to end

The single chokepoint `scenariosWithPassthrough()` currently flattens `ScenarioMeta` to
`slug → label`, dropping summaries. Widen it to full option objects, mechanically update
every consumer, and delete the now-redundant `resolverSlugs` prop threading. **No visual
change in this task** — chips still render label + trailing `CodeXml`.

**Files:**
- Modify: `src/lib/config.ts` (add `REAL_SUMMARY` next to `REAL_LABEL`)
- Modify: `src/lib/scenarios.ts:26-67`
- Modify: `src/app/components/ScenarioPicker.tsx`
- Modify: `src/app/ui/profiles/ScenarioConfig.tsx`
- Modify: `src/app/ui/profiles/ProfileForm.tsx:107-120`
- Modify: `src/app/ui/global-mocks/GlobalMocksForm.tsx:95-102`
- Test: `tests/lib/scenarios.test.ts`, `tests/components/scenario-picker.test.tsx`, `tests/components/scenario-config.test.tsx`

**Interfaces:**
- Consumes: `ScenarioMeta { label, summary? }` from `src/lib/catalog/types.ts`; `EndpointDef.resolverScenarios: string[]`; `REAL_LABEL` from `src/lib/config.ts`.
- Produces (used by every later task):
  ```ts
  // src/lib/scenarios.ts
  export type ScenarioKind = 'fixture' | 'resolver' | 'passthrough'
  export interface ScenarioOption {
    label: string
    summary?: string
    status?: number   // added in Task 2; declare the field now
    kind: ScenarioKind
  }
  export function scenariosWithPassthrough(endpoint: EndpointDef, passthroughAsDefault: boolean): Record<string, ScenarioOption>
  export function scenarioOptionsWithDangling(
    offered: Record<string, ScenarioOption>,
    selection: string | string[] | undefined,
  ): { options: Record<string, ScenarioOption>; unavailable: string[] }
  // src/lib/config.ts
  export const REAL_SUMMARY = 'Forwards the request to the live upstream service.'
  ```
  `ScenarioPicker` props become `{ endpointName, fieldName?, scenarios: Record<string, ScenarioOption>, selected, unavailable? }` (no `resolverSlugs`). `ScenarioConfig` props lose `resolverSlugs` and `scenarios` becomes `Record<string, ScenarioOption>`.

- [ ] **Step 1: Write the failing lib tests**

In `tests/lib/scenarios.test.ts`, update the resolver-endpoint test and add option-shape tests (the `ep` helper stays as-is):

```ts
import { REAL_SUMMARY } from '../../src/lib/config'

describe('scenariosWithPassthrough option shape', () => {
  it('carries label, kind, and summary per declared scenario', () => {
    const endpoint = ep({
      scenarios: {
        default: { label: 'Default', summary: 'All good' },
        'by-amount': { label: 'Routes by amount' },
      },
      resolverScenarios: ['by-amount'],
    })
    const options = scenariosWithPassthrough(endpoint, false)
    expect(options.default).toEqual({ label: 'Default', summary: 'All good', kind: 'fixture' })
    expect(options['by-amount']).toEqual({ label: 'Routes by amount', kind: 'resolver' })
  })

  it('gives the implicit real entry the passthrough kind and auto-summary', () => {
    const options = scenariosWithPassthrough(ep(), false)
    expect(options.real).toEqual({ label: 'Passthrough', summary: REAL_SUMMARY, kind: 'passthrough' })
  })
})

describe('scenarioOptionsWithDangling option shape', () => {
  it('adds dangling pins as fixture-kind options with the unavailable label', () => {
    const offered = scenariosWithPassthrough(ep(), false)
    const { options, unavailable } = scenarioOptionsWithDangling(offered, 'ghost')
    expect(options.ghost).toEqual({ label: danglingScenarioLabel('ghost'), kind: 'fixture' })
    expect(unavailable).toEqual(['ghost'])
  })
})
```

Existing key-order tests (`toEqual(['default', 'frozen', 'real'])` etc.) keep passing — `Object.keys` order is preserved.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/lib/scenarios.test.ts`
Expected: FAIL — options are plain strings (`'Default'`), not objects.

- [ ] **Step 3: Implement the widened shape**

In `src/lib/config.ts`, directly under `REAL_LABEL`:

```ts
/** Auto-summary for the implicit passthrough scenario (it has no catalog file). */
export const REAL_SUMMARY = 'Forwards the request to the live upstream service.'
```

Replace `scenariosWithPassthrough` and `scenarioOptionsWithDangling` in `src/lib/scenarios.ts` (import `REAL_SUMMARY` beside `REAL_LABEL`):

```ts
export type ScenarioKind = 'fixture' | 'resolver' | 'passthrough'

export interface ScenarioOption {
  /** Friendly name (ScenarioMeta.label, or the dangling placeholder). */
  label: string
  /** ScenarioMeta.summary, or the fixed auto-summary for `real`. */
  summary?: string
  /** Fixture HTTP status; absent for resolvers, passthrough, and dangling pins. */
  status?: number
  kind: ScenarioKind
}

export function scenariosWithPassthrough(
  endpoint: EndpointDef,
  passthroughAsDefault: boolean,
): Record<string, ScenarioOption> {
  const declared: Record<string, ScenarioOption> = {}
  for (const [slug, meta] of Object.entries(endpoint.scenarios)) {
    declared[slug] = {
      label: meta.label,
      ...(meta.summary ? { summary: meta.summary } : {}),
      kind: endpoint.resolverScenarios.includes(slug) ? 'resolver' : 'fixture',
    }
  }
  const { default: defaultOption, ...rest } = declared
  const ordered =
    defaultOption === undefined ? declared : { [DEFAULT_SCENARIO]: defaultOption, ...rest }
  const real: ScenarioOption = { label: REAL_LABEL, summary: REAL_SUMMARY, kind: 'passthrough' }
  return passthroughAsDefault
    ? { [REAL_SCENARIO]: real, ...ordered }
    : { ...ordered, [REAL_SCENARIO]: real }
}

export function scenarioOptionsWithDangling(
  offered: Record<string, ScenarioOption>,
  selection: string | string[] | undefined,
): { options: Record<string, ScenarioOption>; unavailable: string[] } {
  const selected = selection === undefined ? [] : Array.isArray(selection) ? selection : [selection]
  const options = { ...offered }
  const unavailable: string[] = []
  for (const slug of selected) {
    if (slug in options || unavailable.includes(slug)) continue
    options[slug] = { label: danglingScenarioLabel(slug), kind: 'fixture' }
    unavailable.push(slug)
  }
  return { options, unavailable }
}
```

- [ ] **Step 4: Mechanically update the four consumers (rendering unchanged)**

`src/app/components/ScenarioPicker.tsx` — change the props type, drop `resolverSlugs`, read `.label`, derive the trailing icon from kind:

```tsx
import type { ScenarioOption } from '../../lib/scenarios'
// props: scenarios: Record<string, ScenarioOption>  (resolverSlugs prop deleted)
{Object.entries(scenarios).map(([key, option]) => {
  // ...unchanged tone/disabled logic...
  //   label text:            {option.label}
  //   trailing icon guard:   {option.kind === 'resolver' && (<CodeXml ... />)}
})}
```

`src/app/ui/profiles/ScenarioConfig.tsx` — `scenarios: Record<string, ScenarioOption>`; delete the `resolverSlugs` prop from `ScenarioConfig` **and** `ScenarioSelect`; update:

```tsx
const involvesResolver = (mode === 'single' ? [singleValue] : steps).some(
  (s) => options[s]?.kind === 'resolver',
)
// ScenarioSelect: const label = scenarios[value]?.label ?? value
// trigger + option resolver-icon guards: scenarios[value]?.kind === 'resolver' / option.kind === 'resolver'
// option text: {option.label}
```

`src/app/ui/profiles/ProfileForm.tsx` — delete the `resolverSlugs={endpoint.resolverScenarios}` line (`:119`).
`src/app/ui/global-mocks/GlobalMocksForm.tsx` — delete `resolverSlugs={endpoint.resolverScenarios}` (`:101`); the reset-history button's own `endpoint.resolverScenarios.includes(selected)` check (`:104`) stays.

- [ ] **Step 5: Update component tests to the new prop shape**

`tests/components/scenario-picker.test.tsx` — the fixture becomes:

```tsx
import type { ScenarioOption } from '../../src/lib/scenarios'
const scenarios: Record<string, ScenarioOption> = {
  real: { label: 'Passthrough', kind: 'passthrough' },
  success: { label: 'Hello success', kind: 'fixture' },
  failure: { label: 'Hello failure', kind: 'fixture' },
}
```

Inline object literals in individual tests (`{ default: 'Default success', ... }`, the `dynamic: 'dynamic — unavailable'` entry) get the same `{ label, kind }` treatment (`dynamic` → `{ label: 'dynamic — unavailable', kind: 'fixture' }`). `tests/components/scenario-config.test.tsx`: same conversion for its `scenarios` fixtures; delete any `resolverSlugs` props; a resolver scenario is now expressed as `kind: 'resolver'`.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS (including `tests/ui/profile-form.test.tsx` / `global-mocks-form.test.tsx`, which exercise the forms end-to-end; if either asserts on removed `resolverSlugs` wiring, update it to the new prop shape).

- [ ] **Step 7: Commit**

```bash
git add src/lib/config.ts src/lib/scenarios.ts src/app/components/ScenarioPicker.tsx src/app/ui/profiles/ScenarioConfig.tsx src/app/ui/profiles/ProfileForm.tsx src/app/ui/global-mocks/GlobalMocksForm.tsx tests/lib/scenarios.test.ts tests/components/scenario-picker.test.tsx tests/components/scenario-config.test.tsx tests/ui/profile-form.test.tsx tests/ui/global-mocks-form.test.tsx
git commit -m "refactor(ui): widen scenario picker options to label+summary+kind objects

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Parse fixture `status` into `ScenarioMeta` and `ScenarioOption`

The hover card shows an HTTP status pill without fetching. Fixtures already declare
`status`; capture it in the same lenient read that extracts `description`/`summary`.

**Files:**
- Modify: `src/lib/catalog/types.ts:8-16`
- Modify: `src/lib/catalog/load.ts:126-134` and `:264-280`
- Modify: `src/lib/scenarios.ts` (copy `status` into the option)
- Test: `tests/catalog/load.test.ts`, `tests/lib/scenarios.test.ts`

**Interfaces:**
- Consumes: `parseScenarioFile` (private in `load.ts`), `ScenarioOption` from Task 1.
- Produces: `ScenarioMeta.status?: number` — set only for fixture-backed scenarios whose JSON has a numeric `status`; `scenariosWithPassthrough` copies it onto the option. Resolver-backed scenarios never get one (they select other scenarios at request time).

- [ ] **Step 1: Write the failing tests**

`tests/catalog/load.test.ts` — alongside the existing summary test (which builds a temp catalog dir; follow its exact setup pattern), add:

```ts
it('captures a fixture numeric status into the scenario meta', () => {
  // temp-catalog scaffold identical to the summary test, with fixture:
  // { "description": "Frozen", "summary": "s", "status": 403, "body": {} }
  // then:
  expect(endpoint.scenarios.frozen).toEqual({ label: 'Frozen', summary: 's', status: 403 })
})

it('ignores a non-numeric status', () => {
  // fixture: { "description": "Bad", "status": "500", "body": {} }
  expect(endpoint.scenarios.bad).toEqual({ label: 'Bad' })
})
```

`tests/lib/scenarios.test.ts` — extend the Task 1 shape test: a scenario meta of `{ label: 'Default', summary: 'All good', status: 200 }` produces option `{ label: 'Default', summary: 'All good', status: 200, kind: 'fixture' }`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/catalog/load.test.ts tests/lib/scenarios.test.ts`
Expected: FAIL — `status` missing from meta/option.

- [ ] **Step 3: Implement**

`src/lib/catalog/types.ts` — add to `ScenarioMeta`:

```ts
  /** Fixture HTTP status, when the scenario file declares a numeric `status`.
   * Absent for resolver-backed scenarios. Feeds the picker hover-card pill. */
  status?: number
```

`src/lib/catalog/load.ts` — `parseScenarioFile` returns the status too:

```ts
function parseScenarioFile(file: string): {
  description: string | null
  summary: string | null
  status: number | null
} {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as { description?: unknown; summary?: unknown; status?: unknown }
      return {
        description: typeof obj.description === 'string' ? obj.description : null,
        summary: typeof obj.summary === 'string' && obj.summary.length > 0 ? obj.summary : null,
        status: typeof obj.status === 'number' ? obj.status : null,
      }
    }
  } catch {
    // reported by validateCatalog
  }
  return { description: null, summary: null, status: null }
}
```

and the fixture branch (`:130`) becomes:

```ts
scenarios[scenario] = {
  label: meta.description ?? scenario,
  ...(meta.summary ? { summary: meta.summary } : {}),
  ...(meta.status !== null ? { status: meta.status } : {}),
}
```

`src/lib/scenarios.ts` — in the `declared[slug]` literal, after the summary spread:

```ts
      ...(meta.status !== undefined ? { status: meta.status } : {}),
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS (`tests/lib/runtime.test.ts` still passes — resolver patching at `runtime.ts:76` touches only `label`/`summary`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog/types.ts src/lib/catalog/load.ts src/lib/scenarios.ts tests/catalog/load.test.ts tests/lib/scenarios.test.ts
git commit -m "feat(catalog): capture fixture status into scenario metadata

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Extract a shared `StatusPill`

`EndpointScenarios.tsx` privately owns status formatting (`formatStatus`,
`STATUS_REASONS`, tone classes). The hover card and modal need the identical pill —
extract it once.

**Files:**
- Create: `src/app/components/StatusPill.tsx`
- Modify: `src/app/ui/catalog/EndpointScenarios.tsx` (delete the moved helpers, consume the component)
- Test: `tests/components/status-pill.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  ```tsx
  // src/app/components/StatusPill.tsx (no 'use client' — pure render, usable from server and client)
  export function StatusPill({ value }: { value: unknown }): ReactNode
  // renders null for null/undefined; otherwise the exact pill markup EndpointScenarios rendered:
  // <span class="inline-flex min-h-6 items-center rounded-full border px-2 py-[3px] font-mono text-[0.72rem] font-bold leading-[1.2] {tone}">HTTP 200 OK</span>
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/status-pill.test.tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StatusPill } from '../../src/app/components/StatusPill'

describe('StatusPill', () => {
  it('renders known statuses with reason phrase and success tone', () => {
    const html = renderToStaticMarkup(<StatusPill value={200} />)
    expect(html).toContain('HTTP 200 OK')
    expect(html).toContain('text-[var(--success)]')
  })
  it('uses the error tone for 5xx', () => {
    const html = renderToStaticMarkup(<StatusPill value={503} />)
    expect(html).toContain('HTTP 503 Service Unavailable')
    expect(html).toContain('text-[#d92d20]')
  })
  it('renders unknown numeric statuses without a reason phrase', () => {
    expect(renderToStaticMarkup(<StatusPill value={299} />)).toContain('>HTTP 299<')
  })
  it('renders nothing for null or undefined', () => {
    expect(renderToStaticMarkup(<StatusPill value={undefined} />)).toBe('')
    expect(renderToStaticMarkup(<StatusPill value={null} />)).toBe('')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/components/status-pill.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `src/app/components/StatusPill.tsx`**

Move `formatMetadataValue`, `formatStatus`, `statusTone`, `statusToneClassName`,
`STATUS_REASONS`, and the `StatusTone`/`FormattedStatus` types verbatim from
`EndpointScenarios.tsx` into the new file (unexported except:)

```tsx
export function StatusPill({ value }: { value: unknown }) {
  const status = formatStatus(value)
  if (!status) return null
  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-full border px-2 py-[3px] font-mono text-[0.72rem] font-bold leading-[1.2] ${statusToneClassName(status.tone)}`}
    >
      {status.label}
    </span>
  )
}
```

- [ ] **Step 4: Consume it from `EndpointScenarios.tsx`**

Delete the moved helpers. `fixtureStatusFromJson` shrinks to a value extractor, and the header renders the component:

```tsx
import { StatusPill } from '../../components/StatusPill'
// in the map: const statusValue = scenario.kind === 'fixture' ? fixtureStatusValue(scenario.json) : null
// header:     <StatusPill value={statusValue} />   (replaces the {status && <span …>} block)

function fixtureStatusValue(json: string): unknown {
  return parseFixtureJson(json)?.status ?? null
}
```

(`parseFixtureJson`/`isRecord`/`formatHeaderValue` stay in `EndpointScenarios.tsx` for now — Task 7 moves the content helpers.)

- [ ] **Step 5: Run the suite**

Run: `npx vitest run tests/components/status-pill.test.tsx tests/ui/endpoint-view.test.tsx tests/ui/scenario-view.test.ts`
Expected: PASS — catalog detail markup is byte-identical.

- [ ] **Step 6: Commit**

```bash
git add src/app/components/StatusPill.tsx src/app/ui/catalog/EndpointScenarios.tsx tests/components/status-pill.test.tsx
git commit -m "refactor(ui): extract the HTTP status pill into a shared component

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Radix `hover-card` and `dialog` primitives

House-style shadcn primitives (do **not** run the shadcn CLI — write the files to match
`dropdown-menu.tsx`: unified `radix-ui` import, `data-slot` attributes, `cn`).

**Files:**
- Create: `src/app/components/ui/hover-card.tsx`
- Create: `src/app/components/ui/dialog.tsx`
- Test: `tests/components/ui-primitives.test.tsx`

**Interfaces:**
- Consumes: `--popover`/`--border` tokens (already in `globals.css`), `cn` from `@/lib/utils`.
- Produces:
  ```tsx
  export { HoverCard, HoverCardTrigger, HoverCardContent }  // hover-card.tsx
  export { Dialog, DialogClose, DialogContent, DialogTitle } // dialog.tsx
  // HoverCard forwards open/onOpenChange (controlled use in Task 8); openDelay 200 / closeDelay 100 defaults.
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/ui-primitives.test.tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HoverCard, HoverCardTrigger } from '../../src/app/components/ui/hover-card'
import { Dialog, DialogContent, DialogTitle } from '../../src/app/components/ui/dialog'

describe('hover-card primitive', () => {
  it('renders an asChild trigger without wrapping markup', () => {
    const html = renderToStaticMarkup(
      <HoverCard>
        <HoverCardTrigger asChild>
          <button type="button">chip</button>
        </HoverCardTrigger>
      </HoverCard>,
    )
    expect(html).toContain('>chip</button>')
    expect(html).toContain('data-state="closed"')
  })
})

describe('dialog primitive', () => {
  it('renders nothing for closed content and content when open', () => {
    expect(
      renderToStaticMarkup(
        <Dialog><DialogContent><DialogTitle>t</DialogTitle></DialogContent></Dialog>,
      ),
    ).toBe('')
    // open content SSRs without a portal (portals don't render in static markup)
    const open = renderToStaticMarkup(
      <Dialog open><DialogContent><DialogTitle>Frozen</DialogTitle></DialogContent></Dialog>,
    )
    expect(open).toContain('Frozen')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/components/ui-primitives.test.tsx`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Create `src/app/components/ui/hover-card.tsx`**

```tsx
"use client"

import * as React from "react"
import { HoverCard as HoverCardPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function HoverCard({
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return (
    <HoverCardPrimitive.Root data-slot="hover-card" openDelay={200} closeDelay={100} {...props} />
  )
}

function HoverCardTrigger({
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
}

function HoverCardContent({
  className,
  align = "start",
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal data-slot="hover-card-portal">
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-[290px] rounded-lg border border-border bg-popover p-3.5 text-popover-foreground shadow-[var(--shadow-card),0_12px_28px_-10px_rgba(0,0,0,0.7)] outline-none",
          className,
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }
```

- [ ] **Step 4: Create `src/app/components/ui/dialog.tsx`**

```tsx
"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-[0.95rem] font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal data-slot="dialog-portal">
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className="fixed inset-0 z-50 bg-black/55 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid w-[min(560px,calc(100vw-2rem))] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 gap-3 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card),0_18px_50px_-12px_rgba(0,0,0,0.7)]",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          data-slot="dialog-close"
          className="absolute right-3.5 top-3.5 rounded-md border-0 bg-transparent p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          aria-label="Close"
        >
          <XIcon className="size-4" aria-hidden="true" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export { Dialog, DialogClose, DialogContent, DialogTitle }
```

Note: `tw-animate-css` (imported in `globals.css`) provides the `animate-in/fade-in-0`
utilities. If the open-dialog SSR assertion in Step 1 fails because the portal skips
static rendering, keep the assertion on the closed state only and note it — the modal
body gets its real coverage in Task 8 via the exported body component.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/components/ui-primitives.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/components/ui/hover-card.tsx src/app/components/ui/dialog.tsx tests/components/ui-primitives.test.tsx
git commit -m "feat(ui): add house-style hover-card and dialog primitives

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Single-scenario view builder

Split `buildScenarioViews` so one declared scenario can be built alone (for the lazy
route) while the catalog detail page keeps the all-scenarios form.

**Files:**
- Modify: `src/app/ui/catalog/scenario-view.ts`
- Test: `tests/ui/scenario-view.test.ts`

**Interfaces:**
- Consumes: `loadFixture`, `resolverFilePath`, `highlight` (all already imported there).
- Produces:
  ```ts
  export async function buildScenarioView(
    system: SystemDef,
    endpoint: EndpointDef,
    key: string,          // must exist in endpoint.scenarios (declared scenarios only — never 'real')
    catalogDir: string,
  ): Promise<ScenarioView>
  // buildScenarioViews signature and output: unchanged.
  ```

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/scenario-view.test.ts` (reusing its `system`/`endpoint`/`fixturesDir` constants):

```ts
import { buildScenarioView } from '../../src/app/ui/catalog/scenario-view'

describe('buildScenarioView', () => {
  it('builds a single fixture view with highlighted html', async () => {
    const view = await buildScenarioView(system, endpoint, 'default', fixturesDir)
    expect(view).toMatchObject({ key: 'default', label: 'Success', isDefault: true, kind: 'fixture' })
    if (view.kind === 'fixture') expect(view.html).toContain('shiki')
  })

  it('reports an error view for a missing fixture file', async () => {
    const missing: EndpointDef = { ...endpoint, scenarios: { nope: { label: 'Missing' } } }
    const view = await buildScenarioView(system, missing, 'nope', fixturesDir)
    expect(view.kind).toBe('error')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ui/scenario-view.test.ts`
Expected: FAIL — `buildScenarioView` is not exported.

- [ ] **Step 3: Implement by extraction**

Move the body of the `Object.entries(...).map(async ([key, meta]) => { ... })` callback
into the new export; the plural builder delegates:

```ts
export async function buildScenarioView(
  system: SystemDef,
  endpoint: EndpointDef,
  key: string,
  catalogDir: string,
): Promise<ScenarioView> {
  const meta = endpoint.scenarios[key]
  const { label, summary } = meta
  const isDefault = key === 'default'
  if (endpoint.resolverScenarios.includes(key)) {
    try {
      const code = fs.readFileSync(
        resolverFilePath(catalogDir, system.slug, endpoint.name, key),
        'utf8',
      )
      return { key, label, ...(summary ? { summary } : {}), isDefault, kind: 'resolver' as const, code, html: await highlight(code, 'javascript') }
    } catch (err) {
      return { key, label, ...(summary ? { summary } : {}), isDefault, kind: 'error' as const, message: (err as Error).message }
    }
  }
  try {
    const fixture = loadFixture(catalogDir, system.slug, endpoint.name, key)
    // `json` is the full fixture (status/headers/body) — kept for the header
    // status-chip parsing. `html` highlights the body only, matching the
    // body block the pre-highlighting UI rendered.
    const json = JSON.stringify(fixture, null, 2)
    const bodyJson = JSON.stringify(fixture.body, null, 2)
    return { key, label, ...(summary ? { summary } : {}), isDefault, kind: 'fixture' as const, json, html: await highlight(bodyJson, 'json') }
  } catch (err) {
    return { key, label, ...(summary ? { summary } : {}), isDefault, kind: 'error' as const, message: (err as Error).message }
  }
}
```

`buildScenarioViews`'s declared mapping becomes:

```ts
  const declared: ScenarioView[] = await Promise.all(
    Object.keys(endpoint.scenarios).map((key) => buildScenarioView(system, endpoint, key, catalogDir)),
  )
```

(the `env`/`passthroughAsDefault` parameters and the passthrough entry stay exactly as they are).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/ui/scenario-view.test.ts`
Expected: PASS, existing tests included.

- [ ] **Step 5: Commit**

```bash
git add src/app/ui/catalog/scenario-view.ts tests/ui/scenario-view.test.ts
git commit -m "refactor(ui): extract a single-scenario view builder

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Lazy view route `GET /ui/api/catalog/[system]/[endpoint]/scenarios/[slug]`

**Files:**
- Create: `src/app/ui/api/catalog/[system]/[endpoint]/scenarios/[slug]/route.ts`
- Test: `tests/api/scenario-view-route.test.ts`

**Interfaces:**
- Consumes: `getRuntime()` (`catalog`, `catalogDir`), `findEndpointBySlug`, `buildScenarioView` (Task 5).
- Produces: `200 { view: ScenarioView }` for any declared scenario (an unreadable file yields `kind: 'error'` inside a 200 — the modal renders its message); `404 { error }` for unknown endpoint, unknown slug, dangling pins, and `real` (passthrough has no content view). Consumed by Task 8's fetch.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/api/scenario-view-route.test.ts
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const fixturesDir = path.join(__dirname, '../testdata/fixtures')

vi.mock('../../src/lib/runtime', () => ({
  getRuntime: () => ({
    catalogDir: fixturesDir,
    catalog: {
      systems: [
        {
          name: 'Test System',
          slug: 'test-system',
          baseUrlEnv: 'TEST_SYSTEM_URL',
          endpoints: [
            {
              name: 'hello_world',
              displayName: 'Hello World',
              method: 'POST',
              path: '/hello/world',
              profileIdSelector: '$.customerId',
              scenarios: {
                default: { label: 'Success', summary: 'Happy path', status: 200 },
                by_amount: { label: 'Routes by amount' },
              },
              resolverScenarios: ['by_amount'],
            },
          ],
        },
      ],
    },
  }),
}))

const { GET } = await import(
  '../../src/app/ui/api/catalog/[system]/[endpoint]/scenarios/[slug]/route'
)

function ctx(system: string, endpoint: string, slug: string) {
  return { params: Promise.resolve({ system, endpoint, slug }) }
}

describe('GET /ui/api/catalog/[system]/[endpoint]/scenarios/[slug]', () => {
  it('returns the prepared view for a declared fixture scenario', async () => {
    const res = await GET(new Request('http://mock/x'), ctx('test-system', 'hello_world', 'default'))
    expect(res.status).toBe(200)
    const { view } = await res.json()
    expect(view).toMatchObject({ key: 'default', label: 'Success', summary: 'Happy path', kind: 'fixture' })
    expect(view.html).toContain('shiki')
  })

  it('returns a resolver view with the highlighted source', async () => {
    // tests/testdata/fixtures/test-system/hello_world/by_amount.mjs exists on disk
    const res = await GET(new Request('http://mock/x'), ctx('test-system', 'hello_world', 'by_amount'))
    expect(res.status).toBe(200)
    const { view } = await res.json()
    expect(view).toMatchObject({ key: 'by_amount', kind: 'resolver' })
    expect(view.code).toContain('export default')
  })

  it('404s for the implicit real scenario', async () => {
    const res = await GET(new Request('http://mock/x'), ctx('test-system', 'hello_world', 'real'))
    expect(res.status).toBe(404)
  })

  it('404s for an unknown slug and an unknown endpoint', async () => {
    expect((await GET(new Request('http://mock/x'), ctx('test-system', 'hello_world', 'ghost'))).status).toBe(404)
    expect((await GET(new Request('http://mock/x'), ctx('nope', 'hello_world', 'default'))).status).toBe(404)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/api/scenario-view-route.test.ts`
Expected: FAIL — route module does not exist.

- [ ] **Step 3: Implement the route**

```ts
// src/app/ui/api/catalog/[system]/[endpoint]/scenarios/[slug]/route.ts
import { findEndpointBySlug } from '../../../../../../../../lib/catalog/find'
import { getRuntime } from '../../../../../../../../lib/runtime'
import { buildScenarioView } from '../../../../../../catalog/scenario-view'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ system: string; endpoint: string; slug: string }> }

// Serves the catalog-style rendering of ONE declared scenario for the picker
// response modal. `real` is implicit (no file) and dangling pins aren't
// declared, so both 404 here — the UI never offers the modal for them.
export async function GET(_request: Request, { params }: Ctx): Promise<Response> {
  const { system, endpoint, slug } = await params
  const { catalog, catalogDir } = getRuntime()
  const found = findEndpointBySlug(catalog, system, endpoint)
  if (!found) {
    return Response.json({ error: `unknown endpoint ${system}/${endpoint}` }, { status: 404 })
  }
  if (!(slug in found.endpoint.scenarios)) {
    return Response.json({ error: `unknown scenario "${slug}"` }, { status: 404 })
  }
  const view = await buildScenarioView(found.system, found.endpoint, slug, catalogDir)
  return Response.json({ view })
}
```

(Import-depth check: the route dir is `src/app/ui/api/catalog/[system]/[endpoint]/scenarios/[slug]`
— 8 ups reach `src/` (for `lib/…`), 6 ups reach `src/app/ui/` (for `catalog/scenario-view`).
TypeScript will confirm; `npm run lint` catches a miscount.)

- [ ] **Step 4: Run to verify pass, including the prerender guard**

Run: `npx vitest run tests/api/scenario-view-route.test.ts tests/ui/force-dynamic.test.ts`
Expected: PASS — the new route exports `dynamic = 'force-dynamic'`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/ui/api/catalog/[system]/[endpoint]/scenarios/[slug]/route.ts" tests/api/scenario-view-route.test.ts
git commit -m "feat(ui): add lazy single-scenario view api for the picker modal

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Extract shared `ScenarioContent`

The modal must render fixture/resolver/error/passthrough views exactly like the catalog
detail page. Move the content renderer out of `EndpointScenarios.tsx`.

**Files:**
- Create: `src/app/components/ScenarioContent.tsx`
- Modify: `src/app/ui/catalog/EndpointScenarios.tsx`
- Test: `tests/components/scenario-content.test.tsx`

**Interfaces:**
- Consumes: `ScenarioView` type from `src/app/ui/catalog/scenario-view` (type-only import — safe in a client file).
- Produces:
  ```tsx
  // no 'use client' directive — pure render; imported by both the catalog page and the modal
  export function ScenarioContent({ scenario }: { scenario: ScenarioView }): ReactNode
  export function parseFixtureJson(json: string): Record<string, unknown> | null
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/scenario-content.test.tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ScenarioContent } from '../../src/app/components/ScenarioContent'
import type { ScenarioView } from '../../src/app/ui/catalog/scenario-view'

describe('ScenarioContent', () => {
  it('renders fixture header pills and the highlighted body html', () => {
    const view: ScenarioView = {
      key: 'frozen', label: 'Frozen', isDefault: false, kind: 'fixture',
      json: JSON.stringify({ status: 403, headers: { 'x-frozen': 'yes' }, body: {} }),
      html: '<pre class="shiki"><code>{}</code></pre>',
    }
    const html = renderToStaticMarkup(<ScenarioContent scenario={view} />)
    expect(html).toContain('x-frozen')
    expect(html).toContain('shiki')
  })

  it('renders resolver views with the source file note', () => {
    const view: ScenarioView = {
      key: 'dynamic', label: 'dynamic', isDefault: false, kind: 'resolver',
      code: 'export default () => "default"', html: '<pre class="shiki"><code>x</code></pre>',
    }
    const html = renderToStaticMarkup(<ScenarioContent scenario={view} />)
    expect(html).toContain('dynamic.mjs')
  })

  it('renders passthrough views with the upstream url or the unset-env note', () => {
    const view: ScenarioView = {
      key: 'real', label: 'Passthrough', isDefault: false, kind: 'passthrough',
      baseUrlEnv: 'X_URL', url: null,
    }
    expect(renderToStaticMarkup(<ScenarioContent scenario={view} />)).toContain('X_URL')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/components/scenario-content.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Move the code**

Create `src/app/components/ScenarioContent.tsx` containing — moved verbatim from
`EndpointScenarios.tsx` — `ScenarioContent`, `FixtureContent`, `parseFixtureJson`,
`isRecord`, and `formatHeaderValue` (plus a local copy of `formatMetadataValue` if Task 3
left it only inside `StatusPill.tsx` — keep `StatusPill.tsx`'s private and add one here;
they are two-line functions and the duplication beats a third shared module). Export
`ScenarioContent` and `parseFixtureJson`. Import the type:

```tsx
import type { ScenarioView } from '../ui/catalog/scenario-view'
```

`EndpointScenarios.tsx` then imports `{ ScenarioContent, parseFixtureJson }` from
`../../components/ScenarioContent`, deletes the moved private copies, and keeps only its
accordion + `fixtureStatusValue` helper.

- [ ] **Step 4: Run the suite**

Run: `npx vitest run tests/components/scenario-content.test.tsx tests/ui/endpoint-view.test.tsx`
Expected: PASS — catalog detail output unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/ScenarioContent.tsx src/app/ui/catalog/EndpointScenarios.tsx tests/components/scenario-content.test.tsx
git commit -m "refactor(ui): share the catalog scenario content renderer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: `ScenarioDisclosure` — hover card + response modal

The one new interactive component. Wraps any trigger element (chip label, sequence step
trigger); hover/focus opens the summary card; its footer button opens the dialog, which
lazily fetches the view through a module-level cache.

**Files:**
- Create: `src/app/components/ScenarioDisclosure.tsx`
- Test: `tests/components/scenario-disclosure.test.tsx`

**Interfaces:**
- Consumes: `ScenarioOption` (Task 1), `StatusPill` (Task 3), hover-card/dialog primitives (Task 4), route from Task 6, `ScenarioContent` + `ScenarioView` (Task 7).
- Produces:
  ```tsx
  'use client'
  export function ScenarioDisclosure(props: {
    system: string                 // system slug, for the fetch url + catalog link
    endpointName: string
    endpointDisplayName: string
    slug: string
    option: ScenarioOption
    suppressed?: boolean           // true while a parent popup is open — forces the card closed
    initialView?: ScenarioView     // test/SSR seam; skips fetching (LogRow's initialDetail pattern)
    children: React.ReactElement   // the trigger; rendered via HoverCardTrigger asChild
  }): ReactNode
  export function ScenarioHoverCardBody(props: {
    option: ScenarioOption
    onViewResponse?: () => void    // omitted for kind 'passthrough' — no button rendered
  }): ReactNode
  export function ScenarioResponseModalBody(props: {
    state: { kind: 'loading' } | { kind: 'error'; retry: () => void } | { kind: 'ready'; view: ScenarioView }
    option: ScenarioOption
    catalogHref: string
    endpointDisplayName: string
  }): ReactNode
  ```

- [ ] **Step 1: Write the failing tests (bodies are SSR-testable directly)**

```tsx
// tests/components/scenario-disclosure.test.tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ScenarioDisclosure,
  ScenarioHoverCardBody,
  ScenarioResponseModalBody,
} from '../../src/app/components/ScenarioDisclosure'
import type { ScenarioView } from '../../src/app/ui/catalog/scenario-view'

const frozen = { label: 'Frozen', summary: 'Account is frozen', status: 403, kind: 'fixture' as const }

describe('ScenarioHoverCardBody', () => {
  it('renders label, status pill, summary, and the response button', () => {
    const html = renderToStaticMarkup(<ScenarioHoverCardBody option={frozen} onViewResponse={() => {}} />)
    expect(html).toContain('Frozen')
    expect(html).toContain('HTTP 403 Forbidden')
    expect(html).toContain('Account is frozen')
    expect(html).toContain('View full response')
  })
  it('labels the resolver button as code and omits the pill without a status', () => {
    const html = renderToStaticMarkup(
      <ScenarioHoverCardBody option={{ label: 'dynamic', summary: 's', kind: 'resolver' }} onViewResponse={() => {}} />,
    )
    expect(html).toContain('View resolver code')
    expect(html).not.toContain('HTTP')
  })
  it('renders passthrough without any response button', () => {
    const html = renderToStaticMarkup(
      <ScenarioHoverCardBody option={{ label: 'Passthrough', summary: 'Forwards the request to the live upstream service.', kind: 'passthrough' }} />,
    )
    expect(html).toContain('Forwards the request')
    expect(html).not.toContain('View full response')
  })
  it('omits the summary line when the option has none', () => {
    const html = renderToStaticMarkup(<ScenarioHoverCardBody option={{ label: 'Plain', status: 200, kind: 'fixture' }} onViewResponse={() => {}} />)
    expect(html).toContain('HTTP 200 OK')
    expect(html).not.toContain('data-slot="scenario-summary"')
  })
})

describe('ScenarioResponseModalBody', () => {
  const view: ScenarioView = {
    key: 'frozen', label: 'Frozen', isDefault: false, kind: 'fixture',
    json: JSON.stringify({ status: 403, body: {} }), html: '<pre class="shiki"><code>{}</code></pre>',
  }
  it('renders header, content, and the catalog link when ready', () => {
    const html = renderToStaticMarkup(
      <ScenarioResponseModalBody
        state={{ kind: 'ready', view }}
        option={frozen}
        catalogHref="/ui/catalog/hello-system/customer_status"
        endpointDisplayName="Customer Status"
      />,
    )
    expect(html).toContain('HTTP 403 Forbidden')
    expect(html).toContain('shiki')
    expect(html).toContain('href="/ui/catalog/hello-system/customer_status"')
    expect(html).toContain('Open Customer Status in the catalog')
  })
  it('renders the error state with a retry button', () => {
    const html = renderToStaticMarkup(
      <ScenarioResponseModalBody state={{ kind: 'error', retry: () => {} }} option={frozen} catalogHref="/x" endpointDisplayName="X" />,
    )
    expect(html).toContain('Could not load')
    expect(html).toContain('Retry')
  })
})

describe('ScenarioDisclosure', () => {
  it('wraps its child as the hover trigger without altering the element', () => {
    const html = renderToStaticMarkup(
      <ScenarioDisclosure system="s" endpointName="e" endpointDisplayName="E" slug="frozen" option={frozen}>
        <button type="button">chip</button>
      </ScenarioDisclosure>,
    )
    expect(html).toContain('>chip</button>')
    expect(html).toContain('data-state="closed"')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/components/scenario-disclosure.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/app/components/ScenarioDisclosure.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SquareArrowOutUpRight } from 'lucide-react'
import type { ScenarioOption } from '../../lib/scenarios'
import type { ScenarioView } from '../ui/catalog/scenario-view'
import { ScenarioContent } from './ScenarioContent'
import { StatusPill } from './StatusPill'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card'

// Views are immutable for the life of the page (catalog reloads restart the
// server), so cache per scenario and dedupe concurrent opens. Failed fetches
// are evicted so Retry actually retries.
const viewCache = new Map<string, Promise<ScenarioView>>()

function fetchView(system: string, endpointName: string, slug: string): Promise<ScenarioView> {
  const key = `${system}/${endpointName}/${slug}`
  let pending = viewCache.get(key)
  if (!pending) {
    pending = fetch(
      `/ui/api/catalog/${encodeURIComponent(system)}/${encodeURIComponent(endpointName)}/scenarios/${encodeURIComponent(slug)}`,
    )
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`http_${res.status}`))))
      .then((data: { view: ScenarioView }) => data.view)
    viewCache.set(key, pending)
    pending.catch(() => viewCache.delete(key))
  }
  return pending
}

export function ScenarioHoverCardBody({
  option,
  onViewResponse,
}: {
  option: ScenarioOption
  onViewResponse?: () => void
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-[0.9rem] font-semibold text-foreground">{option.label}</span>
        <StatusPill value={option.status ?? null} />
      </div>
      {option.summary && (
        <p data-slot="scenario-summary" className="m-0 text-[0.8rem] leading-[1.4] text-muted-foreground [overflow-wrap:anywhere]">
          {option.summary}
        </p>
      )}
      {option.kind !== 'passthrough' && onViewResponse && (
        <button
          type="button"
          className="justify-self-start border-0 bg-transparent p-0 text-[0.78rem] text-[var(--accent-strong)] underline-offset-2 hover:underline"
          onClick={onViewResponse}
        >
          {option.kind === 'resolver' ? 'View resolver code →' : 'View full response →'}
        </button>
      )}
    </div>
  )
}

type ModalState =
  | { kind: 'loading' }
  | { kind: 'error'; retry: () => void }
  | { kind: 'ready'; view: ScenarioView }

export function ScenarioResponseModalBody({
  state,
  option,
  catalogHref,
  endpointDisplayName,
}: {
  state: ModalState
  option: ScenarioOption
  catalogHref: string
  endpointDisplayName: string
}) {
  return (
    <div className="grid gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5 pr-8">
        <DialogTitle>{option.label}</DialogTitle>
        <StatusPill value={option.status ?? null} />
      </div>
      {option.summary && (
        <p className="m-0 text-[0.82rem] leading-[1.4] text-muted-foreground [overflow-wrap:anywhere]">{option.summary}</p>
      )}
      {state.kind === 'loading' && (
        <div className="h-24 animate-pulse rounded-md border border-border bg-background" aria-label="Loading response" />
      )}
      {state.kind === 'error' && (
        <p className="m-0 text-[0.85rem] text-[var(--warning-text)]">
          Could not load the response.{' '}
          <button type="button" className="border-0 bg-transparent p-0 text-[0.85rem] underline" onClick={state.retry}>
            Retry
          </button>
        </p>
      )}
      {state.kind === 'ready' && <ScenarioContent scenario={state.view} />}
      <Link
        href={catalogHref}
        className="inline-flex items-center gap-1.5 justify-self-start text-[0.78rem] text-muted-foreground hover:text-foreground hover:no-underline"
      >
        <SquareArrowOutUpRight className="size-3" aria-hidden="true" />
        Open {endpointDisplayName} in the catalog
      </Link>
    </div>
  )
}

export function ScenarioDisclosure({
  system,
  endpointName,
  endpointDisplayName,
  slug,
  option,
  suppressed = false,
  initialView,
  children,
}: {
  system: string
  endpointName: string
  endpointDisplayName: string
  slug: string
  option: ScenarioOption
  suppressed?: boolean
  initialView?: ScenarioView
  children: React.ReactElement
}) {
  const [hoverOpen, setHoverOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [view, setView] = useState<ScenarioView | null>(initialView ?? null)
  const [failed, setFailed] = useState(false)

  // Fetch the prepared view the first time the dialog opens (LogRow pattern).
  useEffect(() => {
    if (!dialogOpen || view || failed) return
    let cancelled = false
    fetchView(system, endpointName, slug)
      .then((v) => {
        if (!cancelled) setView(v)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [dialogOpen, view, failed, system, endpointName, slug])

  const state: ModalState = view
    ? { kind: 'ready', view }
    : failed
      ? { kind: 'error', retry: () => setFailed(false) }
      : { kind: 'loading' }

  return (
    <>
      <HoverCard open={hoverOpen && !suppressed} onOpenChange={setHoverOpen}>
        <HoverCardTrigger asChild>{children}</HoverCardTrigger>
        <HoverCardContent>
          <ScenarioHoverCardBody
            option={option}
            onViewResponse={
              option.kind === 'passthrough'
                ? undefined
                : () => {
                    setHoverOpen(false)
                    setDialogOpen(true)
                  }
            }
          />
        </HoverCardContent>
      </HoverCard>
      {option.kind !== 'passthrough' && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent aria-describedby={undefined}>
            <ScenarioResponseModalBody
              state={state}
              option={option}
              catalogHref={`/ui/catalog/${system}/${endpointName}`}
              endpointDisplayName={endpointDisplayName}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
```

**Accessibility note (spec deviation, accepted):** the spec floated `aria-describedby`
on the trigger for the card text. Radix HoverCard portals its content and treats it as a
pointer/focus preview, so wiring `aria-describedby` across the portal isn't practical;
per the spec's own framing the card is supplementary and everything it shows is
reachable through the modal (a real, labeled dialog). Do not add custom describedby
plumbing.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/components/scenario-disclosure.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/ScenarioDisclosure.tsx tests/components/scenario-disclosure.test.tsx
git commit -m "feat(ui): add the scenario hover card + response modal component

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Rework `ScenarioPicker` — icon anatomy + disclosure on chips

Chips get the icon-in-slot anatomy (`file-code` for resolvers, `globe` for passthrough,
circles for fixtures; trailing `CodeXml` deleted) and every enabled chip becomes a
`ScenarioDisclosure` trigger. The picker needs the system slug + display name — new
required props threaded from both forms.

**Files:**
- Modify: `src/app/components/ScenarioPicker.tsx`
- Modify: `src/app/ui/profiles/ScenarioConfig.tsx` (accept + pass through `system` / `endpointDisplayName`)
- Modify: `src/app/ui/profiles/ProfileForm.tsx:107-120`
- Modify: `src/app/ui/global-mocks/GlobalMocksForm.tsx:95-102`
- Test: `tests/components/scenario-picker.test.tsx`, `tests/components/scenario-config.test.tsx`

**Interfaces:**
- Consumes: `ScenarioDisclosure` (Task 8), `ScenarioOption.kind`.
- Produces:
  ```tsx
  export function ScenarioPicker(props: {
    system: string                // NEW — system slug
    endpointName: string
    endpointDisplayName: string   // NEW — for the modal's catalog link text
    fieldName?: string
    scenarios: Record<string, ScenarioOption>
    selected: string
    unavailable?: string[]
  }): ReactNode
  // ScenarioConfig gains the same two props and forwards them (also used by Task 10).
  ```

- [ ] **Step 1: Update the tests first**

In `tests/components/scenario-picker.test.tsx`:

1. Every render gains `system="hello-system" endpointDisplayName="Hello World"`.
2. The two class-extraction helpers must tolerate Radix's injected attributes — replace the marker searches with regexes:

```ts
function labelClassForValue(html: string, value: string): string {
  const valueIndex = html.indexOf(`value="${value}"`)
  if (valueIndex === -1) throw new Error(`value ${value} not found`)
  const before = html.slice(0, valueIndex)
  const match = [...before.matchAll(/<label[^>]*class="([^"]*)"/g)].at(-1)
  if (!match) throw new Error(`label for ${value} not found`)
  return match[1]
}
```

(`dotClassForValue` / `textSpanClassForValue` keep working — dot span markup is unchanged for fixtures.)

3. New behavior tests:

```tsx
it('replaces the radio circle with a file-code icon on resolver chips and a globe on real', () => {
  const html = renderToStaticMarkup(
    <ScenarioPicker
      system="hello-system"
      endpointName="hello_world"
      endpointDisplayName="Hello World"
      scenarios={{
        default: { label: 'Default', kind: 'fixture' },
        dynamic: { label: 'dynamic', kind: 'resolver' },
        real: { label: 'Passthrough', kind: 'passthrough' },
      }}
      selected="default"
    />,
  )
  expect(html).toContain('aria-label="Resolved by code at request time"')
  expect(html).toContain('aria-label="Forwards to the live upstream"')
  // fixtures keep the radio dot; icon chips have no dot span
  expect(dotClassForValue(html, 'default')).toContain('rounded-full')
  expect(() => dotClassForValue(html, 'dynamic')).toThrow()
})

it('renders enabled chips as hover-card triggers but leaves unavailable chips bare', () => {
  const html = renderToStaticMarkup(
    <ScenarioPicker
      system="hello-system"
      endpointName="hello_world"
      endpointDisplayName="Hello World"
      scenarios={{
        success: { label: 'Hello success', kind: 'fixture' },
        ghost: { label: 'ghost — unavailable', kind: 'fixture' },
      }}
      selected="success"
      unavailable={['ghost']}
    />,
  )
  // one trigger (success); the dangling chip gets no data-state attribute
  expect(html.match(/data-state="closed"/g)?.length).toBeGreaterThanOrEqual(1)
  const ghostLabel = labelClassForValue(html, 'ghost')
  expect(ghostLabel).toContain('opacity-55')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/components/scenario-picker.test.tsx`
Expected: FAIL — new props unknown, icons absent.

- [ ] **Step 3: Implement the picker rework**

`src/app/components/ScenarioPicker.tsx` full new shape (tones and hidden-radio markup are
untouched; `CodeXml` import removed):

```tsx
import { FileCode, Globe } from 'lucide-react'
import type { ScenarioOption } from '../../lib/scenarios'
import { ScenarioDisclosure } from './ScenarioDisclosure'

// scenarioTone / cardBase / cardTone / dotBase / dotTone: unchanged.

const iconTone: Record<ScenarioTone, string> = {
  default: 'peer-checked:text-[var(--success)]',
  nonDefault: 'peer-checked:text-[var(--warning-text)]',
  real: 'peer-checked:text-[#d92d20]',
}

function ScenarioSlot({ kind, tone }: { kind: ScenarioOption['kind']; tone: ScenarioTone }) {
  if (kind === 'fixture') {
    return <span aria-hidden="true" className={`${dotBase} ${dotTone[tone]}`} />
  }
  const Icon = kind === 'resolver' ? FileCode : Globe
  const label = kind === 'resolver' ? 'Resolved by code at request time' : 'Forwards to the live upstream'
  return (
    <span className={`inline-flex size-4 flex-none items-center justify-center text-muted-foreground transition-colors ${iconTone[tone]}`}>
      <Icon className="size-4" aria-label={label} role="img" />
    </span>
  )
}

export function ScenarioPicker({
  system,
  endpointName,
  endpointDisplayName,
  fieldName,
  scenarios,
  selected,
  unavailable,
}: {
  system: string
  endpointName: string
  endpointDisplayName: string
  fieldName?: string
  scenarios: Record<string, ScenarioOption>
  selected: string
  unavailable?: string[]
}) {
  const isUnavailable = (key: string) => unavailable?.includes(key) ?? false
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(scenarios).map(([key, option]) => {
        const tone = scenarioTone(key)
        const disabled = isUnavailable(key)
        const chip = (
          <label
            key={key}
            className={`${cardBase} ${cardTone[tone]}${disabled ? ' opacity-55 cursor-not-allowed' : ''}`}
          >
            <input
              type="radio"
              name={fieldName ?? `scenario:${endpointName}`}
              value={key}
              defaultChecked={key === selected}
              disabled={disabled}
              className="peer absolute opacity-0 pointer-events-none"
            />
            <ScenarioSlot kind={option.kind} tone={tone} />
            <span
              className={`min-w-0 text-[0.9rem] font-medium [overflow-wrap:anywhere]${disabled ? ' line-through' : ''}`}
            >
              {option.label}
            </span>
          </label>
        )
        // Dangling pins have nothing to disclose — no card, no modal.
        if (disabled) return chip
        return (
          <ScenarioDisclosure
            key={key}
            system={system}
            endpointName={endpointName}
            endpointDisplayName={endpointDisplayName}
            slug={key}
            option={option}
          >
            {chip}
          </ScenarioDisclosure>
        )
      })}
    </div>
  )
}
```

**Note on `peer-checked` inside `ScenarioSlot`:** the icon span sits after the hidden
`peer` radio exactly like the dot span did, so the existing peer mechanics apply
unchanged.

- [ ] **Step 4: Thread the new props**

`ScenarioConfig` props gain `system: string` and `endpointDisplayName: string`; its
single-mode `<ScenarioPicker>` call passes both through.
`ProfileForm.tsx` (`:107`): `<ScenarioConfig system={system.slug} endpointDisplayName={endpoint.displayName} …>`.
`GlobalMocksForm.tsx` (`:95`): `<ScenarioPicker system={system.slug} endpointDisplayName={endpoint.displayName} …>`.
`tests/components/scenario-config.test.tsx`: add the two props to every `ScenarioConfig` render.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (fix `profile-form` / `global-mocks-form` snapshot-ish string assertions if the new attributes shift any `contains` checks).

- [ ] **Step 6: Commit**

```bash
git add src/app/components/ScenarioPicker.tsx src/app/ui/profiles/ScenarioConfig.tsx src/app/ui/profiles/ProfileForm.tsx src/app/ui/global-mocks/GlobalMocksForm.tsx tests/components/scenario-picker.test.tsx tests/components/scenario-config.test.tsx tests/ui/profile-form.test.tsx tests/ui/global-mocks-form.test.tsx
git commit -m "feat(ui): scenario chips get type icons and summary hover cards

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Rework sequence mode — option summaries + step-trigger disclosure

Dropdown options gain always-visible summary second lines and the icon slot; nothing
interactive inside the popup. Step triggers reuse `ScenarioDisclosure`, suppressed while
the popup is open.

**Files:**
- Modify: `src/app/ui/profiles/ScenarioConfig.tsx` (the `ScenarioSelect` function, `:280-451`)
- Test: `tests/components/scenario-config.test.tsx`

**Interfaces:**
- Consumes: `ScenarioDisclosure` (Task 8), `ScenarioOption` (Task 1), `system`/`endpointDisplayName` props (Task 9). `ScenarioSelect` gains `{ system, endpointName, endpointDisplayName }` props, passed from `ScenarioConfig`'s sequence rows.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing tests**

Append to `tests/components/scenario-config.test.tsx` (sequence mode renders when
`selection` is an array):

```tsx
const seqScenarios: Record<string, ScenarioOption> = {
  default: { label: 'Active', summary: 'Customer is in good standing.', status: 200, kind: 'fixture' },
  frozen: { label: 'Frozen', summary: 'Account actions blocked.', status: 200, kind: 'fixture' },
  real: { label: 'Passthrough', summary: 'Forwards the request to the live upstream service.', kind: 'passthrough' },
}

it('renders each sequence step trigger as a hover-card trigger', () => {
  const html = renderToStaticMarkup(
    <ScenarioConfig
      system="hello-system"
      endpointName="customer_status"
      endpointDisplayName="Customer Status"
      scenarios={seqScenarios}
      selection={['frozen', 'default']}
      fallback="default"
    />,
  )
  // two steps → at least two closed hover-card triggers
  expect(html.match(/data-state="closed"/g)?.length).toBeGreaterThanOrEqual(2)
})

it('keeps the closed popup out of static markup (options render only when open)', () => {
  const html = renderToStaticMarkup(
    <ScenarioConfig
      system="hello-system"
      endpointName="customer_status"
      endpointDisplayName="Customer Status"
      scenarios={seqScenarios}
      selection={['frozen']}
      fallback="default"
    />,
  )
  expect(html).not.toContain('role="listbox"')
  // summaries therefore appear only via hover cards/popup, not in the base markup
  expect(html).not.toContain('Customer is in good standing.')
})
```

The open-popup rendering (summaries as second lines, icons, checkmark) can't be
exercised without a DOM — cover it structurally instead: extract the option row into a
plain component and test it directly:

```tsx
import { ScenarioOptionRow } from '../../src/app/ui/profiles/ScenarioConfig'

it('renders an option row with label, summary second line, and selection check', () => {
  const html = renderToStaticMarkup(
    <ScenarioOptionRow slug="default" option={seqScenarios.default} selected onSelect={() => {}} />,
  )
  expect(html).toContain('Active')
  expect(html).toContain('Customer is in good standing.')
  expect(html).toContain('role="option"')
  expect(html).toContain('aria-selected="true"')
})

it('renders the globe icon slot for the passthrough option row', () => {
  const html = renderToStaticMarkup(
    <ScenarioOptionRow slug="real" option={seqScenarios.real} selected={false} onSelect={() => {}} />,
  )
  expect(html).toContain('aria-label="Forwards to the live upstream"')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/components/scenario-config.test.tsx`
Expected: FAIL — `ScenarioOptionRow` not exported; triggers not wrapped.

- [ ] **Step 3: Implement**

In `src/app/ui/profiles/ScenarioConfig.tsx`:

1. Export a `SelectSlot` helper mirroring Task 9's `ScenarioSlot`, but selection is a
   plain boolean (no `peer`):

```tsx
function SelectSlot({ kind, tone, selected }: { kind: ScenarioOption['kind']; tone: Kind; selected: boolean }) {
  if (kind === 'fixture') {
    return (
      <span
        aria-hidden="true"
        className={`size-3.5 flex-none rounded-full bg-card ${selected ? `border-4 ${dotKindClass[tone]}` : 'border-2 border-border'}`}
      />
    )
  }
  const Icon = kind === 'resolver' ? FileCode : Globe
  const label = kind === 'resolver' ? 'Resolved by code at request time' : 'Forwards to the live upstream'
  const color = selected ? iconSelectedKindClass[tone] : 'text-muted-foreground'
  return (
    <span className={`inline-flex size-3.5 flex-none items-center justify-center ${color}`}>
      <Icon className="size-3.5" aria-label={label} role="img" />
    </span>
  )
}

const iconSelectedKindClass: Record<Kind, string> = {
  default: 'text-[var(--success)]',
  nonDefault: 'text-[var(--warning-text)]',
  real: 'text-[#d92d20]',
}
```

2. Export `ScenarioOptionRow` (the popup row, extracted from the current option
   `<button>` at `:409-445` — imports `FileCode`/`Globe` replace `CodeXml`):

```tsx
export function ScenarioOptionRow({
  slug,
  option,
  selected,
  onSelect,
  optionRef,
}: {
  slug: string
  option: ScenarioOption
  selected: boolean
  onSelect: () => void
  optionRef?: React.Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={optionRef}
      type="button"
      role="option"
      aria-selected={selected}
      className={`flex w-full items-start gap-[9px] rounded-md border border-transparent px-[9px] py-1.5 text-left ${
        selected ? optionSelectedKindClass[scenarioKind(slug)] : 'hover:border-border hover:bg-background'
      }`}
      onClick={onSelect}
    >
      <span className="mt-[3px] inline-flex">
        <SelectSlot kind={option.kind} tone={scenarioKind(slug)} selected={selected} />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="min-w-0 text-[0.9rem] font-medium leading-[1.3] text-foreground [overflow-wrap:anywhere]">
          {option.label}
        </span>
        {option.summary && (
          <span className="text-[0.78rem] font-normal leading-[1.4] text-muted-foreground [overflow-wrap:anywhere]">
            {option.summary}
          </span>
        )}
      </span>
      {selected && (
        <Check className="ml-auto mt-[3px] size-3.5 flex-none stroke-[2.6] text-secondary-foreground" aria-hidden="true" />
      )}
    </button>
  )
}
```

3. `ScenarioSelect` changes:
   - New props: `system: string; endpointName: string; endpointDisplayName: string` (forwarded from the sequence row render at `:206-212`).
   - The trigger's dot span becomes `<SelectSlot kind={scenarios[value]?.kind ?? 'fixture'} tone={scenarioKind(value)} selected />`; the trigger's trailing `CodeXml` block is deleted.
   - Wrap the trigger button in disclosure, suppressed while open:

```tsx
<ScenarioDisclosure
  system={system}
  endpointName={endpointName}
  endpointDisplayName={endpointDisplayName}
  slug={value}
  option={scenarios[value] ?? { label: value, kind: 'fixture' }}
  suppressed={open}
>
  <button ref={triggerRef} …unchanged trigger markup…>…</button>
</ScenarioDisclosure>
```

   - The popup map body becomes `<ScenarioOptionRow key={key} slug={key} option={option} selected={selected} optionRef={selected ? selectedRef : undefined} onSelect={() => { onChange(key); close(true) }} />`.
   - Popup width: change `max-w-[340px]` to `max-w-[410px]` in the listbox class (`:390`).

4. `ScenarioConfig` sequence rows pass the three new props to `ScenarioSelect`.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/ui/profiles/ScenarioConfig.tsx tests/components/scenario-config.test.tsx
git commit -m "feat(ui): sequence steps get hover cards; dropdown options show summaries

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Documentation + visual verification

**Files:**
- Modify: `docs/site/docs/building/fixtures.md` (~lines 24-27)
- Modify: `docs/site/docs/building/dynamic.md` (~lines 103-107)
- Modify: `docs/site/docs/driving/ui.md` (~lines 40-70)

**Interfaces:** none — docs and manual QA only. Follow the repo's
`maintaining-project-docs` skill conventions.

- [ ] **Step 1: Update the three stale "summary appears only in the catalog" claims**

- `fixtures.md`: the sentence stating summary "appears only in the catalog detail page (not in the picker or logs)" now reads that summary appears in the catalog detail page **and in the scenario pickers** — in the chip hover card and the sequence dropdown — and still not in logs.
- `dynamic.md` (~:103-107): same correction for `export const summary`.
- `ui.md` (~:40-70, the profiles/global-mocks tour): document the new interactions — hovering or focusing a scenario chip (or a sequence step) shows label, HTTP status, and summary; "View full response" opens the catalog-style modal without leaving the page; resolver scenarios are marked with a file-code icon in place of the radio circle, passthrough with a globe; the icon takes the tone color when selected.

Also check `docs/site` for embedded screenshots showing picker chips with the old
trailing `</>` icon — retake any that now lie about the UI (the docs build surfaces the
image list; `grep -rn "\.png\|\.webp" docs/site/docs/driving/ui.md` finds candidates).

Build check: `cd docs/site && uvx zensical build` (memory: built output is gitignored).

- [ ] **Step 2: Visual verification against the design session mockups**

Start the dev server (`.claude/launch.json` "dev" entry) and check, in dark **and**
light themes, against `.superpowers/brainstorm/62337-1785576874/content/`
(`final-chips-themes.html`, `sequence-final.html`):

1. `/ui/global-mocks` — `dynamic` chip shows `file-code` in the slot (amber when selected), Passthrough shows the globe (red when selected), fixtures keep circles; hover each chip → card with pill/summary; "View full response →" → modal with highlighted JSON + "Open Account Balance in the catalog"; passthrough card has summary but no link.
2. `/ui/profiles/new` — same on `customer_status`; switch to Sequence: dropdown options show summaries + icons + checkmark, nothing clickable inside; hovering a step trigger shows the card; opening the dropdown closes it.
3. Keyboard: Tab to a chip → hover card opens on focus; Escape closes the modal.
4. A scenario with no `summary` (temporarily strip one sample) → card shows pill + link only.
5. `/ui/catalog/hello-system/account_balance` — unchanged rendering.

- [ ] **Step 3: Full gate**

Run: `npm test && npm run lint && npm run build`
Expected: all green (`build` also runs `scripts/build-validate.mjs`).

- [ ] **Step 4: Commit**

```bash
git add docs/site/docs/building/fixtures.md docs/site/docs/building/dynamic.md docs/site/docs/driving/ui.md
git commit -m "docs: cover scenario picker summaries, icons, and the response modal

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Post-plan notes

- **Out of scope (per spec):** catalog list/detail page changes, public `/ui/api/catalog` contract, touch-specific affordances, logs page, `summary` validation.
- The sample catalog summaries used for QA were already committed (`chore(catalog): add summary fields to the sample scenarios`).
- After Task 11, follow `superpowers:finishing-a-development-branch` (and the repo's `feature-lifecycle` skill expects an issue/PR pairing — the branch is `claude/scenario-selection-summary-b7af66`).
