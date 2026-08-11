"""Generate the machine-readable docs routes: /llms.txt and raw per-page markdown.

Zensical has no plugin or hook system, so this runs after `zensical build` and
writes into its output directory. See
docs/superpowers/specs/2026-08-11-llms-txt-docs-routes-design.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml


class GenerationError(Exception):
    """The docs corpus is inconsistent with the nav, or a page is incomplete."""


@dataclass(frozen=True)
class NavEntry:
    """One page as the nav describes it, before its source file is read."""

    section: str
    title: str
    doc_path: str  # relative to docs/, e.g. "sdk/junit.md"


@dataclass(frozen=True)
class Page:
    """A nav entry joined to the description read from its source file."""

    section: str
    title: str
    doc_path: str
    description: str


def _single_item(entry: dict) -> tuple[str, object]:
    if not isinstance(entry, dict) or len(entry) != 1:
        raise GenerationError(f"nav entry must have exactly one key: {entry!r}")
    return next(iter(entry.items()))


def flatten_nav(nav: list[dict]) -> list[NavEntry]:
    """Flatten zensical.toml's nav into an ordered list that remembers sections.

    A top-level entry pointing straight at a page becomes its own
    single-page section, so every page in llms.txt sits under some heading.
    """
    entries: list[NavEntry] = []
    for item in nav:
        title, value = _single_item(item)
        if isinstance(value, str):
            entries.append(NavEntry(section=title, title=title, doc_path=value))
            continue
        if not isinstance(value, list):
            raise GenerationError(f"nav entry {title!r} must be a page or a list")
        for child in value:
            child_title, child_value = _single_item(child)
            if not isinstance(child_value, str):
                raise GenerationError(
                    f"nav nesting deeper than two levels is not supported: "
                    f"{title} > {child_title}"
                )
            entries.append(
                NavEntry(section=title, title=child_title, doc_path=child_value)
            )
    return entries


def read_description(path: Path) -> str | None:
    """Return the `description` from a page's YAML front matter, if present."""
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---", 3)
    if end == -1:
        return None
    front_matter = yaml.safe_load(text[4 : end + 1])
    if not isinstance(front_matter, dict):
        return None
    description = front_matter.get("description")
    if not isinstance(description, str) or not description.strip():
        return None
    return description.strip()


def load_page(entry: NavEntry, docs_dir: Path) -> Page:
    """Read a nav entry's source file and pair it with its description."""
    source = docs_dir / entry.doc_path
    if not source.is_file():
        raise GenerationError(f"nav references a missing page: {entry.doc_path}")
    description = read_description(source)
    if description is None:
        raise GenerationError(
            f"{entry.doc_path} has no `description:` front matter — every page "
            f"needs a one-line summary for llms.txt"
        )
    return Page(
        section=entry.section,
        title=entry.title,
        doc_path=entry.doc_path,
        description=description,
    )


def find_unlisted(docs_dir: Path, entries: list[NavEntry]) -> list[str]:
    """Return markdown files under docs/ that no nav entry points at."""
    listed = {entry.doc_path for entry in entries}
    on_disk = {
        path.relative_to(docs_dir).as_posix() for path in docs_dir.rglob("*.md")
    }
    return sorted(on_disk - listed)
