#!/bin/bash
# Clones Core into ../elementor at the exact commit a Pro evidence run tested.
# The caller's own clone-core.sh may be an older copy that only clones a
# branch head, which has moved on since the run.
set -euo pipefail

: "${ELEMENTOR_CORE_BRANCH:?ELEMENTOR_CORE_BRANCH is required}"
: "${ELEMENTOR_CORE_SHA:?ELEMENTOR_CORE_SHA is required}"

rm -rf ../elementor
echo "Cloning ELEMENTOR_CORE_BRANCH: ${ELEMENTOR_CORE_BRANCH}"
git clone --single-branch --branch "${ELEMENTOR_CORE_BRANCH}" https://github.com/elementor/elementor.git ../elementor
git -C ../elementor checkout --quiet "${ELEMENTOR_CORE_SHA}"

echo "Core commit: $(git -C ../elementor rev-parse HEAD)"
