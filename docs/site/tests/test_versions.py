"""Every version the guide states about our own releases is one nobody typed.

Two failures this guards against, and the second is the reason it exists.

**Drift.** A page states a version older than what is released. That is what
prompted all this: on the day it was written the guide advertised SDK ``2.0.0``
in nine places with ``2.1.0`` on Maven Central, and ``withTag("0.10.0")`` in six
with the server on ``0.11.0``.

**A version nobody classified.** Someone adds a snippet in a shape
``sync_versions.py`` does not recognise. The rewriter leaves it alone — by
design, since it only matches meaning it has been taught — and that one string
goes stale silently while every other stays current, which is worse than the
original problem because the page now looks maintained. So a version-shaped
string that is neither written from ``versions.toml`` nor listed under
``[[exempt]]`` fails here, on the pull request that introduced it.

The exempt list is not a suppression mechanism. Each entry carries a ``reason``
that has to survive a reader asking "should this really never move?", and
``test_no_exempt_entry_is_dead`` deletes the temptation to leave stale ones
lying around.

See docs/superpowers/specs/2026-08-14-docs-version-sync-design.md.
"""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

import pytest

import sync_versions
from sync_versions import RULES, V, apply_rule, load_versions

SITE_ROOT = Path(__file__).resolve().parent.parent
DOCS = SITE_ROOT / "docs"
VERSIONS_PATH = SITE_ROOT / "versions.toml"

VERSION_RE = re.compile(V)

CONFIG = tomllib.loads(VERSIONS_PATH.read_text(encoding="utf-8"))
EXEMPT = CONFIG.get("exempt", [])
VERSIONS = load_versions(VERSIONS_PATH)


def pages() -> list[Path]:
    return sorted(DOCS.rglob("*.md"))


@dataclass(frozen=True)
class Occurrence:
    """One version-shaped string in the corpus, and how it got there."""

    path: Path
    line_number: int
    line: str
    version: str
    tracked: bool


def occurrences() -> list[Occurrence]:
    """Every version in the guide, classified against the rules **per file**.

    Deliberately not per line: the Maven rule spans from ``<groupId>`` down to
    ``<version>`` to prove the coordinate is ours, so a line-scoped scan cannot
    see the four ``<version>2.1.0</version>`` lines as tracked and would demand
    they be exempted — which would then stop the drift check from covering them.
    Matching over whole-file text and comparing spans is what keeps "tracked"
    meaning the same thing here as it does in sync_versions.
    """
    found = []
    for path in pages():
        text = path.read_text(encoding="utf-8")
        written = {
            match.span(1) for rule in RULES for match in rule.pattern.finditer(text)
        }
        for match in VERSION_RE.finditer(text):
            line_number = text.count("\n", 0, match.start()) + 1
            line = text.splitlines()[line_number - 1]
            found.append(
                Occurrence(
                    path.relative_to(DOCS),
                    line_number,
                    line,
                    match.group(0),
                    match.span() in written,
                )
            )
    return found


OCCURRENCES = occurrences()
IDS = [f"{o.path}:{o.line_number}:{o.version}" for o in OCCURRENCES]


# --- the corpus is being read at all ----------------------------------------


def test_the_guide_has_versions_to_check():
    """A rename that stops this suite finding anything must fail loudly."""
    assert len(OCCURRENCES) > 20
    assert any(o.tracked for o in OCCURRENCES), "no rule matches the corpus any more"


def test_every_exempt_pattern_compiles():
    for entry in EXEMPT:
        re.compile(entry["pattern"])


def test_every_exempt_entry_carries_a_reason():
    for entry in EXEMPT:
        assert entry.get("reason", "").strip(), f"{entry['pattern']} has no reason"


# --- the guide agrees with versions.toml ------------------------------------


def test_the_guide_states_the_versions_in_versions_toml():
    """No tracked occurrence is behind. This is the drift check."""
    stale = []
    for path in pages():
        text = path.read_text(encoding="utf-8")
        for rule in RULES:
            _, count = apply_rule(text, rule, VERSIONS[rule.key])
            if count:
                stale.append(f"{path.relative_to(DOCS)}: {count} x {rule.description}")
    assert not stale, (
        "the guide states versions that versions.toml disagrees with:\n  "
        + "\n  ".join(stale)
        + "\nRun `pipenv run python sync_versions.py` to fix."
    )


# --- nothing is unclassified ------------------------------------------------


def is_exempt(line: str) -> bool:
    return any(re.search(entry["pattern"], line) for entry in EXEMPT)


@pytest.mark.parametrize("occurrence", OCCURRENCES, ids=IDS)
def test_every_version_is_tracked_or_exempt(occurrence: Occurrence):
    if occurrence.tracked or is_exempt(occurrence.line):
        return
    pytest.fail(
        f"{occurrence.path}:{occurrence.line_number} states {occurrence.version}, "
        "which is neither written from versions.toml nor exempt:\n"
        f"    {occurrence.line.strip()}\n"
        "Either put it in a shape sync_versions.py recognises (a "
        "com.bilal-fazlani coordinate, a withTag/withImage call), or add an "
        "[[exempt]] entry to versions.toml saying why it must not move."
    )


def test_no_version_is_both_tracked_and_exempt():
    """An exemption over a tracked span would silently stop the drift check.

    The rewriter would keep updating it and the exempt entry would keep claiming
    it must not move — the two would disagree forever with nothing to say so.
    """
    both = [
        f"{o.path}:{o.line_number} ({o.version})"
        for o in OCCURRENCES
        if o.tracked and is_exempt(o.line)
    ]
    assert not both, (
        "these versions are written by a rule *and* matched by an [[exempt]] "
        "pattern; tighten the pattern:\n  " + "\n  ".join(both)
    )


def test_no_exempt_entry_is_dead():
    """An exemption for text nobody has written in a year is a lie about the corpus."""
    corpus = "\n".join(path.read_text(encoding="utf-8") for path in pages())
    unused = [e["pattern"] for e in EXEMPT if not re.search(e["pattern"], corpus)]
    assert not unused, (
        "these [[exempt]] patterns match nothing in the guide and should be deleted:\n  "
        + "\n  ".join(unused)
    )


# --- the rewriter's own contract --------------------------------------------


def test_every_rule_captures_only_the_version():
    """The guard behind Rule.__post_init__, stated where a reader will find it."""
    for rule in RULES:
        assert rule.pattern.groups == 1, rule.description


def test_the_artifact_id_survives_a_coordinate_rewrite():
    """Regression: a capturing group around the artifact ate it.

    ``com.bilal-fazlani:mock-server-junit:2.0.0`` became
    ``com.bilal-fazlani:2.1.0:2.0.0`` — the version was written over the
    artifactId while the real version sat untouched beside it. Every rule spans
    more text than it replaces, so this is the failure mode of the whole design,
    not a one-off typo.
    """
    for original in (
        'testImplementation("com.bilal-fazlani:mock-server-junit:2.0.0")',
        'testImplementation("com.bilal-fazlani:mock-server-spring-boot-test:2.0.0")',
        "`com.bilal-fazlani:<artifact>:2.0.0`",
    ):
        text = original
        for rule in RULES:
            text, _ = apply_rule(text, rule, "9.9.9")
        assert text == original.replace("2.0.0", "9.9.9"), text


def test_a_maven_version_outside_our_group_is_untouched():
    """The long-form rule must not rewrite somebody else's <dependency> block."""
    other = (
        "<dependency>\n"
        "  <groupId>org.junit.jupiter</groupId>\n"
        "  <artifactId>junit-jupiter</artifactId>\n"
        "  <version>6.1.2</version>\n"
        "</dependency>"
    )
    text = other
    for rule in RULES:
        text, _ = apply_rule(text, rule, "9.9.9")
    assert text == other


def test_a_bare_version_is_untouched():
    """Floors, historical facts, and third-party pins survive without being listed."""
    for line in (
        "The SDK needs server **0.7.0 or newer**",
        "| Java | **21 (LTS) or newer**, from SDK **2.0.0** |",
        "| `org.testcontainers:testcontainers` | **2.0.5** |",
        "docker run --rm -p 3000:3000 my-mocks:1.4.0",
    ):
        text = line
        for rule in RULES:
            text, _ = apply_rule(text, rule, "9.9.9")
        assert text == line


def test_load_versions_rejects_a_missing_key(tmp_path: Path):
    path = tmp_path / "versions.toml"
    path.write_text('[current]\nserver = "1.2.3"\n', encoding="utf-8")
    with pytest.raises(sync_versions.SyncError, match="sdk_java"):
        load_versions(path)


def test_load_versions_rejects_a_non_version(tmp_path: Path):
    path = tmp_path / "versions.toml"
    path.write_text('[current]\nserver = "latest"\nsdk_java = "2.1.0"\n', encoding="utf-8")
    with pytest.raises(sync_versions.SyncError, match="server"):
        load_versions(path)
