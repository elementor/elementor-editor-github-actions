#!/usr/bin/env bash
# Force pushes the source branch onto the target branch and reports the PRs
# that only the target branch contains, since the push drops them.
#
# Required environment variables:
#   SOURCE_BRANCH      - branch whose tip replaces the target (e.g. release/beta)
#   TARGET_BRANCH      - branch that is overwritten (e.g. release/stable)
#   DRY_RUN            - "true" to only report, without pushing
#   GITHUB_REPOSITORY  - owner/repo, used for PR links

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=list-stable-only-prs.sh
source "${SCRIPT_DIR}/list-stable-only-prs.sh"

SUMMARY_FILE="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
OUTPUT_FILE="${GITHUB_OUTPUT:-/dev/null}"

require_env() {
	local name="$1"
	if [ -z "${!name:-}" ]; then
		echo "::error::Missing required environment variable: $name"
		exit 1
	fi
}

require_env SOURCE_BRANCH
require_env TARGET_BRANCH
require_env DRY_RUN
require_env GITHUB_REPOSITORY

if [ "$SOURCE_BRANCH" = "$TARGET_BRANCH" ]; then
	echo "::error::Source and target branches must differ (both are ${SOURCE_BRANCH})"
	exit 1
fi

git fetch --no-tags origin \
	"+refs/heads/${SOURCE_BRANCH}:refs/remotes/origin/${SOURCE_BRANCH}" \
	"+refs/heads/${TARGET_BRANCH}:refs/remotes/origin/${TARGET_BRANCH}"

source_sha="$(git rev-parse "origin/${SOURCE_BRANCH}")"
target_sha="$(git rev-parse "origin/${TARGET_BRANCH}")"

rows="$(collect_target_only_prs "origin/${SOURCE_BRANCH}" "origin/${TARGET_BRANCH}")"
commit_count="$(grep -c . <<< "$rows" || true)"

{
	echo "count=${commit_count}"
	echo "prs=$(pr_numbers_as_json "$rows")"
	echo "rollback-sha=${target_sha}"
} >> "$OUTPUT_FILE"

{
	echo "## Force push \`${SOURCE_BRANCH}\` to \`${TARGET_BRANCH}\`"
	echo
	echo "| | |"
	echo "| --- | --- |"
	echo "| **${SOURCE_BRANCH}** | \`${source_sha}\` |"
	echo "| **${TARGET_BRANCH}** (rollback SHA) | \`${target_sha}\` |"
	echo "| **Dry run** | ${DRY_RUN} |"
	echo
	echo "### ${commit_count} commits in \`${TARGET_BRANCH}\` that are not in \`${SOURCE_BRANCH}\`"
	echo
	if [ "$commit_count" -gt 0 ]; then
		render_markdown_table "$rows" "$GITHUB_REPOSITORY"
	else
		echo "None. The force push drops no changes."
	fi
	echo
} >> "$SUMMARY_FILE"

if [ "$source_sha" = "$target_sha" ]; then
	echo "${TARGET_BRANCH} already matches ${SOURCE_BRANCH}. Nothing to push." | tee -a "$SUMMARY_FILE"
	exit 0
fi

if [ "$DRY_RUN" = "true" ]; then
	echo "Dry run: ${TARGET_BRANCH} was not changed." | tee -a "$SUMMARY_FILE"
	exit 0
fi

git push --force-with-lease="refs/heads/${TARGET_BRANCH}:${target_sha}" \
	origin "${source_sha}:refs/heads/${TARGET_BRANCH}"

{
	echo "Pushed \`${source_sha}\` to \`${TARGET_BRANCH}\`."
	echo
	echo "To roll back:"
	echo
	echo '```bash'
	echo "git push --force-with-lease=refs/heads/${TARGET_BRANCH}:${source_sha} origin ${target_sha}:refs/heads/${TARGET_BRANCH}"
	echo '```'
} >> "$SUMMARY_FILE"
