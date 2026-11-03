#!/usr/bin/env bash
# Test suite for release-beta-lock.sh
# Run with: bash release-beta-lock.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="${SCRIPT_DIR}/release-beta-lock.sh"
FAILURES=0
TESTS_RUN=0
STUB_DIR="$(mktemp -d)"
trap 'rm -rf "$STUB_DIR"' EXIT

assert_equals() {
	local expected="$1"
	local actual="$2"
	local message="${3:-}"

	TESTS_RUN=$((TESTS_RUN + 1))

	if [ "$expected" = "$actual" ]; then
		echo "  ✓ ${message}"
		return 0
	else
		echo "  ✗ ${message}"
		echo "    Expected: ${expected}"
		echo "    Got: ${actual}"
		FAILURES=$((FAILURES + 1))
		return 1
	fi
}

# Run test in clean subshell with environment variables passed as arguments
run_isolated() {
	env -i PATH="$PATH" HOME="$HOME" STUB_DIR="$STUB_DIR" SCRIPT_PATH="$SCRIPT_PATH" "$@" bash -c '
		source "$SCRIPT_PATH"
		[ -f "$STUB_DIR/stub.sh" ] && source "$STUB_DIR/stub.sh"
		apply_lock_state
	'
}

# Create stub file that defines gh function
create_stub_gh() {
	local stub_ruleset_id="$1"
	: >"${STUB_DIR}/calls"
	: >"${STUB_DIR}/payload"
	
	cat >"${STUB_DIR}/stub.sh" <<'EOF'
gh() {
	echo "$*" >>"${STUB_DIR}/calls"
	if [[ "$*" == *"--paginate"* ]]; then
		[ -n "${STUB_RULESET_ID:-}" ] && echo "$STUB_RULESET_ID"
		return 0
	fi
	if [[ "$*" == *"--input -"* ]]; then
		cat >"${STUB_DIR}/payload"
	fi
}
EOF
	echo "STUB_RULESET_ID='$stub_ruleset_id'" >>"${STUB_DIR}/stub.sh"
}

create_stub_gh_with_json() {
	local json_response="$1"
	: >"${STUB_DIR}/calls"
	: >"${STUB_DIR}/payload"
	
	cat >"${STUB_DIR}/stub.sh" <<'EOF'
gh() {
	echo "$*" >>"${STUB_DIR}/calls"
	if [[ "$*" == *"--paginate"* ]]; then
		echo "${STUB_JSON}" | jq -r '.[] | select(.name == env.RULESET_NAME and .source_type == "Repository") | .id'
		return 0
	fi
	if [[ "$*" == *"--input -"* ]]; then
		cat >"${STUB_DIR}/payload"
	fi
}
EOF
	# Properly escape the JSON for embedding
	printf 'STUB_JSON=%q\n' "$json_response" >>"${STUB_DIR}/stub.sh"
}

create_stub_failing_gh() {
	local failing_call="$1"
	local stub_ruleset_id="${2:-}"
	: >"${STUB_DIR}/calls"
	: >"${STUB_DIR}/payload"
	
	cat >"${STUB_DIR}/stub.sh" <<EOF
FAILING_CALL='$failing_call'
STUB_RULESET_ID='$stub_ruleset_id'

gh() {
	if [[ "\$*" == *"--input -"* ]]; then
		cat >/dev/null
	fi
	if [[ "\$*" == *"\${FAILING_CALL}"* ]]; then
		return 1
	fi
	if [[ "\$*" == *"--paginate"* ]]; then
		[ -n "\${STUB_RULESET_ID:-}" ] && echo "\$STUB_RULESET_ID"
	fi
}
EOF
}

last_call() {
	tail -n 1 "${STUB_DIR}/calls"
}

test_resolve_enforcement() {
	echo "Testing resolve_enforcement:"
	
	(
		unset BRANCH STATE GITHUB_REPOSITORY RULESET_NAME
		source "${SCRIPT_PATH}"

		assert_equals "active" "$(resolve_enforcement locked)" "locked -> active"
		assert_equals "disabled" "$(resolve_enforcement unlocked)" "unlocked -> disabled"

		if resolve_enforcement "open" >/dev/null 2>&1; then
			assert_equals "failure" "success" "invalid state is rejected"
		else
			assert_equals "failure" "failure" "invalid state is rejected"
		fi
	)
}

test_build_ruleset_payload() {
	echo "Testing build_ruleset_payload:"
	
	(
		unset BRANCH STATE GITHUB_REPOSITORY RULESET_NAME
		BRANCH="release/beta"
		source "${SCRIPT_PATH}"

		local payload
		payload="$(build_ruleset_payload active)"

		assert_equals "active" "$(jq -r '.enforcement' <<<"$payload")" "enforcement is set"
		assert_equals "refs/heads/release/beta" "$(jq -r '.conditions.ref_name.include[0]' <<<"$payload")" "targets the branch ref"
		assert_equals "update" "$(jq -r '.rules | map(.type) | join(",")' <<<"$payload")" "holds only the update rule"
	)
}

test_default_branch() {
	echo "Testing default branch is release/beta when BRANCH unset:"
	
	(
		unset BRANCH STATE GITHUB_REPOSITORY RULESET_NAME
		source "${SCRIPT_PATH}"
		
		assert_equals "release/beta" "$BRANCH" "BRANCH defaults to release/beta"
	)
}

test_missing_repository() {
	echo "Testing missing GITHUB_REPOSITORY fails without API calls:"
	
	create_stub_gh ""
	
	local output result=0
	output="$(run_isolated STATE=locked)" || result=$?
	
	assert_equals "1" "$result" "fails when GITHUB_REPOSITORY is missing"
	assert_equals "" "$(cat "${STUB_DIR}/calls")" "does not call the GitHub API"
	[[ "$output" == *"::error::GITHUB_REPOSITORY is not set"* ]]
	assert_equals "0" "$?" "emits correct error"
}

test_creates_ruleset_when_missing() {
	echo "Testing creates ruleset when missing:"
	
	create_stub_gh ""

	run_isolated GITHUB_REPOSITORY=elementor/example STATE=locked >/dev/null

	assert_equals "api --method POST repos/elementor/example/rulesets --input -" "$(last_call)" "creates the ruleset"
	assert_equals "active" "$(jq -r '.enforcement' "${STUB_DIR}/payload")" "created ruleset is enforced"
}

test_unlocked_creates_disabled_ruleset() {
	echo "Testing unlocked with no ruleset POSTs enforcement disabled:"
	
	create_stub_gh ""

	run_isolated GITHUB_REPOSITORY=elementor/example STATE=unlocked >/dev/null

	assert_equals "api --method POST repos/elementor/example/rulesets --input -" "$(last_call)" "creates the ruleset"
	assert_equals "disabled" "$(jq -r '.enforcement' "${STUB_DIR}/payload")" "created ruleset has enforcement disabled"
}

test_updates_existing_ruleset() {
	echo "Testing updates existing ruleset:"
	
	create_stub_gh "42"

	run_isolated GITHUB_REPOSITORY=elementor/example STATE=unlocked >/dev/null

	assert_equals "api --method PUT repos/elementor/example/rulesets/42 --input -" "$(last_call)" "updates the existing ruleset"
	assert_equals "disabled" "$(jq -r '.enforcement' "${STUB_DIR}/payload")" "ruleset enforcement is disabled"
}

test_filters_org_level_rulesets() {
	echo "Testing filters out non-Repository rulesets:"
	
	# Mock response with both org-level and repo-level rulesets with same name
	local json='[
		{"id": 1, "name": "Release beta lock", "source_type": "Organization"},
		{"id": 2, "name": "Release beta lock", "source_type": "Repository"}
	]'
	create_stub_gh_with_json "$json"

	run_isolated GITHUB_REPOSITORY=elementor/example STATE=locked >/dev/null

	assert_equals "api --method PUT repos/elementor/example/rulesets/2 --input -" "$(last_call)" "uses only repo-level ruleset (id 2)"
}

test_duplicate_matches_uses_first() {
	echo "Testing duplicate matches use first without failing:"
	
	# Multiple repo-level rulesets with same name
	local json='[
		{"id": 10, "name": "Release beta lock", "source_type": "Repository"},
		{"id": 11, "name": "Release beta lock", "source_type": "Repository"}
	]'
	create_stub_gh_with_json "$json"

	local result=0
	run_isolated GITHUB_REPOSITORY=elementor/example STATE=locked >/dev/null || result=$?

	assert_equals "0" "$result" "does not fail on duplicate matches"
	assert_equals "api --method PUT repos/elementor/example/rulesets/10 --input -" "$(last_call)" "uses first matching ruleset (id 10)"
}

test_rejects_invalid_state() {
	echo "Testing rejects invalid state:"
	
	create_stub_gh ""

	local result=0
	run_isolated GITHUB_REPOSITORY=elementor/example STATE=open >/dev/null 2>&1 || result=$?

	assert_equals "1" "$result" "fails on invalid state"
	assert_equals "" "$(cat "${STUB_DIR}/calls")" "does not call the GitHub API"
}

test_reports_list_failure() {
	echo "Testing reports list failure:"
	
	create_stub_failing_gh "--paginate"

	local output result=0
	output="$(run_isolated GITHUB_REPOSITORY=elementor/example STATE=locked)" || result=$?

	assert_equals "1" "$result" "fails when the API call fails"
	[[ "$output" == "::error title=Release beta lock failed::Could not list rulesets"* ]]
	assert_equals "0" "$?" "emits an error annotation"
}

test_reports_update_failure() {
	echo "Testing reports update failure:"
	
	create_stub_failing_gh "--method PUT" "42"

	local output result=0
	output="$(run_isolated GITHUB_REPOSITORY=elementor/example STATE=locked)" || result=$?

	assert_equals "1" "$result" "fails when the update call fails"
	[[ "$output" == *"update ruleset 'Release beta lock' (#42), so release/beta was NOT locked"* ]]
	assert_equals "0" "$?" "error annotation names the operation and state"
}

# Run all tests
test_resolve_enforcement
test_build_ruleset_payload
test_default_branch
test_missing_repository
test_creates_ruleset_when_missing
test_unlocked_creates_disabled_ruleset
test_updates_existing_ruleset
test_filters_org_level_rulesets
test_duplicate_matches_uses_first
test_rejects_invalid_state
test_reports_list_failure
test_reports_update_failure

echo ""
echo "Tests run: ${TESTS_RUN}, Failures: ${FAILURES}"

[ "$FAILURES" -eq 0 ]
