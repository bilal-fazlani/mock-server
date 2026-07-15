# Tailwind + shadcn UI migration — design

**Date:** 2026-07-16
**Status:** Approved (design phase)

## Goal

Rebuild the `/ui` frontend on **Tailwind CSS v4 + shadcn** while keeping the current
visual design intact. Convert the entire existing UI off CSS Modules in one project,
ending with **zero `.module.css` files**. Bundle in one small new feature: a
light/dark/system theme toggle in the header.

Behavior of the mock server itself (routing, catalog, profiles, scenarios, fixtures,
the `/ui/api/*` runtime-control API, request lifecycle) is **unchanged**. This is a
presentation-layer reimplementation only.

## Current state (baseline)

- Next.js 16 (App Router) + React 19.
- Styling: **CSS Modules** — 12 `.module.css` files plus a token-driven
  `src/app/globals.css` (semantic CSS variables, light + dark via
  `@media (prefers-color-scheme: dark)`). No Tailwind today.
- Icons: `lucide-react` (already installed; shadcn's default icon set).
- Shared components in `src/app/components/`: `Alert`, `MethodBadge`, `SchemaBadge`,
  `ScenarioPicker` (a radio-card group, not a dropdown).
- UI pages under `src/app/ui/`: `profiles` (home), `global-mocks`, `catalog`, `logs`,
  `environment`, plus the UI `layout.tsx` header/nav.
- Dark mode is currently **system-only** (no toggle).

## Decisions

- **Tailwind v4** (CSS-first `@theme`, `@tailwindcss/postcss`), not v3.
- **shadcn** latest CLI in v4 mode. New deps: `tailwindcss`, `@tailwindcss/postcss`,
  `postcss`, `clsx`, `tailwind-merge`, `class-variance-authority`, `tw-animate-css`,
  `next-themes`. `lucide-react` stays.
- **Keep the existing palette** — no visual redesign. Map current values onto shadcn's
  variable names.
- **Class-based dark mode** with a **light/dark/system toggle** in the UI header;
  `system` remains the default so current behavior is preserved for users who never
  touch it.
- Sequencing: **foundation-first** (Approach A). Infra + tokens + toggle + shared
  primitives, then convert pages one at a time, deleting each page's `.module.css` as
  it is done.

## Architecture

### 1. Tailwind v4 + shadcn setup
- Install Tailwind v4 and the PostCSS plugin; add `postcss.config.mjs` with
  `@tailwindcss/postcss`.
- `globals.css`: `@import "tailwindcss";`, `@import "tw-animate-css";`, a
  `@custom-variant dark` declaration for class-based dark mode, and the `@theme inline`
  block mapping tokens to Tailwind.
- `npx shadcn@latest init` → generates `components.json`, `lib/utils.ts` (the `cn()`
  helper). Configure component path to `src/app/components/ui/`.

### 2. Theme / tokens (keep current palette)
Redefine the current values under shadcn's expected variable names in `globals.css`:
- `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover*`,
  `--primary` (= current indigo `#4f63e6`), `--primary-foreground`, `--secondary*`,
  `--muted*`, `--accent*`, `--border`, `--input`, `--ring`, `--destructive`.
- Retain custom `--success` and `--warning` families (and RGB/tint variants) for the
  badge/alert variants that use them today.
- Light values in `:root {}`; dark values move from the `@media` block into `.dark {}`.
- Radii map from current `--radius-s` / `--radius-m` to shadcn's `--radius`.
- Fonts unchanged (Geist sans/mono variables already wired in the root layout).

### 3. Dark mode + toggle
- Wrap the app (root `layout.tsx`) in a `next-themes` `ThemeProvider`
  (`attribute="class"`, `defaultTheme="system"`, `enableSystem`,
  `disableTransitionOnChange`). Add `suppressHydrationWarning` on `<html>`.
- New client component `ThemeToggle` (Sun/Moon/Monitor from lucide) rendered top-right
  in the UI header — a small dropdown/segmented control cycling light → dark → system.

### 4. Primitive layer — `src/app/components/ui/`
shadcn-generated, then tuned to the palette:
- `Button` — variants `default` / `secondary` / `outline` / `ghost` (replaces the
  `.btnPrimary` / `.btnSecondary` classes and the base `button` styling in globals).
- `Input`, `Label`.
- `Card` (+ header/content/footer) for the surface panels.
- `Alert` — replaces `src/app/components/Alert.tsx`.
- `Badge` with color variants — replaces both `MethodBadge` and `SchemaBadge`
  (HTTP-method colors and schema-status colors become variants).
- `Select`, `RadioGroup`, `Checkbox` / `Switch` as needed by the forms.
- `lib/utils.ts` `cn()` helper used throughout.

### 5. Component + page conversion
- `ScenarioPicker` → shadcn `RadioGroup`, styled to match the current radio-card look
  (selected/`real`/non-default/unavailable states preserved).
- UI `layout.tsx` header/nav → Tailwind utilities + `ThemeToggle`.
- Each page rewritten with Tailwind + primitives: `profiles` (list, `ProfileForm`,
  `ScenarioConfig`, `RecentActivity`, header, guards), `global-mocks`
  (`GlobalMocksForm`), `catalog` (`CatalogView`, `EndpointView`, `EndpointScenarios`,
  copy buttons), `logs` (`LogsView`, `LogRow`), `environment` (`EnvironmentView`).
- Server Components stay server-side; only interactive pieces (theme toggle, pickers,
  forms, copy buttons) are client components — matching the current split.
- Delete each `.module.css` file as its consumer is converted. End state: **no
  `.module.css` files remain**; `globals.css` holds only the Tailwind directives,
  theme variables, and any small global base styles that don't fit a utility.

## Data flow / interfaces

No change. Forms continue to post to the existing server actions
(`src/app/ui/**/actions.ts`) and the `/ui/api/*` routes are untouched. Component props
(e.g. `ScenarioPicker`'s `scenarios` / `selected` / `unavailable`) keep their current
shapes so call sites don't change semantically.

## Error handling

No new failure modes. The theme toggle degrades gracefully: before hydration the
`next-themes` inline script applies the stored/system theme to avoid a flash; if JS is
disabled, the app renders in the system-preferred scheme via the `.dark` default
resolution. Existing form validation and error/alert rendering are preserved via the
new `Alert`/`Input` primitives.

## Testing / verification

- `npm run build` and `npm run lint` must pass after infra and at the end.
- After infra and after each page conversion: run the app, load the page, and confirm
  it renders correctly in **both light and dark**, and that interactive elements
  (theme toggle, scenario pickers, forms, copy buttons) still work — forms exercise the
  untouched server actions.
- Existing `vitest` suite (mostly `src/lib` logic) must remain green; it is not
  affected by the presentation change.

## Out of scope

- Any redesign or restyle beyond reproducing the current look (tracked separately if
  wanted later).
- Changes to mock-server behavior, catalog schema, or the `/ui/api` API.
- New pages or features beyond the theme toggle.

## Docs guide impact

Per `AGENTS.md`, the `docs/site` guide documents mock-server *functionality* (catalog,
endpoints, profiles, scenarios, fixtures, schemas, `/ui/api`, install, lifecycle). This
migration is a pure UI reimplementation plus a theme toggle and touches none of that, so
**no guide updates are required**.
