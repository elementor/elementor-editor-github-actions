#!/bin/bash

# Single source of truth for nightly tag names, shared with resolve-core-nightly.
# Merges to main roll the bare `nightly` tag; release branches get `<version>-nightly`.
nightly_tag_for() {
	local branch="$1"
	local clean_version="$2"

	if [[ "${branch}" == "${MAIN_BRANCH:-main}" ]]; then
		echo "${MAIN_NIGHTLY_TAG:-nightly}"
	else
		echo "${clean_version}-nightly"
	fi
}
