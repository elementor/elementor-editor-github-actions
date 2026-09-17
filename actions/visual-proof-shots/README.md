# Visual proof shots

After `playground-preview` succeeds, records Playground PNGs and a short clip.
When the caller skips Playground on `ready_for_review` (draft marked ready),
the job should still run if a `playground-preview` deployment already exists
for the head SHA.

A Cursor storyboard actor follows **Steps**; if that produces no shots, CI
falls back to Pages → Add New → Edit with Elementor.

Needs job permissions `contents: write` and `pull-requests: write` so images
can land on `ci/visual-proof-assets` in the **calling** repo.

## Usage

```yaml
visual-proof-shots:
  name: Visual proof shots
  needs: [playground-preview]
  if: |
    always() &&
    github.event.pull_request.draft == false &&
    github.event.action != 'labeled' &&
    github.event.pull_request.head.repo.full_name == github.repository &&
    (
      needs.playground-preview.result == 'success' ||
      github.event.action == 'ready_for_review'
    )
  runs-on: ubuntu-22.04
  timeout-minutes: 25
  permissions:
    contents: write
    pull-requests: write
    deployments: read
  steps:
    - uses: actions/checkout@v6

    - uses: elementor/elementor-editor-github-actions/actions/visual-proof-shots@main
      with:
        pr-number: ${{ github.event.pull_request.number }}
        head-sha: ${{ github.event.pull_request.head.sha }}
        product-name: 'Elementor'
        cursor-api-key: ${{ secrets.CURSOR_APIKEY }}
        model: ${{ vars.PR_REVIEW_MODEL }}
```

Use `product-name: 'Elementor Pro'` in Pro. The environment name must stay
`playground-preview`.
