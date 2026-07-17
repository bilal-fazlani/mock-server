# reference — exact gh commands

The board is project `3`, owner `bilal-fazlani`. Commands below are written for **fish**
(this repo's shell — `set VAR (...)`, `$VAR`). If a `gh project ...` command fails with a
missing-scope error, the user must run `gh auth refresh -s project,read:project` first.

Throughout, replace `N` with the issue number and the lane name with the target lane.

**Exact lane option names (case matters in GitHub, so the recipes below match
case-insensitively):** `Backlog`, `Ready`, `In progress`, `In review`, `Done` — note the
lowercase `p`/`r` in "In progress" / "In review".

## Move a card to a lane

Moving a card = editing the `Status` single-select on the **project item** (not the
issue). IDs are resolved at runtime so this survives board edits:

```fish
set proj_id  (gh project view 3 --owner bilal-fazlani --format json --jq '.id')
set field_id (gh project field-list 3 --owner bilal-fazlani --format json \
                --jq '.fields[] | select(.name=="Status") | .id')
set opt_id   (gh project field-list 3 --owner bilal-fazlani --format json \
                --jq '.fields[] | select(.name=="Status") | .options[] | select(.name|ascii_downcase=="in progress") | .id')
set item_id  (gh project item-list 3 --owner bilal-fazlani --format json --limit 200 \
                --jq '.items[] | select(.content.number==N) | .id')

gh project item-edit --project-id $proj_id --id $item_id \
  --field-id $field_id --single-select-option-id $opt_id
```

Notes:
- `--limit 200` on `item-list` guards against the board paginating the item out of the
  first page; raise it if the board grows large.
- `.content.number` is the issue number on each project item.
- If `item_id` comes back empty, the automation that adds the issue to the board may not
  have fired yet — wait a moment and re-run the `item-list` step.

## Check (or uncheck) a checklist item in the issue body

The checklist lives in the issue body as Markdown checkboxes. To flip one, fetch the
body to a file, edit that one line, and write it back — edit precisely (use the Read/Edit
tools on the file), don't blanket-replace:

```fish
gh issue view N --json body --jq '.body' > /tmp/issue-N-body.md
# change the target line from "- [ ] task text" to "- [x] task text"
gh issue edit N --body-file /tmp/issue-N-body.md
```

To add new checklist items (phase 6, scope growth), append `- [ ]` lines to the same
body file before writing it back.

## Common issue commands

```fish
# create (phase 1) — records #N from the output URL
gh issue create --title "add X" --body "Short summary of the committed work."

# replace the body with fuller detail (phase 2) or an edited checklist (phase 3/5/6)
gh issue edit N --body-file /tmp/issue-N-body.md

# progress / deviation / summary comment (phases 5, 6, 7)
gh issue comment N --body "..."

# close on approval (phase 8a) — the board auto-sets Done; do NOT also edit Status
gh issue close N
```

## Verifying a lane after a move

```fish
gh project item-list 3 --owner bilal-fazlani --format json --limit 200 \
  --jq '.items[] | select(.content.number==N) | .status'
```
