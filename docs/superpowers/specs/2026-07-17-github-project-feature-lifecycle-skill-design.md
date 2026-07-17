# GitHub Project feature-lifecycle skill — design

**Date:** 2026-07-17
**Status:** approved (design), pending implementation

## Purpose

A project-level Claude skill that makes feature work in this repo flow through the
GitHub Project board (`bilal-fazlani/projects/3`) as a tracked lifecycle: log a ticket
once we're committed, capture detail, break it into a checklist, drive it across the
board lanes as work proceeds, log deviations, and close it out only on the user's
approval.

The skill exists to give Claude a consistent, low-friction discipline for issue
tracking that leans on the board's existing automations rather than fighting them.

## Board facts (fixed)

- **Project:** number `3`, owner `bilal-fazlani` (user project).
- **Status lanes, in order:** `Backlog` → `Ready` → `In Progress` → `In Review` → `Done`.
- **Prerequisite:** `gh` needs project scope. If a project command fails with a
  missing-scope error, the skill tells the user to run once:
  `gh auth refresh -s project,read:project`. The skill does **not** run this itself
  (it's an auth change).

## Existing board automations (authoritative — the skill must not duplicate or fight these)

Enabled:
1. Item has sub-issues → add sub-issues to project.
2. Filter `(isIssue, isOpen)` matches new/updated item → add item to project.
3. Status set to `Done` → **close the issue**.
4. Item added to project → **set Status `Backlog`**.
5. Item closed (Issue/PR) → **set Status `Done`**.
6. PR *formally linked* to an issue → set Status `In Progress`.
7. PR merged → set Status `Done`.

Disabled (so they will **not** interfere):
- Item reopened → Ready.
- PR review requesting changes → Ready.
- PR approved → Ready.
- Archive closed issues older than 2 weeks.

### Consequences the skill relies on

- **Creating an issue is enough** to get it onto the board in `Backlog` (automations 2 + 4).
  The skill does *not* manually add-to-project or set Backlog.
- **`Done` and closed are the same state** (automations 3 + 5 form a bidirectional pair).
  So closing the issue and setting Done are equivalent — the skill does **one** action
  and lets the automation complete the pair. It closes the issue (`gh issue close`),
  which is simpler than editing the Status field.
- **The disabled review automations** mean nothing auto-moves the card based on PR
  review state, so the manual review gate (In Review → approve/reject) is safe.

## The lifecycle

| Phase | Trigger | Skill actions | Resulting lane |
| --- | --- | --- | --- |
| **1. Open** | User confirms we're doing the work (not exploring) | Ask the per-feature question (below); `gh issue create` with an imperative title + brief body. Record the issue number `#N` for the session. | **Backlog** (automatic) |
| **2. Detail** | Full information gathered | Update the issue body with full detail — or, per the per-feature choice, write/link a `docs/superpowers/specs/*.md` design doc | Backlog |
| **3. Break down** | Plan decomposed into steps | Add a `- [ ]` task checklist to the issue body; move the card | → **Ready** |
| **4. Start** | Work begins | Move the card. Branching is not mandated (direct-main, branch, or worktree — as fits the work) | → **In Progress** |
| **5. Progress** | Each task completes | Check its box in the issue body **and** post a short progress comment; commit with a Conventional-Commits message plus a `Refs #N` footer | In Progress |
| **6. Deviate** | Scope change, plan change, or failure | Post a comment describing it; add new checklist items if scope grew | In Progress |
| **7. Finish** | Work complete | For UI work: drive the preview, capture a screenshot, show it to the user **in-session** (never attached to the issue). Then post a **summary comment**; move the card | → **In Review** |
| **8a. Approve** | User says merge / push / merge-PR | Perform the git action, then `gh issue close #N` (auto-sets Done) | → **Done** (automatic on close) |
| **8b. Changes** | User requests changes during review | Post a comment capturing the requested changes; move the card back to work | → **In Progress** |

### Per-feature kickoff question (phase 1)

Every time the skill opens a ticket it asks the user:

> "Issue-only, or issue + a linked `docs/superpowers/specs/` design doc?"

- **Issue-only:** all detail lives in the issue body.
- **Issue + spec:** the issue body holds the summary + checklist and links to the spec
  file, which holds the detailed design.

This is asked fresh each time (per the user's instruction) — there is no default.

### Confirm-before-create gate (phase 1 trigger)

The skill auto-activates when feature work begins, but before creating anything it
asks: *"Shall I open a ticket for this?"* This honours the rule that tickets are only
created once we're sure we'll do the work, not while merely exploring an idea.

## The `Refs #N` rule (critical)

Commits and PR bodies reference the issue with a non-closing footer **`Refs #N`** —
never `Closes`/`Fixes`/`Resolves`, and the PR is never manually linked via the
Development sidebar.

Rationale: a closing keyword (or a sidebar link) creates a GitHub *formal link*, which
triggers automations 6 and 7 — a merge would then drive the card straight to Done and
close the issue, **bypassing In Review and the user's approval**. A plain `Refs #N`
mention is only a timeline cross-reference and creates no formal link, so the review
gate stays in the user's hands. Not every issue has a PR anyway (some work is direct on
main or in a local worktree); for those, the issue links via comments.

The `Refs #N` footer is additive — it does not change the Conventional-Commits summary
line, whose format continues to be governed by `AGENTS.md`.

## Manual lane-move mechanics

Moving a card = editing the `Status` single-select on the **project item** (not the
issue itself). The skill discovers IDs at runtime so it survives board edits:

1. Resolve the `Status` field ID and the option ID for the target lane via
   `gh project field-list 3 --owner bilal-fazlani --format json` (match option by name).
2. Resolve the project item ID for issue `#N` via
   `gh project item-list 3 --owner bilal-fazlani --format json` (match by issue number/URL).
3. `gh project item-edit --project-id <PID> --id <ITEM_ID> --field-id <FIELD_ID> --single-select-option-id <OPT_ID>`.

The exact commands (including how to obtain the project node ID) live in a
`reference.md` beside the skill, since this is the part most likely to break.

## Known quirks (accepted, not blocking)

- **No "Cancelled/Won't-do" lane.** Because *any* close → Done (automation 5), an
  abandoned issue lands in Done rather than a distinct dropped state. Acceptable for
  now; revisit by adding a lane if it becomes a problem.

## Skill structure

```
.claude/skills/feature-lifecycle/
  SKILL.md       # trigger description + the lifecycle as an ordered, checklist-able procedure
  reference.md   # exact gh project commands for lane moves and ID resolution
```

- `SKILL.md` description auto-triggers on "starting feature work in this repo" and
  instructs Claude to confirm before creating a ticket.
- The procedure is written so each lane transition maps to an observable trigger, so
  Claude does not drift from the flow.

## Non-goals / out of scope

- Real GitHub sub-issues (the user chose checklist items instead).
- Changing or adding board automations (the archive and review-state automations stay
  disabled; no new automations are required for the skill to work).
- Any auth changes performed by the skill (the user runs `gh auth refresh` themselves).
- A distinct cancelled/won't-do lane.

## Open items

None blocking. Implementation is a single `SKILL.md` plus a `reference.md`.
