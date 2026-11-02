#!/usr/bin/env bash
#
# Unpacks a healer build into the workspace. The build is an artifact, and the
# PR's code runs in this workflow run, so it could have replaced it: only the
# paths a real build contains get unpacked, and only after every path is checked.
#
# Usage: unpack-healer-build.sh <archive> <core|pro>

set -euo pipefail

ARCHIVE="$1"
PRODUCT="$2"

case "$PRODUCT" in
  core)
    ALLOWED='^build(/|$)'
    ENTRIES=(build)
    ;;
  pro)
    ALLOWED='^(elementor|elementor-pro)(/|$)|^elementor\.zip$'
    ENTRIES=(elementor elementor-pro elementor.zip)
    ;;
  *)
    echo "::error::Unknown product '${PRODUCT}'."
    exit 1
    ;;
esac

LISTING=$(tar -tzf "$ARCHIVE")

if grep -Ev "$ALLOWED" <<< "$LISTING" | grep -q . || grep -Eq '(^|/)\.\.(/|$)' <<< "$LISTING"; then
  echo "::error::The build archive holds paths a healer build never has."
  exit 1
fi

UNPACKED=$(mktemp -d "${RUNNER_TEMP:-/tmp}/healer-build.XXXXXX")
tar -xzf "$ARCHIVE" -C "$UNPACKED"

for ENTRY in "${ENTRIES[@]}"; do
  rm -rf "./${ENTRY}"
  mv "${UNPACKED}/${ENTRY}" "./${ENTRY}"
done

rm -rf "$UNPACKED"
