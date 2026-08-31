# Sync Release Branches

Creates downstream PRs after a release-branch merge using isolated git worktrees. The action merges the **PR source branch** (for merge commits) or applies the **squash commit patch** (for squash/rebase merges), then opens a normal PR with the original title.

## Cascade rules

| Merged into      | PR targets             |
| ---------------- | ---------------------- |
| `release/stable` | `release/beta`, `main` |
| `release/beta`   | `main`                 |

Branch names are configurable via inputs.

## Usage

The calling workflow must check out the target repository with `fetch-depth: 0` before invoking this action. Skip PRs whose head branch starts with `sync-pr` or `cherry-pick-pr` to avoid cascade loops.

```yaml
permissions:
  contents: write
  pull-requests: write

steps:
  - uses: actions/checkout@v6
    with:
      fetch-depth: 0
      token: ${{ secrets.GH_PAT || secrets.GITHUB_TOKEN }}

  - uses: elementor/elementor-editor-github-actions/actions/sync-release-branches@main
    with:
      token: ${{ secrets.GH_PAT || secrets.GITHUB_TOKEN }}
      using-pat: ${{ secrets.GH_PAT != '' }}
      base-ref: ${{ github.event.pull_request.base.ref }}
      pr-number: ${{ github.event.pull_request.number }}
      merge-sha: ${{ github.event.pull_request.merge_commit_sha }}
      pr-title: ${{ github.event.pull_request.title }}
      pr-user-login: ${{ github.event.pull_request.user.login }}
      pr-url: ${{ github.event.pull_request.html_url }}
      source-repo: ${{ github.event.pull_request.head.repo.full_name }}
      head-ref: ${{ github.event.pull_request.head.ref }}
```

## Inputs

| Input           | Required | Default          | Description                                                    |
| --------------- | -------- | ---------------- | -------------------------------------------------------------- |
| `token`         | yes      | —                | GitHub token with `contents: write` and `pull-requests: write` |
| `base-ref`      | yes      | —                | Branch the source PR was merged into                           |
| `pr-number`     | yes      | —                | Source PR number                                               |
| `merge-sha`     | yes      | —                | Merge commit SHA                                               |
| `pr-title`      | yes      | —                | Source PR title (reused for downstream PR title)               |
| `pr-user-login` | yes      | —                | Source PR author                                               |
| `pr-url`        | yes      | —                | Source PR URL                                                  |
| `source-repo`   | yes      | —                | Head repo (`owner/repo`)                                       |
| `head-ref`      | no       | `''`             | Source PR head branch                                          |
| `using-pat`     | no       | `false`          | Set to `true` when using `GH_PAT`                              |
| `stable-branch` | no       | `release/stable` | Stable branch name                                             |
| `beta-branch`   | no       | `release/beta`   | Beta branch name                                               |
| `main-branch`   | no       | `main`           | Main branch name                                               |

## Behavior

- Creates one git worktree per target branch under `$RUNNER_TEMP/release-sync-worktrees/`
- **Merge commits:** `git merge --no-ff` of the PR head (`merge-sha^2`) into each target
- **Squash/rebase commits:** applies only that commit's patch (`git diff parent..merge-sha`) and commits on the sync branch
- Opens a PR with the **same title** as the merged PR
- Skips PR creation when the target branch already contains the changes
- Opens a draft PR with conflict markers when the merge/apply fails
- Skips targets whose remote branch does not exist
