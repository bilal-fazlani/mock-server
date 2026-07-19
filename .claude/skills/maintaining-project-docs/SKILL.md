---
name: maintaining-project-docs
description: Use when any feature, flag, env var, route, config field, or user-visible behavior in this repo has been added, changed, or removed — including right after finishing feature work, before opening a PR, and when a change makes the existing documentation structure or navigation no longer fit.
---

# Maintaining the project documentation

The guide under `docs/site/` is the product's front door. It is held to the standard of a
mature open-source project: a reader who has never seen this repo should be able to learn
what it is, install it, build their first mock, and then find precise reference for every
field and route — without reading the source.

**Documentation is part of the feature, not a follow-up to it.** A feature is not done
when the code works; it is done when someone who didn't write it can use it from the docs.

## The rule

After any change to user-visible behavior, **update the documentation in the same unit of
work.** Do not ask whether the docs should be updated — update them. The only question
worth raising with the user is a genuine *editorial* one (see "When to surface something").

Applies to: new or changed catalog fields, scenario/fixture/resolver behavior, env vars,
CLI flags, `/ui/api/*` routes, UI capabilities, install or packaging changes, and anything
that changes what a user writes or observes. Does not apply to: internal refactors with no
behavior change, test-only edits, or styling with no functional effect.

## Step 1 — Structural review (do this BEFORE editing any page)

Content edits are the easy half. First decide whether the *shape* still fits, because a
feature can outgrow the structure that predates it. Ask, in order:

1. **Where would a reader look for this?** Not "where is it easiest to append." If your
   answer is "they'd never find it," that is a structure problem, not a wording problem.
2. **Does this belong on an existing page, or does it need its own?** A feature earns its
   own page when it has its own vocabulary, its own config surface, and a reader could
   want it without wanting its neighbours. Bolting a third concept onto a page named for
   one is how a guide rots.
3. **Did this change make an existing split wrong?** Two pages that now say the same thing
   should merge; one page that now covers two unrelated audiences should split.
4. **Is the section ordering still a sensible learning path?** New concepts sometimes need
   to come *earlier* than where they were appended.
5. **Does the top-level shape still hold?** The guide is organised by what the reader is
   doing, and new content must land in the right mode:

   | Section | Mode | Holds |
   | --- | --- | --- |
   | `get-started/` | Tutorial | Installing, and one guided path to a first working mock |
   | `building/` | How-to (authoring) | Writing the `catalog/` — fields, files, what you author |
   | `driving/` | How-to (operating) | Controlling a *running* server — API, UI, dev & CI |
   | `reference/` | Reference | Exhaustive lookup — config, lifecycle, gotchas |

   Content in the wrong mode is a structural bug even when every sentence is accurate: a
   tutorial that turns into a field dump, or a reference page that tells a story, both fail
   their reader.

**Restructuring is in scope and does not need permission.** Creating a page, splitting one,
merging two, or reordering the nav is normal maintenance. Move content rather than
duplicating it, and leave the old location linking to the new one if anything pointed there.

## Step 2 — Sync the content

Write from the code, never from memory or from the diff summary — open the source and
confirm actual defaults, field names, error text, and edge cases. Then:

- Update every page the change touches, not just the most obvious one. Grep the guide for
  the field names, env vars, routes, and filenames you touched: `rg -n 'FAULTS_ENABLED' docs/site/docs/`
- Update the **`README.md` feature list** when a headline capability lands. It is a
  separate surface and it goes stale silently — code-backed resolvers shipped a 285-line
  guide page and were never added to the README.
- Update `docs/site/docs/index.md` when the mental model, the concepts table, or the
  catalog-tree sketch changes. It is the page most readers see first and the easiest to
  forget.
- Keep cross-links working in both directions: the new content should link to related
  pages, and related pages should link to it.

### House style (match the existing pages)

- **Tables for fields**, with `Field | Required | Purpose & rules` — not prose paragraphs.
- **Lead with the rule, then the exception.** State what a thing does, then its edge cases.
- Concrete, runnable examples with real values (`customer-123`, `/hello/world`) — never
  `foo`/`bar` placeholders.
- Fenced blocks tagged with a language (`json`, `bash`, `text`); annotated tree sketches
  use `text` with trailing `#` comments.
- `!!! note` / `!!! warning` admonitions for things that bite, sparingly.
- Cross-links are relative `.md` paths (`building/fixtures.md#placeholders`), because
  `--strict` validates them.
- Second person, present tense, active voice. No "simply", no "just", no future tense for
  behavior that exists now.

## Step 3 — Wire up navigation (the silent failure)

**A new page must be added to the `nav` array in `docs/site/zensical.toml`.** This is the
one mistake the build will not catch for you:

- A broken internal link → `--strict` **fails the build**. Good.
- A page missing from `nav` → the build reports **"No issues found"**. The page exists at
  its URL, is absent from the sidebar, and nothing tells you. Verified behavior.

So after adding a page, confirm it by eye in the `nav` block. Nav labels are reader-facing
prose ("Code-backed resolvers"), not filenames.

## Step 4 — Verify

From `docs/site/`:

```bash
uvx zensical==0.0.50 build -f zensical.toml --clean --strict
```

Must print `No issues found`. Takes ~1.5s. The version is pinned to match `Pipfile` —
Zensical is alpha and unpinned builds may behave differently. (If a `.venv` exists,
`.venv/bin/zensical build …` works too; `uvx` needs no setup and is the reliable default.)

Then re-read your own diff as a stranger would. If a paragraph only makes sense to someone
who saw the code change, rewrite it.

Note that CI never builds the docs — `ci.yml` skips runs on docs-only changes. This local
build is the *only* gate. A broken guide will merge clean.

## When to surface something

Do not ask for permission to update docs. Do raise these, briefly, after you've done the work:

- A restructure that **moves or renames existing pages** — say what moved where, since URLs change.
- A gap you found but did not fill (an area already undocumented before your change).
- A genuine editorial fork where both options are defensible and you had to pick.

## Red flags — you are not done

- "The code change is small, the docs can follow." Same unit of work.
- "I'll append it to the nearest page" — without having asked whether it belongs there.
- "I updated the page I touched" — but never grepped for the other pages naming that field.
- "The build passed" — but a new page never entered `nav`.
- "I described what the code does" — from the diff, without opening the source.
- Restructuring felt too bold, so content got bolted on instead. Bolting on is how the
  guide rots; restructuring is the maintenance.
