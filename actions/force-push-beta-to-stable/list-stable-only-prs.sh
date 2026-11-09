#!/usr/bin/env bash
# Lists the commits on a target branch that the source branch does not contain,
# skipping commits whose patch already exists on the source (cherry-picks).
# Prints one tab-separated row per commit:
#   pr_number<TAB>sha<TAB>author<TAB>subject<TAB>note

set -euo pipefail

FIELD_SEPARATOR=$'\t'

extract_pr_number() {
	local subject="$1"
	if [[ "$subject" =~ \(#([0-9]+)\)[[:space:]]*$ ]]; then
		echo "${BASH_REMATCH[1]}"
	fi
}

extract_cherry_picked_pr_number() {
	local subject="$1"
	if [[ "$subject" =~ [Cc]herry-pick[[:space:]]+PR[[:space:]]+#?([0-9]+) ]]; then
		echo "${BASH_REMATCH[1]}"
	fi
}

subjects_reference_pr() {
	local subjects="$1"
	local pr_number="$2"
	grep -Eq "\(#${pr_number}\)|PR #?${pr_number}([^0-9]|$)" <<< "$subjects"
}

list_target_only_commits() {
	local source_ref="$1"
	local target_ref="$2"
	git log --no-merges --cherry-pick --right-only --reverse \
		--format="%H${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%s" \
		"${source_ref}...${target_ref}"
}

describe_commit() {
	local source_subjects="$1"
	local pr_number="$2"
	local original_pr_number="$3"

	if [ -n "$original_pr_number" ] && subjects_reference_pr "$source_subjects" "$original_pr_number"; then
		echo "Cherry-pick of #${original_pr_number}, which is in the source branch"
	elif [ -n "$pr_number" ] && subjects_reference_pr "$source_subjects" "$pr_number"; then
		echo "Referenced by a cherry-pick in the source branch"
	elif [ -z "$pr_number" ]; then
		echo "No PR number in the commit message"
	fi
}

collect_target_only_prs() {
	local source_ref="$1"
	local target_ref="$2"
	local source_subjects sha author subject pr_number original_pr_number note

	source_subjects="$(git log --format=%s "$source_ref")"

	while IFS="$FIELD_SEPARATOR" read -r sha author subject; do
		[ -n "$sha" ] || continue
		pr_number="$(extract_pr_number "$subject")"
		original_pr_number="$(extract_cherry_picked_pr_number "$subject")"
		note="$(describe_commit "$source_subjects" "$pr_number" "$original_pr_number")"
		printf '%s\t%s\t%s\t%s\t%s\n' "$pr_number" "$sha" "$author" "$subject" "$note"
	done < <(list_target_only_commits "$source_ref" "$target_ref")
}

escape_markdown_cell() {
	echo "${1//|/\\|}"
}

render_markdown_table() {
	local rows="$1"
	local repository="$2"
	local pr_number sha author subject note reference

	echo '| PR | Title | Author | Note |'
	echo '| --- | --- | --- | --- |'

	while IFS="$FIELD_SEPARATOR" read -r pr_number sha author subject note; do
		[ -n "$sha" ] || continue
		if [ -n "$pr_number" ]; then
			reference="[#${pr_number}](https://github.com/${repository}/pull/${pr_number})"
		else
			reference="[\`${sha:0:10}\`](https://github.com/${repository}/commit/${sha})"
		fi
		echo "| ${reference} | $(escape_markdown_cell "$subject") | $(escape_markdown_cell "$author") | ${note} |"
	done <<< "$rows"
}

pr_numbers_as_json() {
	local rows="$1"
	cut -f1 <<< "$rows" | { grep -E '^[0-9]+$' || true; } | sort -un | jq -Rsc 'split("\n") | map(select(length > 0) | tonumber)'
}
