#!/usr/bin/env bash
# Test suite for announce-branch-structure.sh
# Run with: bash announce-branch-structure.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${SCRIPT_DIR}/announce-branch-structure.sh"
FAILURES=0
TESTS_RUN=0

assert_equals() {
	local expected="$1"
	local actual="$2"
	local message="$3"

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

assert_contains() {
	local haystack="$1"
	local needle="$2"
	local message="$3"

	TESTS_RUN=$((TESTS_RUN + 1))

	if grep -qF -- "$needle" <<< "$haystack"; then
		echo "  ✓ ${message}"
	else
		echo "  ✗ ${message}"
		echo "    Missing: ${needle}"
		FAILURES=$((FAILURES + 1))
	fi
}

commit_version() {
	local branch="$1"
	local version="$2"
	git checkout -q -B "$branch"
	echo "{\"version\":\"${version}\"}" > package.json
	git add package.json
	git commit -q -m "Version ${version}"
	git push -q origin "$branch" 2>/dev/null
}

create_fixture_repository() {
	local root="$1"

	git init -q --bare "${root}/origin.git"
	git clone -q "${root}/origin.git" "${root}/work" 2>/dev/null
	(
		cd "${root}/work"
		git config user.email "test@example.com"
		git config user.name "Test"
		commit_version release/stable 4.5.3
		commit_version release/beta 4.6.0
		commit_version main 4.7.0
	)
}

# Runs the script in the fixture with the given environment and sets
# RUN_EXIT, RUN_STDOUT and RUN_PAYLOAD (channel and text of the payload).
run_announcement() {
	local output_file
	output_file="$(mktemp)"
	RUN_EXIT=0
	RUN_STDOUT="$(cd "$WORK_DIR" && env GITHUB_OUTPUT="$output_file" GITHUB_REPOSITORY=elementor/elementor-pro SLACK_CHANNEL=C123 "$@" bash "$SCRIPT" 2>/dev/null)" || RUN_EXIT=$?
	RUN_PAYLOAD=""
	if grep -q '^payload=' "$output_file"; then
		RUN_PAYLOAD="$(sed 's/^payload=//' "$output_file" | jq -r '.channel + "\n" + .text')"
	fi
	rm -f "$output_file"
}

test_extract_major_minor() {
	echo "Testing extract_major_minor:"

	source "$SCRIPT"

	assert_equals "4.5" "$(extract_major_minor 4.5.0)" "4.5.0 -> 4.5"
	assert_equals "4.6" "$(extract_major_minor 4.6)" "4.6 -> 4.6"
	assert_equals "4.7" "$(extract_major_minor v4.7.2)" "v4.7.2 -> 4.7"
	assert_equals "invalid" "$(extract_major_minor 'not-a-version' || echo invalid)" "rejects a non-version"
}

test_stable_release_new_line() {
	echo "Testing stable-release on a new version line:"

	run_announcement EVENT=stable-release STABLE_VERSION=4.5.0

	assert_equals "0" "$RUN_EXIT" "exits 0"
	assert_contains "$RUN_PAYLOAD" "C123" "posts to the configured channel"
	assert_contains "$RUN_PAYLOAD" "We have just released 4.5.0!" "announces the released version"
	assert_contains "$RUN_PAYLOAD" "release/stable → 4.5" "maps release/stable"
	assert_contains "$RUN_PAYLOAD" "release/beta → 4.6 (locked)" "reads release/beta from the branch"
	assert_contains "$RUN_PAYLOAD" "main → 4.7" "reads main from the branch"
	assert_contains "$RUN_PAYLOAD" "https://github.com/elementor/elementor-pro" "links the repository"
}

test_stable_release_patch() {
	echo "Testing stable-release on a patch version:"

	run_announcement EVENT=stable-release STABLE_VERSION=4.5.2

	assert_equals "0" "$RUN_EXIT" "exits 0"
	assert_equals "" "$RUN_PAYLOAD" "does not post"
}

test_beta_branch_out() {
	echo "Testing beta-branch-out:"

	run_announcement EVENT=beta-branch-out BETA_VERSION=4.6 MAIN_VERSION=4.7.0 BUMP_PR_OUTCOME=success

	assert_equals "0" "$RUN_EXIT" "exits 0"
	assert_contains "$RUN_PAYLOAD" "Beta branch-out is complete!" "announces the branch-out"
	assert_contains "$RUN_PAYLOAD" "release/stable → 4.5" "reads release/stable from the branch"
	assert_contains "$RUN_PAYLOAD" "release/beta → 4.6" "maps release/beta"
	assert_contains "$RUN_PAYLOAD" "main → 4.7" "maps main"
}

test_beta_branch_out_failed_bump() {
	echo "Testing beta-branch-out when the main bump failed:"

	run_announcement EVENT=beta-branch-out BETA_VERSION=4.6 MAIN_VERSION=4.7.0 BUMP_PR_OUTCOME=failure

	assert_contains "$RUN_PAYLOAD" "Manual follow-up required." "asks for a manual follow-up"
}

test_skips() {
	echo "Testing skipped announcements:"

	run_announcement EVENT=stable-release STABLE_VERSION=4.5.0 SLACK_CHANNEL=
	assert_equals "" "$RUN_PAYLOAD" "skips when the channel is empty"
	assert_contains "$RUN_STDOUT" "Slack channel is not set" "warns when the channel is empty"

	run_announcement EVENT=unknown
	assert_equals "" "$RUN_PAYLOAD" "skips an unknown event"

	run_announcement EVENT=beta-branch-out BETA_VERSION=bad MAIN_VERSION=4.7.0
	assert_equals "0" "$RUN_EXIT" "exits 0 on an invalid version"
	assert_equals "" "$RUN_PAYLOAD" "skips an invalid version"
	assert_contains "$RUN_STDOUT" "Could not resolve the beta version" "warns on an invalid version"
}

test_dry_run() {
	echo "Testing dry-run:"

	run_announcement EVENT=stable-release STABLE_VERSION=4.5.0 SLACK_CHANNEL= DRY_RUN=true

	assert_contains "$RUN_STDOUT" "We have just released 4.5.0!" "prints the message"
	assert_equals "" "$RUN_PAYLOAD" "does not write a payload"
}

FIXTURE_ROOT="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_ROOT"' EXIT
create_fixture_repository "$FIXTURE_ROOT"
WORK_DIR="${FIXTURE_ROOT}/work"

test_extract_major_minor
test_stable_release_new_line
test_stable_release_patch
test_beta_branch_out
test_beta_branch_out_failed_bump
test_skips
test_dry_run

echo ""
echo "Tests run: ${TESTS_RUN}, failures: ${FAILURES}"

if [ "$FAILURES" -gt 0 ]; then
	exit 1
fi
