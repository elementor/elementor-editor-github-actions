#!/usr/bin/env bash
# Test suite for release-beta-lock.sh
# Run with: bash release-beta-lock.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
	else
		echo "  ✗ ${message}"
		echo "    Expected: ${expected}"
		echo "    Got: ${actual}"
		FAILURES=$((FAILURES + 1))
	fi
}

stub_gh() {
	STUB_RULESET_ID="$1"
	: >"${STUB_DIR}/calls"
	: >"${STUB_DIR}/payload"

	gh() {
		echo "$*" >>"${STUB_DIR}/calls"
		if [[ "$*" == *"--paginate"* ]]; then
			[ -n "$STUB_RULESET_ID" ] && echo "$STUB_RULESET_ID"
			return 0
		fi
		if [[ "$*" == *"--input -"* ]]; then
			cat >"${STUB_DIR}/payload"
		fi
	}
}

last_call() {
	tail -n 1 "${STUB_DIR}/calls"
}

test_resolve_enforcement() {
	echo "Testing resolve_enforcement:"

	source "${SCRIPT_DIR}/release-beta-lock.sh"

	assert_equals "active" "$(resolve_enforcement locked)" "locked -> active"
	assert_equals "disabled" "$(resolve_enforcement unlocked)" "unlocked -> disabled"

	if resolve_enforcement "open" >/dev/null; then
		assert_equals "failure" "success" "invalid state is rejected"
	else
		assert_equals "failure" "failure" "invalid state is rejected"
	fi
}

test_build_ruleset_payload() {
	echo "Testing build_ruleset_payload:"

	BRANCH="release/beta"
	source "${SCRIPT_DIR}/release-beta-lock.sh"

	local payload
	payload="$(build_ruleset_payload active)"

	assert_equals "active" "$(jq -r '.enforcement' <<<"$payload")" "enforcement is set"
	assert_equals "refs/heads/release/beta" "$(jq -r '.conditions.ref_name.include[0]' <<<"$payload")" "targets the branch ref"
	assert_equals "update" "$(jq -r '.rules | map(.type) | join(",")' <<<"$payload")" "holds only the update rule"
}

test_creates_ruleset_when_missing() {
	echo "Testing apply_lock_state without an existing ruleset:"

	# Arrange
	GITHUB_REPOSITORY="elementor/example"
	STATE="locked"
	source "${SCRIPT_DIR}/release-beta-lock.sh"
	stub_gh ""

	# Act
	apply_lock_state >/dev/null

	# Assert
	assert_equals "api --method POST repos/elementor/example/rulesets --input -" "$(last_call)" "creates the ruleset"
	assert_equals "active" "$(jq -r '.enforcement' "${STUB_DIR}/payload")" "created ruleset is enforced"
}

test_updates_existing_ruleset() {
	echo "Testing apply_lock_state with an existing ruleset:"

	# Arrange
	GITHUB_REPOSITORY="elementor/example"
	STATE="unlocked"
	source "${SCRIPT_DIR}/release-beta-lock.sh"
	stub_gh "42"

	# Act
	apply_lock_state >/dev/null

	# Assert
	assert_equals "api --method PUT repos/elementor/example/rulesets/42 --input -" "$(last_call)" "updates the existing ruleset"
	assert_equals "disabled" "$(jq -r '.enforcement' "${STUB_DIR}/payload")" "ruleset enforcement is disabled"
}

test_rejects_invalid_state() {
	echo "Testing apply_lock_state with an invalid state:"

	# Arrange
	GITHUB_REPOSITORY="elementor/example"
	STATE="open"
	source "${SCRIPT_DIR}/release-beta-lock.sh"
	stub_gh ""

	# Act
	local result="success"
	apply_lock_state >/dev/null || result="failure"

	# Assert
	assert_equals "failure" "$result" "fails on invalid state"
	assert_equals "" "$(cat "${STUB_DIR}/calls")" "does not call the GitHub API"
}

stub_failing_gh() {
	FAILING_CALL="$1"
	STUB_RULESET_ID="${2:-}"

	gh() {
		if [[ "$*" == *"--input -"* ]]; then
			cat >/dev/null
		fi
		if [[ "$*" == *"$FAILING_CALL"* ]]; then
			return 1
		fi
		if [[ "$*" == *"--paginate"* ]]; then
			echo "$STUB_RULESET_ID"
		fi
	}
}

test_reports_list_failure() {
	echo "Testing apply_lock_state when listing rulesets fails:"

	# Arrange
	GITHUB_REPOSITORY="elementor/example"
	STATE="locked"
	source "${SCRIPT_DIR}/release-beta-lock.sh"
	stub_failing_gh "--paginate"

	# Act
	local output result="success"
	output="$(apply_lock_state)" || result="failure"

	# Assert
	assert_equals "failure" "$result" "fails when the API call fails"
	assert_equals "true" "$([[ "$output" == "::error title=Release beta lock failed::Could not list rulesets"* ]] && echo true || echo false)" "emits an error annotation"
}

test_reports_update_failure() {
	echo "Testing apply_lock_state when updating the ruleset fails:"

	# Arrange
	GITHUB_REPOSITORY="elementor/example"
	STATE="locked"
	source "${SCRIPT_DIR}/release-beta-lock.sh"
	stub_failing_gh "--method PUT" "42"

	# Act
	local output result="success"
	output="$(apply_lock_state)" || result="failure"

	# Assert
	assert_equals "failure" "$result" "fails when the update call fails"
	assert_equals "true" "$([[ "$output" == *"update ruleset 'Release beta lock' (#42), so release/beta was NOT locked"* ]] && echo true || echo false)" "error annotation names the operation and state"
}

test_resolve_enforcement
test_build_ruleset_payload
test_creates_ruleset_when_missing
test_updates_existing_ruleset
test_rejects_invalid_state
test_reports_list_failure
test_reports_update_failure

echo ""
echo "Tests run: ${TESTS_RUN}, Failures: ${FAILURES}"

[ "$FAILURES" -eq 0 ]
