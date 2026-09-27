#!/usr/bin/env bash
set -euo pipefail

write_output() {
	echo "extra_args=$1" >> "${GITHUB_OUTPUT}"
}

if [ "${GITHUB_RUN_ATTEMPT:-1}" -le 1 ]; then
	echo "First workflow attempt; skipping Playwright last-run restore."
	write_output ""
	exit 0
fi

download_path="${ARTIFACT_DOWNLOAD_PATH:-.playwright-last-run-artifact}"
last_run_file="${download_path}/.last-run.json"

if [ ! -f "${last_run_file}" ]; then
	echo "No .last-run.json artifact from prior attempt; running full shard."
	write_output ""
	exit 0
fi

if ! jq -e '.failedTests | type == "array" and length > 0' "${last_run_file}" >/dev/null 2>&1; then
	echo "Prior last-run has no failedTests; running full shard."
	write_output ""
	exit 0
fi

write_output "--last-failed"
echo "PLAYWRIGHT_EXTRA_ARGS=--last-failed" >> "${GITHUB_ENV}"
echo "Re-run: will pass --last-failed to Playwright."

while IFS= read -r line || [ -n "${line}" ]; do
	line="$(echo "${line}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
	[ -z "${line}" ] && continue

	target="${line}"
	if [[ "${target}" != *".last-run.json" ]]; then
		target="${target%/}/.last-run.json"
	fi

	mkdir -p "$(dirname "${target}")"
	cp "${last_run_file}" "${target}"
	echo "Restored ${last_run_file} -> ${target}"
done <<< "${LAST_RUN_PATHS:-}"
