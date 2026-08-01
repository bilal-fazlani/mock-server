# Scenario picker disclosure — summaries, icons, and full-response preview

**Date:** 2026-08-01
**Status:** Decisions approved in design session; spec awaiting review
**Surfaces:** Profile page (`/ui/profiles/[profileId]`, `/ui/profiles/new`) and Global mocks page (`/ui/global-mocks`) — both picker modes (single + sequence)

## Problem

When selecting scenarios on the profile or global-mocks pages, the picker shows only a
friendly name. The `summary` field (introduced 2026-07-17) renders solely on the catalog
detail page, so at the moment of decision the user cannot tell what a scenario actually
does, and inspecting the real response requires navigating away to the catalog.

This design reverses the 2026-07-17 spec's deliberate exclusion of `summary` from the
pickers. The catalog pages themselves are unchanged (the detail page already shows
summaries; the list page stays as is).

## Goal

At the point of selection, progressively disclose per scenario:

1. **Name** — always visible (unchanged).
2. **Summary** — one hover/focus away.
3. **Full response** — one click from the summary, in a modal, without leaving the page.

The default UI stays exactly as compact as today; all new information is on demand.

## UX design

### Single mode — chips (shared `ScenarioPicker`, both pages)

- Chips keep today's exact layout, sizing, and tone system (neutral card + circle when
  unselected; tone-colored border, tinted background, and donut when selected).
- **Hovering or keyboard-focusing a chip opens a hover card** anchored to it:
  - Scenario label + HTTP status pill (fixtures only, e.g. `HTTP 200 OK`; error tone for 4xx/5xx).
  - The scenario's `summary`, when set.
  - A **"View full response →"** link (resolvers: **"View resolver code →"**) opening the modal.
- Passthrough's hover card shows the fixed auto-summary
  *"Forwards the request to the live upstream service."* and **no modal link** (there is
  no stored response to show).
- Scenarios without a `summary` still get the card (status pill + link) — the summary
  line is simply omitted.
- Dangling selections (pinned slug no longer in the catalog) stay as today — disabled,
  struck through, **no hover card**.

### Chip anatomy and icons

- **The type icon replaces the radio circle** in the leading slot; fixture scenarios keep
  their radio circle. No trailing icons anymore (the current trailing `CodeXml` goes away).
- Icon inherits the slot's state colors: muted when unselected, tone color when selected
  (amber for non-default, green for a resolver-backed `default`, red for passthrough).
  Selection remains additionally signaled by the chip's tinted background + border.
- **Icons:** resolver scenarios → lucide `file-code` (it *is* a code file beside the JSON
  fixtures); passthrough → lucide `globe` (the real, live service).
- A resolver-backed default (`default.mjs`) needs no special casing: green tone + `file-code`.
- Verified against both themes' exact tokens (light `#1f9d55`/`#8a5a09` on white cards,
  dark `#34b56b`/`#ecc06a` on `#16191e`); no adjustments needed.

### Sequence mode (`ScenarioConfig` / `ScenarioSelect`)

- **Dropdown options are pure options — nothing interactive inside the popup** (ARIA:
  no clickable children inside `role="option"`). Each option row: leading circle/icon +
  label + **its summary always visible as a second line**. Opening the dropdown is
  itself the disclosure gesture, so summaries need no further reveal.
- The checkmark on the current option stays (today's convention): it distinguishes the
  *saved* choice from the keyboard-*focused* row, and is the primary "current" signal
  for icon-slot options that have no donut to fill.
- **Step triggers reuse the chip hover card** (same component, same content, same modal
  link). No ⓘ buttons on steps or options.
- Accepted trade: a candidate's full response is not reachable from inside the open
  dropdown — select it, then hover the step (cheap to undo while editing).
- Hover card also opens on keyboard focus of the trigger, and is suppressed/closed
  whenever the dropdown popup opens so the two never stack.
- Popup widens (~410px) to accommodate summary lines.

### The modal (shared by chips and sequence steps)

Scope: **one scenario** (option 2a) — not the whole endpoint:

- Header: label + HTTP status pill.
- Summary line (when set).
- Body, catalog-style (same Shiki dual-theme rendering as the catalog detail page):
  - Fixture → highlighted response body JSON (+ header pills when present, matching
    catalog's `FixtureContent`).
  - Resolver → "Resolved at request time by `<slug>.mjs`" + highlighted source.
- Footer link: **"Open <endpoint> in the catalog ↗"** → `/ui/catalog/[system]/[endpoint]`
  for the full multi-scenario view.
- Dismiss via ✕, overlay click, or Escape (standard dialog semantics, focus-trapped).

## Architecture

### Data plumbing (summaries + status reach the pickers)

- `ScenarioMeta` (`src/lib/catalog/types.ts`) gains `status?: number`, parsed for fixture
  scenarios in the same read that already extracts `description`/`summary`
  (`src/lib/catalog/load.ts`). Resolver scenarios have no static status (they pick other
  scenarios); their hover card shows no pill.
- The flattening chokepoint `scenariosWithPassthrough()` (`src/lib/scenarios.ts`) widens
  from `Record<string, string>` to `Record<string, ScenarioOption>` where
  `ScenarioOption = { label: string; summary?: string; status?: number; kind: 'fixture' | 'resolver' | 'passthrough' }`
  (kind derived from `EndpointDef.resolverScenarios` / the implicit `real`).
  `scenarioOptionsWithDangling()` widens accordingly. Both pages already receive these
  props from their RSCs — no client fetch for names/summaries/status.
- The **public runtime-control API (`/ui/api/catalog`) is unchanged** — its slug → label
  contract stays; pickers are fed via server-rendered props, not that API.

### Full response (lazy, server-rendered content)

- New internal route `GET /ui/api/catalog/[system]/[endpoint]/scenarios/[slug]`
  (`force-dynamic`, like all `/ui` routes) returning a prepared single-scenario view:
  `{ kind, label, summary?, status?, html }` — `html` is the Shiki dual-theme rendering
  of the fixture body or resolver source. Implemented by refactoring
  `buildScenarioViews` (`src/app/ui/catalog/scenario-view.ts`) to expose a
  single-scenario variant; the catalog detail page keeps using the all-scenarios form.
  404 for unknown slugs, dangling pins, and `real` (which has no content view).
- The modal fetches on open and caches per `system/endpoint/slug` for the page's
  lifetime (precedent: `LogRow`'s fetch-on-expand). Loading state: skeleton in the
  modal; failure: inline error + retry.
- Both forms already resolve `system.slug` + `endpoint.name` for their per-endpoint
  "View in catalog" links (global mocks since #42); that pair needs threading one hop
  further, into the picker/modal components, to address the route and the modal's
  catalog link.

### Components

- `src/app/components/ui/hover-card.tsx` + `dialog.tsx` via `npx shadcn add` (Radix is
  already a dependency; popover tokens already exist in `globals.css`).
- New `ScenarioHoverCard` (content shared by chips and sequence triggers) and
  `ScenarioResponseModal` (client; owns fetch/cache/loading/error).
- `ScenarioPicker.tsx`: slot icon anatomy, remove trailing `CodeXml`, wrap chips as
  hover-card triggers.
- `ScenarioConfig.tsx` (`ScenarioSelect`): option second lines, icon slots, wider popup,
  trigger hover cards, close-card-on-open-popup.

### Accessibility

- Hover cards open on hover **and** focus; chips already expose
  `has-[:focus-visible]` rings; content is supplementary (also reachable via modal), and
  the card itself is announced via `aria-describedby` on the trigger.
- No interactive elements inside listbox options; existing arrow/Escape/Tab handling in
  `ScenarioSelect` is preserved.
- Icons carry `aria-label`s ("Resolved by code at request time", "Forwards to the live
  upstream"); the modal is a labeled dialog with focus trap and Escape close.
- Touch devices: hover cards are unavailable (accepted v1 gap; the catalog remains the
  browse surface). The modal link inside cards is the only card-exclusive action.

## Out of scope

- Catalog list page changes; catalog detail page changes.
- Public runtime-control API additions (summary stays UI-internal).
- Touch-specific affordances (long-press) — possible follow-up.
- Logs page.

## Testing

- `tests/lib` — widened `scenariosWithPassthrough` / `scenarioOptionsWithDangling`
  shapes incl. `kind`/`status` derivation and dangling entries.
- `tests/catalog` — `status` parsed into `ScenarioMeta`; absent/invalid status ignored.
- Component tests — `ScenarioPicker` anatomy (circle vs icon slot per kind, selected
  tones, no trailing icon), hover card content per kind (status pill, summary fallback,
  passthrough auto-summary, no card when dangling), `ScenarioSelect` option summaries +
  checkmark.
- Route test — single-scenario view API: fixture (html + status), resolver (source),
  `real` → 404, unknown slug → 404, dangling → 404.
- `tests/ui/force-dynamic.test.ts` — new route complies automatically; keep green.

## Documentation updates (with `maintaining-project-docs`)

- `docs/site/docs/building/fixtures.md` (§summary, lines ~24-27) and
  `docs/site/docs/building/dynamic.md` (~103-107): "appears only in the catalog detail
  page" → now also in pickers.
- `docs/site/docs/driving/ui.md` (~40-70): picker tour — hover cards, sequence option
  summaries, response modal, new icons.
- Screenshots in docs that show chips with the old trailing `</>` icon.

## Design-session artifacts

Interactive mockups from this session persist (untracked) under
`.superpowers/brainstorm/62337-1785576874/content/` — `disclosure-pattern.html`
(pattern A–D bake-off), `chip-icons.html` / `resolver-icon.html` (anatomy + icon
lineups), `final-chips-themes.html` (dark/light confirmation), `sequence-final.html`
(agreed sequence design).

## Decision log

| Decision | Chosen | Rejected alternatives |
|---|---|---|
| Disclosure pattern | Hover card + modal (A) | Details toggle w/ inline expand (B), side sheet (C), always-visible rows (D) — user: don't clutter the default UI |
| Icon position | Replaces radio circle; fixtures keep circles | Circle + trailing icon (double glyph felt cluttered) |
| Resolver icon | `file-code` | `code-xml` (today), `code`, `square-function`, `braces`, `zap`, `terminal`, `variable`, `git-branch`, "JS" badge |
| Passthrough icon | `globe` | `arrow-right-left`, `arrow-up-right`, `cloud` |
| Sequence full-response entry | Hover card on step triggers (reused) | ⓘ per dropdown option, ⓘ per step row — nothing interactive inside the popup |
| Modal scope | Single scenario + catalog link (2a) | Whole-endpoint accordion (2b) |
