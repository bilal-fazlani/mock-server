"""Every ```json fence in the guide must be honest JSON.

The guide's fixture and schema examples are the thing readers paste into a file,
so a block fenced ``json`` that does not parse costs them a debugging cycle at
exactly the wrong moment — reconstructing an example is where a wrong field name
enters unnoticed. This suite is the guard: it caught the canonical fixture
skeleton carrying ``// optional, …`` prose comments and ``"body": { /* any JSON
*/ }``, which gave no usable literal at all.

Comments are still allowed, but only as **code annotations** — ``// (1)!``
markers paired with a numbered list beneath the block. The theme replaces the
whole comment with a clickable marker, so what a reader selects or copies out of
the rendered page is the JSON without it (see ``[project.extra.annotate]`` in
zensical.toml). Stripping the markers here is therefore exactly what the browser
does, and asserting the remainder parses is asserting what the reader gets.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

DOCS = Path(__file__).resolve().parent.parent / "docs"

FENCE = re.compile(r"^([ \t]*)```json[ \t]*$(.*?)^[ \t]*```[ \t]*$", re.DOTALL | re.MULTILINE)

#: A code annotation: a ``//`` comment holding nothing but ``(n)!``.
ANNOTATION = re.compile(r"[ \t]*//[ \t]*\((\d+)\)![ \t]*$", re.MULTILINE)

#: Any other comment — the thing that made these blocks unparseable.
PROSE_COMMENT = re.compile(r"//(?![ \t]*\(\d+\)!)|/\*")

#: A block deliberately eliding content ("entries": [ … ]) is a sketch of a
#: response, not something anyone pastes into a file. Nothing to assert.
ELISION = "…"


def json_blocks() -> list[tuple[Path, int, str]]:
    found = []
    for path in sorted(DOCS.rglob("*.md")):
        text = path.read_text(encoding="utf-8")
        for match in FENCE.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            found.append((path.relative_to(DOCS), line, match.group(2)))
    return found


BLOCKS = json_blocks()
IDS = [f"{path}:{line}" for path, line, _ in BLOCKS]


def test_the_guide_has_json_blocks_to_check():
    """A rename that stops this suite finding anything must fail loudly."""
    assert len(BLOCKS) > 20


@pytest.mark.parametrize(("path", "line", "block"), BLOCKS, ids=IDS)
def test_a_json_block_carries_no_comment_but_an_annotation(path, line, block):
    assert not PROSE_COMMENT.search(ANNOTATION.sub("", block)), (
        f"{path}:{line} is fenced ```json but carries a comment that is not a code "
        f"annotation. JSON has none, so this block cannot be pasted into a file. "
        f"Move the prose beneath the block, or make it an annotation: `// (1)!` "
        f"plus a numbered list under the fence."
    )


@pytest.mark.parametrize(("path", "line", "block"), BLOCKS, ids=IDS)
def test_a_json_block_parses_once_annotations_are_stripped(path, line, block):
    if ELISION in block:
        pytest.skip("deliberate elision — a sketch, not a document to paste")
    try:
        json.loads(ANNOTATION.sub("", block))
    except json.JSONDecodeError as error:
        pytest.fail(f"{path}:{line} is fenced ```json but does not parse: {error}")


@pytest.mark.parametrize(("path", "line", "block"), BLOCKS, ids=IDS)
def test_annotation_markers_are_numbered_from_one_in_order(path, line, block):
    markers = [int(n) for n in ANNOTATION.findall(block)]
    assert markers == list(range(1, len(markers) + 1)), (
        f"{path}:{line} numbers its annotations {markers}; the list beneath a block "
        f"is matched by position, so they must run 1..n in order."
    )
