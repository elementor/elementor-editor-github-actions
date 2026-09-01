# Post-release verify

Checks a published Elementor Core (and optionally Pro) release. This is the API/zip half of the post-release checklist — it does not scrape wordpress.org HTML.

## What it checks

1. GitHub release API for `elementor/elementor` (`/releases/tags/{version}`) and, if requested, `elementor/elementor-pro`.
2. Non-empty changelog section for that version on `main` (`changelog.txt`; Core also `readme.txt`).
3. wordpress.org SVN tag `readme.txt`: `Stable tag` and changelog (Core GA only). A 404 is **skipped**, not failed — `.org` can lag GitHub by up to a day.
4. Downloaded zip headers: Core `Version` / `ELEMENTOR_VERSION` / `Stable tag`; Pro `Version`, required Core (must be satisfied by the Core version you passed), recommended Core (warn on mismatch).

Does **not** check `elementor.com/changelog` or the wordpress.org plugin HTML page.

Changelog prose is dumped on the job summary for a quick human read. The action does not judge wording.

## Inputs

| Input                | Required | Notes                                                                                                                                                         |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core-version`       | yes      | e.g. `4.2.2`                                                                                                                                                  |
| `pro-version`        | no       | Empty = Core-only                                                                                                                                             |
| `github-token`       | yes      | `github.token` is enough for public Core. **Pro needs a PAT** with `repo` on `elementor/elementor-pro` (same token used for releases, e.g. `MAINTAIN_TOKEN`). |
| `skip-wordpress-org` | no       | Force-skip SVN/download even if the tag exists                                                                                                                |
| `dry-run`            | no       | Write failures to the summary without failing the step                                                                                                        |

## Outputs

- `core-zip-path` / `pro-zip-path` — downloaded zips for the smoke job
- `failed` — `true` if any hard check failed

## Call from Core or Pro

Add a thin workflow in `elementor` / `elementor-pro` that `uses` this repo. Pin `uses:` and `actions_ref` to **the same git ref**. After this workflow is on `main`, that ref is `main`.

Merge this repo first. Core/Pro callers that pin `@main` will fail until then.

This repo must allow GitHub Actions access from other Elementor repositories (Settings → Actions → General → Access).

Pass `MAINTAIN_TOKEN` from Core/Pro. `github.token` from _this_ repo cannot read private Pro; the caller’s `github.token` can read its own repo.

Core (`.github/workflows/post-release-check.yml`):

```yaml
name: Post-Release Check

on:
  workflow_dispatch:
    inputs:
      core_version:
        description: 'Core version (e.g. 4.2.3)'
        required: true
        type: string
      pro_version:
        description: 'Pro version. Leave empty for Core-only.'
        required: false
        type: string
        default: ''
      skip_wordpress_org:
        type: boolean
        default: false
      skip_smoke:
        type: boolean
        default: false

permissions:
  contents: read
  actions: write

jobs:
  post-release-check:
    if: github.repository_owner == 'elementor'
    uses: elementor/elementor-editor-github-actions/.github/workflows/post-release-check.yml@main
    with:
      core_version: ${{ inputs.core_version }}
      pro_version: ${{ inputs.pro_version }}
      skip_wordpress_org: ${{ inputs.skip_wordpress_org }}
      skip_smoke: ${{ inputs.skip_smoke }}
      actions_ref: main
    secrets:
      MAINTAIN_TOKEN: ${{ secrets.MAINTAIN_TOKEN }}
```

Pro: same file, require `pro_version`, make `core_version` optional (empty = current wordpress.org Core), and pass both into `with:`.
