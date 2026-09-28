#!/usr/bin/env bash
set -euo pipefail

# Create downstream PRs after a release-branch merge using isolated git worktrees.
# Merges the PR source branch for merge commits, or applies a squash commit patch.
# Opens normal downstream PRs with the original title.
#
# Required environment variables:
#   BASE_REF       - branch the PR was merged into (e.g. release/stable)
#   PR_NUMBER      - merged PR number
#   MERGE_SHA      - merge commit SHA to sync
#   PR_TITLE       - original PR title
#   PR_USER_LOGIN  - original PR author login
#   ORIG_URL       - original PR URL
#   SOURCE_REPO    - head repo full name
#
# Optional:
#   HEAD_REF       - original PR head branch (used for loop prevention messaging)
#   USING_PAT      - "true" when a PAT is used (workflows trigger automatically)
#   STABLE_BRANCH  - default: release/stable
#   BETA_BRANCH    - default: release/beta
#   MAIN_BRANCH    - default: main

WORKTREE_ROOT="${RUNNER_TEMP:-/tmp}/release-sync-worktrees"
STABLE_BRANCH="${STABLE_BRANCH:-release/stable}"
BETA_BRANCH="${BETA_BRANCH:-release/beta}"
MAIN_BRANCH="${MAIN_BRANCH:-main}"
SYNC_BRANCH_PREFIX="sync-pr"
BOT_LOGIN="github-actions[bot]"
SYNC_COMMIT_MESSAGE="Sync PR #${PR_NUMBER} from ${BASE_REF}"

require_env() {
	local name="$1"
	if [ -z "${!name:-}" ]; then
		echo "::error::Missing required environment variable: $name"
		exit 1
	fi
}

require_env BASE_REF
require_env PR_NUMBER
require_env MERGE_SHA
require_env PR_TITLE
require_env PR_USER_LOGIN
require_env ORIG_URL
require_env SOURCE_REPO

sanitize_title() {
	echo "$1" | sed 's/[;&|<>`$()]//g'
}

target_to_safe() {
	echo "$1" | sed 's/[\/\.]/_/g'
}

resolve_targets_csv() {
	case "$1" in
		"$STABLE_BRANCH") echo "${BETA_BRANCH},${MAIN_BRANCH}" ;;
		"$BETA_BRANCH") echo "${MAIN_BRANCH}" ;;
		*) echo "" ;;
	esac
}

is_merge_commit() {
	local parent_count
	parent_count="$(git rev-list --parents -n 1 "$1" | awk '{print NF - 1}')"
	[ "$parent_count" -ge 2 ]
}

abort_apply() {
	git merge --abort 2>/dev/null || true
	git reset --hard HEAD 2>/dev/null || true
}

merge_pr_head() {
	local merge_sha="$1"
	local pr_head="${merge_sha}^2"

	if ! git rev-parse --verify "${pr_head}^{commit}" >/dev/null 2>&1; then
		LAST_SYNC_ERROR="Merge commit ${merge_sha} has no second parent (PR head)"
		echo "::error:: ${LAST_SYNC_ERROR}"
		return 1
	fi

	local merge_output
	if ! merge_output="$(git merge --no-ff "$pr_head" -m "$SYNC_COMMIT_MESSAGE" 2>&1)"; then
		LAST_SYNC_ERROR="$merge_output"
		printf '%s\n' "$merge_output"
		return 1
	fi

	printf '%s\n' "$merge_output"
}

clear_cherry_pick_state() {
	git cherry-pick --quit 2>/dev/null || true
}

# A text diff piped into git apply omits full blob ids, so binary patches never
# apply. That failure used to leave a clean tree, and the conflict branch was
# identical to the target, which GitHub rejects with "No commits between".
apply_squash_commit_patch() {
	local merge_sha="$1"
	local output

	if output="$(git cherry-pick --no-commit "$merge_sha" 2>&1)"; then
		git add -A

		if git diff --cached --quiet; then
			echo "::notice:: Squash commit ${merge_sha} produced no staged changes"
			clear_cherry_pick_state
			return 0
		fi

		if ! output="$(git commit -m "$SYNC_COMMIT_MESSAGE" 2>&1)"; then
			LAST_SYNC_ERROR="$output"
			echo "::error:: Failed to commit squash sync for ${merge_sha}"
			printf '%s\n' "$output"
			clear_cherry_pick_state
			return 1
		fi

		clear_cherry_pick_state
		return 0
	fi

	printf '%s\n' "$output"

	if ! git diff --name-only --diff-filter=U | grep -q . \
		&& git diff --quiet \
		&& git diff --cached --quiet; then
		echo "::notice:: Squash commit ${merge_sha} produced no staged changes"
		clear_cherry_pick_state
		return 0
	fi

	LAST_SYNC_ERROR="$output"
	return 1
}

keep_incoming_binary_conflicts() {
	local path numstat

	while IFS= read -r path; do
		[ -n "$path" ] || continue
		if ! git cat-file -e ":2:${path}" 2>/dev/null; then
			continue
		fi
		if ! git cat-file -e ":3:${path}" 2>/dev/null; then
			continue
		fi

		numstat="$(git diff --numstat ":2:${path}" ":3:${path}")"
		case "$numstat" in
			"-"*)
				git checkout --theirs -- "$path"
				echo "::warning:: Binary conflict in ${path}; included the incoming file because binaries cannot hold conflict markers"
				;;
		esac
	done < <(git diff --name-only --diff-filter=U)
}

apply_merged_content() {
	local merge_sha="$1"

	if is_merge_commit "$merge_sha"; then
		merge_pr_head "$merge_sha"
	else
		apply_squash_commit_patch "$merge_sha"
	fi
}

has_changes_vs_target() {
	local target="$1"
	! git diff --quiet "origin/${target}" HEAD
}

pr_assignee_args() {
	if [ -n "$PR_USER_LOGIN" ] && [ "$PR_USER_LOGIN" != "$BOT_LOGIN" ]; then
		printf '%s\n' --assignee "$PR_USER_LOGIN"
	fi
}

build_sync_pr_title() {
	local title="$1"
	local type rest

	if [[ "$title" =~ ^([A-Za-z]+):[[:space:]]*(.*)$ ]]; then
		type="${BASH_REMATCH[1]}"
		rest="${BASH_REMATCH[2]}"
		printf '%s: Synced - %s' "$type" "$rest"
		return 0
	fi

	printf 'Internal: Synced - %s' "$title"
}

sanitize_pr_title() {
	SANITIZED_PR_TITLE="$(build_sync_pr_title "$(sanitize_title "$PR_TITLE")")"
}

truncate_error() {
	local text="$1"
	local max=3500

	if [ "${#text}" -le "$max" ]; then
		printf '%s\n' "$text"
		return
	fi

	printf '...truncated...\n%s\n' "${text: -$max}"
}

comment_on_original_pr() {
	local target="$1"
	local message="$2"
	local safe body

	[ -n "$message" ] || return 0

	safe="${message//\`\`\`/~~~}"
	body="$(cat <<EOF
Sync to \`${target}\` failed.

\`\`\`
$(truncate_error "$safe")
\`\`\`
EOF
)"

	if ! gh pr comment "$PR_NUMBER" --body "$body"; then
		echo "::warning:: Failed to comment on original PR #${PR_NUMBER}"
	fi
}

create_conflict_pr() {
	local target="$1"
	local sync_branch="$2"
	local conflict_branch="$3"
	local -a assignee_args

	readarray -t assignee_args < <(pr_assignee_args)

	keep_incoming_binary_conflicts
	git add .

	if git diff --cached --quiet; then
		CONFLICT_FAILURE_ERROR="Conflict sync for PR #${PR_NUMBER} onto ${target} produced no changes"
		echo "::warning:: ${CONFLICT_FAILURE_ERROR} — skipping PR"
		abort_apply
		clear_cherry_pick_state
		return 1
	fi

	local commit_output
	if ! commit_output="$(git commit -m "Sync PR #${PR_NUMBER} to ${target} with conflicts - manual resolution needed" 2>&1)"; then
		CONFLICT_FAILURE_ERROR="$commit_output"
		echo "::warning:: Failed to commit conflict sync for ${conflict_branch}"
		printf '%s\n' "$commit_output"
		abort_apply
		clear_cherry_pick_state
		return 1
	fi

	clear_cherry_pick_state

	local push_output
	if ! push_output="$(git push --force-with-lease origin "${sync_branch}:${conflict_branch}" 2>&1)"; then
		CONFLICT_FAILURE_ERROR="$push_output"
		echo "::warning:: Failed to push conflict branch ${conflict_branch}"
		printf '%s\n' "$push_output"
		abort_apply
		return 1
	fi

	if gh pr list --head "$conflict_branch" --base "$target" --state open | grep -q .; then
		echo "::notice:: Draft PR already exists for conflict resolution: ${conflict_branch}"
		return 0
	fi

	local create_log
	create_log="$(mktemp)"
	if ! gh pr create \
		--base "$target" \
		--head "$conflict_branch" \
		"${assignee_args[@]}" \
		--label "auto-reviewed" \
		--title "${SANITIZED_PR_TITLE} (sync to ${target} — conflicts)" \
		--body "⚠️ **Manual Resolution Required**

This sync PR for [#${PR_NUMBER}](${ORIG_URL}) into \`${target}\` has conflicts that need manual resolution.

**Conflict Files:**
Text conflicts are included in this branch with conflict markers. Binary files cannot store conflict markers, so those files are the incoming version from the original PR.

**Resolution Steps:**
1. Check out this branch: \`git checkout ${conflict_branch}\`
2. Resolve conflicts in the marked files
3. Stage resolved files: \`git add <resolved-files>\`
4. Amend the commit: \`git commit --amend\`
5. Push changes: \`git push --force-with-lease\`
6. Mark this PR as ready for review

**Original PR:** [#${PR_NUMBER}](${ORIG_URL})
**Merged to:** \`${BASE_REF}\`
**Source branch:** \`${HEAD_REF:-unknown}\`" \
		--draft >"$create_log" 2>&1; then
		CONFLICT_FAILURE_ERROR="$(cat "$create_log")"
		rm -f "$create_log"
		echo "::warning:: Failed to create draft PR for ${conflict_branch}"
		printf '%s\n' "$CONFLICT_FAILURE_ERROR"
		return 1
	fi

	CONFLICT_PR_URL="$(tr -d '\r' <"$create_log" | tail -n 1)"
	rm -f "$create_log"
	echo "::notice:: Created draft PR for manual conflict resolution: ${conflict_branch}"
}

create_success_pr() {
	local target="$1"
	local sync_branch="$2"
	local -a assignee_args

	readarray -t assignee_args < <(pr_assignee_args)

	if gh pr list --head "$sync_branch" --base "$target" --state open | grep -q .; then
		echo "PR already exists for branch ${sync_branch} -> ${target}, skipping creation"
		return 0
	fi

	local pr_url new_pr create_log push_output
	create_log="$(mktemp)"
	if ! gh pr create \
		--base "$target" \
		--head "$sync_branch" \
		"${assignee_args[@]}" \
		--label "auto-reviewed" \
		--title "${SANITIZED_PR_TITLE}" \
		--body "Automatic sync PR created after [#${PR_NUMBER}](${ORIG_URL}) was merged into \`${BASE_REF}\`.

**Target branch:** \`${target}\`
**Source:** ${SOURCE_REPO}
**Source branch:** \`${HEAD_REF:-unknown}\`
**Original author:** @${PR_USER_LOGIN}" >"$create_log" 2>&1; then
		SUCCESS_PR_ERROR="$(cat "$create_log")"
		rm -f "$create_log"
		printf '%s\n' "$SUCCESS_PR_ERROR"
		return 1
	fi

	pr_url="$(cat "$create_log")"
	rm -f "$create_log"
	printf '%s\n' "$pr_url"

	new_pr="$(echo "$pr_url" | grep -oE '/pull/[0-9]+' | grep -oE '[0-9]+' || echo "")"

	if [ -z "$new_pr" ]; then
		return 0
	fi

	if [ "${USING_PAT:-false}" = "true" ]; then
		echo "::notice:: PR #${new_pr} created with PAT - workflows will trigger automatically"
		return 0
	fi

	echo "Created PR #${new_pr} with GITHUB_TOKEN, triggering workflows via empty commit..."
	git commit --allow-empty -m "Trigger workflows for PR #${new_pr}"
	if ! push_output="$(git push origin "$sync_branch" 2>&1)"; then
		SUCCESS_PR_ERROR="$push_output"
		printf '%s\n' "$push_output"
		return 1
	fi
	echo "::notice:: Triggered workflows for PR #${new_pr}"
}

sync_to_target() {
	local target="$1"
	local target_safe sync_branch conflict_branch worktree_path failure_message

	LAST_SYNC_ERROR=""
	CONFLICT_PR_URL=""
	CONFLICT_FAILURE_ERROR=""
	SUCCESS_PR_ERROR=""

	target_safe="$(target_to_safe "$target")"
	sync_branch="${SYNC_BRANCH_PREFIX}${PR_NUMBER}_to_${target_safe}"
	conflict_branch="${sync_branch}_conflicts"
	worktree_path="${WORKTREE_ROOT}/${target_safe}"

	if ! git show-ref --verify --quiet "refs/remotes/origin/${target}"; then
		echo "::warning:: Branch ${target} does not exist - skipping"
		return 0
	fi

	git worktree remove --force "$worktree_path" 2>/dev/null || true
	rm -rf "$worktree_path"
	mkdir -p "$WORKTREE_ROOT"

	local worktree_output
	if ! worktree_output="$(git worktree add -B "$sync_branch" "$worktree_path" "origin/${target}" 2>&1)"; then
		echo "::warning:: Failed to create worktree for ${target} - skipping"
		printf '%s\n' "$worktree_output"
		comment_on_original_pr "$target" "$worktree_output"
		return 0
	fi

	pushd "$worktree_path" >/dev/null

	if ! apply_merged_content "$MERGE_SHA"; then
		echo "::error:: Merge conflicts detected for PR #${PR_NUMBER} on branch ${target}"
		create_conflict_pr "$target" "$sync_branch" "$conflict_branch" || true
		failure_message="$LAST_SYNC_ERROR"
		if [ -n "$CONFLICT_PR_URL" ]; then
			failure_message="${failure_message}"$'\n\n'"Draft PR: ${CONFLICT_PR_URL}"
		fi
		if [ -n "$CONFLICT_FAILURE_ERROR" ]; then
			failure_message="${failure_message}"$'\n\n'"${CONFLICT_FAILURE_ERROR}"
		fi
		comment_on_original_pr "$target" "$failure_message"
		popd >/dev/null
		git worktree remove --force "$worktree_path" 2>/dev/null || true
		return 0
	fi

	if ! has_changes_vs_target "$target"; then
		echo "::notice:: No changes to sync for PR #${PR_NUMBER} on ${target} - skipping PR creation"
		popd >/dev/null
		git worktree remove --force "$worktree_path" 2>/dev/null || true
		git push origin --delete "$sync_branch" 2>/dev/null || true
		return 0
	fi

	echo "Merged PR content for ${target}"

	local push_output
	if ! push_output="$(git push --force-with-lease origin "$sync_branch" 2>&1)"; then
		echo "::warning:: Failed to push branch ${sync_branch}"
		printf '%s\n' "$push_output"
		comment_on_original_pr "$target" "$push_output"
		popd >/dev/null
		git worktree remove --force "$worktree_path" 2>/dev/null || true
		return 0
	fi

	if ! create_success_pr "$target" "$sync_branch"; then
		comment_on_original_pr "$target" "$SUCCESS_PR_ERROR"
	fi

	popd >/dev/null
	git worktree remove --force "$worktree_path" 2>/dev/null || true
}

TARGETS_CSV="$(resolve_targets_csv "$BASE_REF")"
if [ -z "$TARGETS_CSV" ]; then
	echo "No sync targets configured for base branch: ${BASE_REF}"
	exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"

sanitize_pr_title

IFS=',' read -ra TARGETS <<< "$TARGETS_CSV"
for target in "${TARGETS[@]}"; do
	sync_to_target "$target"
done

rm -rf "$WORKTREE_ROOT"
