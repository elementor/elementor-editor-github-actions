#!/bin/bash
set -eo pipefail

source "${ACTION_PATH}/nightly-tag.sh"

for REQUIRED_VAR in PLUGIN_SLUG CLEAN_PACKAGE_VERSION PACKAGE_VERSION PLUGIN_ZIP_FILENAME BASE_REF; do
	if [[ -z "${!REQUIRED_VAR}" ]]; then
		echo "::error::Missing ${REQUIRED_VAR} input"
		exit 1
	fi
done

NIGHTLY_TAG=$(nightly_tag_for "${BASE_REF}" "${CLEAN_PACKAGE_VERSION}")
NIGHTLY_ZIP_FILENAME="${PLUGIN_SLUG}-${NIGHTLY_TAG}.zip"
NIGHTLY_RELEASE_NAME="Nightly (${BASE_REF})"
# Prefer the merge commit over HEAD, which can advance under concurrent merges to the same branch.
NIGHTLY_COMMIT="${MERGE_COMMIT_SHA:-$(git rev-parse HEAD)}"

# Shallow checkouts only contain the branch tip, so the merge commit may need fetching.
if ! git cat-file -e "${NIGHTLY_COMMIT}^{commit}" 2>/dev/null; then
	git fetch --depth 1 origin "${NIGHTLY_COMMIT}"
fi

cp "${PLUGIN_ZIP_FILENAME}" "${NIGHTLY_ZIP_FILENAME}"

# The tag has to be moved manually because the release action never repoints an existing tag.
git tag --force "${NIGHTLY_TAG}" "${NIGHTLY_COMMIT}"
git push --force origin "refs/tags/${NIGHTLY_TAG}"

if [[ -n "${PR_NUMBER}" ]]; then
	SOURCE_LINE=$(printf -- '- Pull request: [#%s](%s) %s' "${PR_NUMBER}" "${PR_URL}" "${PR_TITLE}")
else
	SOURCE_LINE=$(printf -- '- Triggered manually by %s' "${TRIGGERED_BY:-unknown}")
fi

printf 'Rolling build of `%s`, replaced on every merge. Not a stable release.\n\n- Build version: `%s`\n- Commit: %s\n%s\n' \
	"${BASE_REF}" \
	"${PACKAGE_VERSION}" \
	"${NIGHTLY_COMMIT}" \
	"${SOURCE_LINE}" \
	> "${NIGHTLY_NOTES_FILENAME}"

{
	echo "NIGHTLY_TAG=${NIGHTLY_TAG}"
	echo "NIGHTLY_RELEASE_NAME=${NIGHTLY_RELEASE_NAME}"
	echo "NIGHTLY_ZIP_FILENAME=${NIGHTLY_ZIP_FILENAME}"
	echo "NIGHTLY_NOTES_FILENAME=${NIGHTLY_NOTES_FILENAME}"
} >> "$GITHUB_ENV"

{
	echo "tag=${NIGHTLY_TAG}"
	echo "release-name=${NIGHTLY_RELEASE_NAME}"
	echo "zip=${NIGHTLY_ZIP_FILENAME}"
	echo "notes=${NIGHTLY_NOTES_FILENAME}"
	echo "commit=${NIGHTLY_COMMIT}"
} >> "$GITHUB_OUTPUT"
