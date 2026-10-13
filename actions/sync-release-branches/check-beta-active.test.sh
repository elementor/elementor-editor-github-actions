#!/usr/bin/env bash
# Test suite for check-beta-active.sh
# Run with: bash check-beta-active.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAILURES=0
TESTS_RUN=0

# Test helper functions
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

test_extract_major_minor() {
	echo "Testing extract_major_minor:"
	
	source "${SCRIPT_DIR}/check-beta-active.sh"
	
	local result
	result="$(extract_major_minor "4.3.0")"
	assert_equals "4.3" "$result" "4.3.0 -> 4.3"
	
	result="$(extract_major_minor "4.3.6")"
	assert_equals "4.3" "$result" "4.3.6 -> 4.3"
	
	result="$(extract_major_minor "v4.4.0")"
	assert_equals "4.4" "$result" "v4.4.0 -> 4.4"
	
	result="$(extract_major_minor "4.4.0-beta1")"
	assert_equals "4.4" "$result" "4.4.0-beta1 -> 4.4"
	
	result="$(extract_major_minor "4.4.0-latest-1234567890")"
	assert_equals "4.4" "$result" "4.4.0-latest-1234567890 -> 4.4"
}

test_version_gt() {
	echo "Testing version_gt:"
	
	source "${SCRIPT_DIR}/check-beta-active.sh"
	
	if version_gt "4.4" "4.3"; then
		TESTS_RUN=$((TESTS_RUN + 1))
		echo "  ✓ 4.4 > 4.3"
	else
		TESTS_RUN=$((TESTS_RUN + 1))
		FAILURES=$((FAILURES + 1))
		echo "  ✗ 4.4 > 4.3 should be true"
	fi
	
	if version_gt "4.3" "4.3"; then
		TESTS_RUN=$((TESTS_RUN + 1))
		FAILURES=$((FAILURES + 1))
		echo "  ✗ 4.3 > 4.3 should be false"
	else
		TESTS_RUN=$((TESTS_RUN + 1))
		echo "  ✓ 4.3 <= 4.3"
	fi
	
	if version_gt "4.3" "4.4"; then
		TESTS_RUN=$((TESTS_RUN + 1))
		FAILURES=$((FAILURES + 1))
		echo "  ✗ 4.3 > 4.4 should be false"
	else
		TESTS_RUN=$((TESTS_RUN + 1))
		echo "  ✓ 4.3 <= 4.4"
	fi
	
	if version_gt "5.0" "4.9"; then
		TESTS_RUN=$((TESTS_RUN + 1))
		echo "  ✓ 5.0 > 4.9"
	else
		TESTS_RUN=$((TESTS_RUN + 1))
		FAILURES=$((FAILURES + 1))
		echo "  ✗ 5.0 > 4.9 should be true"
	fi
}

test_extract_version_from_file() {
	echo "Testing extract_version_from_file:"
	
	source "${SCRIPT_DIR}/check-beta-active.sh"
	
	# Test Core header format
	local content='<?php
/**
 * Plugin Name: Elementor
 * Version: 4.3.0
 */'
	local result
	result="$(extract_version_from_file "$content" "elementor.php")"
	assert_equals "4.3.0" "$result" "Extract from Core header"
	
	# Test Core constant format
	content='<?php
define( '\''ELEMENTOR_VERSION'\'', '\''4.3.5'\'' );'
	result="$(extract_version_from_file "$content" "elementor.php")"
	assert_equals "4.3.5" "$result" "Extract from Core constant"
	
	# Test Pro constant format
	content='<?php
define( '\''ELEMENTOR_PRO_VERSION'\'', '\''4.3.1'\'' );'
	result="$(extract_version_from_file "$content" "elementor-pro.php")"
	assert_equals "4.3.1" "$result" "Extract from Pro constant"
}

test_get_latest_stable_release() {
	echo "Testing get_latest_stable_release with stubbed gh:"
	
	# Source the script to get the function
	source "${SCRIPT_DIR}/check-beta-active.sh"
	
	# Stub gh command to return sample releases
	gh() {
		if [[ "$1" == "api" ]] && [[ "$2" == repos/* ]]; then
			cat <<-'EOF'
			{"tag_name":"v4.4.0","draft":false,"prerelease":false}
			{"tag_name":"v4.3.7","draft":false,"prerelease":false}
			{"tag_name":"v4.4.0-latest-1791784999","draft":false,"prerelease":false}
			{"tag_name":"v4.3.0-beta3","draft":false,"prerelease":false}
			{"tag_name":"nightly-20240101","draft":false,"prerelease":false}
			{"tag_name":"v4.2.5","draft":false,"prerelease":false}
			{"tag_name":"v4.3.0-dev","draft":false,"prerelease":false}
			{"tag_name":"v4.3.0-rc1","draft":false,"prerelease":false}
			{"tag_name":"v4.5.0-beta1","draft":true,"prerelease":false}
			{"tag_name":"v3.9.0","draft":false,"prerelease":true}
			EOF
		fi
	}
	export -f gh
	export GITHUB_REPOSITORY="test/repo"
	
	local result
	result="$(get_latest_stable_release)"
	assert_equals "v4.4.0" "$result" "Highest stable version is v4.4.0"
	
	TESTS_RUN=$((TESTS_RUN + 1))
	if [[ "$result" != *"latest"* ]] && [[ "$result" != *"beta"* ]] && [[ "$result" != *"dev"* ]] && [[ "$result" != *"rc"* ]] && [[ "$result" != *"nightly"* ]]; then
		echo "  ✓ Filtered out automated builds and pre-release tags"
	else
		echo "  ✗ Should filter out automated builds and pre-release tags"
		FAILURES=$((FAILURES + 1))
	fi
	
	unset -f gh
}

test_check_beta_active_decisions() {
	echo "Testing check_beta_active decision logic:"
	
	# Source the script
	source "${SCRIPT_DIR}/check-beta-active.sh"
	
	# Test case 1: Beta active (4.4 > 4.3)
	export GITHUB_REPOSITORY="test/repo"
	
	# Mock get_beta_version to return 4.4.0
	get_beta_version() {
		echo "4.4.0"
	}
	export -f get_beta_version
	
	# Mock get_latest_stable_release to return v4.3.0
	get_latest_stable_release() {
		echo "v4.3.0"
	}
	export -f get_latest_stable_release
	
	local result
	result="$(check_beta_active)"
	
	TESTS_RUN=$((TESTS_RUN + 1))
	if echo "$result" | grep -q '"isActive":true'; then
		echo "  ✓ Beta 4.4 > stable 4.3 = ACTIVE"
	else
		echo "  ✗ Beta 4.4 > stable 4.3 should be ACTIVE"
		echo "    Got: $result"
		FAILURES=$((FAILURES + 1))
	fi
	
	# Test case 2: Beta inactive (4.3 <= 4.3)
	get_beta_version() {
		echo "4.3.5"
	}
	export -f get_beta_version
	
	get_latest_stable_release() {
		echo "v4.3.7"
	}
	export -f get_latest_stable_release
	
	result="$(check_beta_active)"
	
	TESTS_RUN=$((TESTS_RUN + 1))
	if echo "$result" | grep -q '"isActive":false'; then
		echo "  ✓ Beta 4.3 <= stable 4.3 = INACTIVE"
	else
		echo "  ✗ Beta 4.3 <= stable 4.3 should be INACTIVE"
		echo "    Got: $result"
		FAILURES=$((FAILURES + 1))
	fi
	
	# Test case 3: Beta inactive (4.3 < 4.4)
	get_beta_version() {
		echo "4.3.8"
	}
	export -f get_beta_version
	
	get_latest_stable_release() {
		echo "v4.4.0"
	}
	export -f get_latest_stable_release
	
	result="$(check_beta_active)"
	
	TESTS_RUN=$((TESTS_RUN + 1))
	if echo "$result" | grep -q '"isActive":false'; then
		echo "  ✓ Beta 4.3 < stable 4.4 = INACTIVE"
	else
		echo "  ✗ Beta 4.3 < stable 4.4 should be INACTIVE"
		echo "    Got: $result"
		FAILURES=$((FAILURES + 1))
	fi
	
	unset -f get_beta_version
	unset -f get_latest_stable_release
}

# Run all tests
echo "=== Running check-beta-active.sh tests ==="
echo

test_extract_major_minor
echo

test_version_gt
echo

test_extract_version_from_file
echo

test_get_latest_stable_release
echo

test_check_beta_active_decisions
echo

# Summary
echo "==================================="
echo "Tests run: ${TESTS_RUN}"
echo "Failures: ${FAILURES}"
echo "==================================="

if [ "$FAILURES" -eq 0 ]; then
	echo "All tests passed!"
	exit 0
else
	echo "Some tests failed"
	exit 1
fi
