# Machine-readable docs routes — `/llms.txt` and per-page raw markdown

**Date:** 2026-08-11
**Status:** Decisions approved in design session; spec awaiting review
**Issue:** [#76](https://github.com/bilal-fazlani/mock-server/issues/76)
**Surfaces:** Docs site build (`docs/site/`), Netlify config (`netlify.toml`), CI (`.github/workflows/`)

## Problem

The docs site serves HTML only. There is no machine-readable route:

```
https://mock-server.bilal-fazlani.com/llms.txt              -> not served
https://mock-server.bilal-fazlani.com/sdk/spring-boot.md    -> 404
```

Consuming the docs programmatically therefore means fetching HTML and stripping tags,
which is lossy: code fences, table structure, and admonition boundaries all degrade. The
tables on `/sdk/` and `/sdk/junit/` carry a lot of this project's load-bearing detail.

For a testing tool released in 2026, a meaningful share of first contact is through a
coding agent rather than a human reading the site. This project suits that unusually well
— the catalog is declarative files, the SDK is a small surface, and the docs are precise
enough that an agent can author a working catalog and test suite from prose alone. The
format is the only thing in the way.

## Goal

Serve the documentation as markdown alongside the HTML, discoverable from a single index:

1. **`/llms.txt`** — a grouped index of every page: title, absolute URL, one-line description.
2. **Per-page raw markdown** — `docs/sdk/junit.md` served verbatim at `/sdk/junit.md`.

The rendered HTML site is unchanged in structure, navigation, and URLs.

### Out of scope

**`/llms-full.txt`** (the whole corpus concatenated, ~247 KB / ~62k tokens). The index plus
selective per-page fetches covers the same need at a fraction of the context cost, and the
concatenated form needs link rewriting that the per-page form does not (see below).
Deliberately deferred, not rejected: `build_llms.py` holds every page's text in memory at
the point it writes `llms.txt`, so adding it later is a few lines, not a redesign.

## Constraints discovered

- **Zensical has no plugin or hook system.** `hooks` is listed among the unsupported
  MkDocs settings; the module system is still in development. The MkDocs `llmstxt` plugin
  route is unavailable, so generation must be a script wrapped around `zensical build`.
- **A `.md` file left in `docs/` gets rendered to HTML**, not copied. The raw markdown
  must therefore be written into the build output *after* Zensical runs, not staged as a
  source asset.
- **The docs are clean markdown.** 24 pages, no front matter today, no content tabs, no
  snippet includes. The only Material-specific syntax is 42 `!!!` admonitions, which stay
  legible as raw text.
- **All 125 internal cross-page links are `path/file.md` or `path/file.md#anchor`.** No
  link uses a directory-style URL. This is what makes the layout below work.

## Output layout

The source tree mirrors 1:1 into the build output:

| Source | Served at | Content-Type |
| --- | --- | --- |
| `docs/sdk/junit.md` | `/sdk/junit.md` | `text/markdown; charset=utf-8` |
| `docs/building/profiles.md` | `/building/profiles.md` | `text/markdown; charset=utf-8` |
| `docs/index.md` | `/index.md` | `text/markdown; charset=utf-8` |
| *(generated)* | `/llms.txt` | `text/plain; charset=utf-8` |

**The flat mapping is load-bearing.** The HTML site uses directory URLs
(`/sdk/junit/`), so `/sdk/junit/index.md` looks like the natural twin. It is not:

- From `/sdk/junit.md`, the existing link `../building/profiles.md` resolves to
  `/building/profiles.md` ✓
- From `/sdk/junit/index.md`, the same link resolves to `/sdk/building/profiles.md` ✗

Mirroring the source tree flat means all 125 relative links keep working **unchanged**,
and the markdown corpus is crawlable end to end with zero rewriting. This is the single
strongest reason per-page markdown beats a concatenated file for this site.

The HTML site keeps its existing directory URLs. `/sdk/junit/` and `/sdk/junit.md` are the
same content in two formats.

## `build_llms.py`

A single dependency-light Python script at `docs/site/build_llms.py`, run after
`zensical build`.

**Nav is the authority.** The script reads `nav` from `zensical.toml` with `tomllib`
(stdlib on Python 3.14, already pinned by the Pipfile and `netlify.toml`). Nav supplies
both the page order and the section titles, so `llms.txt` groups exactly as the sidebar
does and no second list of pages can drift out of sync.

For each nav entry: read the source file, parse front matter with PyYAML, take
`description`, and copy the file verbatim to its mirrored path under `site/`.

**Output format** (`llmstxt.org`), with absolute URLs built from `site_url`:

```markdown
# Mock Server

> A data-driven mock server: you mock an upstream service by creating directories
> and JSON files under a `catalog/` tree — no request-handling code — and the
> routing engine serves them.

## Get started
- [Install & run](https://mock-server.bilal-fazlani.com/get-started/install.md): <description>
- [Your first mock endpoint](https://mock-server.bilal-fazlani.com/get-started/first-mock.md): <description>

## Building mocks
- [Endpoints](https://mock-server.bilal-fazlani.com/building/endpoints.md): <description>
...
```

The blockquote summary comes from `site_description` in `zensical.toml`.

### Failure modes

The script exits non-zero — failing the Netlify build — when:

- a page named in `nav` is missing from disk,
- a page has no `description` in its front matter,
- a `.md` file under `docs/` is absent from `nav`.

A machine-readable route is one nobody looks at by hand, so silent incompleteness would
persist indefinitely. Failing the build is the only reliable guard.

## Front matter

All 24 pages gain a one-line `description:`. This is the single source of truth for the
page summary — it lives next to the content, so a new page carries its own description or
the build fails.

The served `.md` keeps its front matter verbatim. It is useful metadata for the consumer,
and a plain copy is more robust than a parse-and-rewrite.

Side effect, and a welcome one: Zensical turns `description` into the page's
`<meta name="description">`, which the site currently lacks per page.

## Layout

```
docs/site/
  Pipfile              # [packages] zensical, pyyaml | [dev-packages] pytest
  conftest.py          # empty — puts docs/site on sys.path for the tests
  build_llms.py
  tests/
    test_build_llms.py
  zensical.toml
  docs/                # the 24 pages
```

Everything the docs toolchain needs — build config, generator, tests, dependency manifest
— sits in one directory. `pytest` under `[dev-packages]` keeps it out of Netlify's plain
`pipenv install`.

The empty `conftest.py` is load-bearing: with no `__init__.py` under `tests/`, pytest
inserts the rootdir containing `conftest.py` onto `sys.path`, which is what lets
`test_build_llms.py` do `import build_llms`.

## Netlify wiring

Three changes to `netlify.toml`:

1. **Build command** → `zensical build && pipenv run python build_llms.py`

   The `pipenv run` prefix is required and was missed on the first deploy.
   Netlify's automatic `pipenv install` puts *console scripts* on PATH — a
   console script carries a shebang pointing into the virtualenv, which is why
   `zensical` needs no prefix. Bare `python` gets no such treatment: it resolves
   to the system interpreter, which cannot see the virtualenv's site-packages,
   so the build died on `ModuleNotFoundError: No module named 'yaml'` *after*
   Zensical had already reported success.
2. **Headers** for the new routes:

   ```toml
   [[headers]]
     for = "/*.md"
     [headers.values]
       Content-Type = "text/markdown; charset=utf-8"

   [[headers]]
     for = "/llms.txt"
     [headers.values]
       Content-Type = "text/plain; charset=utf-8"
   ```

3. **Ignore pathspec** widens to `':/docs/site' ':/netlify.toml'`. The file is currently
   outside its own build trigger, so a headers-only edit would push and deploy nothing.

## CI

A new `.github/workflows/docs-checks.yml`, triggered on `docs/site/**`, runs
`pipenv install --dev && pipenv run pytest`.

It needs to be a separate workflow: `ci.yml` skips its entire run on `docs/**`
(`paths-ignore`), and its one job is Node-only. Scoping the new workflow to `docs/site/**`
means it never slows a code-only PR.

## Testing

`docs/site/tests/test_build_llms.py`, pytest, against a fixture docs tree in `tmp_path`:

- nav flattening preserves section grouping and page order
- description extraction from front matter
- missing `description` exits non-zero
- a nav page missing from disk exits non-zero
- a `.md` under `docs/` missing from nav exits non-zero
- source path → output path mapping (including `index.md` at the root)
- rendered `llms.txt` matches the expected document

Beyond unit tests, Netlify deploy previews build the real site on any PR touching
`docs/site/`, so a generator that crashes on the actual corpus is caught before merge.

## Documentation

A short note on the `/llms.txt` and `.md` routes in the docs index and the README, so the
routes are discoverable by humans too.

## Decisions and rejected alternatives

| Decision | Alternative rejected | Why |
| --- | --- | --- |
| Post-build script | MkDocs `llmstxt` plugin / a Zensical hook | Zensical supports neither |
| `/llms.txt` + per-page `.md` | Adding `/llms-full.txt` now | 62k tokens per fetch; the index plus selective fetch covers it. Cheap to add later |
| Flat `/sdk/junit.md` | `/sdk/junit/index.md` | Directory form breaks all 125 relative links |
| `description:` front matter | Auto-extracting the first sentence | Uneven quality, and untunable without rewriting prose |
| `description:` front matter | A title→description map inside the script | A second list that drifts from nav the moment a page is added |
| `text/markdown; charset=utf-8` | `text/plain` | RFC 7763 registers `text/markdown`; `text/plain` optimizes hand-verification in a browser at the cost of misdeclaring the payload |
| No `variant=` parameter | `variant=GFM` | Content is CommonMark plus Zensical admonitions — not a registered variant |
| Python in `docs/site/` | Node `.mjs` in `scripts/` | `netlify.toml`'s ignore pathspec covers `:/docs/site`; a generator outside it would let bug fixes push without redeploying |
| PyYAML as a build dependency | A hand-rolled front-matter reader | Fragile on quoting and multiline values. Zensical likely pulls PyYAML transitively, but depending on that is worse than declaring it |
