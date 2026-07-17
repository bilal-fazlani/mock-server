---
name: feature-lifecycle
description: Use when starting feature work in this repo that we are committed to building (not merely exploring an idea) — tracks it as a GitHub issue on project board #3 (owner bilal-fazlani) and drives it across the Backlog → Ready → In Progress → In Review → Done lanes as work proceeds. Confirms before creating the ticket, updates a task checklist in real time, logs deviations as comments, and closes out only on the user's approval.
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
- Lanes, in order: `Backlog` → `Ready` → `In Progress` → `In Review` → `Done`.
- **Automations already handle:** issue created → added to board + set `Backlog`;
  issue closed ⇄ status `Done` (bidirectional). So: never manually add-to-project or
  set Backlog, and to finish just **close the issue** (Done follows automatically).

## The procedure

Create one todo per phase and work them in order. Each transition has an observable
trigger — do not skip ahead.

### 1. Open the ticket — trigger: we've confirmed we're doing the work

1. **Confirm first:** ask *"Shall I open a ticket for this?"* Proceed only on yes.
2. **Ask the per-feature question (fresh every time, no default):**
   *"Issue-only, or issue + a linked `docs/superpowers/specs/` design doc?"*
3. Create the issue with an imperative, lowercase-ish title and a brief body:
   `gh issue create --title "..." --body "..."`
4. **Record the issue number `#N`** — you'll reference it for the rest of the session.

The board auto-adds it and sets `Backlog`. Do nothing else here.

### 2. Capture full detail — trigger: we have enough information

Update the issue body with the full details
(`gh issue edit N --body-file -`). If the user chose *issue + spec*, write/link the
`docs/superpowers/specs/*.md` design doc and keep the issue body as summary + link.
Card stays in `Backlog`.

### 3. Break down — trigger: the plan is decomposed into steps

Add a Markdown task checklist to the issue body:

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

## Notes

- **Which issue?** Track the current `#N` for the session; if multiple could apply, ask.
- **No cancelled lane.** Any close → Done, so an abandoned issue lands in Done. Accepted.
- Checklist items are Markdown checkboxes in the issue body — not real GitHub sub-issues.
