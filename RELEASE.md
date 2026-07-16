# Releasing

Releases are automated with [release-please](https://github.com/googleapis/release-please).
You do **not** bump versions, write changelogs, tag, or draft releases by hand — you write
[Conventional Commits](https://www.conventionalcommits.org) (see [AGENTS.md](AGENTS.md)) and
**merge a bot-maintained PR** when you want to ship.

Two artifacts publish from every release, in lockstep:

| Artifact | Registry | Workflow |
| --- | --- | --- |
| npm package `@bilal-fazlani/mock-server` | npmjs.com | [`publish-npm.yml`](.github/workflows/publish-npm.yml) |
| Container image `ghcr.io/bilal-fazlani/mock-server` | GitHub Container Registry | [`publish-image.yml`](.github/workflows/publish-image.yml) |

## How it works

1. You merge normal PRs to `main` with Conventional Commit messages/titles (`feat:`, `fix:`, …).
2. [`release-please.yml`](.github/workflows/release-please.yml) runs on each push to `main` and
   maintains a standing **release PR** titled like `chore(main): release 0.2.0`. That PR bumps
   `package.json`, updates `CHANGELOG.md`, and drafts the notes — all computed from the commits
   since the last release. It auto-updates as more work lands.
3. When you're ready to ship, **merge the release PR.** release-please tags `vX.Y.Z` and creates
   the GitHub Release.
4. Publishing the Release triggers both publish workflows → npm + the multi-arch image go out,
   tagged with the same version.

`package.json`, the git tag, npm, and the image tags all derive from one computed version, so
they can never drift apart.

## One-time setup

- [x] **`NPM_TOKEN` secret** — npm automation token with publish rights for `@bilal-fazlani/*`.
      Used by `publish-npm.yml`. *(done)*
- [ ] **`RELEASE_PLEASE_TOKEN` secret** — **required for automation to publish anything.**
      A Release created with the default `GITHUB_TOKEN` does **not** trigger other workflows
      (GitHub blocks `GITHUB_TOKEN`-initiated events from starting new runs), so the publish
      workflows would never fire. Give release-please a token that *can* trigger them:
    - Simplest: a **fine-grained Personal Access Token** scoped to this repo with
      **Contents: read & write** and **Pull requests: read & write**, saved as the repo secret
      `RELEASE_PLEASE_TOKEN`. (Set a calendar reminder for its expiry.)
    - Zero-maintenance alternative: a **GitHub App** token via `actions/create-github-app-token`
      (no expiry) — more setup, swap it into `release-please.yml` if you prefer.
- [ ] **ghcr visibility** — after the first image publish, make the package public in the repo's
      Packages settings if you want anonymous `docker pull`.

## Versioning (all automatic, from commit types)

| Commits since last release | Next version |
| --- | --- |
| only `fix:` / `perf:` | patch (`0.1.0` → `0.1.1`) |
| any `feat:` | minor (`0.1.0` → `0.2.0`) |
| breaking (`feat!:` or `BREAKING CHANGE:`) | pre-1.0: minor; post-1.0: major |
| only `docs:` / `chore:` / `ci:` / `refactor:` / `test:` | no release PR is opened |

Pre-1.0 behavior is set in [`release-please-config.json`](release-please-config.json)
(`bump-minor-pre-major: true`), so breaking changes stay in `0.x` until you deliberately go 1.0.

**Force a specific version** (e.g. the first stable `1.0.0`): add a `Release-As: 1.0.0` footer to
a commit — release-please writes it into `package.json` and tags it. Never edit the version by hand.

> **First release:** with no prior release tag, the first release PR summarizes recent history and
> may be large — review/trim it before merging. This is the moment to cut `1.0.0` if you're ready
> (`Release-As: 1.0.0`); otherwise it starts from the `0.1.0` baseline in
> [`.release-please-manifest.json`](.release-please-manifest.json).

## Where release notes live

release-please writes them for you into `CHANGELOG.md` and the GitHub Release body, grouped by
type (Features, Bug Fixes, …). To adjust wording before shipping, **edit the release PR**
(`CHANGELOG.md` or the PR body) before merging — it's a normal PR.

## Prereleases

- Marking the GitHub Release as a pre-release skips the `latest` **image** tag (the image still
  gets its `X.Y.Z` tag).
- ⚠️ The **npm** workflow always publishes to the `latest` dist-tag. For a prerelease on npm
  without moving `latest`, publish manually with a dist-tag
  (`npm publish --provenance --access public --tag next`) or extend `publish-npm.yml`.

## Re-running a failed publish

Both publish workflows also support `workflow_dispatch`. Re-run against the tag ref:

```bash
gh workflow run publish-npm.yml   --ref v1.4.0
gh workflow run publish-image.yml --ref v1.4.0
```

npm rejects re-publishing an existing version — to redo a broken `1.4.0` you must release a new
version. (You can also always cut a release the fully-manual way by tagging and publishing a
GitHub Release yourself; the publish workflows key off `release: published` either way.)

## Verifying a release

```bash
npm view @bilal-fazlani/mock-server version
npx @bilal-fazlani/mock-server ./catalog                       # boots on embedded Mongo, no deps

docker run --rm -p 3000:3000 ghcr.io/bilal-fazlani/mock-server:1.4.0
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/ui
```

**First release, extra check:** the `linux/amd64` image is built under QEMU in CI and hasn't run
on native amd64 — after the first release, `docker run --platform linux/amd64 …` and confirm the
embedded `mongod` launches (log shows the embedded-Mongo notice and serves a request).

## Troubleshooting

- **Release PR is created and merged, but nothing publishes** — the classic symptom of a missing
  or wrong `RELEASE_PLEASE_TOKEN`: the Release was created with `GITHUB_TOKEN` and couldn't trigger
  the publish workflows. Fix the secret, then re-run the publish workflows via `workflow_dispatch`
  against the tag.
- **No release PR appears** — there are no releasing commits since the last release (only
  `docs:`/`chore:`/etc.), or a commit message isn't valid Conventional Commits.
- **npm publish fails `403`/`EEXIST`** — version already published, or `NPM_TOKEN` lacks rights for
  the `@bilal-fazlani` scope.
- **Provenance error** — `publish-npm.yml` needs `id-token: write` (present) and `package.json`
  needs a `repository` field (present); provenance requires a public repo.
- **Wrong/missing image tags (e.g. no `latest`)** — the Release was marked pre-release, or the tag
  isn't valid `vX.Y.Z` SemVer.
