# Cherry Pick Release Branches

Automatically cherry-picks merged PRs across the release branch cascade using isolated git worktrees.

## Cascade rules

| Merged into | Cherry-pick targets |
| --- | --- |
| `release/stable` | `release/beta`, `main` |
| `release/beta` | `main` |

Branch names are configurable via inputs.

## Usage

The calling workflow must check out the target repository with `fetch-depth: 0` before invoking this action.

```yaml
permissions:
  contents: write
  pull-requests: write

steps:
  - uses: actions/checkout@v6
    with:
      fetch-depth: 0
      token: ${{ secrets.GH_PAT || secrets.GITHUB_TOKEN }}

  - uses: elementor/elementor-editor-github-actions/actions/cherry-pick-release-branches@main
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
```

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `token` | yes | — | GitHub token with `contents: write` and `pull-requests: write` |
| `base-ref` | yes | — | Branch the source PR was merged into |
| `pr-number` | yes | — | Source PR number |
| `merge-sha` | yes | — | Merge commit SHA |
| `pr-title` | yes | — | Source PR title |
| `pr-user-login` | yes | — | Source PR author |
| `pr-url` | yes | — | Source PR URL |
| `source-repo` | yes | — | Head repo (`owner/repo`) |
| `using-pat` | no | `false` | Set to `true` when using `GH_PAT` |
| `stable-branch` | no | `release/stable` | Stable branch name |
| `beta-branch` | no | `release/beta` | Beta branch name |
| `main-branch` | no | `main` | Main branch name |

## Behavior

- Creates one git worktree per target branch under `$RUNNER_TEMP/cherry-pick-worktrees/`
- Opens a PR on success, or a draft PR with conflict markers on failure
- Skips targets whose remote branch does not exist
- Uses `-m 1` only for merge commits; squash merges use plain `git cherry-pick`
