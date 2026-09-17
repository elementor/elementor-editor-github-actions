# Visual proof author

Writes `## Visual proof` on a PR body when that section is still missing.
Ported from Core so Elementor and Elementor Pro share one implementation.

If the caller checkout has `.cursor/skills/visual-proof/SKILL.md`, that file
wins. Otherwise the bundled skill in this action’s `skill.md` is used.

## Usage

```yaml
name: Visual proof author

on:
  pull_request:
    types: [opened, ready_for_review]

permissions:
  contents: read
  pull-requests: write

jobs:
  author:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-22.04
    timeout-minutes: 8
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          ref: ${{ github.event.pull_request.head.sha }}

      - uses: elementor/elementor-editor-github-actions/actions/visual-proof-author@main
        with:
          pr-number: ${{ github.event.pull_request.number }}
          pr-head-sha: ${{ github.event.pull_request.head.sha }}
          pr-base-sha: ${{ github.event.pull_request.base.sha }}
          product-name: 'Elementor'
          cursor-api-key: ${{ secrets.CURSOR_APIKEY }}
          model: ${{ vars.PR_REVIEW_MODEL }}
```

Use `product-name: 'Elementor Pro'` in Pro.

## Intentional non-blocking behavior

The action runs with `continue-on-error: true` because the **Visual proof**
section is optional for contributors. Author failures (timeout, missing skill,
API errors) do not block the PR workflow. The shots action will fall back to
a generic Playground walk when the section is missing or marked `#skip_proof`.
