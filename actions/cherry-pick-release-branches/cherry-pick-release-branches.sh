#!/usr/bin/env bash
set -euo pipefail

# Cherry-pick a merged PR to downstream release branches using isolated git worktrees.
#
# Required environment variables:
#   BASE_REF       - branch the PR was merged into (e.g. release/stable)
#   PR_NUMBER      - merged PR number
#   MERGE_SHA      - merge commit SHA to cherry-pick
#   PR_TITLE       - original PR title
#   PR_USER_LOGIN  - original PR author login
#   ORIG_URL       - original PR URL
#   SOURCE_REPO    - head repo full name
#
# Optional:
#   USING_PAT      - "true" when a PAT is used (workflows trigger automatically)
#   STABLE_BRANCH  - default: release/stable
#   BETA_BRANCH    - default: release/beta
#   MAIN_BRANCH    - default: main
#   JIRA_TICKET_PATTERN - regex for Jira ticket extraction (default: [A-Z]{2,10}-[0-9]+)

JIRA_TICKET_PATTERN="${JIRA_TICKET_PATTERN:-[A-Z]{2,10}-[0-9]+}"
WORKTREE_ROOT="${RUNNER_TEMP:-/tmp}/cherry-pick-worktrees"
STABLE_BRANCH="${STABLE_BRANCH:-release/stable}"
BETA_BRANCH="${BETA_BRANCH:-release/beta}"
MAIN_BRANCH="${MAIN_BRANCH:-main}"

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

run_cherry_pick() {
	local merge_sha="$1"

	if is_merge_commit "$merge_sha"; then
		git cherry-pick -m 1 "$merge_sha"
	else
		git cherry-pick "$merge_sha"
	fi
}

extract_pr_title_parts() {
	local sanitized_title type ticket ticket_suffix title_body

	sanitized_title="$(sanitize_title "$PR_TITLE")"

	type="$(echo "$sanitized_title" | grep -oE '^[A-Za-z]+:' | head -1)"
	if [ -z "$type" ]; then
		type="Internal:"
	fi

	ticket="$(echo "$sanitized_title" | grep -oE "$JIRA_TICKET_PATTERN" | head -1)"
	if [ -n "$ticket" ]; then
		ticket_suffix=" [${ticket}]"
	else
		ticket_suffix=" [NO-TICKET]"
	fi

	title_body="$(echo "$sanitized_title" | sed 's/^[A-Za-z]*: *//')"

	PR_TITLE_TYPE="$type"
	PR_TITLE_BODY="$title_body"
	PR_TICKET_SUFFIX="$ticket_suffix"
}

create_conflict_pr() {
	local target="$1"
	local cp_branch="$2"
	local conflict_branch="$3"

	git add .
	git commit -m "Cherry-pick PR #${PR_NUMBER} with conflicts - manual resolution needed"

	if ! git push --force-with-lease origin "${cp_branch}:${conflict_branch}"; then
		echo "::warning:: Failed to push conflict branch ${conflict_branch}"
		git cherry-pick --abort
		return 1
	fi

	if gh pr list --head "$conflict_branch" --base "$target" --state open | grep -q .; then
		echo "::notice:: Draft PR already exists for conflict resolution: ${conflict_branch}"
		return 0
	fi

	gh pr create \
		--base "$target" \
		--head "$conflict_branch" \
		--assignee "$PR_USER_LOGIN" \
		--label "auto-reviewed" \
		--title "${PR_TITLE_TYPE} Cherry-pick PR ${PR_NUMBER} to ${target} with conflicts: ${PR_TITLE_BODY}" \
		--body "⚠️ **Manual Resolution Required**

This cherry-pick of [#${PR_NUMBER}](${ORIG_URL}) to \`${target}\` branch has conflicts that need manual resolution.

**Conflict Files:**
The conflicted files are included in this branch with conflict markers.

**Resolution Steps:**
1. Check out this branch: \`git checkout ${conflict_branch}\`
2. Resolve conflicts in the marked files
3. Stage resolved files: \`git add <resolved-files>\`
4. Amend the commit: \`git commit --amend\`
5. Push changes: \`git push --force-with-lease\`
6. Mark this PR as ready for review

**Original PR:** [#${PR_NUMBER}](${ORIG_URL})
**Trigger:** Automatic cascade from merge to \`${BASE_REF}\`" \
		--draft

	echo "::notice:: Created draft PR for manual conflict resolution: ${conflict_branch}"
}

create_success_pr() {
	local target="$1"
	local cp_branch="$2"

	if gh pr list --head "$cp_branch" --base "$target" --state open | grep -q .; then
		echo "PR already exists for branch ${cp_branch} -> ${target}, skipping creation"
		return 0
	fi

	local pr_url new_pr
	pr_url="$(gh pr create \
		--base "$target" \
		--head "$cp_branch" \
		--assignee "$PR_USER_LOGIN" \
		--label "auto-reviewed" \
		--title "${PR_TITLE_TYPE} Cherry-pick PR ${PR_NUMBER} to ${target}: ${PR_TITLE_BODY}" \
		--body "Automatic cherry-pick of [#${PR_NUMBER}](${ORIG_URL}) to \`${target}\` branch.

**Source:** ${SOURCE_REPO}
**Original Author:** @${PR_USER_LOGIN}
**Trigger:** Automatic cascade from merge to \`${BASE_REF}\`")"

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
	git push origin "$cp_branch"
	echo "::notice:: Triggered workflows for PR #${new_pr}"
}

cherry_pick_to_target() {
	local target="$1"
	local target_safe cp_branch conflict_branch worktree_path

	target_safe="$(target_to_safe "$target")"
	cp_branch="cherry-pick-pr${PR_NUMBER}_to_${target_safe}"
	conflict_branch="${cp_branch}_conflicts"
	worktree_path="${WORKTREE_ROOT}/${target_safe}"

	if ! git show-ref --verify --quiet "refs/remotes/origin/${target}"; then
		echo "::warning:: Branch ${target} does not exist - skipping"
		return 0
	fi

	git worktree remove --force "$worktree_path" 2>/dev/null || true
	rm -rf "$worktree_path"
	mkdir -p "$WORKTREE_ROOT"

	if ! git worktree add -B "$cp_branch" "$worktree_path" "origin/${target}"; then
		echo "::warning:: Failed to create worktree for ${target} - skipping"
		return 0
	fi

	pushd "$worktree_path" >/dev/null

	if ! run_cherry_pick "$MERGE_SHA"; then
		echo "::error:: Cherry-pick conflicts detected for PR #${PR_NUMBER} on branch ${target}"
		create_conflict_pr "$target" "$cp_branch" "$conflict_branch" || true
		popd >/dev/null
		git worktree remove --force "$worktree_path" 2>/dev/null || true
		return 0
	fi

	echo "Cherry-pick successful for ${target}"

	if ! git push --force-with-lease origin "$cp_branch"; then
		echo "::warning:: Failed to push branch ${cp_branch}"
		popd >/dev/null
		git worktree remove --force "$worktree_path" 2>/dev/null || true
		return 0
	fi

	create_success_pr "$target" "$cp_branch"

	popd >/dev/null
	git worktree remove --force "$worktree_path" 2>/dev/null || true
}

TARGETS_CSV="$(resolve_targets_csv "$BASE_REF")"
if [ -z "$TARGETS_CSV" ]; then
	echo "No cherry-pick targets configured for base branch: ${BASE_REF}"
	exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"

extract_pr_title_parts

IFS=',' read -ra TARGETS <<< "$TARGETS_CSV"
for target in "${TARGETS[@]}"; do
	cherry_pick_to_target "$target"
done

rm -rf "$WORKTREE_ROOT"
