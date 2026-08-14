# Keeping the versions the docs advertise in step with what is released

**Date:** 2026-08-14
**Status:** Decisions approved in design session; spec awaiting review
**Issue:** [#85](https://github.com/bilal-fazlani/mock-server/issues/85)
**Surfaces:** Docs site (`docs/site/`), CI (`.github/workflows/`), the SDK repo's release workflow

## Problem

The guide states versions it has no mechanism for keeping current. On the day SDK 2.1.0 and
server 0.11.0 shipped, it advertised `2.0.0` in nine places and `withTag("0.10.0")` in six.
A reader copies a coordinate one or two releases behind and has nothing to tell them so.

Two things are broken, and they are independent:

1. **No substitution.** Version strings are hand-typed prose. Keeping them current is a
   manual sweep nobody remembers to do at release time.
2. **No trigger.** `netlify.toml`'s `ignore` command skips the build unless `docs/site/**`
   or `netlify.toml` changed. A release-please merge touches `package.json`, `CHANGELOG.md`,
   and the manifest — none under `docs/site/` — so **the site does not rebuild when a
   release happens.** A release in `bilal-fazlani/mock-server-java-client` touches this repo
   not at all.

Fixing (1) without (2) ships a rewriter whose output never reaches the site.

## Goal

Every version the docs state about **our own releases** matches the newest published
release, without anyone remembering to check — and every version that deliberately does not
track a release is recorded as such, and stays put.

### Out of scope

- **Third-party versions** (Spring Boot, JUnit, Testcontainers, Jackson, Spring Framework).
  These track what the SDK's build pins, not "latest of that library"; they change when
  `libs.versions.toml` changes, which is a human decision in the other repo.
- **The runtime-control contract version** (`openapi.json`'s `info.version`). A third
  version line with its own rules — `AGENTS.md` already requires it be bumped in the same
  commit as any `/ui/api/*` change, which is a stronger guarantee than polling would give.
- **A version selector / multi-version site.** The guide documents the current release only.
- **The example repository in [#77](https://github.com/bilal-fazlani/mock-server/issues/77)**,
  should it land. It would carry its own coordinates in a third repo. The design below
  extends to it (one more entry in `versions.toml`, one more dispatch source), but nothing
  here waits on it.

## The classification, and why it is the load-bearing part

A sweep over version-shaped strings would be wrong more often than right. Of the ~40 in
`docs/site/docs/`, ~15 should track a release and the rest must not move.

**Tracked — the SDK's latest release** (`sdk_java`), 9 occurrences:

| Shape | Pages |
| --- | --- |
| `com.bilal-fazlani:<artifact>:X.Y.Z` in a Gradle string | `sdk/java-quickstart.md`, `sdk/junit.md`, `sdk/spring-boot.md`, `sdk/testcontainers-client.md` |
| `<version>X.Y.Z</version>` inside a `com.bilal-fazlani` Maven block | the same four |
| `com.bilal-fazlani:<artifact>:X.Y.Z` in prose | `sdk/index.md` |

**Tracked — the server's latest release** (`server`), 6 occurrences:

| Shape | Pages |
| --- | --- |
| `DEFAULT_IMAGE_NAME.withTag("X.Y.Z")` | `sdk/junit.md`, `sdk/spring-boot.md`, `sdk/testcontainers-client.md` |
| `withImage("X.Y.Z")` / `new MockServerContainer("X.Y.Z")` | `sdk/junit.md`, `sdk/spring-boot.md` |

**Exempt — must not move:**

| String | Why |
| --- | --- |
| `0.7.0 or newer` (×4) | a compatibility **floor**. It rises only when the SDK stops working against an older server — a deliberate decision, never a side effect of releasing. |
| `from SDK 2.0.0`, `Safe with virtual threads, from 2.0.0`, `AutoCloseable as of 2.0.0` | permanent historical facts. "Since 2.0.0" is wrong the moment it is rewritten to the current release. |
| Spring Boot `4.1.0`, JUnit `6.1.2`, Testcontainers `2.0.5`, Jackson `2.22.1`/`2.16.0`, Framework `7.0.8` | third-party pins — see Out of scope. |
| contract version `1.0.0` | the third version line — see Out of scope. |
| `my-mocks:1.4.0`, `"service.version":"0.5.0"`, `like 0.10.0` | illustrative samples, not claims about a real release. |

Two entries deserve a second look at implementation time, because they are neither cleanly
tracked nor cleanly exempt:

- **`Pinned in 2.0.0`** and **"Read this as what 2.0.0 is compiled and tested against"**
  (`sdk/index.md`). The *heading* names the current SDK release, so it wants to track — but
  the table under it holds third-party versions that do not. Tracking the heading while the
  rows stay frozen would state something false. Resolution: treat the heading as tracked
  only once the rows are sourced from the SDK's own `libs.versions.toml`; until then, exempt
  the whole block and reword it to name no version ("what the current release is compiled
  and tested against").
- **`Java 21 (LTS) or newer, from SDK 2.0.0`.** A floor and a historical fact in one
  sentence. Exempt.

## Design

Three parts. The third is what makes it a system rather than a script.

### 1. `docs/site/versions.toml` — one source of truth

```toml
# What the docs may state about our own releases. Nothing else in the guide is
# allowed to name one of these products' versions; see tests/test_versions.py.
[current]
server = "0.11.0"    # npm @bilal-fazlani/mock-server, and the ghcr image tag
sdk_java = "2.1.0"   # com.bilal-fazlani:mock-server-*

# Version strings that deliberately do not track a release. Every version-shaped
# string in the corpus must be either tracked or listed here, with a reason.
[[exempt]]
pattern = "0.7.0 or newer"
reason = "compatibility floor; rises only when the SDK drops support for an older server"
```

Committed, human-readable, and the only place a version is written by hand.

### 2. `docs/site/sync_versions.py` — the rewriter

Reads `versions.toml`, rewrites `docs/site/docs/**/*.md` **in place**, reports what changed,
and exits non-zero if it changed nothing when run with `--check`.

Anchored on **meaning, not shape**: it matches `com.bilal-fazlani:<artifact>:` followed by a
version, and the specific `withTag(…)` / `withImage(…)` / `new MockServerContainer("…")`
call forms — never a bare `\d+\.\d+\.\d+`. A version string that is not in one of those
positions is not touched, which is what keeps the exempt list from needing to be exhaustive
in order to be safe.

Sits next to `build_llms.py`, and follows it: same directory, same Pipfile, same test
directory, same `docs-checks.yml` workflow. It runs at **authoring/CI time**, not at deploy
time — unlike `build_llms.py`, which post-processes Zensical's output.

### 3. `docs/site/tests/test_versions.py` — the guard

Run by the existing `docs-checks.yml`. Three assertions:

1. Every **tracked** occurrence equals its `versions.toml` value.
2. Every version-shaped string in the corpus is either tracked or matches an `[[exempt]]`
   entry — an unclassified one fails, naming the file, line, and both remedies.
3. Every `[[exempt]]` entry still matches something — so the list cannot rot into a
   collection of patterns for text nobody has written in a year.

Assertion 2 is the point of the whole design. Without it the failure mode is a new snippet
in a shape the rewriter does not recognise, going stale silently — which is the bug being
fixed, reintroduced one layer down. With it, the failure is a red CI run on the PR that
introduced it. Same shape as `check:prerender` and `tests/ui/openapi.test.ts`.

### 4. Triggers

**The server's own release.** `release-please` opens its PR; a step bumps `[current].server`
in `versions.toml`, runs the rewriter, and commits. Because that touches `docs/site/**`,
Netlify's existing `ignore` rule rebuilds on its own — no build hook, no special case.

**The SDK's release.** Two paths, deliberately both:

- **`repository_dispatch`** from `mock-server-java-client`'s `release.yml`, after the
  deployment reaches `PUBLISHED`. Fires a workflow here that bumps `sdk_java`, runs the
  rewriter, and commits. Immediate.
- **A weekly scheduled workflow** that compares `versions.toml` against Maven Central's
  `solrsearch` API and this repo's own newest GitHub release, and opens a PR on a mismatch.

The cron exists because a dispatch that fails, or a token that expires, leaves the docs
stale with nothing watching — the same silence this whole issue is about. The dispatch gives
speed; the cron makes the system self-healing. Neither is sufficient alone.

## Deploy-count consequence

One extra Netlify deploy per release, not a doubling:

| Step | Touches `docs/site/**` | Deploy |
| --- | --- | --- |
| Feature commits land on `main` | sometimes | 1 — unchanged from today |
| Release-please PR merged | no | 0 — unchanged from today |
| Version-sync commit | yes | **1 — new** |

Ordinary docs pushes are unaffected. The extra build is inherent to "the published site now
shows a new number" and is not avoidable by any mechanism: the placeholder alternative
(below) needs a forced build hook for exactly the same reason, for exactly the same cost.

## Decisions and rejected alternatives

**Rewrite the sources and commit, rather than substituting placeholders at deploy time.**
Deploy count is identical, so it turns on other properties. Committed sources stay correct
under `zensical serve` and when browsed on GitHub, the raw `.md` routes `build_llms.py`
serves get the right values for free rather than needing a second substitution pass, and
each bump is a reviewable, revertable, `git blame`-able diff. Deploy-time substitution would
make the published output non-reproducible from the commit — two builds of the same SHA
producing different pages — which is a poor trade for saving nothing.

**Do not fold the rewriter into the release-please PR (yet).** `extra-files` with the
generic updater could bump `versions.toml` inside the release PR — the SDK repo already does
this for `gradle.properties` — which would get the server half to zero extra deploys. It
also needs a workflow that runs the rewriter on the release branch and pushes to it, adding
moving parts to the release path, which is the path where a bug is most expensive. Deferred
until the build count is a real cost.

**Do not use client-side JavaScript.** It would leave the raw `.md` routes — a first-class
surface here — showing different versions from the HTML, break for readers without JS,
and add a runtime network dependency to a static site.

**Do not use a macros plugin.** Zensical has no plugin or hook system; `build_llms.py`'s
docstring already records this. There is no Jinja in Markdown to reach for.

**Do not make the npm invocation version-pinned.** `npx @bilal-fazlani/mock-server` is
already version-less and resolves to latest on its own — the one place where the problem
does not arise, and it should stay that way.

**Do not track the Docker `docker run` example to a pinned version.** `get-started/install.md`
teaches `:latest` for a first run and pinning separately; that is a deliberate editorial
choice, not staleness.

## Documentation

Internal machinery, so no guide page. `docs/site/README` conventions do not exist; the
Pipfile and this spec are where a reader looks. `AGENTS.md` gains a short rule: a version of
our own products stated in the guide belongs in `versions.toml`, never typed into a page.
