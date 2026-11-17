#!/usr/bin/env bash
# Builds the Slack message that announces the release branch mapping after a
# beta branch-out or a new stable version line, and writes it to the "payload"
# output. Versions that are not passed are read from the branch package.json.

set -euo pipefail

STABLE_BRANCH="${STABLE_BRANCH:-release/stable}"
BETA_BRANCH="${BETA_BRANCH:-release/beta}"
MAIN_BRANCH="${MAIN_BRANCH:-main}"

skip() {
	echo "::warning::$1 Skipping branch structure announcement."
	exit 0
}

extract_major_minor() {
	local version="${1#v}"
	if [[ "$version" =~ ^([0-9]+)\.([0-9]+)(\.[0-9]+)?$ ]]; then
		echo "${BASH_REMATCH[1]}.${BASH_REMATCH[2]}"
	else
		return 1
	fi
}

is_new_version_line() {
	[[ "$1" =~ ^[0-9]+\.[0-9]+\.0$ ]]
}

read_branch_version() {
	local branch="$1"
	git fetch --no-tags --quiet origin "$branch" >&2
	git show "origin/${branch}:package.json" | jq -r '.version // empty'
}

build_beta_branch_out_text() {
	local repo_url="$1" stable="$2" beta="$3" main="$4" bump_outcome="$5"

	local header=":rocket: Beta branch-out is complete!"
	if [ "$bump_outcome" != "success" ]; then
		header=":warning: ${BETA_BRANCH} was reset, but the ${MAIN_BRANCH} version bump did not finish. Manual follow-up required."
	fi

	cat <<EOF
<!channel>
${header}

Repo: ${repo_url}

:package: Version mapping:
:large_green_circle: ${STABLE_BRANCH} → ${stable}
:large_yellow_circle: ${BETA_BRANCH} → ${beta}
:large_blue_circle: ${MAIN_BRANCH} → ${main}
EOF
}

build_stable_release_text() {
	local repo_url="$1" released="$2" stable="$3" beta="$4" main="$5"

	cat <<EOF
<!channel>
:rocket: We have just released ${released}!

Repo: ${repo_url}

:package: Updated version mapping:
:large_green_circle: ${STABLE_BRANCH} → ${stable}
:lock: ${BETA_BRANCH} → ${beta} (locked) - No need to push any changes to this branch until the next beta release.
:large_blue_circle: ${MAIN_BRANCH} → ${main}

:bulb: Reminder: As a best practice, always create your initial branch from ${STABLE_BRANCH} to allow the sync branch to do its job and keep changes properly synchronized across branches.
EOF
}

resolve_major_minor() {
	local version="$1" branch="$2"
	if [ -z "$version" ]; then
		version="$(read_branch_version "$branch" || true)"
	fi
	extract_major_minor "$version"
}

announce_branch_structure() {
	local event="${EVENT:-}"
	local repo_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}"

	if [ "${DRY_RUN:-false}" != "true" ] && [ -z "${SLACK_CHANNEL:-}" ]; then
		skip "The Slack channel is not set."
	fi

	local text
	case "$event" in
		beta-branch-out)
			local stable beta main
			stable="$(resolve_major_minor "${STABLE_VERSION:-}" "$STABLE_BRANCH")" || skip "Could not resolve the stable version."
			beta="$(resolve_major_minor "${BETA_VERSION:-}" "$BETA_BRANCH")" || skip "Could not resolve the beta version."
			main="$(resolve_major_minor "${MAIN_VERSION:-}" "$MAIN_BRANCH")" || skip "Could not resolve the main version."
			text="$(build_beta_branch_out_text "$repo_url" "$stable" "$beta" "$main" "${BUMP_PR_OUTCOME:-success}")"
			;;
		stable-release)
			local released="${STABLE_VERSION:-}"
			if ! is_new_version_line "$released"; then
				echo "${released} is not a new version line. Skipping branch structure announcement."
				exit 0
			fi
			local stable beta main
			stable="$(extract_major_minor "$released")"
			beta="$(resolve_major_minor "${BETA_VERSION:-}" "$BETA_BRANCH")" || skip "Could not resolve the beta version."
			main="$(resolve_major_minor "${MAIN_VERSION:-}" "$MAIN_BRANCH")" || skip "Could not resolve the main version."
			text="$(build_stable_release_text "$repo_url" "$released" "$stable" "$beta" "$main")"
			;;
		*)
			skip "Unknown event: '${event}'."
			;;
	esac

	local payload
	payload="$(jq -c -n --arg text "$text" --arg channel "${SLACK_CHANNEL:-}" '{channel:$channel,text:$text}')"

	if [ "${DRY_RUN:-false}" = "true" ]; then
		echo "$text"
		exit 0
	fi

	echo "payload=${payload}" >> "$GITHUB_OUTPUT"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	announce_branch_structure
fi
