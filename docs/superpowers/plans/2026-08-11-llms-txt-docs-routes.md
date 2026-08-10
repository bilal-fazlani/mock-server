# Machine-readable docs routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the docs site as markdown alongside its HTML — a `/llms.txt` index plus every source page mirrored at `/sdk/junit.md` and friends.

**Architecture:** Zensical has no plugin or hook system, so a Python script (`docs/site/build_llms.py`) runs *after* `zensical build` and writes into its output directory. The script reads `nav` from `zensical.toml` as the single authority for page order, section grouping, and titles; each page's one-line summary comes from a new `description:` front matter field. Pages are copied flat, mirroring the source tree, which is what keeps the 125 existing relative `.md` links resolving correctly.

**Tech Stack:** Python 3.14 (`tomllib` from stdlib, PyYAML for front matter), pipenv, pytest, Netlify build config, GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-08-11-llms-txt-docs-routes-design.md](../specs/2026-08-11-llms-txt-docs-routes-design.md)
**Issue:** [#76](https://github.com/bilal-fazlani/mock-server/issues/76)

## Global Constraints

- **Python 3.14** — pinned by `docs/site/Pipfile` (`python_version = "3.14"`) and `netlify.toml` (`PYTHON_VERSION = "3.14"`). `tomllib` is stdlib; do not add a TOML dependency.
- **All work lives under `docs/site/`** except `netlify.toml` and the new workflow file. A generator outside `docs/site/` would fall outside Netlify's build-trigger pathspec.
- **`pytest` goes in `[dev-packages]`**, never `[packages]` — Netlify runs a plain `pipenv install` and must not pull test deps into the deploy.
- **`Pipfile.lock` must be regenerated and committed** whenever `Pipfile` changes. CI runs `pipenv install --dev --deploy`, which fails on a stale lock (the Python analogue of the `npm ci` gate).
- **Conventional commit messages** (`feat:`, `docs:`, `chore:`, `test:`), matching the existing history.
- **No AI or provenance trailers in commit messages** — no `Co-Authored-By: Claude`, no "generated with" footer.
- **Descriptions are always double-quoted in YAML front matter.** Several contain `: ` (colon-space), which breaks an unquoted plain scalar. Quoting uniformly avoids the whole class of bug.
- **Site URL** is `https://mock-server.bilal-fazlani.com` (from `site_url` in `zensical.toml`, no trailing slash).

## File Structure

| File | Responsibility |
| --- | --- |
| `docs/site/build_llms.py` | *(new)* The whole generator: nav flattening, front-matter reading, validation, `llms.txt` rendering, output writing. One file — the total surface is ~120 lines and the pieces are meaningless apart. |
| `docs/site/tests/test_build_llms.py` | *(new)* pytest suite, driven by fixture docs trees in `tmp_path`. Never touches the real corpus. |
| `docs/site/conftest.py` | *(new)* Empty. Its presence puts `docs/site/` on `sys.path` so tests can `import build_llms`. |
| `docs/site/Pipfile` | *(modify)* Add `pyyaml` to `[packages]`, `pytest` to `[dev-packages]`. |
| `docs/site/docs/**/*.md` | *(modify)* All 24 pages gain a `description:` front matter line. |
| `netlify.toml` | *(modify)* Build command, `[[headers]]` for the new routes, widened ignore pathspec. |
| `.github/workflows/docs-checks.yml` | *(new)* Runs pytest on changes under `docs/site/**`. |
| `README.md`, `docs/site/docs/index.md` | *(modify)* Document the new routes for humans. |

---

### Task 1: Toolchain scaffolding and nav flattening

Establishes the Python test setup and the first unit of the generator: turning `zensical.toml`'s nested `nav` into a flat, ordered list of pages that remember their section.

**Files:**
- Create: `docs/site/build_llms.py`
- Create: `docs/site/conftest.py`
- Create: `docs/site/tests/test_build_llms.py`
- Modify: `docs/site/Pipfile`

**Interfaces:**
- Consumes: nothing.
- Produces: `GenerationError(Exception)`; `NavEntry` frozen dataclass with fields `section: str`, `title: str`, `doc_path: str` (path relative to `docs/`, e.g. `"sdk/junit.md"`); `flatten_nav(nav: list[dict]) -> list[NavEntry]`.

- [ ] **Step 1: Add the dependencies**

Run from `docs/site/`:

```bash
pipenv install pyyaml && pipenv install --dev pytest
```

This edits `Pipfile` and regenerates `Pipfile.lock`. Confirm `Pipfile` now reads:

```toml
[packages]
# Pinned to the version the docs are authored/verified against. Zensical is
# alpha (0.0.x) and may ship breaking changes, so keep this pinned and bump
# deliberately.
zensical = "==0.0.52"
# Front matter parsing for build_llms.py.
pyyaml = "*"

[dev-packages]
pytest = "*"
```

- [ ] **Step 2: Create the empty conftest**

Create `docs/site/conftest.py`:

```python
# Intentionally empty. pytest puts the directory containing the rootdir
# conftest on sys.path, which is what lets tests/ do `import build_llms`
# without a package layout.
```

- [ ] **Step 3: Write the failing tests**

Create `docs/site/tests/test_build_llms.py`:

```python
import pytest

from build_llms import GenerationError, NavEntry, flatten_nav


def test_flatten_nav_preserves_section_grouping_and_order():
    nav = [
        {"Overview": "index.md"},
        {
            "Get started": [
                {"Install & run": "get-started/install.md"},
                {"Your first mock endpoint": "get-started/first-mock.md"},
            ]
        },
    ]

    assert flatten_nav(nav) == [
        NavEntry(section="Overview", title="Overview", doc_path="index.md"),
        NavEntry(
            section="Get started",
            title="Install & run",
            doc_path="get-started/install.md",
        ),
        NavEntry(
            section="Get started",
            title="Your first mock endpoint",
            doc_path="get-started/first-mock.md",
        ),
    ]


def test_flatten_nav_rejects_three_level_nesting():
    nav = [{"Reference": [{"Deeper": [{"Page": "a.md"}]}]}]

    with pytest.raises(GenerationError, match="two levels"):
        flatten_nav(nav)


def test_flatten_nav_rejects_multi_key_entry():
    nav = [{"One": "one.md", "Two": "two.md"}]

    with pytest.raises(GenerationError, match="exactly one key"):
        flatten_nav(nav)
```

- [ ] **Step 4: Run the tests to verify they fail**

Run from `docs/site/`:

```bash
pipenv run pytest -v
```

Expected: collection error — `ModuleNotFoundError: No module named 'build_llms'`.

- [ ] **Step 5: Write the minimal implementation**

Create `docs/site/build_llms.py`:

```python
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
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pipenv run pytest -v
```

Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git add docs/site/Pipfile docs/site/Pipfile.lock docs/site/conftest.py docs/site/build_llms.py docs/site/tests/test_build_llms.py
git commit -m "feat(docs): flatten zensical nav for machine-readable routes"
```

---

### Task 2: Front matter reading, page loading, and corpus validation

Turns each `NavEntry` into a `Page` carrying its description, and adds the three checks that fail the build rather than emitting a silently incomplete index.

**Files:**
- Modify: `docs/site/build_llms.py`
- Modify: `docs/site/tests/test_build_llms.py`

**Interfaces:**
- Consumes: `GenerationError`, `NavEntry`, `flatten_nav` from Task 1.
- Produces: `Page` frozen dataclass with fields `section: str`, `title: str`, `doc_path: str`, `description: str`; `read_description(path: Path) -> str | None`; `load_page(entry: NavEntry, docs_dir: Path) -> Page`; `find_unlisted(docs_dir: Path, entries: list[NavEntry]) -> list[str]`.

- [ ] **Step 1: Write the failing tests**

Append to `docs/site/tests/test_build_llms.py`, and extend the existing import line to `from build_llms import GenerationError, NavEntry, Page, find_unlisted, flatten_nav, load_page, read_description`:

```python
def write_page(docs_dir, rel_path, description="A description.", body="# Title\n"):
    """Write a fixture page. Pass description=None to omit the front matter."""
    path = docs_dir / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    front = "" if description is None else f'---\ndescription: "{description}"\n---\n\n'
    path.write_text(front + body, encoding="utf-8")
    return path


def test_read_description_returns_the_front_matter_value(tmp_path):
    path = write_page(tmp_path, "a.md", description="What the page covers.")

    assert read_description(path) == "What the page covers."


def test_read_description_returns_none_without_front_matter(tmp_path):
    path = write_page(tmp_path, "a.md", description=None)

    assert read_description(path) is None


def test_read_description_returns_none_when_the_key_is_absent(tmp_path):
    path = tmp_path / "a.md"
    path.write_text("---\ntitle: Something\n---\n\n# Title\n", encoding="utf-8")

    assert read_description(path) is None


def test_load_page_carries_the_description(tmp_path):
    write_page(tmp_path, "sdk/junit.md", description="The Jupiter extension.")
    entry = NavEntry(section="Testing SDKs", title="JUnit 5 guide", doc_path="sdk/junit.md")

    assert load_page(entry, tmp_path) == Page(
        section="Testing SDKs",
        title="JUnit 5 guide",
        doc_path="sdk/junit.md",
        description="The Jupiter extension.",
    )


def test_load_page_raises_when_the_file_is_missing(tmp_path):
    entry = NavEntry(section="Reference", title="Gone", doc_path="reference/gone.md")

    with pytest.raises(GenerationError, match="missing page"):
        load_page(entry, tmp_path)


def test_load_page_raises_when_the_description_is_missing(tmp_path):
    write_page(tmp_path, "a.md", description=None)
    entry = NavEntry(section="Overview", title="Overview", doc_path="a.md")

    with pytest.raises(GenerationError, match="description"):
        load_page(entry, tmp_path)


def test_find_unlisted_reports_pages_absent_from_nav(tmp_path):
    write_page(tmp_path, "a.md")
    write_page(tmp_path, "nested/orphan.md")
    entries = [NavEntry(section="Overview", title="A", doc_path="a.md")]

    assert find_unlisted(tmp_path, entries) == ["nested/orphan.md"]


def test_find_unlisted_is_empty_when_nav_covers_everything(tmp_path):
    write_page(tmp_path, "a.md")
    entries = [NavEntry(section="Overview", title="A", doc_path="a.md")]

    assert find_unlisted(tmp_path, entries) == []
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pipenv run pytest -v
```

Expected: collection error — `ImportError: cannot import name 'Page' from 'build_llms'`.

- [ ] **Step 3: Write the minimal implementation**

In `docs/site/build_llms.py`, extend the imports to:

```python
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml
```

Add after the `NavEntry` dataclass:

```python
@dataclass(frozen=True)
class Page:
    """A nav entry joined to the description read from its source file."""

    section: str
    title: str
    doc_path: str
    description: str
```

Add after `flatten_nav`:

```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pipenv run pytest -v
```

Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
git add docs/site/build_llms.py docs/site/tests/test_build_llms.py
git commit -m "feat(docs): read page descriptions and validate the docs corpus"
```

---

### Task 3: Render `llms.txt`

Produces the index document itself, in the format described at llmstxt.org.

**Files:**
- Modify: `docs/site/build_llms.py`
- Modify: `docs/site/tests/test_build_llms.py`

**Interfaces:**
- Consumes: `Page` from Task 2.
- Produces: `render_llms_txt(site_name: str, site_description: str, site_url: str, pages: list[Page]) -> str`.

- [ ] **Step 1: Write the failing test**

Append to `docs/site/tests/test_build_llms.py`, extending the import line to also include `render_llms_txt`:

```python
def test_render_llms_txt_groups_pages_under_their_sections():
    pages = [
        Page(
            section="Overview",
            title="Overview",
            doc_path="index.md",
            description="What this thing is.",
        ),
        Page(
            section="Get started",
            title="Install & run",
            doc_path="get-started/install.md",
            description="How to run it.",
        ),
        Page(
            section="Get started",
            title="Your first mock endpoint",
            doc_path="get-started/first-mock.md",
            description="Add an endpoint step by step.",
        ),
    ]

    rendered = render_llms_txt(
        site_name="Mock Server",
        site_description="A data-driven mock server.",
        site_url="https://example.test",
        pages=pages,
    )

    assert rendered == (
        "# Mock Server\n"
        "\n"
        "> A data-driven mock server.\n"
        "\n"
        "## Overview\n"
        "- [Overview](https://example.test/index.md): What this thing is.\n"
        "\n"
        "## Get started\n"
        "- [Install & run](https://example.test/get-started/install.md): How to run it.\n"
        "- [Your first mock endpoint](https://example.test/get-started/first-mock.md): "
        "Add an endpoint step by step.\n"
    )


def test_render_llms_txt_tolerates_a_trailing_slash_in_site_url():
    pages = [
        Page(
            section="Overview",
            title="Overview",
            doc_path="index.md",
            description="What this thing is.",
        )
    ]

    rendered = render_llms_txt("S", "D", "https://example.test/", pages)

    assert "(https://example.test/index.md)" in rendered
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pipenv run pytest -v
```

Expected: collection error — `ImportError: cannot import name 'render_llms_txt'`.

- [ ] **Step 3: Write the minimal implementation**

Add to `docs/site/build_llms.py` after `find_unlisted`:

```python
def render_llms_txt(
    site_name: str,
    site_description: str,
    site_url: str,
    pages: list[Page],
) -> str:
    """Render the llms.txt index (https://llmstxt.org) for the given pages."""
    base = site_url.rstrip("/")
    lines = [f"# {site_name}", "", f"> {site_description}", ""]
    section = None
    for page in pages:
        if page.section != section:
            if section is not None:
                lines.append("")
            lines.append(f"## {page.section}")
            section = page.section
        lines.append(f"- [{page.title}]({base}/{page.doc_path}): {page.description}")
    return "\n".join(lines) + "\n"
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pipenv run pytest -v
```

Expected: 13 passed.

- [ ] **Step 5: Commit**

```bash
git add docs/site/build_llms.py docs/site/tests/test_build_llms.py
git commit -m "feat(docs): render the llms.txt index from nav and descriptions"
```

---

### Task 4: Copy pages and wire up `main()`

Mirrors the source tree into the build output and joins every piece into a runnable script with a non-zero exit on any validation failure.

**Files:**
- Modify: `docs/site/build_llms.py`
- Modify: `docs/site/tests/test_build_llms.py`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: `copy_pages(pages: list[Page], docs_dir: Path, output_dir: Path) -> None`; `generate(site_root: Path) -> int` returning the page count; `main() -> None`. Module constants `SITE_ROOT`, `CONFIG_PATH`, `DOCS_DIR`, `OUTPUT_DIR`.

- [ ] **Step 1: Write the failing tests**

Append to `docs/site/tests/test_build_llms.py`, extending the import line to also include `copy_pages` and `generate`:

```python
def test_copy_pages_mirrors_the_source_tree_verbatim(tmp_path):
    docs_dir = tmp_path / "docs"
    output_dir = tmp_path / "site"
    output_dir.mkdir()
    write_page(docs_dir, "sdk/junit.md", description="D.", body="# JUnit\n\nBody.\n")
    pages = [
        Page(
            section="Testing SDKs",
            title="JUnit 5 guide",
            doc_path="sdk/junit.md",
            description="D.",
        )
    ]

    copy_pages(pages, docs_dir, output_dir)

    copied = output_dir / "sdk" / "junit.md"
    assert copied.read_text(encoding="utf-8") == (
        '---\ndescription: "D."\n---\n\n# JUnit\n\nBody.\n'
    )


def build_site_root(tmp_path, nav_toml, pages):
    """Assemble a fake docs/site/ with a zensical.toml, docs/, and site/."""
    site_root = tmp_path / "site_root"
    docs_dir = site_root / "docs"
    (site_root / "site").mkdir(parents=True)
    for rel_path, description in pages:
        write_page(docs_dir, rel_path, description=description)
    (site_root / "zensical.toml").write_text(
        "[project]\n"
        'site_name = "Mock Server"\n'
        'site_description = "A data-driven mock server."\n'
        'site_url = "https://example.test"\n'
        f"nav = {nav_toml}\n",
        encoding="utf-8",
    )
    return site_root


def test_generate_writes_llms_txt_and_the_mirrored_pages(tmp_path):
    site_root = build_site_root(
        tmp_path,
        nav_toml='[ { "Overview" = "index.md" }, '
        '{ "Reference" = [ { "Configuration" = "reference/configuration.md" } ] } ]',
        pages=[("index.md", "What this is."), ("reference/configuration.md", "Env vars.")],
    )

    assert generate(site_root) == 2

    output = site_root / "site"
    assert (output / "index.md").is_file()
    assert (output / "reference" / "configuration.md").is_file()
    assert (output / "llms.txt").read_text(encoding="utf-8") == (
        "# Mock Server\n"
        "\n"
        "> A data-driven mock server.\n"
        "\n"
        "## Overview\n"
        "- [Overview](https://example.test/index.md): What this is.\n"
        "\n"
        "## Reference\n"
        "- [Configuration](https://example.test/reference/configuration.md): Env vars.\n"
    )


def test_generate_raises_when_a_page_is_missing_from_nav(tmp_path):
    site_root = build_site_root(
        tmp_path,
        nav_toml='[ { "Overview" = "index.md" } ]',
        pages=[("index.md", "What this is."), ("stray.md", "Not in nav.")],
    )

    with pytest.raises(GenerationError, match="stray.md"):
        generate(site_root)


def test_generate_raises_when_the_build_output_is_absent(tmp_path):
    site_root = build_site_root(
        tmp_path,
        nav_toml='[ { "Overview" = "index.md" } ]',
        pages=[("index.md", "What this is.")],
    )
    (site_root / "site").rmdir()

    with pytest.raises(GenerationError, match="zensical build"):
        generate(site_root)
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pipenv run pytest -v
```

Expected: collection error — `ImportError: cannot import name 'copy_pages'`.

- [ ] **Step 3: Write the minimal implementation**

In `docs/site/build_llms.py`, extend the imports to:

```python
from __future__ import annotations

import shutil
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path

import yaml
```

Add the module constants immediately after the imports, before `GenerationError`:

```python
SITE_ROOT = Path(__file__).parent
CONFIG_PATH = SITE_ROOT / "zensical.toml"
DOCS_DIR = SITE_ROOT / "docs"
OUTPUT_DIR = SITE_ROOT / "site"
```

Add at the end of the file:

```python
def copy_pages(pages: list[Page], docs_dir: Path, output_dir: Path) -> None:
    """Copy each source page verbatim to its mirrored path in the output.

    Flat, mirroring docs/ exactly — sdk/junit.md, not sdk/junit/index.md. The
    pages' existing relative links (../building/profiles.md) only resolve
    correctly under the flat layout.
    """
    for page in pages:
        destination = output_dir / page.doc_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(docs_dir / page.doc_path, destination)


def generate(site_root: Path) -> int:
    """Write llms.txt and the raw markdown mirror. Returns the page count."""
    config_path = site_root / "zensical.toml"
    docs_dir = site_root / "docs"
    output_dir = site_root / "site"

    if not output_dir.is_dir():
        raise GenerationError(
            f"{output_dir} does not exist — run `zensical build` first"
        )

    project = tomllib.loads(config_path.read_text(encoding="utf-8"))["project"]
    entries = flatten_nav(project["nav"])

    unlisted = find_unlisted(docs_dir, entries)
    if unlisted:
        raise GenerationError(
            "these pages are not in nav, so they would be missing from llms.txt: "
            + ", ".join(unlisted)
        )

    pages = [load_page(entry, docs_dir) for entry in entries]
    copy_pages(pages, docs_dir, output_dir)
    (output_dir / "llms.txt").write_text(
        render_llms_txt(
            site_name=project["site_name"],
            site_description=project["site_description"],
            site_url=project["site_url"],
            pages=pages,
        ),
        encoding="utf-8",
    )
    return len(pages)


def main() -> None:
    try:
        count = generate(SITE_ROOT)
    except GenerationError as error:
        print(f"build_llms: {error}", file=sys.stderr)
        raise SystemExit(1)
    print(f"build_llms: wrote llms.txt and {count} markdown pages to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pipenv run pytest -v
```

Expected: 17 passed.

- [ ] **Step 5: Verify the script fails loudly on the real corpus**

The real pages have no `description:` yet, so this must exit non-zero — proving the guard works before Task 5 satisfies it.

```bash
cd docs/site && pipenv run zensical build && pipenv run python build_llms.py; echo "exit=$?"
```

Expected: a `build_llms: index.md has no ... front matter` line on stderr, and `exit=1`.

- [ ] **Step 6: Commit**

```bash
git add docs/site/build_llms.py docs/site/tests/test_build_llms.py
git commit -m "feat(docs): write llms.txt and the raw markdown mirror"
```

---

### Task 5: Add `description:` front matter to all 24 pages

The content half of the feature. After this task the generator succeeds against the real corpus, and the HTML site gains per-page `<meta name="description">` as a side effect.

**Files:**
- Modify: all 24 files under `docs/site/docs/`

**Interfaces:**
- Consumes: the `description:` contract from Task 2.
- Produces: nothing for later tasks to import.

- [ ] **Step 1: Add front matter to every page**

Insert at the very top of each file, before its `# Heading`, with a blank line after the closing `---`. Keep the double quotes — several values contain `: `, which would break an unquoted YAML scalar.

| File | `description:` value |
| --- | --- |
| `index.md` | `"A data-driven mock server: mock an upstream by creating directories and JSON files under a catalog tree, with no request-handling code."` |
| `get-started/install.md` | `"Run the server via npx, Docker, or from source, and decide whether to persist state in MongoDB."` |
| `get-started/first-mock.md` | `"Add POST /accounts/balance to an existing system, with a default and an insufficient scenario, step by step."` |
| `building/endpoints.md` | `"The _system.json and _endpoint.json metadata that maps a request method and path to a catalog directory."` |
| `building/profiles.md` | `"Per-caller scenario selections, and the selectors that extract a profile ID from an incoming request."` |
| `building/scenarios.md` | `"Scenario slugs, the real passthrough to a live upstream, and sequences that answer differently on each call."` |
| `building/dynamic.md` | `"Back a scenario with a <slug>.mjs module that picks or computes its outcome at request time."` |
| `building/fixtures.md` | `"The <slug>.json fixture shape: status, headers, body, and per-fixture response delay."` |
| `building/templating.md` | `"The {{ … }} engine: placeholder sources, the expression grammar and transforms, custom functions, and type preservation."` |
| `building/schemas.md` | `"Validate requests and responses against an OpenAPI 3.1 operation object in _schema.json."` |
| `building/validate.md` | `"Check a whole catalog in one pass that reports every problem at once, without starting a server."` |
| `driving/ui.md` | `"The management dashboard at /ui: profiles, global mocks, catalog browsing, and live log views."` |
| `driving/api.md` | `"The JSON HTTP API for flipping scenarios, managing profiles, resetting sequence progress, and reading request logs."` |
| `driving/dev-and-ci.md` | `"Point your app at the mock server, choose scenarios per environment, and pick between ephemeral and persistent data."` |
| `driving/request-logs.md` | `"Every received request with its full decision trace, plus querying, trace correlation, and retention."` |
| `driving/console-logs.md` | `"The per-request stdout stream, and the two environment variables governing its verbosity and format."` |
| `sdk/index.md` | `"The four Java Maven artifacts that package the runtime-control API for JVM integration tests, and the versions they pin."` |
| `sdk/java-quickstart.md` | `"A working JUnit integration test against a real mock server, from nothing, in four steps."` |
| `sdk/junit.md` | `"The mock-server-junit Jupiter extension: a per-test profile, the injected handle, and the end-of-test schema check."` |
| `sdk/spring-boot.md` | `"mock-server-spring-boot-test, which points the application under test at the server with no URL plumbing."` |
| `sdk/testcontainers-client.md` | `"MockServerContainer and MockServerClient as plain Java objects, for TestNG, Spock, Kotest, or no test framework at all."` |
| `reference/configuration.md` | `"Canonical reference for every environment variable that governs app-wide behavior."` |
| `reference/request-lifecycle.md` | `"The ordered walk that resolves an incoming request to a response, as implemented in the router."` |
| `reference/gotchas.md` | `"A worked GET example with a path parameter, plus the mistakes that most often produce a surprising response."` |

For example, `docs/site/docs/sdk/junit.md` becomes:

```markdown
---
description: "The mock-server-junit Jupiter extension: a per-test profile, the injected handle, and the end-of-test schema check."
---

# JUnit 5 guide

`mock-server-junit` is a JUnit Jupiter extension. …
```

- [ ] **Step 2: Verify every page has one**

```bash
cd docs/site/docs && find . -name "*.md" -exec grep -L "^description:" {} +
```

Expected: no output. Any path printed is a page still missing its front matter.

- [ ] **Step 3: Run the generator against the real corpus**

```bash
cd docs/site && pipenv run zensical build && pipenv run python build_llms.py
```

Expected: `build_llms: wrote llms.txt and 24 markdown pages to …/docs/site/site`.

- [ ] **Step 4: Verify the output by hand**

```bash
cd docs/site && cat site/llms.txt && head -6 site/sdk/junit.md && ls site/building/
```

Expected: `llms.txt` has six `##` sections in nav order (Overview, Get started, Building mocks, Driving mocks, Testing SDKs, Reference) and 24 bullets with absolute `https://mock-server.bilal-fazlani.com/…​.md` URLs; `site/sdk/junit.md` starts with its front matter; `site/building/` holds all 8 markdown files.

- [ ] **Step 5: Verify the HTML gained meta descriptions**

```bash
cd docs/site && grep -o '<meta name="description"[^>]*>' site/sdk/junit/index.html
```

Expected: one meta tag carrying the JUnit description.

- [ ] **Step 6: Commit**

```bash
git add docs/site/docs
git commit -m "docs: add a description to every page's front matter"
```

---

### Task 6: Wire the generator into the Netlify build

Runs the script on every deploy, declares the correct media types, and fixes a pre-existing gap where `netlify.toml` sat outside its own build trigger.

**Files:**
- Modify: `netlify.toml`

**Interfaces:**
- Consumes: `docs/site/build_llms.py` from Task 4.
- Produces: nothing for later tasks to import.

- [ ] **Step 1: Update the build command**

In `netlify.toml`, replace:

```toml
  command = "zensical build"
```

with:

```toml
  # build_llms.py writes /llms.txt and the raw per-page markdown into the same
  # output directory, after Zensical has produced the HTML. It runs second
  # because Zensical renders any .md left in docs/ rather than copying it.
  command = "zensical build && python build_llms.py"
```

- [ ] **Step 2: Widen the ignore pathspec**

Replace:

```toml
  ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- ':/docs/site'"
```

with:

```toml
  ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- ':/docs/site' ':/netlify.toml'"
```

Also extend the comment above it: this file configures the docs deploy but previously sat outside its own trigger, so a change to the build command or headers alone would push without redeploying.

- [ ] **Step 3: Add the media-type headers**

Append to `netlify.toml`:

```toml
# The machine-readable routes written by build_llms.py. RFC 7763 registers
# text/markdown, and RFC 7764's `variant` parameter is deliberately omitted —
# the content is CommonMark plus Zensical admonitions, not a registered
# variant. No browser renders text/markdown inline, so these URLs download
# rather than display; that is correct for the payload.
[[headers]]
  for = "/*.md"
  [headers.values]
    Content-Type = "text/markdown; charset=utf-8"

[[headers]]
  for = "/llms.txt"
  [headers.values]
    Content-Type = "text/plain; charset=utf-8"
```

- [ ] **Step 4: Verify the file parses and the command works end to end**

```bash
python3 -c "import tomllib,pathlib; c=tomllib.loads(pathlib.Path('netlify.toml').read_text()); print(c['build']['command']); print([h['for'] for h in c['headers']])"
```

Expected: `zensical build && python build_llms.py` and `['/*.md', '/llms.txt']`.

Then reproduce the deploy locally:

```bash
cd docs/site && rm -rf site && pipenv run sh -c "zensical build && python build_llms.py"
```

Expected: exit 0, and `site/llms.txt` exists.

- [ ] **Step 5: Commit**

```bash
git add netlify.toml
git commit -m "build(docs): serve llms.txt and raw markdown from the Netlify deploy"
```

---

### Task 7: CI workflow for the docs toolchain

`ci.yml` skips its whole run on `docs/**` and its only job is Node-only, so the Python tests need a workflow of their own.

**Files:**
- Create: `.github/workflows/docs-checks.yml`

**Interfaces:**
- Consumes: the pytest suite from Tasks 1–4.
- Produces: nothing for later tasks to import.

- [ ] **Step 1: Create the workflow**

```yaml
name: Docs checks

# ci.yml skips its entire run on docs/** and its only job is Node-only, so the
# docs toolchain's Python tests need a workflow of their own. Scoped to
# docs/site/** so a code-only PR never waits on it.
on:
  pull_request:
    paths:
      - 'docs/site/**'
  push:
    branches: [main]
    paths:
      - 'docs/site/**'

permissions:
  contents: read

concurrency:
  group: docs-checks-${{ github.ref }}
  cancel-in-progress: true

jobs:
  pytest:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: docs/site
    steps:
      - name: Checkout
        uses: actions/checkout@v7

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          # Must match Pipfile's python_version and netlify.toml's
          # PYTHON_VERSION so CI tests what the deploy actually runs.
          python-version: '3.14'

      - name: Install pipenv
        run: pipx install pipenv

      # --deploy fails on a Pipfile.lock that is out of date with the Pipfile.
      # Same gate as `npm ci` in ci.yml, for the same reason.
      - name: Install (strict — fails on lockfile drift)
        run: pipenv install --dev --deploy

      - name: Test
        run: pipenv run pytest -v
```

- [ ] **Step 2: Verify the workflow is valid YAML with the expected triggers**

YAML parses a bare `on:` key as the boolean `True`, so the triggers are read back via `True` rather than `"on"`:

```bash
cd docs/site && pipenv run python -c "import yaml,pathlib; w=yaml.safe_load(pathlib.Path('../../.github/workflows/docs-checks.yml').read_text()); print(w[True]); print(list(w['jobs']))"
```

Expected: the trigger mapping with both `paths` lists, and `['pytest']`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/docs-checks.yml
git commit -m "ci: run the docs toolchain tests on docs/site changes"
```

---

### Task 8: Document the new routes

The routes are for machines, but a human has to be able to find out they exist.

**Files:**
- Modify: `docs/site/docs/index.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Add a section to the docs index**

In `docs/site/docs/index.md`, insert a new section immediately before the existing `## Where to go next` heading:

```markdown
## Reading these docs as a machine

Every page on this site is also served as raw markdown at the same path with a
`.md` suffix — [`/sdk/junit.md`](sdk/junit.md) alongside `/sdk/junit/`. Relative
links between pages are preserved, so the markdown corpus can be crawled end to
end without touching the HTML.

[`/llms.txt`](https://mock-server.bilal-fazlani.com/llms.txt) indexes every page
with a one-line description, following the
[llms.txt convention](https://llmstxt.org). Point a coding agent at it and it can
fetch only the pages it needs.
```

- [ ] **Step 2: Add a paragraph to the README**

In `README.md`, in the `## Documentation` section, append after the paragraph ending "…to install and run.":

```markdown
The published site also serves the docs as markdown for programmatic consumers:
[`/llms.txt`](https://mock-server.bilal-fazlani.com/llms.txt) indexes every page,
and each page is served raw at its own path with a `.md` suffix (for example
[`/sdk/junit.md`](https://mock-server.bilal-fazlani.com/sdk/junit.md)). Both are
generated at build time by `docs/site/build_llms.py`.
```

- [ ] **Step 3: Verify the docs still build and the new page is indexed**

```bash
cd docs/site && rm -rf site && pipenv run sh -c "zensical build && python build_llms.py" && grep -c "^- \[" site/llms.txt
```

Expected: exit 0 and `24`.

- [ ] **Step 4: Commit**

```bash
git add docs/site/docs/index.md README.md
git commit -m "docs: describe the llms.txt and raw markdown routes"
```

---

## Final verification

- [ ] Full suite green: `cd docs/site && pipenv run pytest -v` → 17 passed
- [ ] Clean build reproduces the deploy: `cd docs/site && rm -rf site && pipenv run sh -c "zensical build && python build_llms.py"` → exit 0
- [ ] `site/llms.txt` has 6 sections and 24 bullets, all URLs absolute
- [ ] `site/` mirrors `docs/` exactly (written as Python rather than shell process substitution, which fish does not support):

  ```bash
  cd docs/site && pipenv run python -c "import pathlib; d={p.relative_to('docs').as_posix() for p in pathlib.Path('docs').rglob('*.md')}; s={p.relative_to('site').as_posix() for p in pathlib.Path('site').rglob('*.md')}; print('MATCH' if d==s else f'only in docs: {d-s}\nonly in site: {s-d}')"
  ```

  Expected: `MATCH`
- [ ] Deleting a page's `description:` makes the build fail with a clear message (revert after checking)
- [ ] Netlify deploy preview on the PR serves `/llms.txt` and `/sdk/junit.md` with the right `Content-Type`
