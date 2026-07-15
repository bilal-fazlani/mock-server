# Tailwind + shadcn UI migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `/ui` frontend on Tailwind CSS v4 + shadcn, preserving the current visual design, ending with zero `.module.css` files, and adding a light/dark/system theme toggle in the header.

**Architecture:** Foundation-first. Install Tailwind v4 + shadcn, map the existing palette onto shadcn's CSS variables (no visual redesign), add class-based dark mode via `next-themes` with a header toggle, build a shared primitive layer under `src/app/components/ui/`, then convert each page off CSS Modules one at a time — deleting each `.module.css` as its consumer is done. Mock-server behavior and the `/ui/api/*` routes are untouched.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn, `next-themes`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`.

## Global Constraints

- **Node** `>=22` (package.json `engines`). **Next** `16.2.10`, **React** `19.2.4` — do not bump.
- **Tailwind v4** (CSS-first `@theme`; PostCSS plugin `@tailwindcss/postcss`). Not v3.
- **Keep the existing palette** — reproduce the current look exactly; no restyle. Accent/primary is indigo `#4f63e6` (light) / `#4051c7` primary button (dark).
- **Dark mode is class-based** (`.dark`), default `system`. The header toggle cycles light/dark/system. Never regress the system-follows-OS default.
- **Zero `.module.css` at the end.** Each page task deletes the CSS Modules it replaces.
- **Path alias** `@/*` → `./src/*` already exists (tsconfig). shadcn components live at `src/app/components/ui/`, helper at `src/lib/utils.ts` (alias `@/lib/utils`).
- **Do not touch** any `actions.ts`, `src/app/ui/api/**`, or `src/lib/**` behavior. Server Components stay server; only interactive pieces are client components.
- **Standalone build must keep working** — `next.config.ts` `output: "standalone"` and `serverExternalPackages` are unchanged; the `prepack` flow is unaffected by CSS changes.
- **Verify per task:** `npm run build` and `npm run lint` pass; the affected page renders correctly in **both light and dark**; interactive elements still work.

## Conversion mapping (shared reference — used by every page/component task)

Replace CSS-Module classes and the current global classes with these:

| Current | Replacement |
| --- | --- |
| base `button`, `.btnPrimary` | `<Button>` (default variant) |
| `.btnSecondary` | `<Button variant="secondary">` (or `outline`) |
| base `input` styling | `<Input>` |
| `.appHeader` / `.appName` / `.appNav` | Tailwind utilities in the UI layout (see Task 4) |
| `.appMain` | `mx-auto w-full max-w-[1280px] px-6 pt-7 pb-16` |
| surface/card panels (`background: var(--surface); border; radius; shadow-card`) | `<Card>` or `bg-card border border-border rounded-[--radius] shadow-sm` |
| `Alert` (warning) | `<Alert>` primitive (Task 7) |
| `MethodBadge` / `SchemaBadge` | `<Badge variant="method">` / `<Badge variant="schema">` (Task 6) |
| `ScenarioPicker` radio-cards | `<ScenarioPicker>` on shadcn `RadioGroup` (Task 8) |
| color vars `--text-secondary` / `--text-muted` | `text-muted-foreground` (and Tailwind text utilities) |

Token → utility: `--background`→`bg-background`, `--surface`→`bg-card`, `--border`→`border-border`, `--text-primary`→`text-foreground`, `--accent`→`text-primary`/`bg-primary`. Radii: `--radius-s`→`rounded-md`, `--radius-m`→`rounded-lg`.

**Per-page procedure (apply in every page/component conversion task):**
1. Read the current `.tsx` and its `.module.css` to capture exact structure, states, and behavior.
2. Reproduce the same DOM structure and behavior with Tailwind utilities + the primitives above. Preserve all props, `aria-*`, `title`, and conditional states.
3. Delete the `.module.css` file and remove its `import styles from …`.
4. `npm run build && npm run lint`, then load the page in the browser and confirm it matches the previous look in **light and dark** and that interactions work.

---

## Task 1: Install Tailwind v4 + shadcn scaffolding

**Files:**
- Create: `postcss.config.mjs`
- Create: `src/lib/utils.ts`
- Create: `components.json`
- Modify: `src/app/globals.css` (Tailwind directives added; full palette mapping is Task 2)
- Modify: `package.json` (deps)

**Interfaces:**
- Produces: `cn(...inputs)` from `@/lib/utils`; the `components.json` config pointing shadcn at `src/app/components/ui`.

- [ ] **Step 1: Install dependencies**

```bash
npm install tailwindcss @tailwindcss/postcss postcss class-variance-authority clsx tailwind-merge tw-animate-css next-themes
```

- [ ] **Step 2: Create `postcss.config.mjs`**

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 3: Create `src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Prepend Tailwind directives to `src/app/globals.css`**

Add these lines at the very top of `src/app/globals.css` (keep the existing content below for now — Task 2 replaces the theme block):

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));
```

- [ ] **Step 5: Create `components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/app/components",
    "utils": "@/lib/utils",
    "ui": "@/app/components/ui",
    "lib": "@/lib",
    "hooks": "@/app/hooks"
  }
}
```

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: PASS. (Existing pages may show minor visual drift from Tailwind preflight; that is expected and resolved as pages convert.)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json postcss.config.mjs components.json src/lib/utils.ts src/app/globals.css
git commit -m "build: add Tailwind v4 + shadcn scaffolding"
```

---

## Task 2: Map the existing palette onto shadcn CSS variables

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: shadcn theme variables (`--background`, `--foreground`, `--card`, `--primary`, `--border`, `--ring`, `--muted`, `--destructive`, `--radius`, …) in `:root` (light) and `.dark` (dark), plus the retained custom `--success` / `--warning-*` families; a `@theme inline` block exposing them to Tailwind utilities.

- [ ] **Step 1: Replace the `:root` and `@media (prefers-color-scheme: dark)` blocks**

In `src/app/globals.css`, replace the existing `:root { … }` and the `@media (prefers-color-scheme: dark)` block with the following. Keep the font variables and the retained custom tokens. Values are taken from the current palette; tune tints during Step 4 verification to match the current look exactly.

```css
:root {
  --font-sans: var(--font-geist-sans), system-ui, -apple-system, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, 'SF Mono', monospace;

  --radius: 0.625rem; /* 10px, was --radius-m */

  --background: #f5f6f8;
  --foreground: #171a20;
  --card: #ffffff;
  --card-foreground: #171a20;
  --popover: #ffffff;
  --popover-foreground: #171a20;
  --primary: #4f63e6;
  --primary-foreground: #ffffff;
  --secondary: #ffffff;
  --secondary-foreground: #4b5563;
  --muted: #f5f6f8;
  --muted-foreground: #8a92a0;
  --accent: #eef0fb;
  --accent-foreground: #171a20;
  --destructive: #d92d20;
  --destructive-foreground: #ffffff;
  --border: #e3e6eb;
  --input: #e3e6eb;
  --ring: #4f63e6;

  /* retained custom tokens used by Badge / Alert / ScenarioPicker */
  --primary-strong: #3a4ed3;
  --success: #1f9d55;
  --success-rgb: 31, 157, 85;
  --success-tint: rgba(var(--success-rgb), 0.08);
  --warning-bg: #fef6e7;
  --warning-border: #f2ce88;
  --warning-text: #8a5a09;
  --schema-fg: #0f766e;
}

.dark {
  --background: #0e1013;
  --foreground: #eceef1;
  --card: #16191e;
  --card-foreground: #eceef1;
  --popover: #16191e;
  --popover-foreground: #eceef1;
  --primary: #4051c7;
  --primary-foreground: #ffffff;
  --secondary: #16191e;
  --secondary-foreground: #a6adba;
  --muted: #16191e;
  --muted-foreground: #6d7583;
  --accent: #232a3a;
  --accent-foreground: #eceef1;
  --destructive: #e5675c;
  --destructive-foreground: #ffffff;
  --border: #2a2f38;
  --input: #2a2f38;
  --ring: #7686f0;

  --primary-strong: #93a0f4;
  --success: #34b56b;
  --success-rgb: 52, 181, 107;
  --success-tint: rgba(var(--success-rgb), 0.14);
  --warning-bg: #2c2210;
  --warning-border: #6b5320;
  --warning-text: #ecc06a;
  --schema-fg: #5eead4;
}
```

- [ ] **Step 2: Add the `@theme inline` mapping**

Add after the `.dark` block so Tailwind generates `bg-background`, `text-foreground`, `border-border`, `bg-primary`, `text-muted-foreground`, `bg-card`, `rounded-lg`, etc.:

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}
```

- [ ] **Step 3: Point body/base styles at the new tokens**

In the existing `body` rule, change `color: var(--text-primary)` → `color: var(--foreground)` and `background: var(--background)` (unchanged name). Update the base `a { color: var(--accent) }` rule to `color: var(--primary)` and its hover to `var(--primary-strong)`. Leave the `*`, `html`, `body`, `h1`, `h2`, `code` base rules in place (Task 15 trims what's redundant). The `.btnPrimary/.btnSecondary/.appHeader/.appNav/.appMain` classes stay until their consumers convert.

- [ ] **Step 4: Verify build + appearance**

Run: `npm run build`
Expected: PASS.
Then run the app (`npm run dev`), open `/ui`, and confirm the background/text/border colors still look like the current design in light mode. Toggle your OS to dark (or manually add `class="dark"` to `<html>` via devtools) and confirm dark values look right. Adjust any `--accent`/tint values that look off.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css
git commit -m "style: map existing palette onto shadcn CSS variables"
```

---

## Task 3: Wire next-themes provider (class-based dark mode)

**Files:**
- Create: `src/app/components/theme-provider.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces: `<ThemeProvider>` wrapping the app; `<html>` gets `.dark`/`.light` from `next-themes`.

- [ ] **Step 1: Create the provider**

```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
```

- [ ] **Step 2: Wrap the app in `src/app/layout.tsx`**

Add `suppressHydrationWarning` to `<html>` and wrap `{children}` in the body:

```tsx
import { ThemeProvider } from "./components/theme-provider";
// …
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
```

- [ ] **Step 3: Verify build + toggling**

Run: `npm run build`
Expected: PASS.
Run the app; in devtools confirm `<html>` gets `class="dark"` when OS is dark and `class="light"` when light, with no hydration warning in the console.

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx src/app/components/theme-provider.tsx
git commit -m "feat: add class-based dark mode via next-themes (system default)"
```

---

## Task 4: Theme toggle + convert the UI header/nav

**Files:**
- Create: `src/app/components/ThemeToggle.tsx`
- Modify: `src/app/ui/layout.tsx`
- Add (CLI): `src/app/components/ui/dropdown-menu.tsx`, `src/app/components/ui/button.tsx`

**Interfaces:**
- Consumes: `<Button>` and dropdown-menu primitives from shadcn.
- Produces: `<ThemeToggle />` rendered top-right in the UI header.

- [ ] **Step 1: Add the primitives the toggle needs**

```bash
npx shadcn@latest add button dropdown-menu
```
Expected: creates `src/app/components/ui/button.tsx` and `dropdown-menu.tsx`.

- [ ] **Step 2: Create `src/app/components/ThemeToggle.tsx`**

```tsx
"use client";

import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

export function ThemeToggle() {
  const { setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Toggle theme">
          <Sun className="h-4 w-4 scale-100 dark:scale-0" />
          <Moon className="absolute h-4 w-4 scale-0 dark:scale-100" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun className="mr-2 h-4 w-4" /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon className="mr-2 h-4 w-4" /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Monitor className="mr-2 h-4 w-4" /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2b: Tune the Button variants to the palette**

In `src/app/components/ui/button.tsx`, confirm the `default` variant uses `bg-primary text-primary-foreground` and `secondary` uses `bg-secondary` with a `border`. Adjust hover to `--primary-strong` if needed so it matches the old `.btnPrimary:hover`.

- [ ] **Step 3: Convert `src/app/ui/layout.tsx`**

Replace the `.appHeader`/`.appName`/`.appNav`/`.appMain` classes with Tailwind utilities and add the toggle at the far right:

```tsx
import Link from "next/link";
import { ThemeToggle } from "@/app/components/ThemeToggle";

export default function UiLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <header className="z-10 flex items-center gap-6 border-b border-border bg-card px-6 py-3">
        <Link href="/ui" className="text-base font-bold tracking-tight text-foreground hover:no-underline">
          Mock Server
        </Link>
        <nav className="flex gap-4 text-sm">
          <Link href="/ui" className="text-muted-foreground hover:text-foreground hover:no-underline">Profiles</Link>
          <Link href="/ui/global-mocks" className="text-muted-foreground hover:text-foreground hover:no-underline">Global mocks</Link>
          <Link href="/ui/catalog" className="text-muted-foreground hover:text-foreground hover:no-underline">Catalog</Link>
          <Link href="/ui/logs" className="text-muted-foreground hover:text-foreground hover:no-underline">Logs</Link>
          <Link href="/ui/environment" className="text-muted-foreground hover:text-foreground hover:no-underline">Environment</Link>
        </nav>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>
      <div className="mx-auto w-full max-w-[1280px] px-6 pt-7 pb-16">{children}</div>
    </>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npm run build && npm run lint`
Expected: PASS.
Run the app; confirm the header renders like before with a theme button top-right; clicking Light/Dark/System switches the theme immediately and persists on reload.

- [ ] **Step 5: Commit**

```bash
git add src/app/ui/layout.tsx src/app/components/ThemeToggle.tsx src/app/components/ui/
git commit -m "feat: add header theme toggle; convert UI header to Tailwind"
```

---

## Task 5: Add base shadcn form primitives

**Files:**
- Add (CLI): `src/app/components/ui/{input,label,card,select,radio-group,checkbox,switch}.tsx`

**Interfaces:**
- Produces: `Input`, `Label`, `Card` (+ parts), `Select`, `RadioGroup`/`RadioGroupItem`, `Checkbox`, `Switch` under `@/app/components/ui/*`.

- [ ] **Step 1: Generate primitives**

```bash
npx shadcn@latest add input label card select radio-group checkbox switch
```

- [ ] **Step 2: Tune Input to match the current field look**

In `src/app/components/ui/input.tsx`, confirm border is `border-input`, focus ring uses `--ring` (matching the old `box-shadow: 0 0 0 3px var(--accent-tint)`), and radius is `rounded-md`. Adjust padding to `px-2.5 py-2` if it differs from the old `8px 10px`.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS (primitives compile; not yet consumed).

- [ ] **Step 4: Commit**

```bash
git add src/app/components/ui/
git commit -m "feat: add base shadcn form primitives"
```

---

## Task 6: Badge primitive — replace MethodBadge & SchemaBadge

**Files:**
- Create: `src/app/components/ui/badge.tsx` (via CLI, then add variants)
- Modify: `src/app/components/MethodBadge.tsx`, `src/app/components/SchemaBadge.tsx`
- Delete: `src/app/components/MethodBadge.module.css`, `src/app/components/SchemaBadge.module.css`

**Interfaces:**
- Produces: `<Badge variant="method" | "schema" | …>`; `MethodBadge`/`SchemaBadge` keep their current props (`{ method: string }` / no props) so call sites don't change.

- [ ] **Step 1: Generate the badge primitive**

```bash
npx shadcn@latest add badge
```

- [ ] **Step 2: Add `method` and `schema` variants**

In `src/app/components/ui/badge.tsx`, extend the `cva` variants to reproduce the current styles:

```ts
// method: mono, uppercase, outlined, muted text (from MethodBadge.module.css)
method:
  "font-mono text-[0.72rem] font-bold tracking-[0.04em] text-muted-foreground bg-transparent border border-foreground/20 rounded-md px-2 py-[3px]",
// schema: teal, tinted bg (from SchemaBadge.module.css)
schema:
  "font-mono text-[0.72rem] font-bold tracking-[0.02em] rounded-md px-2 py-[3px] whitespace-nowrap border gap-1.5 text-[var(--schema-fg)] bg-[color-mix(in_srgb,var(--schema-fg)_12%,transparent)] border-[color-mix(in_srgb,var(--schema-fg)_28%,transparent)]",
```

- [ ] **Step 3: Rewrite `MethodBadge.tsx`**

```tsx
import { Badge } from "@/app/components/ui/badge";

export function MethodBadge({ method }: { method: string }) {
  return <Badge variant="method">{method.toUpperCase()}</Badge>;
}
```

- [ ] **Step 4: Rewrite `SchemaBadge.tsx`**

Keep the inline shield SVG and `title`, wrapping in the badge:

```tsx
import { Badge } from "@/app/components/ui/badge";

export function SchemaBadge() {
  return (
    <Badge
      variant="schema"
      title="Request and response bodies are validated against a schema"
    >
      <svg className="h-[13px] w-[13px] shrink-0" viewBox="0 0 16 16" aria-hidden="true"
        fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 1.5 2.5 3.5v4c0 3 2.2 5.3 5.5 6.5 3.3-1.2 5.5-3.5 5.5-6.5v-4L8 1.5Z" />
        <path d="m5.8 7.8 1.6 1.6 3-3.2" />
      </svg>
      Schema verified
    </Badge>
  );
}
```

- [ ] **Step 5: Delete the CSS Modules**

```bash
git rm src/app/components/MethodBadge.module.css src/app/components/SchemaBadge.module.css
```

- [ ] **Step 6: Verify**

Run: `npm run build && npm run lint`
Expected: PASS.
Run the app; open `/ui/catalog` and an endpoint page; confirm method badges and the schema badge look identical to before in light and dark.

- [ ] **Step 7: Commit**

```bash
git add src/app/components/ui/badge.tsx src/app/components/MethodBadge.tsx src/app/components/SchemaBadge.tsx
git commit -m "refactor: reimplement Method/Schema badges on shadcn Badge"
```

---

## Task 7: Alert primitive — replace the warning Alert

**Files:**
- Create: `src/app/components/ui/alert.tsx` (via CLI, add `warning` variant)
- Modify: `src/app/components/Alert.tsx`
- Delete: `src/app/components/Alert.module.css`

**Interfaces:**
- Produces: `<Alert>` keeping its current signature `{ children: React.ReactNode }` and `role="alert"`, styled as the current amber warning box.

- [ ] **Step 1: Generate the alert primitive**

```bash
npx shadcn@latest add alert
```

- [ ] **Step 2: Rewrite `src/app/components/Alert.tsx`**

Preserve the public component (call sites pass children only). Render the current warning style with tokens:

```tsx
export function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border px-3 py-2.5 text-[0.9rem] leading-[1.45] border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)]"
    >
      {children}
    </div>
  );
}
```

(The generated `ui/alert.tsx` is available for future variants; the app's `Alert` wrapper keeps its simple API.)

- [ ] **Step 3: Delete the CSS Module**

```bash
git rm src/app/components/Alert.module.css
```

- [ ] **Step 4: Verify**

Run: `npm run build && npm run lint`
Expected: PASS.
Run the app; find a page that renders an Alert (e.g. a profile with a stale-selection warning) and confirm the amber box looks the same in light and dark.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/Alert.tsx src/app/components/ui/alert.tsx
git commit -m "refactor: reimplement Alert on Tailwind tokens"
```

---

## Task 8: Convert ScenarioPicker to shadcn RadioGroup

**Files:**
- Modify: `src/app/components/ScenarioPicker.tsx`
- Delete: `src/app/components/ScenarioPicker.module.css`

**Interfaces:**
- Consumes: `RadioGroup`/`RadioGroupItem` from Task 5.
- Produces: `<ScenarioPicker>` with the **same props** (`endpointName`, `fieldName?`, `scenarios`, `selected`, `unavailable?`) and the same radio-card visual states: default, non-default (amber), `real` (red), checked (green for default), unavailable (dimmed + line-through), keyboard focus ring. Must still submit as a radio input named `fieldName ?? scenario:${endpointName}` (server actions read this).

- [ ] **Step 1: Read the current component + module CSS**

Re-read `src/app/components/ScenarioPicker.tsx` and `ScenarioPicker.module.css` (captured in the design) to preserve every state.

- [ ] **Step 2: Rewrite as radio-cards with Tailwind**

Reproduce the label-wraps-radio card. Keep it a native radio (`RadioGroupItem` renders an input) so form submission is unchanged, or keep the native `<input type="radio">` inside a styled `<label>` (simplest, preserves form semantics exactly). Recommended — keep native input, restyle with utilities and `has-[]` variants:

```tsx
const cardBase =
  "flex items-center gap-2.5 max-w-full cursor-pointer select-none rounded-lg border border-border bg-card px-3.5 py-2 pl-2.5 transition-colors hover:border-muted-foreground " +
  "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-offset-2 " +
  "has-[:checked]:border-[var(--success)] has-[:checked]:bg-[var(--success-tint)]";
const cardNonDefault =
  "has-[:checked]:border-[var(--warning-border)] has-[:checked]:bg-[var(--warning-bg)]";
const cardReal =
  "has-[:checked]:border-[#d92d20] has-[:checked]:bg-[rgba(217,45,32,0.12)]";
const dotBase =
  "flex-none h-4 w-4 rounded-full border-2 border-border bg-card transition-colors";
```

Render each option: a `<label>` with `cardBase` (+ `cardNonDefault` for non-`default`/non-`real`, + `cardReal` for `real`, + `opacity-55 cursor-not-allowed` when unavailable); inside, the hidden native `<input type="radio">` (`absolute opacity-0 pointer-events-none`), the dot span (checked color driven by the label's `has-[:checked]` via peer/group or a sibling selector — use `peer` on the input and `peer-checked:` on the dot for the dot fill/border color), and the label text span (`text-[0.9rem] font-medium [overflow-wrap:anywhere]`, `line-through` when unavailable). Keep `name`, `value`, `defaultChecked`, `disabled` exactly as today.

- [ ] **Step 3: Delete the CSS Module**

```bash
git rm src/app/components/ScenarioPicker.module.css
```

- [ ] **Step 4: Verify**

Run: `npm run build && npm run lint`
Expected: PASS.
Run the app; open a profile page with scenario pickers. Confirm: default selected = green card + filled dot; a non-default scenario = amber; `real` = red; unavailable = dimmed with strikethrough and disabled; Tab focus shows the ring. Change a selection and submit the form — the server action must still apply it (behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/app/components/ScenarioPicker.tsx
git commit -m "refactor: reimplement ScenarioPicker on Tailwind radio-cards"
```

---

## Task 9: Convert the profiles home page

**Files:**
- Modify: `src/app/ui/page.tsx`
- Delete: `src/app/ui/home.module.css`

Follow the **Per-page procedure** and **Conversion mapping** above.

- [ ] **Step 1** Read `src/app/ui/page.tsx` + `home.module.css`.
- [ ] **Step 2** Rewrite markup with Tailwind utilities + `Card`/`Button`; preserve all links/data and the profiles-list structure.
- [ ] **Step 3** `git rm src/app/ui/home.module.css` and remove its import.
- [ ] **Step 4** `npm run build && npm run lint` → PASS; load `/ui`, confirm the profiles list matches the old look in light + dark; create/open a profile link still navigates.
- [ ] **Step 5** Commit: `git commit -am "refactor: convert profiles home page to Tailwind"`

---

## Task 10: Convert the profile detail / new-profile pages

**Files:**
- Modify: `src/app/ui/profiles/ProfileForm.tsx`, `ScenarioConfig.tsx`, `ProfilePageHeader.tsx`, `RecentActivity.tsx`, `StaleSelectionGuard.tsx`, `CopyProfileIdButton.tsx`, `[profileId]/page.tsx`, `new/page.tsx`
- Delete: `src/app/ui/profiles/ProfileForm.module.css`, `ScenarioConfig.module.css`, `profilePage.module.css`

Follow the **Per-page procedure**. Use `Input`/`Label`/`Button`/`Card` primitives; `ScenarioConfig` uses the already-converted `ScenarioPicker`. Do not change any `actions.ts`.

- [ ] **Step 1** Read all listed `.tsx` + the three `.module.css`.
- [ ] **Step 2** Convert each component's markup to Tailwind + primitives, preserving form field names, `defaultValue`s, copy-button behavior, guard logic, and recent-activity rendering.
- [ ] **Step 3** `git rm` the three module CSS files and remove imports.
- [ ] **Step 4** `npm run build && npm run lint` → PASS; open a profile and `/ui/profiles/new`, confirm layout matches in light + dark, then submit the form and confirm the profile updates (server action works), and the copy-ID button copies.
- [ ] **Step 5** Commit: `git commit -am "refactor: convert profile pages to Tailwind"`

---

## Task 11: Convert the global-mocks page

**Files:**
- Modify: `src/app/ui/global-mocks/GlobalMocksForm.tsx`, `page.tsx`
- Delete: any `global-mocks/*.module.css` present

Follow the **Per-page procedure**; use `Input`/`Label`/`Button`/`Switch`/`Card` as the current form requires. Do not change `actions.ts`.

- [ ] **Step 1** Read the form + page (+ its module CSS if any).
- [ ] **Step 2** Convert markup, preserving field names and the global-mock toggle behavior.
- [ ] **Step 3** Delete the module CSS (if any) and remove imports.
- [ ] **Step 4** `npm run build && npm run lint` → PASS; open `/ui/global-mocks`, confirm look in light + dark, toggle/submit a global mock and confirm it applies.
- [ ] **Step 5** Commit: `git commit -am "refactor: convert global-mocks page to Tailwind"`

---

## Task 12: Convert the catalog pages

**Files:**
- Modify: `src/app/ui/catalog/CatalogView.tsx`, `EndpointView.tsx`, `EndpointScenarios.tsx`, `CopyCurlButton.tsx`, `page.tsx`, `[system]/[endpoint]/page.tsx`
- Delete: `src/app/ui/catalog/catalog.module.css`, `endpoint.module.css`

Follow the **Per-page procedure**; uses `MethodBadge`/`SchemaBadge` (done), `Card`, `Button`. `scenario-view.ts` is logic — leave it. Do not change API routes.

- [ ] **Step 1** Read all listed `.tsx` + both module CSS.
- [ ] **Step 2** Convert the catalog tree and endpoint views to Tailwind + primitives; preserve the copy-curl behavior and scenario listing.
- [ ] **Step 3** `git rm` `catalog.module.css` and `endpoint.module.css`, remove imports.
- [ ] **Step 4** `npm run build && npm run lint` → PASS; open `/ui/catalog` and an endpoint page, confirm the tree/badges/copy-curl match in light + dark and copy works.
- [ ] **Step 5** Commit: `git commit -am "refactor: convert catalog pages to Tailwind"`

---

## Task 13: Convert the logs page

**Files:**
- Modify: `src/app/ui/logs/LogsView.tsx`, `LogRow.tsx`, `page.tsx`
- Delete: `src/app/ui/logs/logs.module.css`

Follow the **Per-page procedure**. `list-state.ts`, `types.ts`, `actions.ts` are logic — leave them. `LogsView` is a client component (polling) — keep it a client component.

- [ ] **Step 1** Read `LogsView.tsx`, `LogRow.tsx`, `page.tsx`, `logs.module.css`.
- [ ] **Step 2** Convert the log list + row to Tailwind + `MethodBadge`/`Badge`, preserving expand/detail behavior and any polling/refresh UI.
- [ ] **Step 3** `git rm src/app/ui/logs/logs.module.css`, remove imports.
- [ ] **Step 4** `npm run build && npm run lint` → PASS; open `/ui/logs`, make a mock request against the server, confirm the log appears and renders correctly in light + dark and row expansion works.
- [ ] **Step 5** Commit: `git commit -am "refactor: convert logs page to Tailwind"`

---

## Task 14: Convert the environment page

**Files:**
- Modify: `src/app/ui/environment/EnvironmentView.tsx`, `page.tsx`
- Delete: `src/app/ui/environment/environment.module.css`

Follow the **Per-page procedure**.

- [ ] **Step 1** Read `EnvironmentView.tsx`, `page.tsx`, `environment.module.css`.
- [ ] **Step 2** Convert to Tailwind + `Card`; preserve the env-var listing.
- [ ] **Step 3** `git rm src/app/ui/environment/environment.module.css`, remove imports.
- [ ] **Step 4** `npm run build && npm run lint` → PASS; open `/ui/environment`, confirm it matches in light + dark.
- [ ] **Step 5** Commit: `git commit -am "refactor: convert environment page to Tailwind"`

---

## Task 15: Final cleanup and full verification

**Files:**
- Modify: `src/app/globals.css` (remove now-unused base classes)
- Also check: `src/app/ui/[...notFound]/page.tsx` and any stray CSS-Module import

**Interfaces:** none new.

- [ ] **Step 1: Confirm no CSS Modules remain**

Run: `find src -name "*.module.css"`
Expected: **no output**. If any remain, convert their consumer (same per-page procedure) before continuing.

- [ ] **Step 2: Confirm no dangling imports**

Run: `grep -rn "module.css" src`
Expected: no results.

- [ ] **Step 3: Trim redundant globals**

In `src/app/globals.css`, remove the now-unused `.btnPrimary`, `.btnSecondary`, `.appHeader`, `.appName`, `.appNav`, `.appMain`, and the base `input`/`button` style blocks (Tailwind + primitives now own these). Keep `@import "tailwindcss"`, `tw-animate-css`, `@custom-variant`, the token blocks, `@theme inline`, and minimal base (`*` box-sizing reset if still needed, `body` font/colors, `a`, `code`, `h1`/`h2`). Verify nothing visually regresses.

- [ ] **Step 4: Check the notFound page**

Ensure `src/app/ui/[...notFound]/page.tsx` uses no `.module.css` and renders with Tailwind.

- [ ] **Step 5: Full verification**

```bash
npm run build
npm run lint
npm run test
```
Expected: all PASS.
Then run the app and click through every page (`/ui`, a profile, `/ui/profiles/new`, `/ui/global-mocks`, `/ui/catalog` + an endpoint, `/ui/logs`, `/ui/environment`) in **both light and dark**, plus toggle light/dark/system. Confirm no visual regressions and all forms/pickers/copy buttons work.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove legacy CSS Modules and unused global styles"
```

---

## Notes

- **Docs guide:** No `docs/site` update required — this is a UI reimplementation plus a theme toggle; it touches none of the documented mock-server functionality (per AGENTS.md). If, during conversion, any documented `/ui` behavior actually changes (it shouldn't), pause and raise it per the AGENTS.md sync rule before editing the guide.
- **shadcn CLI output may vary slightly** by version; if a generated file differs from the snippets here, keep the palette mapping and variant intent — tune classes to reproduce the current look, verifying visually in both themes.
