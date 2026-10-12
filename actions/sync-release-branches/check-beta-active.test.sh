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

# Run all tests
echo "=== Running check-beta-active.sh tests ==="
echo

test_extract_major_minor
echo

test_version_gt
echo

test_extract_version_from_file
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
