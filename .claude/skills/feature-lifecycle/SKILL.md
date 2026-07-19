---
name: feature-lifecycle
description: Use when starting feature work in this repo that we are committed to building (not merely exploring an idea) — tracks it as a GitHub issue on project board #3 (owner bilal-fazlani) and drives it across the Backlog → Refining → Ready → In Progress → In Review → Done lanes as work proceeds. Moves the card to Refining while shaping the feature, populates the card and moves it to Ready once the spec/plan (or, for small features, the answered questions + details + lightweight checklist) are complete, confirms before creating the ticket, updates a task checklist in real time, logs deviations as comments, and closes out only on the user's approval.
---

# Feature lifecycle on the GitHub Project board

Track committed feature work as a GitHub issue and move it across the board
(`bilal-fazlani/projects/3`) as the work progresses. Lean on the board's automations;
do not fight them. See `reference.md` for the exact `gh` commands for lane moves,
checklist edits, and ID resolution.

## When this applies

Feature work we have decided to do — a new capability, a non-trivial change. **Not**
for pure exploration, quick questions, or throwaway spikes. If it's unclear whether
we're committed, ask before creating anything.

## Prerequisite (check once per session, before the first board command)

`gh` needs project scope. If any `gh project ...` command fails with a missing-scope
error, stop and tell the user to run:

```
gh auth refresh -s project,read:project
```

Do **not** run this yourself — it is an auth change the user performs.

## Board facts

- Project number `3`, owner `bilal-fazlani`.
- Lanes, in order (exact GitHub casing): `Backlog` → `Refining` → `Ready` →
  `In progress` → `In review` → `Done`. `reference.md` matches option names
  case-insensitively.
- **Automations already handle:** issue created → added to board + set `Backlog`;
  issue closed ⇄ status `Done` (bidirectional). So: never manually add-to-project or
  set Backlog, and to finish just **close the issue** (Done follows automatically).
- **`Refining` and `Ready` are manual moves** (no automation) — the procedure below
  drives them: into `Refining` when shaping starts, into `Ready` once shaping is done
  and the card is populated.

## The procedure

Create one todo per phase and work them in order. Each transition has an observable
trigger — do not skip ahead.

### 0. Survey the board — trigger: before opening a new ticket, or before designing an issue we're picking up

Before designing anything, get the lay of the open issues so this work moves *with*
the backlog, not against it. This phase runs at **both** entry points — a brand-new
idea and picking up an existing issue.

1. **List them:** `gh issue list --state open` — scan titles, labels, and existing
   relationships. (`gh issue view N` shows an issue's `parent` / `sub-issues` /
   `blocked-by` / `blocking`.)
2. **Read the related ones:** open the body of any issue sharing this work's `area:`
   label, plus any the titles flag as obviously related. No need to read every issue —
   same-area plus obviously-related is enough.
3. **Check two things** against what you're about to design:
   - **Conflict** — does another open issue want the same surface to behave in an
     opposite or incompatible way?
   - **Direction** — does another issue describe a future step this design should leave
     room for? Design so the two **compose (same direction)**, never so this change
     blocks or contradicts the other.
4. **On a contradiction, stop and confirm with the user** before designing around it —
   name the specific issue and the tension. Mere alignment (no contradiction) needs no
   confirmation; just fold it into the design.
5. **Wire up any relationships** the survey reveals (parent/sub-issue, blocked-by,
   blocking) — see "Issue relationships" below. For a new idea, if the survey shows it
   is already tracked, extend that issue instead of opening a duplicate.

### 1. Open the ticket — trigger: we've confirmed we're doing the work

1. **Confirm first:** ask *"Shall I open a ticket for this?"* Proceed only on yes.
2. **Ask the per-feature question (fresh every time, no default):**
   *"Issue-only, or issue + a linked `docs/superpowers/specs/` design doc?"*
3. Create the issue with an imperative, lowercase-ish title and a brief body, applying
   **exactly one type label and one area label** — the taxonomy lives in the "GitHub issue
   labels" section of `AGENTS.md`; read it there rather than assuming the label names:
   `gh issue create --label enhancement --label "area: ui" --title "..." --body "..."`
   If the phase-0 survey surfaced a parent or a dependency, set it **at creation**:
   add `--parent P`, `--blocked-by B`, and/or `--blocking X` (see "Issue relationships").
4. **Record the issue number `#N`** — you'll reference it for the rest of the session.

The board auto-adds it and sets `Backlog`. Do nothing else here.

### 2. Refine — trigger: we begin giving shape to the feature in dialogue

The moment active shaping starts — refining the feature with the user in conversation —
move the card to **Refining** (see `reference.md` → "Move a card"). This fires for
**both** entry points: a new-idea ticket just opened in phase 1, and an existing
`Backlog` ticket picked up in phase 0. Only pull a `Backlog` card into `Refining`; never
drag a card already at `Ready` or beyond backward.

The card lives in **Refining** for the whole shaping conversation. While it sits here:

- **Capture detail** into the issue body (`gh issue edit N --body-file -`).
- If the user chose *issue + spec*, write/link the `docs/superpowers/specs/*.md` design
  doc and keep the issue body as summary + link.
- **Large features:** author the implementation **plan** (spec + plan both land here).
- **Small features (no spec/plan):** **answer every open question** raised while shaping.

The card stays in **Refining** until the phase-3 gate is met — do not advance early.

### 3. Ready — trigger: refinement is complete and the card is populated

Advance only when shaping has actually finished. Two paths:

- **Large feature (spec + plan):** details captured **and** the spec is ready
  (`docs/superpowers/specs/…`) **and** the plan is ready.
- **Small feature (no spec/plan):** every open question answered **and** details written
  to the body **and** a lightweight `- [ ]` checklist added.

**Before moving, populate the card** — update the issue body (`gh issue edit N --body-file -`)
so it carries, in this order:

1. **Major decisions** taken during refinement.
2. A short **summary of what came out of the refinement discussion**.
3. **Spec / plan links** — large path only; omit when none exist.
4. The **task checklist**:

   ```
   - [ ] first task
   - [ ] second task
   ```

Then move the card to **Ready** (see `reference.md` → "Move a card").

### 4. Start work — trigger: we begin implementing

Move the card to **In Progress**. Branching is not mandated — direct on main, a branch,
or a worktree, whatever fits.

### 5. Progress — trigger: each task completes

For every completed checklist item:
- **Check its box** in the issue body (`reference.md` → "Check a checklist item").
- **Post a short progress comment:** `gh issue comment N --body "..."`.
- Commit with a Conventional-Commits message (format per `AGENTS.md`) plus a
  **`Refs #N`** footer. See the `Refs #N` rule below.

Card stays in **In Progress**.

### 6. Deviation / failure / new scope — trigger: reality diverges from the plan

Post a comment on the issue explaining what changed and why
(`gh issue comment N`). If scope grew, add new `- [ ]` items to the checklist.
Card stays in **In Progress**.

### 7. Finish — trigger: the work is complete

First run the pre-commit checks from `AGENTS.md` → "Verify before committing" (`npm test`,
`npm run lint`, `npm run build`, plus `npm run validate:catalog` if `catalog/` changed).
CI runs only `npm test`, so a lint error or a broken build reaches review unless you catch
it here. Do not post the summary comment until they pass.

Then, if the feature changed anything a user can observe, **invoke the
`maintaining-project-docs` skill and sync the guide** — including deciding whether the
feature warrants a structural change, not just edited prose. Docs ship with the feature; do
not defer them to a follow-up issue and do not ask whether to do it. The summary comment
should state which pages changed.

If the work touched the **UI** (anything the dev server renders under `/ui/`), verify it
visually first: drive the preview, capture a screenshot, and show it to the user
**in-session** as proof. The screenshot stays in the session — do **not** attach or embed
it in the issue (`gh` can't cleanly upload images anyway); the summary comment may note in
text that the UI was verified visually.

Then post a **summary comment** describing what shipped, and move the card to
**In Review**. Hand back to the user for review — do not proceed to close.

### 8. Review outcome

- **8a. Approved** — trigger: the user says merge / push / merge-PR.
  Perform the git action they asked for, then **close the issue**:
  `gh issue close N`. The board auto-sets `Done`. (Do not also edit the Status field —
  closing is enough.)
- **8b. Changes requested** — trigger: the user asks for changes during review.
  Post a comment capturing the requested changes, move the card back to
  **In Progress**, and return to phase 5.

## The `Refs #N` rule (do not violate)

Reference the issue from commits and PR bodies with a **non-closing** footer only:

```
Refs #N
```

**Never** use `Closes` / `Fixes` / `Resolves`, and **never** manually link the PR via
GitHub's Development sidebar. A closing keyword or sidebar link creates a *formal link*,
which triggers the board automations "PR linked → In Progress" and "PR merged → Done" —
those would drive the card to Done and close the issue, **bypassing In Review and the
user's approval**. A plain `Refs #N` mention is only a cross-reference and creates no
formal link, so the review gate stays with the user. Work that has no PR (direct on
main, or a local worktree) links to the issue via comments instead.

## Issue relationships

GitHub tracks four native relationships. Use them so the backlog's structure is
explicit rather than buried in issue prose — set them when creating an issue and
whenever the phase-0 survey or the design surfaces a new dependency. (`gh` ≥ 2.65
supports these flags directly; this repo's `gh` is 2.96.)

| Relationship | Meaning | At create (`gh issue create …`) | Later (`gh issue edit …`) |
| --- | --- | --- | --- |
| **parent / sub-issue** | this issue is part of a larger tracked issue | `--parent P` | `N --parent P` · `P --add-sub-issue N` |
| **blocked by** | this issue can't proceed until another lands | `--blocked-by B` | `N --add-blocked-by B` |
| **blocking** | this issue must land before another can proceed | `--blocking X` | `N --add-blocking X` |

`--blocked-by` / `--blocking` / `--add-sub-issue` take comma-separated numbers or
URLs; `--remove-parent` / `--remove-blocked-by` / `--remove-blocking` /
`--remove-sub-issue` undo them. `blocked by` and `blocking` are two views of one edge
(setting `N --add-blocked-by B` is the same edge as `B --add-blocking N`) — set it from
whichever side you're editing; don't set both.

When to use which:
- **parent / sub-issue** when the work decomposes a larger effort (e.g. several
  placeholder issues under one "placeholder engine" umbrella).
- **blocked by / blocking** for real ordering dependencies found in the survey — if A
  must ship before B, set `B --add-blocked-by A`.

Relationships are structural metadata: unlike a PR's formal link (see the `Refs #N`
rule), they are **not** among the board automations listed in "Board facts", so setting
them does not move the card or bypass review.

## Comment voice (every `gh issue comment` — phases 5, 6, 7, 8b)

Comments post under the user's own GitHub login, so a comment must read as an
automated note *about* the work, not as the user speaking. Each comment has two
properties and one fixed footer:

1. **Third-person and neutral.** State facts and status: "Implemented on `main`
   (`<sha>`)", "Pending maintainer review before merge", "Docs build passed". The
   author is the agent, the audience is whoever reads the issue.
2. **No first- or second-person address.** The subject is the work, never "I" and
   never "you"/"your" (write "the maintainer" / "pending consent", not "your review").
3. **Ends with this exact footer line:**

   ```
   <sub>🤖 Automated note posted by Claude Code, acting through @bilal-fazlani's account.</sub>
   ```

The `reference.md` comment template already carries this footer — fill in the body
above it. Same voice applies to PR bodies.

> Note: `gh` authenticates as the user, so there is no separate GitHub author for
> the agent; the footer is the attribution. A distinct author would require a bot
> account or GitHub App token (out of scope here).

## Notes

- **Which issue?** Track the current `#N` for the session; if multiple could apply, ask.
- **No cancelled lane.** Any close → Done, so an abandoned issue lands in Done. Accepted.
- Checklist items are Markdown checkboxes in the issue body — not real GitHub sub-issues.
