#!/bin/sh
# PreToolUse guard: tickets.html is only ever edited in the MAIN worktree.
#
# The ticket board records live project state, so it has to be current on `main`
# the moment a lane changes — not whenever a feature branch happens to merge.
# A worktree copy edited on a branch is invisible on main until then, and two
# branches editing it collide. So: edits are allowed only against the main
# worktree's copy, whatever directory the session is running in.
#
# Reads the hook payload on stdin. Exit 2 blocks the tool call and feeds stderr
# back to Claude; exit 0 allows it.

payload=$(cat)
path=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

# Not a file edit, or not the board — nothing to say.
[ -n "$path" ] || exit 0
case "$path" in
  */tickets.html) ;;
  *) exit 0 ;;
esac

dir=$(dirname "$path")
[ -d "$dir" ] || exit 0

# --git-common-dir resolves to the MAIN worktree's .git from anywhere in the
# repo, including a linked worktree — so its parent is the main checkout.
common=$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
[ -n "$common" ] || exit 0
main=$(CDPATH= cd -- "$(dirname "$common")" 2>/dev/null && pwd -P) || exit 0
here=$(CDPATH= cd -- "$dir" 2>/dev/null && pwd -P) || exit 0

[ "$here" = "$main" ] && exit 0

cat >&2 <<EOF
Blocked: $path is a worktree copy of the ticket board.

tickets.html is only ever edited in the main worktree, so the board is correct
on main the moment a lane changes rather than whenever this branch merges.

Edit the main copy instead, by absolute path:

  $main/tickets.html

and commit it there, without leaving this worktree:

  git -C $main add tickets.html
  git -C $main commit -m "chore: update tickets board — ..."
EOF
exit 2
