"""Generate the machine-readable docs routes: /llms.txt and raw per-page markdown.

Zensical has no plugin or hook system, so this runs after `zensical build` and
writes into its output directory. See
docs/superpowers/specs/2026-08-11-llms-txt-docs-routes-design.md.
"""

from __future__ import annotations

from dataclasses import dataclass


class GenerationError(Exception):
    """The docs corpus is inconsistent with the nav, or a page is incomplete."""


@dataclass(frozen=True)
class NavEntry:
    """One page as the nav describes it, before its source file is read."""

    section: str
    title: str
    doc_path: str  # relative to docs/, e.g. "sdk/junit.md"


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
