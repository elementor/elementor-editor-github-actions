#!/usr/bin/env bash
# Locks or unlocks a release branch by toggling the enforcement of a dedicated
# repository ruleset holding a single "update" rule. Creates the ruleset when missing.

set -euo pipefail

REPO="${GITHUB_REPOSITORY:-}"
STATE="${STATE:-}"
BRANCH="${BRANCH:-release/beta}"
export RULESET_NAME="${RULESET_NAME:-Release beta lock}"

resolve_enforcement() {
	case "$1" in
		locked) echo "active" ;;
		unlocked) echo "disabled" ;;
		*) return 1 ;;
	esac
}

find_ruleset_id() {
	local ids
	ids="$(gh api "repos/${REPO}/rulesets" --paginate --jq '.[] | select(.name == env.RULESET_NAME and .source_type == "Repository") | .id')" || return $?
	echo "$ids" | head -n 1
}

build_ruleset_payload() {
	local enforcement="$1"

	jq -n \
		--arg name "$RULESET_NAME" \
		--arg ref "refs/heads/${BRANCH}" \
		--arg enforcement "$enforcement" \
		'{
			name: $name,
			target: "branch",
			enforcement: $enforcement,
			conditions: { ref_name: { include: [$ref], exclude: [] } },
			rules: [{ type: "update" }]
		}'
}

apply_lock_state() {
	local enforcement ruleset_id

	if [ -z "$REPO" ]; then
		echo "::error::GITHUB_REPOSITORY is not set"
		return 1
	fi

	if ! enforcement="$(resolve_enforcement "$STATE")"; then
		echo "::error::Invalid state '${STATE}'. Expected 'locked' or 'unlocked'"
		return 1
	fi

	if ! ruleset_id="$(find_ruleset_id)"; then
		report_api_failure "list rulesets"
		return 1
	fi

	if [ -z "$ruleset_id" ]; then
		if ! build_ruleset_payload "$enforcement" | gh api --method POST "repos/${REPO}/rulesets" --input - >/dev/null; then
			report_api_failure "create ruleset '${RULESET_NAME}'"
			return 1
		fi
		echo "::notice::Created ruleset '${RULESET_NAME}' - ${BRANCH} is now ${STATE}"
	else
		if ! build_ruleset_payload "$enforcement" | gh api --method PUT "repos/${REPO}/rulesets/${ruleset_id}" --input - >/dev/null; then
			report_api_failure "update ruleset '${RULESET_NAME}' (#${ruleset_id})"
			return 1
		fi
		echo "::notice::Updated ruleset '${RULESET_NAME}' (#${ruleset_id}) - ${BRANCH} is now ${STATE}"
	fi
}

report_api_failure() {
	local operation="$1"

	echo "::error title=Release beta lock failed::Could not ${operation}, so ${BRANCH} was NOT ${STATE}. The token needs repository Administration write permission."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	apply_lock_state
fi
