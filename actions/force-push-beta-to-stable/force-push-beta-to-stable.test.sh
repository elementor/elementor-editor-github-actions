#!/usr/bin/env bash
# Test suite for force-push-beta-to-stable.sh
# Run with: bash force-push-beta-to-stable.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

commit_file() {
	local file="$1"
	local content="$2"
	local message="$3"
	echo "$content" > "$file"
	git add "$file"
	git commit -q -m "$message"
}

# Beta and stable share a base. Stable then gets a cherry-pick that beta already
# has, a conflicting cherry-pick of a beta PR, a stable-only fix, and a commit
# with no PR number.
create_fixture_repository() {
	local root="$1"

	git init -q --bare "${root}/origin.git"
	git clone -q "${root}/origin.git" "${root}/work" 2>/dev/null
	cd "${root}/work"
	git config user.email "test@example.com"
	git config user.name "Test"

	commit_file base.txt base "Internal: Base (#1)"
	git branch -M release/beta

	commit_file shared.txt shared "Fix: Shared fix (#200)"
	commit_file conflict.txt beta-version "Fix: Beta feature (#300)"

	git checkout -q -b release/stable HEAD~2
	commit_file shared.txt shared "Fix: Cherry-pick PR 200 to release/stable: Shared fix (#201)"
	commit_file conflict.txt stable-version "Fix: Cherry-pick PR 300 to release/stable with conflicts: Beta feature (#301)"
	commit_file stable.txt stable "Fix: Stable only | hotfix (#400)"
	commit_file manual.txt manual "Manual stable commit"

	git push -q origin release/beta release/stable
}

run_action() {
	local dry_run="$1"
	SOURCE_BRANCH=release/beta \
		TARGET_BRANCH=release/stable \
		DRY_RUN="$dry_run" \
		GITHUB_REPOSITORY=elementor/test \
		GITHUB_STEP_SUMMARY="${FIXTURE_ROOT}/summary.md" \
		GITHUB_OUTPUT="${FIXTURE_ROOT}/output.txt" \
		bash "${SCRIPT_DIR}/force-push-beta-to-stable.sh" > /dev/null 2>&1
}

remote_sha() {
	git --git-dir="${FIXTURE_ROOT}/origin.git" rev-parse "$1"
}

test_dry_run_reports_without_pushing() {
	echo "Testing dry run:"

	# Arrange
	FIXTURE_ROOT="$(mktemp -d)"
	create_fixture_repository "$FIXTURE_ROOT"
	local stable_before
	stable_before="$(remote_sha release/stable)"

	# Act
	run_action true

	# Assert
	local summary output
	summary="$(cat "${FIXTURE_ROOT}/summary.md")"
	output="$(cat "${FIXTURE_ROOT}/output.txt")"
	assert_equals "$stable_before" "$(remote_sha release/stable)" "release/stable is not changed"
	assert_contains "$output" "count=3" "counts only commits whose patch is not in beta"
	assert_contains "$output" "prs=[301,400]" "outputs the stable-only PR numbers"
	assert_contains "$output" "rollback-sha=${stable_before}" "outputs the rollback SHA"
	assert_contains "$summary" "[#400](https://github.com/elementor/test/pull/400)" "links the stable-only PR"
	assert_contains "$summary" "Stable only \\| hotfix" "escapes pipes in titles"
	assert_contains "$summary" "Cherry-pick of #300, which is in the source branch" "flags cherry-picks of beta PRs"
	assert_contains "$summary" "No PR number in the commit message" "lists commits without a PR number"

	cd "$SCRIPT_DIR"
	rm -rf "$FIXTURE_ROOT"
}

test_push_replaces_stable_with_beta() {
	echo "Testing push:"

	# Arrange
	FIXTURE_ROOT="$(mktemp -d)"
	create_fixture_repository "$FIXTURE_ROOT"
	local stable_before
	stable_before="$(remote_sha release/stable)"

	# Act
	run_action false

	# Assert
	local summary
	summary="$(cat "${FIXTURE_ROOT}/summary.md")"
	assert_equals "$(remote_sha release/beta)" "$(remote_sha release/stable)" "release/stable matches release/beta"
	assert_contains "$summary" "${stable_before}:refs/heads/release/stable" "prints the rollback command"

	cd "$SCRIPT_DIR"
	rm -rf "$FIXTURE_ROOT"
}

test_dry_run_reports_without_pushing
test_push_replaces_stable_with_beta

echo
echo "${TESTS_RUN} tests, ${FAILURES} failures"
[ "$FAILURES" -eq 0 ]
