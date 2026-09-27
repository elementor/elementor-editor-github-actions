#!/usr/bin/env bash
set -euo pipefail

staging_dir="${STAGING_DIR:-playwright-last-run-staging}"
source_file=""

while IFS= read -r line || [ -n "${line}" ]; do
	line="$(echo "${line}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
	[ -z "${line}" ] && continue

	candidate="${line}"
	if [[ "${candidate}" != *".last-run.json" ]]; then
		candidate="${candidate%/}/.last-run.json"
	fi

	if [ ! -f "${candidate}" ]; then
		continue
	fi

	if jq -e '.failedTests | type == "array" and length > 0' "${candidate}" >/dev/null 2>&1; then
		source_file="${candidate}"
		break
	fi
done <<< "${LAST_RUN_PATHS:-}"

if [ -z "${source_file}" ]; then
	echo "No .last-run.json with failed tests; skipping last-run artifact upload."
	echo "uploaded=false" >> "${GITHUB_OUTPUT}"
	exit 0
fi

rm -rf "${staging_dir}"
mkdir -p "${staging_dir}"
cp "${source_file}" "${staging_dir}/.last-run.json"
echo "Staged ${source_file} for artifact upload."
echo "uploaded=true" >> "${GITHUB_OUTPUT}"
