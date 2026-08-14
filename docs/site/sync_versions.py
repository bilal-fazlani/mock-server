"""Write the versions in versions.toml into the guide's pages.

The guide states our own versions in fifteen places — Maven and Gradle
coordinates for the Java SDK, and image tags for the server — and until this
existed, all fifteen were hand-typed prose that nothing kept current. They were
two releases behind on the day this was written.

Rewriting the markdown in place, rather than substituting at build time, is what
keeps `zensical serve`, the pages as browsed on GitHub, and the raw `.md` routes
build_llms.py serves all saying the same thing, and makes each bump a diff
somebody can read. Zensical has no plugin or hook system either way (see
build_llms.py), so a script is the only option; this one just runs before the
build instead of after it.

**Every rule below is anchored on meaning, never on a bare version shape.** A
coordinate is recognised by its groupId, an image tag by the call that takes it.
Nothing matches `\\d+\\.\\d+\\.\\d+` on its own, so a version this file has never
heard of is left untouched rather than corrupted — third-party pins, floors like
"0.7.0 or newer", and "from SDK 2.0.0" all survive a run without needing to be
enumerated here. tests/test_versions.py is what then insists they be classified.

    python sync_versions.py           # rewrite in place, report what changed
    python sync_versions.py --check   # exit 1 if anything would change

See docs/superpowers/specs/2026-08-14-docs-version-sync-design.md.
"""

from __future__ import annotations

import argparse
import re
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path

SITE_ROOT = Path(__file__).parent
VERSIONS_PATH = SITE_ROOT / "versions.toml"
DOCS_DIR = SITE_ROOT / "docs"

#: A version, as every rule below captures it.
V = r"\d+\.\d+\.\d+"


class SyncError(Exception):
    """versions.toml is unusable, or a rule matched something impossible."""


@dataclass(frozen=True)
class Rule:
    """One way the guide names a version, and which version it names.

    ``pattern`` must capture the version — and only the version — in group 1, so
    the substitution can replace that span alone and leave the surrounding
    literal (the artifact id, the call name) exactly as the author wrote it.
    """

    key: str
    pattern: re.Pattern[str]
    description: str

    def __post_init__(self) -> None:
        # A second capturing group is not a style problem, it is data loss:
        # apply_rule replaces span(1), so whatever else group 1 happens to hold
        # gets overwritten with a version. Refuse at import rather than at the
        # next release.
        if self.pattern.groups != 1:
            raise SyncError(
                f"rule {self.description!r} has {self.pattern.groups} capturing groups; "
                "exactly one is required, holding the version alone (use (?:…) elsewhere)"
            )


RULES: tuple[Rule, ...] = (
    # --- The Java SDK's four artifacts, which share one version -------------
    Rule(
        "sdk_java",
        # Gradle short form and the prose that quotes it. The artifact segment
        # allows <artifact>, the literal placeholder sdk/index.md uses when
        # talking about all four at once. It is deliberately *non*-capturing:
        # group 1 is the version and nothing else, because that is the only span
        # apply_rule replaces. Capturing the artifact here once rewrote
        # `com.bilal-fazlani:mock-server-junit:2.0.0` to
        # `com.bilal-fazlani:2.1.0:2.0.0` — see test_the_artifact_id_survives.
        re.compile(rf"(?<=com\.bilal-fazlani:)(?:[a-z-]+|<artifact>):({V})"),
        "com.bilal-fazlani:<artifact>:<version> coordinate",
    ),
    Rule(
        "sdk_java",
        # Maven long form. Anchored on our groupId so a <version> belonging to
        # any other dependency block is invisible to this rule.
        re.compile(
            rf"(?s)(?<=<groupId>com\.bilal-fazlani</groupId>).{{0,200}}?<version>({V})</version>"
        ),
        "<version> inside a com.bilal-fazlani <dependency>",
    ),
    # --- The server image tag -----------------------------------------------
    Rule(
        "server",
        re.compile(rf'(?<=withTag\(")({V})'),
        'DEFAULT_IMAGE_NAME.withTag("<version>")',
    ),
    Rule(
        "server",
        re.compile(rf'(?<=withImage\(")({V})'),
        'withImage("<version>")',
    ),
    Rule(
        "server",
        re.compile(rf'(?<=new MockServerContainer\(")({V})'),
        'new MockServerContainer("<version>")',
    ),
    Rule(
        "server",
        # The prose immediately after those two, echoing the same literal back:
        # "…looks for a repository named `0.10.0`." Left behind, it would
        # contradict the call it is explaining.
        re.compile(rf"(?<=repository named `)({V})"),
        "the repository-named echo beside a whole-reference example",
    ),
)


def load_versions(path: Path = VERSIONS_PATH) -> dict[str, str]:
    """Read [current] from versions.toml, checking every rule has a value."""
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SyncError(f"{path} does not exist") from exc
    except tomllib.TOMLDecodeError as exc:
        raise SyncError(f"{path} is not valid TOML: {exc}") from exc

    current = data.get("current")
    if not isinstance(current, dict):
        raise SyncError(f"{path} has no [current] table")

    for key in sorted({rule.key for rule in RULES}):
        value = current.get(key)
        if not isinstance(value, str) or not re.fullmatch(V, value):
            raise SyncError(
                f"[current].{key} must be a version like 1.2.3 in {path}, got {value!r}"
            )
    return {key: value for key, value in current.items() if isinstance(value, str)}


def apply_rule(text: str, rule: Rule, version: str) -> tuple[str, int]:
    """Replace only the captured span, so the rest of the match is preserved.

    The Maven rule's pattern spans the whole dependency block to prove the
    groupId is ours; rewriting the entire match would delete the artifactId
    between them. Substituting by span keeps every rule to the version itself.
    """
    out: list[str] = []
    cursor = 0
    count = 0
    for match in rule.pattern.finditer(text):
        start, end = match.span(1)
        if match.group(1) == version:
            continue
        out.append(text[cursor:start])
        out.append(version)
        cursor = end
        count += 1
    out.append(text[cursor:])
    return "".join(out), count


@dataclass
class Change:
    path: Path
    rule: Rule
    count: int


def sync(versions: dict[str, str], docs_dir: Path = DOCS_DIR) -> list[Change]:
    """Rewrite every page, returning what changed. Writes nothing if nothing did."""
    changes: list[Change] = []
    for path in sorted(docs_dir.rglob("*.md")):
        original = path.read_text(encoding="utf-8")
        text = original
        for rule in RULES:
            text, count = apply_rule(text, rule, versions[rule.key])
            if count:
                changes.append(Change(path.relative_to(docs_dir), rule, count))
        if text != original:
            path.write_text(text, encoding="utf-8")
    return changes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--check",
        action="store_true",
        help="report what would change and exit 1 if anything would, writing nothing",
    )
    args = parser.parse_args(argv)

    try:
        versions = load_versions()
    except SyncError as exc:
        print(f"sync_versions: {exc}", file=sys.stderr)
        return 2

    if args.check:
        # Same traversal, against copies. Nothing reaches disk.
        changes = []
        for path in sorted(DOCS_DIR.rglob("*.md")):
            text = path.read_text(encoding="utf-8")
            for rule in RULES:
                text, count = apply_rule(text, rule, versions[rule.key])
                if count:
                    changes.append(Change(path.relative_to(DOCS_DIR), rule, count))
    else:
        changes = sync(versions)

    stated = ", ".join(f"{key}={versions[key]}" for key in sorted(versions))
    if not changes:
        print(f"sync_versions: the guide already states {stated}")
        return 0

    verb = "would update" if args.check else "updated"
    for change in changes:
        print(f"  {change.path}: {verb} {change.count} x {change.rule.description}")
    total = sum(change.count for change in changes)
    print(f"sync_versions: {verb} {total} version(s) to {stated}")
    if args.check:
        print(
            "sync_versions: run `pipenv run python sync_versions.py` to apply",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
