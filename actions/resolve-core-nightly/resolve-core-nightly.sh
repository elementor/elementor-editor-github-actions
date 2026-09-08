#!/bin/bash
set -eo pipefail

# Consumer side of the nightly tag contract, so the naming rule stays defined in one place.
source "${ACTION_PATH}/../publish-nightly-release/nightly-tag.sh"

if [[ -z "${CORE_BRANCH}" ]]; then
	echo "::error::Missing core-branch input"
	exit 1
fi

if [[ -n "${BETA_BRANCH_ALIAS}" && "${CORE_BRANCH}" == "${BETA_BRANCH_ALIAS}" ]]; then
	CORE_BRANCH="${BETA_BRANCH}"
fi

core_api() {
	curl -fsSL -H "Authorization: Bearer ${GITHUB_TOKEN}" -H "Accept: $2" "$1"
}

if ! CORE_PACKAGE_JSON=$(core_api \
	"https://api.github.com/repos/${CORE_REPO}/contents/package.json?ref=${CORE_BRANCH}" \
	"application/vnd.github.raw"); then
	echo "::error::Unable to read package.json from Core branch ${CORE_BRANCH}"
	exit 1
fi

CORE_PACKAGE_VERSION=$(jq -r '.version // ""' <<< "${CORE_PACKAGE_JSON}")

if [[ -z "${CORE_PACKAGE_VERSION}" || "${CORE_PACKAGE_VERSION}" == "null" ]]; then
	echo "::error::No version field in package.json on Core branch ${CORE_BRANCH}"
	exit 1
fi

CORE_RELEASE_TAG=$(nightly_tag_for "${CORE_BRANCH}" "${CORE_PACKAGE_VERSION}")

if ! CORE_RELEASE=$(core_api \
	"https://api.github.com/repos/${CORE_REPO}/releases/tags/${CORE_RELEASE_TAG}" \
	"application/vnd.github+json"); then
	echo "::error::No Core nightly release tagged ${CORE_RELEASE_TAG} for branch ${CORE_BRANCH}"
	exit 1
fi

CORE_ZIP_URL=$(jq -r 'first(.assets[] | select(.name | endswith(".zip")) | .browser_download_url) // ""' <<< "${CORE_RELEASE}")

if [[ -z "${CORE_ZIP_URL}" ]]; then
	echo "::error::Core nightly release ${CORE_RELEASE_TAG} has no zip asset"
	exit 1
fi

echo "Core branch ${CORE_BRANCH} resolved to ${CORE_RELEASE_TAG} (version ${CORE_PACKAGE_VERSION})"

if [[ -n "${CORE_ZIP_PATH}" ]]; then
	curl -fsSL -H "Authorization: Bearer ${GITHUB_TOKEN}" "${CORE_ZIP_URL}" -o "${CORE_ZIP_PATH}"
	ls -lh "${CORE_ZIP_PATH}"
fi

{
	echo "CORE_RELEASE_TAG=${CORE_RELEASE_TAG}"
	echo "CORE_PACKAGE_VERSION=${CORE_PACKAGE_VERSION}"
	echo "CORE_ZIP_URL=${CORE_ZIP_URL}"
	echo "ELEMENTOR_CORE_BRANCH=${CORE_BRANCH}"
} >> "$GITHUB_ENV"

{
	echo "tag=${CORE_RELEASE_TAG}"
	echo "version=${CORE_PACKAGE_VERSION}"
	echo "zip-url=${CORE_ZIP_URL}"
	echo "branch=${CORE_BRANCH}"
} >> "$GITHUB_OUTPUT"
