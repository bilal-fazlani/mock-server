#!/usr/bin/env bash
# Answers "is <tag> the highest published release?" for every release workflow.
#
#   release-order.sh <tag>
#
# Compares <tag> by semver (not by creation date) against every published,
# non-prerelease release and prints, ready to append to $GITHUB_OUTPUT or to source:
#   highest=<tag>       the highest stable release, <tag> included
#   is_highest=<bool>   true only when <tag> is a stable version equal to highest
#   npm_tag=<dist-tag>  latest | next (prerelease) | <major>.<minor>-backport
#
# RELEASE_TAGS (newline separated) replaces the GitHub lookup, for tests.
set -euo pipefail

tag=${1:?usage: release-order.sh <tag>}
stable='^v[0-9]+\.[0-9]+\.[0-9]+$'

if [ -n "${RELEASE_TAGS+x}" ]; then
  published=$RELEASE_TAGS
else
  published=$(gh release list --repo "$GITHUB_REPOSITORY" \
    --exclude-drafts --exclude-pre-releases --limit 1000 \
    --json tagName --jq '.[].tagName')
fi

highest=$( { printf '%s\n' "$published"; printf '%s\n' "$tag"; } \
  | grep -E "$stable" | sort -uV | tail -n 1 || true)

if ! printf '%s' "$tag" | grep -Eq "$stable"; then
  is_highest=false
  npm_tag=next
elif [ "$tag" = "$highest" ]; then
  is_highest=true
  npm_tag=latest
else
  is_highest=false
  version=${tag#v}
  npm_tag="${version%.*}-backport"
fi

echo "highest=$highest"
echo "is_highest=$is_highest"
echo "npm_tag=$npm_tag"
