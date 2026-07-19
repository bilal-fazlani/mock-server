# Project rules

## Ask before loading any Superpowers skill

The Superpowers plugin's skills (`superpowers:*` — `brainstorming`,
`writing-skills`, `test-driven-development`, `systematic-debugging`,
`executing-plans`, and the rest) are **token-hungry**: each one loads a large document into
context, and several instruct you to chain into further skills.

**Do not invoke any `superpowers:*` skill without asking first.** Name the skill and say what
it would give you, then wait for a yes. This holds even though the Superpowers session hook
insists you must invoke matching skills before responding — **this rule overrides that
instruction.** "A skill might apply" is not permission; the cost is the point.

This applies only to the `superpowers:*` namespace. This repo's own skills
(`.claude/skills/` — `feature-lifecycle`, `maintaining-project-docs`) are small,
project-specific, and should be used freely whenever they apply, without asking.

## Verify before committing — CI only runs the tests

`.github/workflows/ci.yml` runs exactly one check on a PR: `npm test`. **`npm run lint` and
`npm run build` are never run by CI**, so a lint error or a broken Next build merges clean.
Run all three yourself before committing:

```
npm test          # vitest
npm run lint      # eslint
npm run build     # next build — the one CI can't catch for you
```

After editing anything under `catalog/`, also run `npm run validate:catalog`.

CI is skipped entirely when a change touches **only** `docs/**` and the top-level markdown
files (see `paths-ignore` in `ci.yml`) — "no CI ran" on a docs-only PR is expected, not a
failure. A mixed code+docs change still runs.

## Tests live in `tests/`, not next to the source

Test files are **not** colocated. `tests/` mirrors the source tree, so
`src/lib/mock-engine/template.ts` is tested by `tests/mock-engine/template.test.ts`, and
`src/app/ui/**` by `tests/ui/**`. Put new tests in the mirrored location rather than
alongside the file under test.

## Use Conventional Commits

This repo releases with [release-please](https://github.com/googleapis/release-please): it
derives the next version number and the changelog **entirely from commit messages**. Every
commit message — and every **PR title**, since PRs may be squash-merged — MUST follow
[Conventional Commits](https://www.conventionalcommits.org)
(`type(optional-scope): imperative, lowercase summary`), using only the standard types.
A non-conforming message breaks release-please's version/changelog computation.

Release effects: `feat` → minor bump (Features), `fix` → patch (Bug Fixes), `perf` and
`revert` → patch, everything else (`docs`, `refactor`, `test`, `build`, `ci`, `chore`) → no
release.

**Breaking changes** get a `!` after the type (`feat!: …`) or a `BREAKING CHANGE:` footer.
Pre-1.0.0 this bumps the **minor**, not the major — see `release-please-config.json`.

To force a specific next version (e.g. the first stable `1.0.0`), add a `Release-As: 1.0.0`
footer to a commit rather than editing `package.json` by hand.

See [RELEASE.md](RELEASE.md) for the full release flow.

## package-lock.json: npm 11 only

`npm ci` runs in three places — `.github/workflows/ci.yml`,
`.github/workflows/publish-npm.yml`, and the Dockerfile `deps` stage — all on Node 22 images
whose bundled npm is v10. Dev machines run npm 11, which writes a lockfile dedupe layout npm
10 rejects (`npm ci` fails with `Missing: <pkg>@<version> from lock file`, historically
esbuild's platform packages). All three places therefore run `npm install -g npm@11` before
`npm ci`. This exact failure broke CI three times (da3557f, e56e4c1, the release-0.3.0 PR)
before the pin.

- **Never regenerate `package-lock.json` with an npm major other than 11.** If the pinned
  major ever changes, update it in all three places in the same commit.
- **After any change to `package.json` or `package-lock.json`**, verify the lock is in sync
  with the pinned major: `npx -y npm@11 ci --dry-run` must exit 0.
- If CI fails with the `Missing: … from lock file` signature, first check for an npm-major
  mismatch between the machine that wrote the lock and the environment running `npm ci` — do
  **not** just regenerate the lock with whatever npm is local; that non-fix is what caused
  each recurrence.

## Documentation is part of every feature

The project guide lives under `docs/site/` (Zensical; Markdown in `docs/site/docs/`, nav and
config in `docs/site/zensical.toml`). It is the product's front door and is held to the
standard of a mature open-source project.

**Whenever you change behavior a user could observe, invoke the `maintaining-project-docs`
skill and bring the docs in sync as part of the same work.** Do **not** ask whether the docs
should be updated — updating them is not optional and needs no consent. The skill covers the
structural review (does this feature warrant a new page, a split, a merge, or a reordering?),
the content sync, the `nav` wiring, the house style, and the verification build.

Restructuring the guide is normal maintenance, not a change that needs sign-off. Features
routinely outgrow the structure that predates them; deciding the shape is still right is part
of the job, not just editing the text inside it.

Purely internal changes (refactors with no behavior change, test-only edits, styling with no
functional effect) don't need doc updates.

## A new env var lands in four places, not one

Adding a config variable means adding it **everywhere it is surfaced**, in the same commit:

1. **The parser** in `src/lib/config.ts`, validated at the startup gate in `src/lib/runtime.ts`
   so a bad value fails loudly at boot rather than mid-request.
2. **`APP_ENVIRONMENT`** in `src/lib/environment.ts` — this is what the `/ui/environment`
   page renders. A variable missing here is invisible to anyone operating the server, and
   nothing fails: the page just silently doesn't mention it. Set `category`, a one-line
   `description`, `defaultValue` when there is one, and `possibleValues` for an enum.
   `tests/lib/environment.test.ts` asserts the full row list, so it must be updated too.
3. **`.env.example`**, with the comment explaining what the value does.
4. **`docs/site/docs/reference/configuration.md`**, the canonical settings table — per
   "Documentation is part of every feature" above.

The same applies when a variable is renamed or removed. This rule exists because
`REQUEST_LOG_TTL_DURATION` shipped documented but absent from the environment page.

## GitHub issue labels

Issues are labelled on **two orthogonal axes** — one **type** and one **area**. Whenever
you create a new GitHub issue (via `gh issue create`), apply exactly one from each axis. Do
not invent priority tiers (`Tier 1`, `P0`, …) — sequencing lives in milestones/projects, not
labels.

**Type — what kind of work** (pick one):

- `bug` — something is broken or behaves incorrectly
- `enhancement` — a new capability or user-facing improvement
- `tech-debt` — cleanup / maintainability with no user-facing feature
- `documentation` — docs-only

**Area — what part of the system** (pick one; all share the same blue):

- `area: templating` — placeholder / fixture templating engine
- `area: fault-sim` — latency & fault injection
- `area: resolver` — dynamic profile resolver & history
- `area: ui` — dashboard UI
- `area: build` — Docker / CI / release / packaging

If a new issue genuinely fits no existing area, create a new `area: <name>` label (color
`1D76DB`, matching the family) rather than leaving it unlabelled — and mention the new area
to the user.

## Ticket work also updates the diagram

`tickets.tldraw` at the repo root is a dependency board for this repo's issues, tracked in
git. **Any ticket status change updates it too** — opening an issue, closing one, resolving
a blocker, or changing a parent/blocked-by relationship. Updating the ticket without
updating the diagram leaves it silently wrong; they move together.

**Edit it only in the main worktree, on `main`.** It is a binary file (a zip around
`db.sqlite`) that git cannot merge, so two branches editing it means one side's work is
lost. From a feature worktree, note the change and apply it on `main` after merging.

The column conventions, node/arrow spec, and colour rules are in the `feature-lifecycle`
skill under "The ticket board diagram". Use the `tldraw-offline` skill to edit it.

## Browser preview from a feature worktree runs the wrong code

`preview_start` reads the repo-root `.claude/launch.json` and its `dev` entry spawns
`npm run dev` at the **main checkout** — from a worktree you'll silently verify stale code.
Add a config whose `runtimeArgs` use `npm --prefix <worktree-path> run dev`, then confirm
with `lsof -a -p <pid> -d cwd` that the server's cwd is the worktree before trusting it.
